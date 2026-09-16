import type { EntityManager } from "@mikro-orm/postgresql";
import {
  NOOP_METRICS,
  type MetricsPort,
} from "../../shared/metrics/metrics.port";
import { WAGER_EVENTS_QUEUE } from "../sqs/queue-names";
import type { SqsPort } from "../sqs/sqs.port";
import type { OutboxMessage } from "./outbox-message";
import type { OutboxRepositoryPort } from "./outbox-repository.port";

/**
 * Publisher da outbox: pega o lote pendente (FOR UPDATE SKIP LOCKED
 * seguro rodar em várias instâncias de worker ao mesmo tempo) e manda cada
 * mensagem pra `wager-events.fifo`. Falha ao publicar não derruba o lote
 * inteiro: essa mensagem agenda retry com backoff, as outras seguem
 *
 * `messageGroupId = aggregateId`: eventos do mesmo agregado (mesma wallet,
 * mesma transação) chegam em ordem no consumidor. agregados diferentes
 * publicam em paralelo dentro da fila FIFO.
 */
export class PublishOutboxBatchUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly outboxRepository: OutboxRepositoryPort,
    private readonly sqs: SqsPort,
    private readonly metrics: MetricsPort = NOOP_METRICS,
  ) {}

  async run(batchSize = 20): Promise<number> {
    return this.em.transactional(async (em) => {
      const now = new Date();
      const batch = await this.outboxRepository.findDueBatch(
        em,
        now,
        batchSize,
      );
      for (const message of batch) {
        await this.publishOne(em, message, now);
      }
      return batch.length;
    });
  }

  private async publishOne(
    em: EntityManager,
    message: OutboxMessage,
    now: Date,
  ): Promise<void> {
    try {
      await this.sqs.send(
        WAGER_EVENTS_QUEUE,
        JSON.stringify(message.payload),
        message.aggregateId,
        message.id,
      );
      message.markPublished(now);
      this.metrics.incrementCounter("outbox_published_total");
    } catch {
      message.scheduleRetry(now);
      this.metrics.incrementCounter("outbox_publish_failures_total");
    }
    await this.outboxRepository.save(em, message);
  }
}
