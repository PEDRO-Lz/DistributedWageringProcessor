import type { EntityManager } from "@mikro-orm/postgresql";
import type { WagerTransaction } from "../../domain/wager-transaction";
import type { WagerTransactionKind } from "../../domain/wager-transaction-kind.enum";

export interface WagerTransactionRepositoryPort {
  insert(em: EntityManager, tx: WagerTransaction): void;
  // Insert + flush imediato: "claim-first" da idempotência, o conflito de chave única aparece aqui, não num SELECT prévio
  claim(em: EntityManager, tx: WagerTransaction): Promise<void>;
  findById(em: EntityManager, id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(
    em: EntityManager,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    em: EntityManager,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;
  save(em: EntityManager, tx: WagerTransaction): Promise<void>;
  // Já existe uma reversão PROCESSED (desse kind) pra essa referência? Usado pra rejeitar reversão duplicada
  findProcessedReversal(
    em: EntityManager,
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null>;
  // Lote de PENDING_REFERENCE já no ponto de tentar de novo, pro worker de retry
  findDuePendingReferenceBatch(
    em: EntityManager,
    now: Date,
    limit: number,
  ): Promise<WagerTransaction[]>;
}

export const WAGER_TRANSACTION_REPOSITORY = Symbol(
  "WAGER_TRANSACTION_REPOSITORY",
);
