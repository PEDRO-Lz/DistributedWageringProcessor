import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
import { newId } from "../../src/shared/kernel/id";
import { WAGER_TRANSACTIONS_QUEUE } from "../../src/messaging/sqs/queue-names";
import type { ReceivedSqsMessage } from "../../src/messaging/sqs/sqs.port";
import {
  closeInstances,
  createTestInstance,
  resetDatabase,
  type TestInstance,
} from "../support/test-orm";

async function drainQueue(instance: TestInstance): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const messages = await instance.sqs.receive(
      WAGER_TRANSACTIONS_QUEUE,
      10,
      0,
    );
    if (messages.length === 0) {
      return;
    }
    for (const message of messages) {
      await instance.sqs.delete(
        WAGER_TRANSACTIONS_QUEUE,
        message.receiptHandle,
      );
    }
  }
}

describe("ConsumeWagerTransactionBatchUseCase (integração, Postgres + LocalStack reais)", () => {
  let instance: TestInstance;

  beforeEach(async () => {
    instance = await createTestInstance();
    await resetDatabase(instance);
    await drainQueue(instance);
  });

  afterAll(async () => {
    await closeInstances([instance]);
  });

  it("consome uma mensagem real da fila, processa o BET e apaga a mensagem", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const idempotencyKey = `provider-a:${newId()}`;
    await instance.sqs.send(
      WAGER_TRANSACTIONS_QUEUE,
      JSON.stringify({
        providerId: "provider-a",
        externalTransactionId: idempotencyKey,
        idempotencyKey,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
      }),
      wallet.id,
      idempotencyKey,
    );

    const processed = await instance.consumeWagerTransactionBatch.run(10, 2);
    expect(processed).toBe(1);

    const reloaded = await instance.getWallet.execute(wallet.id);
    expect(reloaded!.balance.toJSON()).toEqual({
      amount: "75.00",
      currency: "BRL",
    });

    const remaining = await instance.sqs.receive(
      WAGER_TRANSACTIONS_QUEUE,
      10,
      0,
    );
    expect(remaining).toHaveLength(0);
  });

  it("redelivery da mesma mensagem (mesmo messageId) é idempotente via inbox, não debita de novo", async () => {
    const playerId = newId();
    const wallet = await instance.openWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const idempotencyKey = `provider-a:${newId()}`;
    const message: ReceivedSqsMessage = {
      messageId: newId(),
      receiptHandle: "fake-receipt-handle",
      body: JSON.stringify({
        providerId: "provider-a",
        externalTransactionId: idempotencyKey,
        idempotencyKey,
        playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
      }),
    };

    const first = await instance.consumeWagerTransactionBatch.handle(message);
    const second = await instance.consumeWagerTransactionBatch.handle(message);

    expect(first.status).toBe("processed");
    expect(second.status).toBe("duplicate");

    const reloaded = await instance.getWallet.execute(wallet.id);
    expect(reloaded!.balance.toJSON()).toEqual({
      amount: "75.00",
      currency: "BRL",
    });
  });

  it("mensagem malformada (JSON inválido) não é ack, marcada como malformed", async () => {
    const message: ReceivedSqsMessage = {
      messageId: newId(),
      receiptHandle: "fake-receipt-handle",
      body: "isso não é JSON",
    };

    const outcome = await instance.consumeWagerTransactionBatch.handle(message);
    expect(outcome.status).toBe("malformed");
    expect(outcome.ack).toBe(false);
  });

  it("erro de negócio (wallet inexistente) não é ack e não deixa rastro na inbox", async () => {
    const idempotencyKey = `provider-a:${newId()}`;
    const message: ReceivedSqsMessage = {
      messageId: newId(),
      receiptHandle: "fake-receipt-handle",
      body: JSON.stringify({
        providerId: "provider-a",
        externalTransactionId: idempotencyKey,
        idempotencyKey,
        playerId: newId(),
        walletId: newId(),
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
      }),
    };

    const outcome = await instance.consumeWagerTransactionBatch.handle(message);
    expect(outcome.status).toBe("error");
    expect(outcome.ack).toBe(false);

    // A transação inteira (inbox + submit) fez rollback junto: nenhuma
    // linha de inbox sobrou pra essa mensagem, uma reentrega futura parte
    // do zero de novo.
    const em = instance.orm.em.fork();
    const inboxRow = await em
      .getConnection()
      .execute("select 1 from inbox_messages where message_id = ?", [
        message.messageId,
      ]);
    expect(inboxRow).toHaveLength(0);
  });
});
