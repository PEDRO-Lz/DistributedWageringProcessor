import type { EntityManager } from "@mikro-orm/postgresql";
import {
  CurrencyMismatchError,
  InsufficientBalanceError,
  InvariantViolationError,
} from "../../shared/kernel/errors";
import { FailureCode } from "../../shared/kernel/failure-code";
import { LedgerDirection } from "../../shared/kernel/ledger-direction";
import { newId } from "../../shared/kernel/id";
import {
  NOOP_METRICS,
  type MetricsPort,
} from "../../shared/metrics/metrics.port";
import type { EventContext } from "../../shared/kernel/integration-event";
import { OutboxMessage } from "../../messaging/outbox/outbox-message";
import type { OutboxRepositoryPort } from "../../messaging/outbox/outbox-repository.port";
import type { WalletRepositoryPort } from "../../wallets/application/ports/wallet-repository.port";
import type { WalletLedgerRepositoryPort } from "../../wallets/application/ports/wallet-ledger-repository.port";
import type { Wallet } from "../../wallets/domain/wallet";
import { WalletBalanceChanged } from "../../wallets/domain/events/wallet-balance-changed.event";
import type { WagerTransactionRepositoryPort } from "./ports/wager-transaction-repository.port";
import type { ReferenceResolution } from "./reference-resolution";
import { WagerTransaction } from "../domain/wager-transaction";
import { WagerTransactionKind } from "../domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../domain/wager-transaction-status.enum";
import { WagerTransactionProcessed } from "../domain/events/wager-transaction-processed.event";
import { WagerTransactionRejected } from "../domain/events/wager-transaction-rejected.event";
import { WagerTransactionPendingReference } from "../domain/events/wager-transaction-pending-reference.event";

const REVERSAL_ALLOWED_REFERENCE_KINDS = new Set([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Refund,
]);

export interface ApplyEffectResult {
  wallet: Wallet;
}

/**
 * Concentra tudo que decide "o que fazer com essa WagerTransaction depois
 * que ela já foi reivindicada (claim)": resolver referência, aplicar o
 * efeito no saldo (ou não, se for LOSS), publicar os eventos certos.
 */
export class WagerTransactionFinalizer {
  constructor(
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
    private readonly walletRepository: WalletRepositoryPort,
    private readonly ledgerRepository: WalletLedgerRepositoryPort,
    private readonly outboxRepository: OutboxRepositoryPort,
    private readonly metrics: MetricsPort = NOOP_METRICS,
  ) {}

  // Só leitura: essa referência existe? pertence ao mesmo dono? tipo compatível?
  // está num estado resolvível? valor bate? já foi revertida antes desse jeito?
  async resolveReference(
    em: EntityManager,
    tx: WagerTransaction,
  ): Promise<ReferenceResolution> {
    const refExtId = tx.referenceExternalTransactionId;
    if (!refExtId) {
      throw new InvariantViolationError(
        "resolveReference chamado numa transação sem referência",
      );
    }

    const reference =
      await this.wagerTransactionRepository.findByProviderAndExternalId(
        em,
        tx.providerId,
        refExtId,
      );
    if (!reference) {
      return { outcome: "pending" };
    }

    const sameOwner =
      reference.playerId === tx.playerId &&
      reference.walletId === tx.walletId &&
      reference.roundId === tx.roundId &&
      reference.money.currency === tx.money.currency;
    if (!sameOwner) {
      return {
        outcome: "rejected",
        failureCode: FailureCode.ReferenceMismatch,
      };
    }

    const validKind =
      tx.kind === WagerTransactionKind.Refund
        ? reference.kind === WagerTransactionKind.Bet
        : REVERSAL_ALLOWED_REFERENCE_KINDS.has(reference.kind);
    if (!validKind) {
      return {
        outcome: "rejected",
        failureCode: FailureCode.ReferenceInvalidKind,
      };
    }

    if (
      reference.status === WagerTransactionStatus.Pending ||
      reference.status === WagerTransactionStatus.PendingReference
    ) {
      return { outcome: "pending" };
    }
    if (
      reference.status === WagerTransactionStatus.Rejected ||
      reference.status === WagerTransactionStatus.Failed
    ) {
      return {
        outcome: "rejected",
        failureCode: FailureCode.ReferenceInvalidState,
      };
    }

    // A partir daqui, reference.status é PROCESSED.
    if (!tx.money.equals(reference.money)) {
      return {
        outcome: "rejected",
        failureCode: FailureCode.ReferenceAmountMismatch,
      };
    }

    const alreadyReversed =
      await this.wagerTransactionRepository.findProcessedReversal(
        em,
        reference.id,
        tx.kind,
      );
    if (alreadyReversed) {
      return {
        outcome: "rejected",
        failureCode: FailureCode.ReferenceAlreadyReversed,
      };
    }

    return { outcome: "resolved", reference };
  }

  async markPendingReference(
    em: EntityManager,
    tx: WagerTransaction,
    ctx: EventContext,
  ): Promise<void> {
    tx.markPendingReference();
    await this.wagerTransactionRepository.save(em, tx);
    this.outboxRepository.insert(
      em,
      OutboxMessage.enqueue(WagerTransactionPendingReference.from(tx, ctx)),
    );
  }

  async reject(
    em: EntityManager,
    tx: WagerTransaction,
    failureCode: FailureCode,
    ctx: EventContext,
  ): Promise<void> {
    tx.reject(failureCode, ctx.now);
    await this.wagerTransactionRepository.save(em, tx);
    this.outboxRepository.insert(
      em,
      OutboxMessage.enqueue(WagerTransactionRejected.from(tx, ctx)),
    );
    this.recordOutcome(tx);
  }

  /**
   * `wallet` já vem travado (FOR UPDATE) por quem chamou, ANTES de reivindicar
   * a linha de `tx`: essa ordem evita um deadlock real sob concorrência
   * genuína (ver submit-wager-transaction.use-case.ts)
   */
  async applyEffect(
    em: EntityManager,
    tx: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransaction | undefined,
    ctx: EventContext,
  ): Promise<ApplyEffectResult> {
    if (!tx.affectsBalance()) {
      // LOSS: processada, mas sem tocar no saldo nem gerar lançamento.
      tx.markProcessed(reference?.id, ctx.now);
      await this.wagerTransactionRepository.save(em, tx);
      this.outboxRepository.insert(
        em,
        OutboxMessage.enqueue(
          WagerTransactionProcessed.from(tx, wallet.balance, ctx),
        ),
      );
      this.recordOutcome(tx);
      return { wallet };
    }

    const direction = tx.ledgerDirectionFor(reference);
    const movementCtx = {
      transactionId: tx.id,
      ledgerEntryId: newId(),
      now: ctx.now,
    };

    try {
      const entry =
        direction === LedgerDirection.Debit
          ? wallet.debit(tx.money, movementCtx)
          : wallet.credit(tx.money, movementCtx);

      this.ledgerRepository.insert(em, entry);
      await this.walletRepository.save(em, wallet);
      tx.markProcessed(reference?.id, ctx.now);
      await this.wagerTransactionRepository.save(em, tx);

      this.outboxRepository.insert(
        em,
        OutboxMessage.enqueue(
          WagerTransactionProcessed.from(tx, wallet.balance, ctx),
        ),
      );
      this.outboxRepository.insert(
        em,
        OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, ctx)),
      );
      this.recordOutcome(tx);

      return { wallet };
    } catch (err) {
      const failureCode = this.classifyApplyFailure(err, tx.kind);
      if (!failureCode) {
        throw err;
      }
      await this.reject(em, tx, failureCode, ctx);
      return { wallet };
    }
  }

  private classifyApplyFailure(
    err: unknown,
    kind: WagerTransactionKind,
  ): FailureCode | undefined {
    if (err instanceof InsufficientBalanceError) {
      // Diferente de propósito: reversão sem saldo não é a mesma situação
      // que uma aposta sem saldo (seção 7 do desafio)
      return kind === WagerTransactionKind.Rollback
        ? FailureCode.RollbackInsufficientBalance
        : FailureCode.InsufficientBalance;
    }
    if (err instanceof CurrencyMismatchError) {
      return FailureCode.WalletCurrencyMismatch;
    }
    return undefined;
  }

  private recordOutcome(tx: WagerTransaction): void {
    this.metrics.incrementCounter("wager_transactions_total", {
      status: tx.status,
      kind: tx.kind,
    });
  }
}
