import type { EntityManager } from "@mikro-orm/postgresql";
import type { InboxMessage } from "./inbox-message";

export interface InboxRepositoryPort {
  // Insert + flush imediato: o conflito de (consumerName, messageId) já duplicado aparece aqui
  claim(em: EntityManager, message: InboxMessage): Promise<void>;
  findByConsumerAndMessageId(
    em: EntityManager,
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null>;
  markProcessed(
    em: EntityManager,
    consumerName: string,
    messageId: string,
    at: Date,
  ): Promise<void>;
}

export const INBOX_REPOSITORY = Symbol("INBOX_REPOSITORY");
