import type { InferEntity } from "@mikro-orm/core";
import { InboxMessage } from "./inbox-message";
import { InboxMessageEntity } from "./inbox-message.entity";

type InboxMessageRow = InferEntity<typeof InboxMessageEntity>;

export function toInboxMessageDomain(entity: InboxMessageRow): InboxMessage {
  return InboxMessage.rehydrate({
    consumerName: entity.consumerName,
    messageId: entity.messageId,
    payloadHash: entity.payloadHash,
    receivedAt: entity.receivedAt,
    processedAt: entity.processedAt as Date | undefined,
  });
}

export function toInboxMessageEntity(message: InboxMessage): InboxMessageRow {
  return {
    consumerName: message.consumerName,
    messageId: message.messageId,
    payloadHash: message.payloadHash,
    receivedAt: message.receivedAt,
    processedAt: message.processedAt ?? null,
  };
}
