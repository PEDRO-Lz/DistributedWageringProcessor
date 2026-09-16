import { LockMode, type EntityManager } from "@mikro-orm/postgresql";
import { UniqueConstraintViolationException } from "@mikro-orm/core";
import {
  IdempotencyConflictError,
  InvariantViolationError,
  TransientProcessingError,
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from "../../../shared/kernel/errors";
import { newId } from "../../../shared/kernel/id";
import type { Money } from "../../../shared/kernel/money";
import {
  NOOP_METRICS,
  type MetricsPort,
} from "../../../shared/metrics/metrics.port";
import type { WalletRepositoryPort } from "../../../wallets/application/ports/wallet-repository.port";
import type { WagerTransactionRepositoryPort } from "../ports/wager-transaction-repository.port";
import { WagerTransaction } from "../../domain/wager-transaction";
import { WagerTransactionKind } from "../../domain/wager-transaction-kind.enum";
import { computePayloadHash } from "../payload-hash";
import { WagerTransactionFinalizer } from "../wager-transaction-finalizer";

export interface SubmitWagerTransactionCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  correlationId?: string;
  causationId?: string;
}

export interface SubmitWagerTransactionResult {
  transaction: WagerTransaction;
  idempotentReplay: boolean;
  balance: Money;
}

export class SubmitWagerTransactionUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly finalizer: WagerTransactionFinalizer,
    private readonly walletRepository: WalletRepositoryPort,
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
    private readonly metrics: MetricsPort = NOOP_METRICS,
  ) {}

  async execute(
    cmd: SubmitWagerTransactionCommand,
  ): Promise<SubmitWagerTransactionResult> {
    if (cmd.kind === WagerTransactionKind.Opening) {
      throw new InvariantViolationError(
        "WagerTransactionKind.OPENING não pode ser submetido externamente",
      );
    }

    const payloadHash = computePayloadHash({
      providerId: cmd.providerId,
      externalTransactionId: cmd.externalTransactionId,
      playerId: cmd.playerId,
      walletId: cmd.walletId,
      roundId: cmd.roundId,
      gameId: cmd.gameId,
      kind: cmd.kind,
      money: cmd.money.toJSON(),
      referenceExternalTransactionId: cmd.referenceExternalTransactionId,
    });

    try {
      return await this.em.transactional((em) =>
        this.processNew(em, cmd, payloadHash),
      );
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        return this.handleClaimConflict(cmd, payloadHash);
      }
      throw err;
    }
  }

  private async processNew(
    em: EntityManager,
    cmd: SubmitWagerTransactionCommand,
    payloadHash: string,
  ): Promise<SubmitWagerTransactionResult> {
    const now = new Date();

    // Trava a wallet ANTES de reivindicar a linha de wager_transactions,
    // nunca depois: invertido, isso deadlockaria sob concorrência real (um
    // INSERT que referencia wallet_id pega um FOR KEY SHARE implícito;
    // duas transações concorrentes conseguem os dois esse shared lock, e
    // então cada uma trava esperando a outra soltar pra fazer o upgrade
    // pra FOR UPDATE). Travando primeiro, nunca existe essa inversão.
    const wallet = await this.walletRepository.findById(
      em,
      cmd.walletId,
      LockMode.PESSIMISTIC_WRITE,
    );
    if (!wallet) {
      throw new WalletNotFoundError(cmd.walletId);
    }
    if (wallet.playerId !== cmd.playerId) {
      throw new WalletPlayerMismatchError(cmd.walletId, cmd.playerId);
    }

    const tx = WagerTransaction.create({
      id: newId(),
      providerId: cmd.providerId,
      externalTransactionId: cmd.externalTransactionId,
      idempotencyKey: cmd.idempotencyKey,
      payloadHash,
      walletId: cmd.walletId,
      playerId: cmd.playerId,
      roundId: cmd.roundId,
      gameId: cmd.gameId,
      kind: cmd.kind,
      money: cmd.money,
      referenceExternalTransactionId: cmd.referenceExternalTransactionId,
      createdAt: now,
    });

    // Claim-first: esse flush lança UniqueConstraintViolationException se
    // outra instância já commitou essa idempotencyKey (ou esse par
    // provider+externalTransactionId) primeiro. Ver execute().
    await this.wagerTransactionRepository.claim(em, tx);

    const ctx = {
      correlationId: cmd.correlationId ?? newId(),
      causationId: cmd.causationId,
      now,
    };

    if (tx.requiresReference()) {
      const resolution = await this.finalizer.resolveReference(em, tx);
      if (resolution.outcome === "pending") {
        await this.finalizer.markPendingReference(em, tx, ctx);
        return {
          transaction: tx,
          idempotentReplay: false,
          balance: wallet.balance,
        };
      }
      if (resolution.outcome === "rejected") {
        await this.finalizer.reject(em, tx, resolution.failureCode, ctx);
        return {
          transaction: tx,
          idempotentReplay: false,
          balance: wallet.balance,
        };
      }
      const applied = await this.finalizer.applyEffect(
        em,
        tx,
        wallet,
        resolution.reference,
        ctx,
      );
      return {
        transaction: tx,
        idempotentReplay: false,
        balance: applied.wallet.balance,
      };
    }

    const applied = await this.finalizer.applyEffect(
      em,
      tx,
      wallet,
      undefined,
      ctx,
    );
    return {
      transaction: tx,
      idempotentReplay: false,
      balance: applied.wallet.balance,
    };
  }

  private async handleClaimConflict(
    cmd: SubmitWagerTransactionCommand,
    payloadHash: string,
  ): Promise<SubmitWagerTransactionResult> {
    const em = this.em.fork();

    const byKey = await this.wagerTransactionRepository.findByIdempotencyKey(
      em,
      cmd.idempotencyKey,
    );
    if (byKey) {
      if (!byKey.matchesPayload(payloadHash)) {
        throw new IdempotencyConflictError(cmd.idempotencyKey);
      }
      this.metrics.incrementCounter(
        "wager_transactions_idempotent_replays_total",
      );
      const wallet = await this.walletRepository.findById(em, byKey.walletId);
      return {
        transaction: byKey,
        idempotentReplay: true,
        balance: wallet?.balance ?? cmd.money,
      };
    }

    const byProviderExternal =
      await this.wagerTransactionRepository.findByProviderAndExternalId(
        em,
        cmd.providerId,
        cmd.externalTransactionId,
      );
    if (byProviderExternal) {
      throw new IdempotencyConflictError(
        cmd.idempotencyKey,
        "providerId/externalTransactionId já registrado sob outra Idempotency-Key",
      );
    }

    // Perdeu uma corrida de referência já revertida, garantida pelo banco). Seguro
    // pedir retry com a mesma Idempotency-Key.
    throw new TransientProcessingError(
      "Não foi possível resolver um conflito de unique constraint ao submeter a transação; tente de novo com a mesma Idempotency-Key",
    );
  }
}
