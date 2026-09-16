import type { EntityManager } from "@mikro-orm/postgresql";
import { UniqueConstraintViolationException } from "@mikro-orm/core";
import { DuplicateWalletError } from "../../../shared/kernel/errors";
import { newId } from "../../../shared/kernel/id";
import type { Money } from "../../../shared/kernel/money";
import {
  NOOP_METRICS,
  type MetricsPort,
} from "../../../shared/metrics/metrics.port";
import type { WalletRepositoryPort } from "../ports/wallet-repository.port";
import type { WalletLedgerRepositoryPort } from "../ports/wallet-ledger-repository.port";
import type { WagerTransactionRepositoryPort } from "../../../wagering/application/ports/wager-transaction-repository.port";
import type { OutboxRepositoryPort } from "../../../messaging/outbox/outbox-repository.port";
import { OutboxMessage } from "../../../messaging/outbox/outbox-message";
import { Wallet } from "../../domain/wallet";
import { WalletLedgerEntry } from "../../domain/wallet-ledger-entry";
import { LedgerDirection } from "../../../shared/kernel/ledger-direction";
import { WagerTransaction } from "../../../wagering/domain/wager-transaction";
import { WagerTransactionProcessed } from "../../../wagering/domain/events/wager-transaction-processed.event";
import { WalletBalanceChanged } from "../../domain/events/wallet-balance-changed.event";

export interface OpenWalletCommand {
  playerId: string;
  initialBalance: Money;
}

// Ainda uma classe simples
export class OpenWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepositoryPort,
    private readonly ledgerRepository: WalletLedgerRepositoryPort,
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
    private readonly outboxRepository: OutboxRepositoryPort,
    private readonly metrics: MetricsPort = NOOP_METRICS,
  ) {}

  async execute(cmd: OpenWalletCommand): Promise<Wallet> {
    const now = new Date();
    const wallet = Wallet.open({
      id: newId(),
      playerId: cmd.playerId,
      initialBalance: cmd.initialBalance,
      now,
    });

    try {
      await this.em.transactional(async (em) => {
        this.walletRepository.insert(em, wallet);
        // Coluna de FK escalar, sem @ManyToOne: o MikroORM não sabe que
        // precisa inserir a wallet antes da transação/lançamento que a
        // referenciam. Flush explícito garante a ordem certa.
        await em.flush();

        if (cmd.initialBalance.isPositive()) {
          const tx = WagerTransaction.createOpening({
            id: newId(),
            walletId: wallet.id,
            playerId: cmd.playerId,
            money: cmd.initialBalance,
            now,
          });
          this.wagerTransactionRepository.insert(em, tx);
          await em.flush();

          const entry = WalletLedgerEntry.create({
            id: newId(),
            walletId: wallet.id,
            transactionId: tx.id,
            direction: LedgerDirection.Credit,
            money: cmd.initialBalance,
            balanceBefore: cmd.initialBalance.subtract(cmd.initialBalance),
            balanceAfter: cmd.initialBalance,
            createdAt: now,
          });
          this.ledgerRepository.insert(em, entry);

          const ctx = { correlationId: newId(), now };
          this.outboxRepository.insert(
            em,
            OutboxMessage.enqueue(
              WagerTransactionProcessed.from(tx, cmd.initialBalance, ctx),
            ),
          );
          this.outboxRepository.insert(
            em,
            OutboxMessage.enqueue(
              WalletBalanceChanged.from(wallet, entry, ctx),
            ),
          );
        }
      });
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new DuplicateWalletError(
          cmd.playerId,
          cmd.initialBalance.currency,
        );
      }
      throw err;
    }

    this.metrics.incrementCounter("wallets_opened_total");
    return wallet;
  }
}
