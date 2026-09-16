import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
import { LedgerDirection } from "../../src/shared/kernel/ledger-direction";
import {
  DuplicateWalletError,
  WalletNotFoundError,
} from "../../src/shared/kernel/errors";
import { newId } from "../../src/shared/kernel/id";
import {
  closeInstances,
  createTestInstance,
  resetDatabase,
  type TestInstance,
} from "../support/test-orm";

describe("OpenWalletUseCase (integração, Postgres real)", () => {
  let instance: TestInstance;

  beforeEach(async () => {
    instance = await createTestInstance();
    await resetDatabase(instance);
  });

  afterAll(async () => {
    await closeInstances([instance]);
  });

  it("saldo inicial > 0 gera a wallet, a transação OPENING e o lançamento CREDIT na mesma transação SQL", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    expect(wallet.balance.toJSON()).toEqual({
      amount: "100.00",
      currency: "BRL",
    });
    expect(wallet.version).toBe(1);

    const page = await instance.getLedger.execute({ walletId: wallet.id });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]!.direction).toBe(LedgerDirection.Credit);
    expect(page.entries[0]!.balanceAfter.toJSON()).toEqual({
      amount: "100.00",
      currency: "BRL",
    });

    const outboxCount: Array<{ count: number }> = await instance.orm.em
      .getConnection()
      .execute(
        "select count(*)::int as count from outbox_messages where aggregate_id = ?",
        [wallet.id],
      );
    expect(outboxCount[0]!.count).toBe(2); // WagerTransactionProcessed + WalletBalanceChanged
  });

  it("saldo inicial zero não gera OPENING nem lançamento", async () => {
    const wallet = await instance.openWallet.execute({
      playerId: newId(),
      initialBalance: Money.zero("BRL"),
    });

    const page = await instance.getLedger.execute({ walletId: wallet.id });
    expect(page.entries).toHaveLength(0);

    const txCount: Array<{ count: number }> = await instance.orm.em
      .getConnection()
      .execute(
        "select count(*)::int as count from wager_transactions where wallet_id = ?",
        [wallet.id],
      );
    expect(txCount[0]!.count).toBe(0);
  });

  it("rejeita wallet duplicada pro mesmo playerId + currency", async () => {
    const playerId = newId();
    await instance.openWallet.execute({
      playerId,
      initialBalance: Money.zero("BRL"),
    });

    await expect(
      instance.openWallet.execute({
        playerId,
        initialBalance: Money.zero("BRL"),
      }),
    ).rejects.toBeInstanceOf(DuplicateWalletError);
  });

  it("reconcile() bate certo depois da abertura", async () => {
    const wallet = await instance.openWallet.execute({
      playerId: newId(),
      initialBalance: Money.from({ amount: "50.00", currency: "BRL" }),
    });

    const result = await instance.reconcile.execute(wallet.id);
    expect(result.consistent).toBe(true);
    expect(result.storedBalance.equals(result.calculatedBalance)).toBe(true);
    expect(result.checkedEntries).toBe(1);
  });

  it("reconcile() numa wallet inexistente lança WalletNotFoundError", async () => {
    await expect(instance.reconcile.execute(newId())).rejects.toBeInstanceOf(
      WalletNotFoundError,
    );
  });
});
