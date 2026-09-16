import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../../mikro-orm.config";
import { OutboxMessage } from "../../src/messaging/outbox/outbox-message";
import { MikroOrmOutboxRepository } from "../../src/messaging/outbox/outbox-message.repository";
import { PublishOutboxBatchUseCase } from "../../src/messaging/outbox/publish-outbox-batch.use-case";
import { SqsClientAdapter } from "../../src/messaging/sqs/sqs-client.adapter";
import { WAGER_EVENTS_QUEUE } from "../../src/messaging/sqs/queue-names";
import type {
  ReceivedSqsMessage,
  SqsPort,
} from "../../src/messaging/sqs/sqs.port";
import { drainQueue } from "../support/sqs-test-utils";
import { FakeEvent } from "../support/fake-event";

class AlwaysFailingSqs implements SqsPort {
  async send(): Promise<void> {
    throw new Error("falha simulada de envio");
  }
  async receive(): Promise<ReceivedSqsMessage[]> {
    return [];
  }
  async checkConnection(): Promise<void> {}
  async delete(): Promise<void> {}
}

describe("PublishOutboxBatchUseCase (integração, Postgres + LocalStack reais)", () => {
  let orm: MikroORM;
  const outboxRepository = new MikroOrmOutboxRepository();
  const sqs = new SqsClientAdapter();

  beforeEach(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.em.getConnection().execute("truncate outbox_messages cascade");
    await drainQueue(sqs, WAGER_EVENTS_QUEUE);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("publica mensagem pendente na fila e marca como publicada", async () => {
    const now = new Date();
    const message = OutboxMessage.enqueue(
      FakeEvent.from("aggregate-1", { correlationId: "corr-1", now }),
    );
    await orm.em.transactional(async (em) =>
      outboxRepository.insert(em, message),
    );

    const useCase = new PublishOutboxBatchUseCase(
      orm.em,
      outboxRepository,
      sqs,
    );
    const published = await useCase.run(10);
    expect(published).toBe(1);

    const received = await sqs.receive(WAGER_EVENTS_QUEUE, 10, 5);
    expect(received).toHaveLength(1);
    const body = JSON.parse(received[0]!.body);
    expect(body.eventId).toBe(message.id);
    expect(body.eventType).toBe("FakeEvent");
    await sqs.delete(WAGER_EVENTS_QUEUE, received[0]!.receiptHandle);

    const stillDue = await orm.em.transactional((em) =>
      outboxRepository.findDueBatch(em, now, 10),
    );
    expect(stillDue).toHaveLength(0);
  });

  it("falha ao publicar agenda retry com backoff, sem marcar como publicada", async () => {
    const now = new Date();
    const message = OutboxMessage.enqueue(
      FakeEvent.from("aggregate-2", { correlationId: "corr-2", now }),
    );
    await orm.em.transactional(async (em) =>
      outboxRepository.insert(em, message),
    );

    const useCase = new PublishOutboxBatchUseCase(
      orm.em,
      outboxRepository,
      new AlwaysFailingSqs(),
    );
    const published = await useCase.run(10);
    expect(published).toBe(1);

    const [row] = await orm.em.getConnection().execute<
      {
        attempts: number;
        published_at: string | null;
        next_attempt_at: string | null;
      }[]
    >("select attempts, published_at, next_attempt_at from outbox_messages where id = ?", [message.id]);
    expect(row!.published_at).toBeNull();
    expect(row!.attempts).toBe(1);
    expect(row!.next_attempt_at).not.toBeNull();
    expect(new Date(row!.next_attempt_at!).getTime()).toBeGreaterThan(
      now.getTime(),
    );
  });
});
