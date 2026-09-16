import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
import { FailureCode } from "../../src/shared/kernel/failure-code";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../src/wagering/domain/wager-transaction-status.enum";
import { newId } from "../../src/shared/kernel/id";
import {
  closeInstances,
  createTestInstance,
  resetDatabase,
  type TestInstance,
} from "../support/test-orm";

/**
 * Paralelismo contra Postgres: cada `createTestInstance()` abre
 * seu próprio pool de conexão, exatamente como duas instâncias separadas
 * da aplicação bateriam na mesma wallet.
 */
describe("concorrência real (Postgres real, múltiplas instâncias)", () => {
  let instances: TestInstance[];

  beforeEach(async () => {
    instances = await Promise.all([
      createTestInstance(),
      createTestInstance(),
      createTestInstance(),
    ]);
    await resetDatabase(instances[0]!);
  });

  afterAll(async () => {
    await closeInstances(instances);
  });

  it("cenário obrigatório: saldo 100, duas apostas de 80 em paralelo, uma PROCESSED, uma REJECTED, saldo final 20.00", async () => {
    const [a, b] = instances;
    const playerId = newId();
    const wallet = await a!.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const [r1, r2] = await Promise.all([
      a!.submit.execute({
        providerId: "provider-a",
        externalTransactionId: "race-a",
        idempotencyKey: "provider-a:race-a",
        playerId,
        walletId: wallet.id,
        roundId: "round-race",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "80.00", currency: "BRL" }),
      }),
      b!.submit.execute({
        providerId: "provider-a",
        externalTransactionId: "race-b",
        idempotencyKey: "provider-a:race-b",
        playerId,
        walletId: wallet.id,
        roundId: "round-race",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "80.00", currency: "BRL" }),
      }),
    ]);

    const statuses = [r1.transaction.status, r2.transaction.status].sort();
    expect(statuses).toEqual(
      [
        WagerTransactionStatus.Processed,
        WagerTransactionStatus.Rejected,
      ].sort(),
    );

    const rejected =
      r1.transaction.status === WagerTransactionStatus.Rejected ? r1 : r2;
    expect(rejected.transaction.failureCode).toBe(
      FailureCode.InsufficientBalance,
    );

    const reloaded = await a!.getWallet.execute(wallet.id);
    expect(reloaded!.balance.toJSON()).toEqual({
      amount: "20.00",
      currency: "BRL",
    });

    const page = await a!.getLedger.execute({ walletId: wallet.id });
    const debits = page.entries.filter((e) => e.direction === "DEBIT");
    expect(debits).toHaveLength(1); // exatamente um débito, não importa quantas vezes isso rodar
  });

  it("50 submissões idênticas em paralelo produzem um único débito", async () => {
    const [a] = instances;
    const playerId = newId();
    const wallet = await a!.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
    });

    const cmd = {
      providerId: "provider-a",
      externalTransactionId: "dup-bet",
      idempotencyKey: "provider-a:dup-bet",
      playerId,
      walletId: wallet.id,
      roundId: "round-dup",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "30.00", currency: "BRL" }),
    };

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        instances[i % instances.length]!.submit.execute(cmd),
      ),
    );

    const transactionIds = new Set(results.map((r) => r.transaction.id));
    expect(transactionIds.size).toBe(1);
    expect(results.filter((r) => r.idempotentReplay).length).toBe(49);
    expect(results.filter((r) => !r.idempotentReplay).length).toBe(1);

    const reloaded = await a!.getWallet.execute(wallet.id);
    expect(reloaded!.balance.toJSON()).toEqual({
      amount: "970.00",
      currency: "BRL",
    });
  });
});
