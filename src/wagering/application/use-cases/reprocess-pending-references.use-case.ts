import { LockMode, type EntityManager } from "@mikro-orm/postgresql";
import { WalletNotFoundError } from "../../../shared/kernel/errors";
import { FailureCode } from "../../../shared/kernel/failure-code";
import { newId } from "../../../shared/kernel/id";
import {
  NOOP_METRICS,
  type MetricsPort,
} from "../../../shared/metrics/metrics.port";
import type { WalletRepositoryPort } from "../../../wallets/application/ports/wallet-repository.port";
import type { WagerTransactionRepositoryPort } from "../ports/wager-transaction-repository.port";
import type { WagerTransaction } from "../../domain/wager-transaction";
import { MAX_REFERENCE_RETRY_ATTEMPTS } from "../reference-backoff";
import { WagerTransactionFinalizer } from "../wager-transaction-finalizer";

const DEFAULT_BATCH_SIZE = 20;

/**
 * Reprocessa o lote de REFUND/ROLLBACK ainda esperando a referência. Cada
 * transação do lote é resolvida, rejeitada por timeout, ou reagendada,
 * nunca fica sem decisão.
 */
export class ReprocessPendingReferencesUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly finalizer: WagerTransactionFinalizer,
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
    private readonly walletRepository: WalletRepositoryPort,
    private readonly metrics: MetricsPort = NOOP_METRICS,
  ) {}

  async run(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    return this.em.transactional(async (em) => {
      const now = new Date();
      const batch =
        await this.wagerTransactionRepository.findDuePendingReferenceBatch(
          em,
          now,
          batchSize,
        );

      for (const tx of batch) {
        await this.processOne(em, tx, now);
      }

      return batch.length;
    });
  }

  private async processOne(
    em: EntityManager,
    tx: WagerTransaction,
    now: Date,
  ): Promise<void> {
    const ctx = { correlationId: newId(), now };
    const resolution = await this.finalizer.resolveReference(em, tx);

    if (resolution.outcome === "resolved") {
      // Mesma ordem do submit: trava a wallet ANTES de qualquer outra coisa.
      const wallet = await this.walletRepository.findById(
        em,
        tx.walletId,
        LockMode.PESSIMISTIC_WRITE,
      );
      if (!wallet) {
        throw new WalletNotFoundError(tx.walletId);
      }
      await this.finalizer.applyEffect(
        em,
        tx,
        wallet,
        resolution.reference,
        ctx,
      );
      return;
    }

    if (resolution.outcome === "rejected") {
      await this.finalizer.reject(em, tx, resolution.failureCode, ctx);
      return;
    }

    if (tx.referenceRetryAttempts >= MAX_REFERENCE_RETRY_ATTEMPTS) {
      await this.finalizer.reject(
        em,
        tx,
        FailureCode.ReferenceResolutionTimeout,
        ctx,
      );
      this.metrics.incrementCounter("pending_reference_retries_total", {
        outcome: "timeout",
      });
      return;
    }

    await this.finalizer.markPendingReference(em, tx, ctx);
    this.metrics.incrementCounter("pending_reference_retries_total", {
      outcome: "rescheduled",
    });
  }
}
