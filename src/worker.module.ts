import { Module } from "@nestjs/common";
import { CoreModule } from "./core.module";
import { HealthController } from "./health/health.controller";
import { WorkerReadinessController } from "./health/worker-readiness.controller";
import { WorkerSchedulerService } from "./worker-scheduler.service";
import { MetricsController } from "./shared/metrics/metrics.controller";

import { ENTITY_MANAGER } from "./shared/persistence/orm.tokens";
import { WALLET_REPOSITORY } from "./wallets/application/ports/wallet-repository.port";
import { WAGER_TRANSACTION_REPOSITORY } from "./wagering/application/ports/wager-transaction-repository.port";
import { OUTBOX_REPOSITORY } from "./messaging/outbox/outbox-repository.port";
import { INBOX_REPOSITORY } from "./messaging/inbox/inbox-repository.port";
import { METRICS_PORT } from "./shared/metrics/metrics.port";

import { MikroOrmInboxRepository } from "./messaging/inbox/inbox-message.repository";
import { SqsClientAdapter } from "./messaging/sqs/sqs-client.adapter";
import { SQS_PORT } from "./messaging/sqs/sqs.port";

import { SubmitWagerTransactionUseCase } from "./wagering/application/use-cases/submit-wager-transaction.use-case";
import { ConsumeWagerTransactionBatchUseCase } from "./wagering/application/use-cases/consume-wager-transaction-batch.use-case";
import { ReprocessPendingReferencesUseCase } from "./wagering/application/use-cases/reprocess-pending-references.use-case";
import { PublishOutboxBatchUseCase } from "./messaging/outbox/publish-outbox-batch.use-case";
import { WagerTransactionFinalizer } from "./wagering/application/wager-transaction-finalizer";

/**
 * Segundo processo Bun, não mais um provider dentro do processo da API.
 * Importa CoreModule (repositórios, casos de uso de wallets/wagering),
 * mas os providers daqui (fila, inbox, consumer, publisher, scheduler)
 * são exclusivos do worker: ApiModule nunca importa isso, e este módulo
 * nunca declara controllers de negócio, só o HealthController
 */
@Module({
  imports: [CoreModule],
  controllers: [HealthController, WorkerReadinessController, MetricsController],
  providers: [
    { provide: SQS_PORT, useClass: SqsClientAdapter },
    { provide: INBOX_REPOSITORY, useClass: MikroOrmInboxRepository },

    {
      provide: ConsumeWagerTransactionBatchUseCase,
      useFactory: (em, sqs, inboxRepository, submitUseCase, metrics) =>
        new ConsumeWagerTransactionBatchUseCase(
          em,
          sqs,
          inboxRepository,
          submitUseCase,
          metrics,
        ),
      inject: [
        ENTITY_MANAGER,
        SQS_PORT,
        INBOX_REPOSITORY,
        SubmitWagerTransactionUseCase,
        METRICS_PORT,
      ],
    },
    {
      provide: PublishOutboxBatchUseCase,
      useFactory: (em, outboxRepository, sqs, metrics) =>
        new PublishOutboxBatchUseCase(em, outboxRepository, sqs, metrics),
      inject: [ENTITY_MANAGER, OUTBOX_REPOSITORY, SQS_PORT, METRICS_PORT],
    },
    {
      provide: ReprocessPendingReferencesUseCase,
      useFactory: (
        em,
        finalizer,
        wagerTransactionRepository,
        walletRepository,
        metrics,
      ) =>
        new ReprocessPendingReferencesUseCase(
          em,
          finalizer,
          wagerTransactionRepository,
          walletRepository,
          metrics,
        ),
      inject: [
        ENTITY_MANAGER,
        WagerTransactionFinalizer,
        WAGER_TRANSACTION_REPOSITORY,
        WALLET_REPOSITORY,
        METRICS_PORT,
      ],
    },

    WorkerSchedulerService,
  ],
})
export class WorkerModule {}
