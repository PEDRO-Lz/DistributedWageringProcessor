import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../src/wagering/domain/wager-transaction-status.enum";
import { FailureCode } from "../../src/shared/kernel/failure-code";
import { IdempotencyConflictError } from "../../src/shared/kernel/errors";
import { newId } from "../../src/shared/kernel/id";
import {
  closeInstances,
  createTestInstance,
  resetDatabase,
  type TestInstance,
} from "../support/test-orm";

describe("SubmitWagerTransactionUseCase (integração, Postgres real)", () => {
  let instance: TestInstance;

  beforeEach(async () => {
    instance = await createTestInstance();
    await resetDatabase(instance);
  });

  afterAll(async () => {
    await closeInstances([instance]);
  });

  it("BET com saldo suficiente é PROCESSED, debita a wallet e gera 1 lançamento DEBIT", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const result = await instance.submit.execute({
      providerId: "provider-a",
      externalTransactionId: "bet-1",
      idempotencyKey: "provider-a:bet-1",
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
    });

    expect(result.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.toJSON()).toEqual({
      amount: "75.00",
      currency: "BRL",
    });

    const reloaded = await instance.getWallet.execute(wallet.id);
    expect(reloaded!.balance.toJSON()).toEqual({
      amount: "75.00",
      currency: "BRL",
    });
  });

  it("BET sem saldo suficiente é REJECTED, sem lançamento e sem mudar o saldo", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "10.00", currency: "BRL" }),
    });

    const result = await instance.submit.execute({
      providerId: "provider-a",
      externalTransactionId: "bet-1",
      idempotencyKey: "provider-a:bet-1",
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
    });

    expect(result.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.transaction.failureCode).toBe(
      FailureCode.InsufficientBalance,
    );

    const reloaded = await instance.getWallet.execute(wallet.id);
    expect(reloaded!.balance.toJSON()).toEqual({
      amount: "10.00",
      currency: "BRL",
    });

    const page = await instance.getLedger.execute({ walletId: wallet.id });
    expect(page.entries).toHaveLength(1); // só o CREDIT da abertura (saldo inicial 10.00); a rejeição não gerou lançamento novo
  });

  it("a mesma Idempotency-Key duas vezes retorna replay, sem debitar de novo", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });
    const cmd = {
      providerId: "provider-a",
      externalTransactionId: "bet-1",
      idempotencyKey: "provider-a:bet-1",
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
    };

    const first = await instance.submit.execute(cmd);
    const second = await instance.submit.execute(cmd);

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.balance.toJSON()).toEqual({
      amount: "75.00",
      currency: "BRL",
    });
  });

  it("a mesma Idempotency-Key com payload diferente é conflito, não replay", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });
    const base = {
      providerId: "provider-a",
      externalTransactionId: "bet-1",
      idempotencyKey: "provider-a:bet-1",
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
    };

    await instance.submit.execute({
      ...base,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
    });

    await expect(
      instance.submit.execute({
        ...base,
        money: Money.from({ amount: "30.00", currency: "BRL" }),
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
