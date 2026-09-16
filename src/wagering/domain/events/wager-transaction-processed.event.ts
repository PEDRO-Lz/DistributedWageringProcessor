import {
  IntegrationEvent,
  type EventContext,
} from "../../../shared/kernel/integration-event";
import type { Money, MoneyProps } from "../../../shared/kernel/money";
import { newId } from "../../../shared/kernel/id";
import type { WagerTransaction } from "../wager-transaction";

export interface WagerTransactionProcessedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  balanceAfter: MoneyProps;
}

// Qualquer transação aplicada, inclusive LOSS (que não move saldo, mas ainda assim foi processada)
export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  static from(
    tx: WagerTransaction,
    balanceAfter: Money,
    ctx: EventContext,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      eventId: newId(),
      aggregateId: tx.walletId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.now,
      data: {
        transactionId: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        playerId: tx.playerId,
        walletId: tx.walletId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        balanceAfter: balanceAfter.toJSON(),
      },
    });
  }
}
