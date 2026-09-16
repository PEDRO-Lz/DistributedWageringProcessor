import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../mikro-orm.config";

import { MIKRO_ORM, ENTITY_MANAGER } from "./shared/persistence/orm.tokens";

import { WALLET_REPOSITORY } from "./wallets/application/ports/wallet-repository.port";
import { WALLET_LEDGER_REPOSITORY } from "./wallets/application/ports/wallet-ledger-repository.port";
import { WAGER_TRANSACTION_REPOSITORY } from "./wagering/application/ports/wager-transaction-repository.port";
import { OUTBOX_REPOSITORY } from "./messaging/outbox/outbox-repository.port";

import { MikroOrmWalletRepository } from "./wallets/infrastructure/persistence/wallet.repository";
import { MikroOrmWalletLedgerRepository } from "./wallets/infrastructure/persistence/wallet-ledger-entry.repository";
import { MikroOrmWagerTransactionRepository } from "./wagering/infrastructure/persistence/wager-transaction.repository";
import { MikroOrmOutboxRepository } from "./messaging/outbox/outbox-message.repository";

import { WagerTransactionFinalizer } from "./wagering/application/wager-transaction-finalizer";
import { OpenWalletUseCase } from "./wallets/application/use-cases/open-wallet.use-case";
import { GetWalletUseCase } from "./wallets/application/use-cases/get-wallet.use-case";
import { GetWalletLedgerUseCase } from "./wallets/application/use-cases/get-wallet-ledger.use-case";
import { ReconcileWalletUseCase } from "./wallets/application/use-cases/reconcile-wallet.use-case";
import { SubmitWagerTransactionUseCase } from "./wagering/application/use-cases/submit-wager-transaction.use-case";
import { GetWagerTransactionUseCase } from "./wagering/application/use-cases/get-wager-transaction.use-case";

/**
 * Wiring de repositórios e casos de uso, sem nenhum controller/consumer.
 * `ApiModule` e `WorkerModule` importam isso pra não duplicar essa lista de `useFactory`
 * Cada processo que importa `CoreModule` chama `MikroORM.init()` a própria vez
 * (é um Module normal, não singleton entre processos): API e worker acabam com pools de conexão
 * independentes.
 */
@Module({
  providers: [
    {
      provide: MIKRO_ORM,
      useFactory: (): Promise<MikroORM> => MikroORM.init(mikroOrmConfig),
    },
    {
      provide: ENTITY_MANAGER,
      useFactory: (orm: MikroORM): EntityManager => orm.em,
      inject: [MIKRO_ORM],
    },

    { provide: WALLET_REPOSITORY, useClass: MikroOrmWalletRepository },
    {
      provide: WALLET_LEDGER_REPOSITORY,
      useClass: MikroOrmWalletLedgerRepository,
    },
    {
      provide: WAGER_TRANSACTION_REPOSITORY,
      useClass: MikroOrmWagerTransactionRepository,
    },
    { provide: OUTBOX_REPOSITORY, useClass: MikroOrmOutboxRepository },

    {
      provide: WagerTransactionFinalizer,
      useFactory: (
        wagerTransactionRepository: MikroOrmWagerTransactionRepository,
        walletRepository: MikroOrmWalletRepository,
        ledgerRepository: MikroOrmWalletLedgerRepository,
        outboxRepository: MikroOrmOutboxRepository,
      ) =>
        new WagerTransactionFinalizer(
          wagerTransactionRepository,
          walletRepository,
          ledgerRepository,
          outboxRepository,
        ),
      inject: [
        WAGER_TRANSACTION_REPOSITORY,
        WALLET_REPOSITORY,
        WALLET_LEDGER_REPOSITORY,
        OUTBOX_REPOSITORY,
      ],
    },

    {
      provide: OpenWalletUseCase,
      useFactory: (
        em: EntityManager,
        walletRepository: MikroOrmWalletRepository,
        ledgerRepository: MikroOrmWalletLedgerRepository,
        wagerTransactionRepository: MikroOrmWagerTransactionRepository,
        outboxRepository: MikroOrmOutboxRepository,
      ) =>
        new OpenWalletUseCase(
          em,
          walletRepository,
          ledgerRepository,
          wagerTransactionRepository,
          outboxRepository,
        ),
      inject: [
        ENTITY_MANAGER,
        WALLET_REPOSITORY,
        WALLET_LEDGER_REPOSITORY,
        WAGER_TRANSACTION_REPOSITORY,
        OUTBOX_REPOSITORY,
      ],
    },
    {
      provide: GetWalletUseCase,
      useFactory: (
        em: EntityManager,
        walletRepository: MikroOrmWalletRepository,
      ) => new GetWalletUseCase(em, walletRepository),
      inject: [ENTITY_MANAGER, WALLET_REPOSITORY],
    },
    {
      provide: GetWalletLedgerUseCase,
      useFactory: (
        em: EntityManager,
        ledgerRepository: MikroOrmWalletLedgerRepository,
      ) => new GetWalletLedgerUseCase(em, ledgerRepository),
      inject: [ENTITY_MANAGER, WALLET_LEDGER_REPOSITORY],
    },
    {
      provide: ReconcileWalletUseCase,
      useFactory: (
        em: EntityManager,
        walletRepository: MikroOrmWalletRepository,
        ledgerRepository: MikroOrmWalletLedgerRepository,
      ) => new ReconcileWalletUseCase(em, walletRepository, ledgerRepository),
      inject: [ENTITY_MANAGER, WALLET_REPOSITORY, WALLET_LEDGER_REPOSITORY],
    },
    {
      provide: SubmitWagerTransactionUseCase,
      useFactory: (
        em: EntityManager,
        finalizer: WagerTransactionFinalizer,
        walletRepository: MikroOrmWalletRepository,
        wagerTransactionRepository: MikroOrmWagerTransactionRepository,
      ) =>
        new SubmitWagerTransactionUseCase(
          em,
          finalizer,
          walletRepository,
          wagerTransactionRepository,
        ),
      inject: [
        ENTITY_MANAGER,
        WagerTransactionFinalizer,
        WALLET_REPOSITORY,
        WAGER_TRANSACTION_REPOSITORY,
      ],
    },
    {
      provide: GetWagerTransactionUseCase,
      useFactory: (
        em: EntityManager,
        wagerTransactionRepository: MikroOrmWagerTransactionRepository,
      ) => new GetWagerTransactionUseCase(em, wagerTransactionRepository),
      inject: [ENTITY_MANAGER, WAGER_TRANSACTION_REPOSITORY],
    },
  ],
  exports: [
    MIKRO_ORM,
    ENTITY_MANAGER,
    WALLET_REPOSITORY,
    WALLET_LEDGER_REPOSITORY,
    WAGER_TRANSACTION_REPOSITORY,
    OUTBOX_REPOSITORY,
    WagerTransactionFinalizer,
    OpenWalletUseCase,
    GetWalletUseCase,
    GetWalletLedgerUseCase,
    ReconcileWalletUseCase,
    SubmitWagerTransactionUseCase,
    GetWagerTransactionUseCase,
  ],
})
export class CoreModule implements OnApplicationShutdown {
  constructor(@Inject(MIKRO_ORM) private readonly orm: MikroORM) {}

  async onApplicationShutdown(): Promise<void> {
    await this.orm.close();
  }
}
