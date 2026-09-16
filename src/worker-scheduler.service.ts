import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { startRepeatingTask } from "./shared/scheduler/repeating-task";
import { ConsumeWagerTransactionBatchUseCase } from "./wagering/application/use-cases/consume-wager-transaction-batch.use-case";
import { ReprocessPendingReferencesUseCase } from "./wagering/application/use-cases/reprocess-pending-references.use-case";
import { PublishOutboxBatchUseCase } from "./messaging/outbox/publish-outbox-batch.use-case";

const PUBLISH_OUTBOX_INTERVAL_MS = 2_000;
const REPROCESS_PENDING_REFERENCE_INTERVAL_MS = 5_000;

/**
 * Única classe com decorator do Nest no processo worker: equivalente a um controller,
 * só que acionado por tempo em vez de request HTTP
 * O consumo de wager-transactions.fifo usa long polling (espera até 5s por
 * mensagem dentro do próprio `run()`), então não precisa de intervalo
 * já tem pacing natural. Publisher e reprocessamento de
 * PENDING_REFERENCE são polls simples e correm num intervalo fixo
 */
@Injectable()
export class WorkerSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkerSchedulerService.name);
  private readonly stopFns: Array<() => void> = [];

  constructor(
    @Inject(ConsumeWagerTransactionBatchUseCase)
    private readonly consumeWagerTransactionBatch: ConsumeWagerTransactionBatchUseCase,
    @Inject(PublishOutboxBatchUseCase)
    private readonly publishOutboxBatch: PublishOutboxBatchUseCase,
    @Inject(ReprocessPendingReferencesUseCase)
    private readonly reprocessPendingReferences: ReprocessPendingReferencesUseCase,
  ) {}

  onApplicationBootstrap(): void {
    this.stopFns.push(
      startRepeatingTask(
        0,
        async () => {
          await this.consumeWagerTransactionBatch.run(10, 5);
        },
        (err) =>
          this.logger.error(
            "Erro consumindo wager-transactions.fifo",
            err as Error,
          ),
      ),
    );
    this.stopFns.push(
      startRepeatingTask(
        PUBLISH_OUTBOX_INTERVAL_MS,
        async () => {
          await this.publishOutboxBatch.run(20);
        },
        (err) => this.logger.error("Erro publicando outbox", err as Error),
      ),
    );
    this.stopFns.push(
      startRepeatingTask(
        REPROCESS_PENDING_REFERENCE_INTERVAL_MS,
        async () => {
          await this.reprocessPendingReferences.run(20);
        },
        (err) =>
          this.logger.error(
            "Erro reprocessando pending-reference",
            err as Error,
          ),
      ),
    );
    this.logger.log("Scheduler do worker iniciado");
  }

  onApplicationShutdown(): void {
    for (const stop of this.stopFns) {
      stop();
    }
  }
}
