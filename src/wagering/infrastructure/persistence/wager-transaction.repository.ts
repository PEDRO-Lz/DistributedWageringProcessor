import { LockMode, type EntityManager } from "@mikro-orm/postgresql";
import type { WagerTransactionRepositoryPort } from "../../application/ports/wager-transaction-repository.port";
import type { WagerTransaction } from "../../domain/wager-transaction";
import type { WagerTransactionKind } from "../../domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../domain/wager-transaction-status.enum";
import { WagerTransactionEntity } from "./wager-transaction.entity";
import {
  toWagerTransactionDomain,
  toWagerTransactionEntity,
} from "./wager-transaction.mapper";

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepositoryPort {
  insert(em: EntityManager, tx: WagerTransaction): void {
    em.create(WagerTransactionEntity, toWagerTransactionEntity(tx));
  }

  // Insert + flush imediato: se (idempotencyKey) ou (providerId, externalTransactionId) já existir, a violação de unique estoura aqui
  async claim(em: EntityManager, tx: WagerTransaction): Promise<void> {
    this.insert(em, tx);
    await em.flush();
  }

  async findById(
    em: EntityManager,
    id: string,
  ): Promise<WagerTransaction | null> {
    const row = await em.findOne(WagerTransactionEntity, { id });
    return row ? toWagerTransactionDomain(row) : null;
  }

  async findByIdempotencyKey(
    em: EntityManager,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    const row = await em.findOne(WagerTransactionEntity, { idempotencyKey });
    return row ? toWagerTransactionDomain(row) : null;
  }

  async findByProviderAndExternalId(
    em: EntityManager,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const row = await em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });
    return row ? toWagerTransactionDomain(row) : null;
  }

  async save(em: EntityManager, tx: WagerTransaction): Promise<void> {
    const row = await em.findOneOrFail(WagerTransactionEntity, { id: tx.id });
    em.assign(row, toWagerTransactionEntity(tx));
  }

  async findProcessedReversal(
    em: EntityManager,
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null> {
    const row = await em.findOne(WagerTransactionEntity, {
      referenceTransactionId,
      kind,
      status: WagerTransactionStatus.Processed,
    });
    return row ? toWagerTransactionDomain(row) : null;
  }

  /**
   * FOR UPDATE SKIP LOCKED, pra várias instâncias do worker de retry rodarem
   * em paralelo sem colidir. `now` ainda não filtra nada
   */
  async findDuePendingReferenceBatch(
    em: EntityManager,
    _now: Date,
    limit: number,
  ): Promise<WagerTransaction[]> {
    const rows = await em
      .createQueryBuilder(WagerTransactionEntity, "t")
      .where({ status: WagerTransactionStatus.PendingReference })
      .limit(limit)
      .setLockMode(LockMode.PESSIMISTIC_PARTIAL_WRITE)
      .getResultList();
    return rows.map(toWagerTransactionDomain);
  }
}
