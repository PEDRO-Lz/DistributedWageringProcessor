import {
  IntegrationEvent,
  type EventContext,
} from "../../../shared/kernel/integration-event";
import type { MoneyProps } from "../../../shared/kernel/money";
import { newId } from "../../../shared/kernel/id";
import type { WagerTransaction } from "../wager-transaction";

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId: string;
}

// REFUND/ROLLBACK cuja referência ainda não existe: parqueado para o worker de retry
export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;

  static from(
    tx: WagerTransaction,
    ctx: EventContext,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
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
        // Garantido definido: só chega aqui quando requiresReference() é
        // true, e create() já rejeita esse kind sem referência (MissingReferenceError)
        referenceExternalTransactionId: tx.referenceExternalTransactionId!,
      },
    });
  }
}
