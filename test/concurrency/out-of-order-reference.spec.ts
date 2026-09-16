import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
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
 * ROLLBACK/REFUND podem chegar antes do BET/WIN que referenciam
 * (mensageria não garante ordem entre filas diferentes,
 * só dentro do mesmo message group). O sistema não pode travar nem perder
 * a reversão, só adiar (PENDING_REFERENCE) até o worker de retry resolver
 */
describe("REFUND/ROLLBACK fora de ordem (Postgres real, múltiplas instâncias)", () => {
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

  it("ROLLBACK chega antes do BET, fica PENDING_REFERENCE, resolve depois e o saldo final é consistente", async () => {
    const [a, b, c] = instances;
    const playerId = newId();
    const wallet = await a!.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const externalBetId = "bet-fora-de-ordem";

    // Duas instâncias diferentes, ao mesmo tempo: B manda o ROLLBACK
    // referenciando um BET que A ainda não submeteu. Não deve deadlockar
    // nem lançar erro, só decidir "pending" (o BET pode chegar depois).
    const [rollbackResult, betResult] = await Promise.all([
      b!.submit.execute({
        providerId: "provider-a",
        externalTransactionId: "rollback-1",
        idempotencyKey: "provider-a:rollback-1",
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Rollback,
        money: Money.from({ amount: "30.00", currency: "BRL" }),
        referenceExternalTransactionId: externalBetId,
      }),
      a!.submit.execute({
        providerId: "provider-a",
        externalTransactionId: externalBetId,
        idempotencyKey: `provider-a:${externalBetId}`,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "30.00", currency: "BRL" }),
      }),
    ]);

    expect(betResult.transaction.status).toBe(WagerTransactionStatus.Processed);
    // Pode já ter resolvido se a corrida terminou depois do commit do BET,
    // ou ter ficado pending se terminou antes: os dois são corretos, o que
    // não pode acontecer é erro ou deadlock.
    expect([
      WagerTransactionStatus.PendingReference,
      WagerTransactionStatus.Processed,
    ]).toContain(rollbackResult.transaction.status);

    // Dá o "tempo" que o worker de retry daria: reprocessa até o ROLLBACK
    // resolver (no máximo alguns lotes, nunca preso pra sempre).
    for (let attempt = 0; attempt < 5; attempt++) {
      await c!.orm.em
        .getConnection()
        .execute(
          "update wager_transactions set next_reference_retry_at = null where status = 'PENDING_REFERENCE'",
        );
      await c!.reprocess.run(10);
    }

    const rollback = await c!.getTransaction.byId(
      rollbackResult.transaction.id,
    );
    expect(rollback!.status).toBe(WagerTransactionStatus.Processed);

    // BET debita 30, ROLLBACK reverte com crédito de 30: volta pro saldo original.
    const reloaded = await c!.getWallet.execute(wallet.id);
    expect(reloaded!.balance.toJSON()).toEqual({
      amount: "100.00",
      currency: "BRL",
    });

    // Prova de consistência de verdade: recalcula o saldo do zero a partir
    // do ledger, não confia só na coluna materializada.
    const reconciliation = await c!.reconcile.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.calculatedBalance.toJSON()).toEqual(
      reconciliation.storedBalance.toJSON(),
    );
  });
});
