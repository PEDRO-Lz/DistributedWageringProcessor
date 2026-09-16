import type { EntityManager } from "@mikro-orm/postgresql";
import type { OutboxMessage } from "./outbox-message";

export interface OutboxRepositoryPort {
  insert(em: EntityManager, message: OutboxMessage): void;
  findDueBatch(
    em: EntityManager,
    now: Date,
    limit: number,
  ): Promise<OutboxMessage[]>;
  save(em: EntityManager, message: OutboxMessage): Promise<void>;
}

export const OUTBOX_REPOSITORY = Symbol("OUTBOX_REPOSITORY");
