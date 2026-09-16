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

// Bypassa o backoff pra não precisar esperar minutos de verdade num teste
async function makeDueNow(
  instance: TestInstance,
  transactionId: string,
): Promise<void> {
  await instance.orm.em
    .getConnection()
    .execute(
      "update wager_transactions set next_reference_retry_at = null where id = ?",
      [transactionId],
    );
}

describe("ReprocessPendingReferencesUseCase (integração, Postgres real)", () => {
  let instance: TestInstance;

  beforeEach(async () => {
    instance = await createTestInstance();
    await resetDatabase(instance);
  });

  afterAll(async () => {
    await closeInstances([instance]);
  });

  it("REFUND antes do BET existir fica PENDING_REFERENCE; depois que o BET chega, o worker resolve pra PROCESSED", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const refund = await instance.submit.execute({
      providerId: "provider-a",
      externalTransactionId: "refund-1",
      idempotencyKey: "provider-a:refund-1",
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: "bet-1",
      money: Money.from({ amount: "25.00", currency: "BRL" }),
    });
    expect(refund.transaction.status).toBe(
      WagerTransactionStatus.PendingReference,
    );
    expect(refund.transaction.referenceRetryAttempts).toBe(1);

    await instance.submit.execute({
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

    await makeDueNow(instance, refund.transaction.id);
    const processedCount = await instance.reprocess.run(10);
    expect(processedCount).toBe(1);

    const resolved = await instance.getTransaction.byId(refund.transaction.id);
    expect(resolved!.status).toBe(WagerTransactionStatus.Processed);

    // BET debitou 25, REFUND devolveu 25: saldo volta pro que era antes.
    const reloaded = await instance.getWallet.execute(wallet.id);
    expect(reloaded!.balance.toJSON()).toEqual({
      amount: "100.00",
      currency: "BRL",
    });
  });

  it("esgotar as tentativas sem a referência aparecer rejeita com REFERENCE_RESOLUTION_TIMEOUT", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const refund = await instance.submit.execute({
      providerId: "provider-a",
      externalTransactionId: "refund-timeout",
      idempotencyKey: "provider-a:refund-timeout",
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: "bet-que-nunca-chega",
      money: Money.from({ amount: "25.00", currency: "BRL" }),
    });
    expect(refund.transaction.referenceRetryAttempts).toBe(1);

    // A referência nunca chega: cada rodada do worker reagenda de novo,
    // até esgotar. 1 tentativa já feita no submit, faltam mais 9 pra chegar no máximo (10).
    for (let i = 0; i < 9; i++) {
      await makeDueNow(instance, refund.transaction.id);
      await instance.reprocess.run(10);
    }

    const stillPending = await instance.getTransaction.byId(
      refund.transaction.id,
    );
    expect(stillPending!.status).toBe(WagerTransactionStatus.PendingReference);
    expect(stillPending!.referenceRetryAttempts).toBe(10);

    // Uma rodada mais: agora sim esgota.
    await makeDueNow(instance, refund.transaction.id);
    await instance.reprocess.run(10);

    const timedOut = await instance.getTransaction.byId(refund.transaction.id);
    expect(timedOut!.status).toBe(WagerTransactionStatus.Rejected);
    expect(timedOut!.failureCode).toBe(FailureCode.ReferenceResolutionTimeout);
  });
});
