import { defineEntity, p } from "@mikro-orm/core";
import { WagerTransactionKind } from "../../domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../domain/wager-transaction-status.enum";

export const WagerTransactionEntity = defineEntity({
  name: "WagerTransactionEntity",
  tableName: "wager_transactions",
  properties: {
    id: p.uuid().primary(),
    providerId: p.string(),
    externalTransactionId: p.string(),
    idempotencyKey: p.string(),
    payloadHash: p.string(),
    walletId: p.uuid(),
    playerId: p.uuid(),
    roundId: p.string(),
    gameId: p.string(),
    kind: p.enum(() => WagerTransactionKind),
    moneyAmount: p.bigint(),
    moneyCurrency: p.string(),
    referenceExternalTransactionId: p.string().nullable(),
    referenceTransactionId: p.uuid().nullable(),
    status: p.enum(() => WagerTransactionStatus),
    failureCode: p.string().nullable(),
    createdAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
});
