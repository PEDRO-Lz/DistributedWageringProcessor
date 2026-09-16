import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { OutboxMessage } from "../../src/messaging/outbox/outbox-message";
import { MikroOrmOutboxRepository } from "../../src/messaging/outbox/outbox-message.repository";
import { WAGER_EVENTS_QUEUE } from "../../src/messaging/sqs/queue-names";
import {
  closeInstances,
  createTestInstance,
  resetDatabase,
  type TestInstance,
} from "../support/test-orm";
import { drainQueue } from "../support/sqs-test-utils";
import { FakeEvent } from "../support/fake-event";

const TOTAL_MESSAGES = 30;

/**
 * Duas réplicas reais do worker (dois pools MikroORM independentes, como
 * dois processos Bun separados de verdade), cada uma com seu próprio
 * PublishOutboxBatchUseCase, publicando o mesmo lote de linhas pendentes ao
 * mesmo tempo. `FOR UPDATE SKIP LOCKED` (já em findDueBatch) é o que
 * garante que elas nunca peguem a mesma linha duas vezes.
 */
describe("dois publishers de outbox concorrentes (Postgres + LocalStack reais)", () => {
  let instances: TestInstance[];
  const outboxRepository = new MikroOrmOutboxRepository();

  beforeEach(async () => {
    instances = await Promise.all([createTestInstance(), createTestInstance()]);
    await resetDatabase(instances[0]!);
    await drainQueue(instances[0]!.sqs, WAGER_EVENTS_QUEUE);
  });

  afterAll(async () => {
    await closeInstances(instances);
  });

  it(`${TOTAL_MESSAGES} mensagens pendentes, duas instâncias publicando em paralelo: cada uma sai exatamente uma vez`, async () => {
    const [a, b] = instances;
    const now = new Date();

    const eventIds = new Set<string>();
    await a!.orm.em.transactional(async (em) => {
      for (let i = 0; i < TOTAL_MESSAGES; i++) {
        const event = FakeEvent.from(`aggregate-${i % 5}`, {
          correlationId: `corr-${i}`,
          now,
        });
        eventIds.add(event.eventId);
        outboxRepository.insert(em, OutboxMessage.enqueue(event));
      }
    });
    expect(eventIds.size).toBe(TOTAL_MESSAGES);

    // Rodadas concorrentes até drenar tudo dos dois lados: cada instância
    // só pega o que conseguir travar (SKIP LOCKED), então mais de uma
    // rodada é esperado quando o batch é menor que o total.
    let totalPublishedByA = 0;
    let totalPublishedByB = 0;
    for (let round = 0; round < 10; round++) {
      const [publishedByA, publishedByB] = await Promise.all([
        a!.publishOutboxBatch.run(20),
        b!.publishOutboxBatch.run(20),
      ]);
      totalPublishedByA += publishedByA;
      totalPublishedByB += publishedByB;
      if (totalPublishedByA + totalPublishedByB >= TOTAL_MESSAGES) {
        break;
      }
    }
    expect(totalPublishedByA + totalPublishedByB).toBe(TOTAL_MESSAGES);

    // Nenhuma linha ficou pendente, e cada uma foi publicada uma vez só.
    const [pendingRow] = await a!.orm.em
      .getConnection()
      .execute<
        { count: string }[]
      >("select count(*)::int as count from outbox_messages where published_at is null");
    expect(Number(pendingRow!.count)).toBe(0);

    // Do lado da fila: exatamente 30 mensagens, nenhum eventId duplicado,
    // nenhum perdido.
    const receivedEventIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const batch = await a!.sqs.receive(WAGER_EVENTS_QUEUE, 10, 1);
      if (batch.length === 0) {
        break;
      }
      for (const message of batch) {
        const body = JSON.parse(message.body) as { eventId: string };
        receivedEventIds.push(body.eventId);
        await a!.sqs.delete(WAGER_EVENTS_QUEUE, message.receiptHandle);
      }
    }
    expect(receivedEventIds).toHaveLength(TOTAL_MESSAGES);
    expect(new Set(receivedEventIds)).toEqual(eventIds);
  });
});
