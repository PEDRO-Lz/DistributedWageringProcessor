import type { InferEntity } from "@mikro-orm/core";
import { OutboxMessage } from "./outbox-message";
import { OutboxMessageEntity } from "./outbox-message.entity";

type OutboxMessageRow = InferEntity<typeof OutboxMessageEntity>;

export function toOutboxMessageDomain(entity: OutboxMessageRow): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: entity.id,
    aggregateId: entity.aggregateId,
    eventType: entity.eventType,
    payload: entity.payload,
    occurredAt: entity.occurredAt,
    attempts: entity.attempts,
    nextAttemptAt: entity.nextAttemptAt as Date | undefined,
    publishedAt: entity.publishedAt as Date | undefined,
  });
}

export function toOutboxMessageEntity(
  message: OutboxMessage,
): OutboxMessageRow {
  return {
    id: message.id,
    aggregateId: message.aggregateId,
    eventType: message.eventType,
    payload: message.payload as Record<string, unknown>,
    occurredAt: message.occurredAt,
    attempts: message.attempts,
    nextAttemptAt: message.nextAttemptAt ?? null,
    publishedAt: message.publishedAt ?? null,
  };
}
