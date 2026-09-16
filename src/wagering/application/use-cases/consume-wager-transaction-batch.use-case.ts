import { createHash } from "node:crypto";
import type { EntityManager } from "@mikro-orm/postgresql";
import {
  NOOP_METRICS,
  type MetricsPort,
} from "../../../shared/metrics/metrics.port";
import { logger } from "../../../shared/logging/logger";
import { runWithLogContext } from "../../../shared/logging/log-context";
import { InboxMessage } from "../../../messaging/inbox/inbox-message";
import type { InboxRepositoryPort } from "../../../messaging/inbox/inbox-repository.port";
import { WAGER_TRANSACTIONS_QUEUE } from "../../../messaging/sqs/queue-names";
import type {
  ReceivedSqsMessage,
  SqsPort,
} from "../../../messaging/sqs/sqs.port";
import {
  InvalidWagerTransactionMessageError,
  parseWagerTransactionMessage,
} from "../parse-wager-transaction-message";
import { SubmitWagerTransactionUseCase } from "./submit-wager-transaction.use-case";

const CONSUMER_NAME = "wager-transactions-consumer";

export type ConsumeOutcome =
  | { status: "processed"; ack: true }
  | { status: "duplicate"; ack: true }
  | { status: "malformed"; ack: false; error: Error }
  | { status: "error"; ack: false; error: unknown };

/**
 * Consumidor de `wager-transactions.fifo`. Cada mensagem entra numa
 * transação só: se já existe uma linha de inbox pra esse messageId E ela já
 * foi marcada como processada, é redelivery pura, nem chama o caso de uso de
 * novo. Se existe mas não foi processada, é recuperação de crash (claim
 * anterior não terminou): não reclaima, só retoma daqui pra frente, o
 * próprio SubmitWagerTransactionUseCase já é idempotente por idempotencyKey.
 * Ack (delete da fila) só acontece depois do commit. qualquer exceção não
 * apagada deixa a mensagem visível de novo pro SQS reentregar, e depois de
 * `maxReceiveCount` tentativas o redrive policy da fila manda pra DLQ sozinho
 */
export class ConsumeWagerTransactionBatchUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly sqs: SqsPort,
    private readonly inboxRepository: InboxRepositoryPort,
    private readonly submitUseCase: SubmitWagerTransactionUseCase,
    private readonly metrics: MetricsPort = NOOP_METRICS,
  ) {}

  async run(maxMessages = 10, waitTimeSeconds = 5): Promise<number> {
    const messages = await this.sqs.receive(
      WAGER_TRANSACTIONS_QUEUE,
      maxMessages,
      waitTimeSeconds,
    );
    for (const message of messages) {
      await this.consumeOne(message);
    }
    return messages.length;
  }

  private async consumeOne(message: ReceivedSqsMessage): Promise<void> {
    const outcome = await this.handle(message);
    this.metrics.incrementCounter("wager_transaction_messages_total", {
      status: outcome.status,
    });
    if (outcome.ack) {
      await this.sqs.delete(WAGER_TRANSACTIONS_QUEUE, message.receiptHandle);
    }
  }

  async handle(message: ReceivedSqsMessage): Promise<ConsumeOutcome> {
    return runWithLogContext({ messageId: message.messageId }, () =>
      this.handleWithLogContext(message),
    );
  }

  private async handleWithLogContext(
    message: ReceivedSqsMessage,
  ): Promise<ConsumeOutcome> {
    const now = new Date();
    const payloadHash = createHash("sha256").update(message.body).digest("hex");

    try {
      let wasDuplicate = false;
      let providerId: string | undefined;

      await this.em.transactional(async (em) => {
        const existing = await this.inboxRepository.findByConsumerAndMessageId(
          em,
          CONSUMER_NAME,
          message.messageId,
        );
        if (existing?.isProcessed()) {
          wasDuplicate = true;
          return;
        }
        if (!existing) {
          await this.inboxRepository.claim(
            em,
            InboxMessage.receive({
              consumerName: CONSUMER_NAME,
              messageId: message.messageId,
              payloadHash,
              receivedAt: now,
            }),
          );
        }

        const command = parseWagerTransactionMessage(message.body);
        providerId = command.providerId;
        await runWithLogContext({ providerId }, () =>
          this.submitUseCase.execute(command),
        );
        await this.inboxRepository.markProcessed(
          em,
          CONSUMER_NAME,
          message.messageId,
          now,
        );
      });

      if (wasDuplicate) {
        logger.info("mensagem duplicada (redelivery), ignorada");
        return { status: "duplicate", ack: true };
      }
      logger.info("wager transaction processada via mensageria", {
        providerId,
      });
      return { status: "processed", ack: true };
    } catch (err) {
      if (err instanceof InvalidWagerTransactionMessageError) {
        logger.warn("mensagem malformada, não será reentregue com sucesso", {
          error: err.message,
        });
        return { status: "malformed", ack: false, error: err };
      }
      logger.error("erro processando mensagem de wager transaction", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: "error", ack: false, error: err };
    }
  }
}
