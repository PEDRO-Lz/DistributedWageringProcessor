import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { LockMode, MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../../mikro-orm.config";
import { Money } from "../../src/shared/kernel/money";
import { Wallet } from "../../src/wallets/domain/wallet";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
import { MikroOrmWalletRepository } from "../../src/wallets/infrastructure/persistence/wallet.repository";

// Postgres real, sem mock. Precisa de `docker compose up -d postgres` e migrations
describe("MikroOrmWalletRepository (integração, Postgres real)", () => {
  let orm: MikroORM;
  const repository = new MikroOrmWalletRepository();

  beforeEach(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.em
      .getConnection()
      .execute(
        "truncate wallet_ledger_entries, wager_transactions, wallets cascade",
      );
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("insert() + findById() faz o roundtrip exato", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      now,
    });

    await orm.em.transactional(async (em) => {
      repository.insert(em, wallet);
    });

    const reloaded = await repository.findById(orm.em.fork(), wallet.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.balance.toJSON()).toEqual({
      amount: "100.00",
      currency: "BRL",
    });
    expect(reloaded!.version).toBe(1);
  });

  it("findByPlayerAndCurrency() acha a wallet certa", async () => {
    const now = new Date();
    const playerId = crypto.randomUUID();
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId,
      initialBalance: Money.zero("BRL"),
      now,
    });

    await orm.em.transactional(async (em) => repository.insert(em, wallet));

    const found = await repository.findByPlayerAndCurrency(
      orm.em.fork(),
      playerId,
      "BRL",
    );
    expect(found?.id).toBe(wallet.id);
  });

  it("save() persiste o estado depois de um débito", async () => {
    const now = new Date();
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      now,
    });
    await orm.em.transactional(async (em) => repository.insert(em, wallet));

    wallet.debit(Money.from({ amount: "30.00", currency: "BRL" }), {
      transactionId: crypto.randomUUID(),
      ledgerEntryId: crypto.randomUUID(),
      now,
    });
    await orm.em.transactional(async (em) => repository.save(em, wallet));

    const reloaded = await repository.findById(orm.em.fork(), wallet.id);
    expect(reloaded!.balance.toJSON().amount).toBe("70.00");
    expect(reloaded!.version).toBe(2);
  });

  it("duas conexões concorrentes disputando o lock da mesma wallet serializam (uma espera a outra commitar)", async () => {
    const now = new Date();
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      now,
    });
    await orm.em.transactional(async (em) => repository.insert(em, wallet));

    // Pool de conexão separado, simulando uma segunda instância da aplicação.
    const ormB = await MikroORM.init(mikroOrmConfig);
    const repositoryB = new MikroOrmWalletRepository();
    const order: string[] = [];

    const txA = orm.em.transactional(async (em) => {
      await repository.findById(em, wallet.id, LockMode.PESSIMISTIC_WRITE);
      order.push("A: lock adquirido");
      await sleep(200);
      order.push("A: committando");
    });

    // Dá uma luz de saída pra A garantir que ela pega o lock primeiro.
    await sleep(50);

    const txB = ormB.em.transactional(async (em) => {
      order.push("B: esperando o lock");
      await repositoryB.findById(em, wallet.id, LockMode.PESSIMISTIC_WRITE);
      order.push("B: lock adquirido");
    });

    await Promise.all([txA, txB]);
    await ormB.close(true);

    // Se o lock funcionasse, B conseguiria o lock ANTES de A liberar (committar).
    // Com o lock funcionando, B só consegue depois que A já commitou.
    expect(order).toEqual([
      "A: lock adquirido",
      "B: esperando o lock",
      "A: committando",
      "B: lock adquirido",
    ]);
  });
});
