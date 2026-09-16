import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../../mikro-orm.config";
import { MikroOrmWalletRepository } from "../../src/wallets/infrastructure/persistence/wallet.repository";
import { MikroOrmWalletLedgerRepository } from "../../src/wallets/infrastructure/persistence/wallet-ledger-entry.repository";
import { MikroOrmWagerTransactionRepository } from "../../src/wagering/infrastructure/persistence/wager-transaction.repository";
import { MikroOrmOutboxRepository } from "../../src/messaging/outbox/outbox-message.repository";
import { OpenWalletUseCase } from "../../src/wallets/application/use-cases/open-wallet.use-case";
import { GetWalletUseCase } from "../../src/wallets/application/use-cases/get-wallet.use-case";
import { GetWalletLedgerUseCase } from "../../src/wallets/application/use-cases/get-wallet-ledger.use-case";
import { ReconcileWalletUseCase } from "../../src/wallets/application/use-cases/reconcile-wallet.use-case";

/**
 * Abre uma instância nova do MikroORM (pool de conexão próprio, igual um
 * processo de aplicação separado) e liga os casos de uso, sem
 * container de DI: só funciona direto assim porque os casos de uso
 * dependem da interface (port), não da classe concreta do adapter.
 */
export interface TestInstance {
  orm: MikroORM;
  openWallet: OpenWalletUseCase;
  getWallet: GetWalletUseCase;
  getLedger: GetWalletLedgerUseCase;
  reconcile: ReconcileWalletUseCase;
}

export async function createTestInstance(): Promise<TestInstance> {
  const orm = await MikroORM.init(mikroOrmConfig);
  const em = orm.em;

  const walletRepository = new MikroOrmWalletRepository();
  const ledgerRepository = new MikroOrmWalletLedgerRepository();
  const wagerTransactionRepository = new MikroOrmWagerTransactionRepository();
  const outboxRepository = new MikroOrmOutboxRepository();

  return {
    orm,
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
