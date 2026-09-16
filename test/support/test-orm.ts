import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../../mikro-orm.config";
import { MikroOrmWalletRepository } from "../../src/wallets/infrastructure/persistence/wallet.repository";
import { MikroOrmWalletLedgerRepository } from "../../src/wallets/infrastructure/persistence/wallet-ledger-entry.repository";
import { MikroOrmWagerTransactionRepository } from "../../src/wagering/infrastructure/persistence/wager-transaction.repository";
import { MikroOrmOutboxRepository } from "../../src/messaging/outbox/outbox-message.repository";
import { MikroOrmInboxRepository } from "../../src/messaging/inbox/inbox-message.repository";
import { SqsClientAdapter } from "../../src/messaging/sqs/sqs-client.adapter";
import { OpenWalletUseCase } from "../../src/wallets/application/use-cases/open-wallet.use-case";
import { GetWalletUseCase } from "../../src/wallets/application/use-cases/get-wallet.use-case";
import { GetWalletLedgerUseCase } from "../../src/wallets/application/use-cases/get-wallet-ledger.use-case";
import { ReconcileWalletUseCase } from "../../src/wallets/application/use-cases/reconcile-wallet.use-case";
import { SubmitWagerTransactionUseCase } from "../../src/wagering/application/use-cases/submit-wager-transaction.use-case";
import { GetWagerTransactionUseCase } from "../../src/wagering/application/use-cases/get-wager-transaction.use-case";
import { ReprocessPendingReferencesUseCase } from "../../src/wagering/application/use-cases/reprocess-pending-references.use-case";
import { ConsumeWagerTransactionBatchUseCase } from "../../src/wagering/application/use-cases/consume-wager-transaction-batch.use-case";
import { PublishOutboxBatchUseCase } from "../../src/messaging/outbox/publish-outbox-batch.use-case";
import { WagerTransactionFinalizer } from "../../src/wagering/application/wager-transaction-finalizer";

/**
 * Abre uma instância nova do MikroORM (pool de conexão próprio, igual um
 * processo de aplicação separado) e liga os casos de uso, sem
 * container de DI: só funciona direto assim porque os casos de uso
 * dependem da interface (port), não da classe concreta do adapter.
 */
export interface TestInstance {
  orm: MikroORM;
  sqs: SqsClientAdapter;
  openWallet: OpenWalletUseCase;
  getWallet: GetWalletUseCase;
  getLedger: GetWalletLedgerUseCase;
  reconcile: ReconcileWalletUseCase;
  submit: SubmitWagerTransactionUseCase;
  getTransaction: GetWagerTransactionUseCase;
  reprocess: ReprocessPendingReferencesUseCase;
  consumeWagerTransactionBatch: ConsumeWagerTransactionBatchUseCase;
  publishOutboxBatch: PublishOutboxBatchUseCase;
}

export async function createTestInstance(): Promise<TestInstance> {
  const orm = await MikroORM.init(mikroOrmConfig);
  const em = orm.em;

  const walletRepository = new MikroOrmWalletRepository();
  const ledgerRepository = new MikroOrmWalletLedgerRepository();
  const wagerTransactionRepository = new MikroOrmWagerTransactionRepository();
  const outboxRepository = new MikroOrmOutboxRepository();
  const inboxRepository = new MikroOrmInboxRepository();
  const sqs = new SqsClientAdapter();

  const finalizer = new WagerTransactionFinalizer(
    wagerTransactionRepository,
    walletRepository,
    ledgerRepository,
    outboxRepository,
  );

  const submit = new SubmitWagerTransactionUseCase(
    em,
    finalizer,
    walletRepository,
    wagerTransactionRepository,
  );

  return {
    orm,
    sqs,
    openWallet: new OpenWalletUseCase(
      em,
      walletRepository,
      ledgerRepository,
      wagerTransactionRepository,
      outboxRepository,
    ),
    getWallet: new GetWalletUseCase(em, walletRepository),
    getLedger: new GetWalletLedgerUseCase(em, ledgerRepository),
    reconcile: new ReconcileWalletUseCase(
      em,
      walletRepository,
      ledgerRepository,
    ),
    submit,
    getTransaction: new GetWagerTransactionUseCase(
      em,
      wagerTransactionRepository,
    ),
    reprocess: new ReprocessPendingReferencesUseCase(
      em,
      finalizer,
      wagerTransactionRepository,
      walletRepository,
    ),
    consumeWagerTransactionBatch: new ConsumeWagerTransactionBatchUseCase(
      em,
      sqs,
      inboxRepository,
      submit,
    ),
    publishOutboxBatch: new PublishOutboxBatchUseCase(
      em,
      outboxRepository,
      sqs,
    ),
  };
}

export async function closeInstances(instances: TestInstance[]): Promise<void> {
  await Promise.all(instances.map((i) => i.orm.close(true)));
}

export async function resetDatabase(instance: TestInstance): Promise<void> {
  await instance.orm.em
    .getConnection()
    .execute(
      "truncate wallet_ledger_entries, wager_transactions, wallets, outbox_messages, inbox_messages cascade",
    );
}
