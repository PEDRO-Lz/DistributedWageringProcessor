import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
import { newId } from "../../src/shared/kernel/id";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../src/wagering/domain/wager-transaction-status.enum";
import {
  closeInstances,
  createTestInstance,
  resetDatabase,
  type TestInstance,
} from "../support/test-orm";

describe("imutabilidade estrutural (triggers do Postgres, sem mock)", () => {
  let instance: TestInstance;

  beforeEach(async () => {
    instance = await createTestInstance();
    await resetDatabase(instance);
  });

  afterAll(async () => {
    await closeInstances([instance]);
  });

  it("wallet_ledger_entries rejeita UPDATE e DELETE, mesmo mudando um campo qualquer", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const [entry] = await instance.orm.em
      .getConnection()
      .execute<
        { id: string }[]
      >("select id from wallet_ledger_entries where wallet_id = ?", [wallet.id]);
    expect(entry).toBeDefined();

    await expect(
      instance.orm.em
        .getConnection()
        .execute(
          "update wallet_ledger_entries set money_amount = money_amount + 1 where id = ?",
          [entry!.id],
        ),
    ).rejects.toThrow(/immutable/);

    await expect(
      instance.orm.em
        .getConnection()
        .execute("delete from wallet_ledger_entries where id = ?", [entry!.id]),
    ).rejects.toThrow(/immutable/);
  });

  it("wager_transactions aceita UPDATE enquanto não é terminal, e rejeita depois de terminal", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    // REFUND sem o BET referenciado ainda existir: fica PENDING_REFERENCE,
    // não terminal, exatamente o estado que devia aceitar UPDATE normal
    const result = await instance.submit.execute({
      providerId: "provider-a",
      externalTransactionId: "refund-1",
      idempotencyKey: "provider-a:refund-1",
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: "10.00", currency: "BRL" }),
      referenceExternalTransactionId: "bet-inexistente",
    });
    expect(result.transaction.status).toBe(
      WagerTransactionStatus.PendingReference,
    );

    const txId = result.transaction.id;

    // Não terminal: update comum é permitido
    await instance.orm.em
      .getConnection()
      .execute(
        "update wager_transactions set reference_retry_attempts = reference_retry_attempts + 1 where id = ?",
        [txId],
      );
    const [afterAllowedUpdate] = await instance.orm.em
      .getConnection()
      .execute<
        { reference_retry_attempts: number }[]
      >("select reference_retry_attempts from wager_transactions where id = ?", [txId]);
    expect(afterAllowedUpdate!.reference_retry_attempts).toBe(2);

    // Transição para terminal (o próprio UPDATE que termina a linha é
    // permitido: old.status ainda não era terminal quando ele rodou)
    await instance.orm.em
      .getConnection()
      .execute(
        "update wager_transactions set status = 'REJECTED', failure_code = 'REFERENCE_RESOLUTION_TIMEOUT', processed_at = now() where id = ?",
        [txId],
      );

    // Agora é terminal: qualquer UPDATE novo é rejeitado.
    await expect(
      instance.orm.em
        .getConnection()
        .execute(
          "update wager_transactions set reference_retry_attempts = reference_retry_attempts + 1 where id = ?",
          [txId],
        ),
    ).rejects.toThrow(/terminal/);

    await expect(
      instance.orm.em
        .getConnection()
        .execute("delete from wager_transactions where id = ?", [txId]),
    ).rejects.toThrow(/never deleted/);
  });

  it("outbox_messages: envelope é sempre imutável, bookkeeping só até publicar, depois congela tudo", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const [message] = await instance.orm.em
      .getConnection()
      .execute<
        { id: string; attempts: number }[]
      >("select id, attempts from outbox_messages order by occurred_at asc limit 1");
    expect(message).toBeDefined();

    // Envelope nunca muda, publicada ou não.
    await expect(
      instance.orm.em
        .getConnection()
        .execute(
          "update outbox_messages set event_type = 'Forjado' where id = ?",
          [message!.id],
        ),
    ).rejects.toThrow(/envelope is immutable/);

    // Bookkeeping pode mudar normalmente antes de publicar.
    await instance.orm.em
      .getConnection()
      .execute(
        "update outbox_messages set attempts = attempts + 1 where id = ?",
        [message!.id],
      );
    const [afterBookkeepingUpdate] = await instance.orm.em
      .getConnection()
      .execute<
        { attempts: number }[]
      >("select attempts from outbox_messages where id = ?", [message!.id]);
    expect(afterBookkeepingUpdate!.attempts).toBe(message!.attempts + 1);

    // Marca como publicada.
    await instance.orm.em
      .getConnection()
      .execute("update outbox_messages set published_at = now() where id = ?", [
        message!.id,
      ]);

    // Publicada: até bookkeeping trava agora.
    await expect(
      instance.orm.em
        .getConnection()
        .execute(
          "update outbox_messages set attempts = attempts + 1 where id = ?",
          [message!.id],
        ),
    ).rejects.toThrow(/published and terminal/);

    await expect(
      instance.orm.em
        .getConnection()
        .execute("delete from outbox_messages where id = ?", [message!.id]),
    ).rejects.toThrow(/never deleted/);
  });
});
