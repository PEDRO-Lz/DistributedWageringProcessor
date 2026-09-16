import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { newId } from "../../src/shared/kernel/id";
import { TransientProcessingError } from "../../src/shared/kernel/errors";
import {
  WAGER_TRANSACTIONS_DLQ_QUEUE,
  WAGER_TRANSACTIONS_QUEUE,
} from "../../src/messaging/sqs/queue-names";
import { MikroOrmInboxRepository } from "../../src/messaging/inbox/inbox-message.repository";
import { ConsumeWagerTransactionBatchUseCase } from "../../src/wagering/application/use-cases/consume-wager-transaction-batch.use-case";
import type { SubmitWagerTransactionPort } from "../../src/wagering/application/use-cases/submit-wager-transaction.use-case";
import type { MetricsPort } from "../../src/shared/metrics/metrics.port";
import {
  closeInstances,
  createTestInstance,
  resetDatabase,
  type TestInstance,
} from "../support/test-orm";
import { drainQueue, makeMessageVisibleNow } from "../support/sqs-test-utils";

// Sempre transitório: o ponto do teste é isolar o comportamento de redrive
// da SQS do código de negócio, nunca chega perto de wallet/wager de verdade.
class AlwaysFailingSubmit implements SubmitWagerTransactionPort {
  async execute(): Promise<never> {
    throw new TransientProcessingError("falha simulada, sempre transitória");
  }
}

class RecordingMetrics implements MetricsPort {
  readonly counters: { name: string; labels?: Record<string, string> }[] = [];
  incrementCounter(name: string, labels?: Record<string, string>): void {
    this.counters.push({ name, labels });
  }
  observeHistogram(): void {}
  setGauge(): void {}
}

describe("exaustão real de DLQ (LocalStack real, sem mock)", () => {
  let instance: TestInstance;

  beforeEach(async () => {
    instance = await createTestInstance();
    await resetDatabase(instance);
    await drainQueue(instance.sqs, WAGER_TRANSACTIONS_QUEUE);
    await drainQueue(instance.sqs, WAGER_TRANSACTIONS_DLQ_QUEUE);
  });

  afterAll(async () => {
    await closeInstances([instance]);
  });

  it("mensagem que sempre falha esgota maxReceiveCount e a própria SQS move pra DLQ, sem nenhuma decisão da aplicação", async () => {
    const idempotencyKey = `provider-a:${newId()}`;
    await instance.sqs.send(
      WAGER_TRANSACTIONS_QUEUE,
      JSON.stringify({
        providerId: "provider-a",
        externalTransactionId: idempotencyKey,
        idempotencyKey,
        playerId: newId(),
        walletId: newId(),
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "10.00", currency: "BRL" },
      }),
      "group-dlq-test",
      idempotencyKey,
    );

    const metrics = new RecordingMetrics();
    const consumer = new ConsumeWagerTransactionBatchUseCase(
      instance.orm.em,
      instance.sqs,
      new MikroOrmInboxRepository(),
      new AlwaysFailingSubmit(),
      metrics,
    );

    // maxReceiveCount=5 (ver infra/localstack/init-queues.sh): a fila
    // reentrega a mesma mensagem até 5 vezes sem ack, na 6a tentativa a
    // própria SQS já não devolve mais nada (moveu pra DLQ). Zera a
    // visibilidade manualmente entre tentativas só pra não esperar os 30s
    // reais do VisibilityTimeout, o redrive count em si é inteiramente da
    // SQS, não simulamos isso.
    let sourceQueueEmptiedByRedrive = false;
    let attempts = 0;
    for (let attempt = 1; attempt <= 8; attempt++) {
      const [message] = await instance.sqs.receive(
        WAGER_TRANSACTIONS_QUEUE,
        1,
        2,
      );
      if (!message) {
        sourceQueueEmptiedByRedrive = true;
        break;
      }
      attempts += 1;
      const outcome = await consumer.handle(message);
      metrics.incrementCounter("wager_transaction_messages_total", {
        status: outcome.status,
      });
      expect(outcome.status).toBe("error");
      expect(outcome.ack).toBe(false);
      await makeMessageVisibleNow(
        WAGER_TRANSACTIONS_QUEUE,
        message.receiptHandle,
      );
    }

    expect(sourceQueueEmptiedByRedrive).toBe(true);
    expect(attempts).toBe(5);

    const [dlqMessage] = await instance.sqs.receive(
      WAGER_TRANSACTIONS_DLQ_QUEUE,
      10,
      3,
    );
    expect(dlqMessage).toBeDefined();
    expect(JSON.parse(dlqMessage!.body).idempotencyKey).toBe(idempotencyKey);
    await instance.sqs.delete(
      WAGER_TRANSACTIONS_DLQ_QUEUE,
      dlqMessage!.receiptHandle,
    );

    // O único rastro que a aplicação grava é um contador de erro genérico,
    // por tentativa: nunca existiu um "moveu pra DLQ" decidido por nós.
    const errorCounters = metrics.counters.filter(
      (c) =>
        c.name === "wager_transaction_messages_total" &&
        c.labels?.status === "error",
    );
    expect(errorCounters).toHaveLength(5);
    const dlqRelatedCounters = metrics.counters.filter(
      (c) =>
        c.name.toLowerCase().includes("dlq") ||
        c.name.toLowerCase().includes("dead_letter"),
    );
    expect(dlqRelatedCounters).toHaveLength(0);
  });
});
