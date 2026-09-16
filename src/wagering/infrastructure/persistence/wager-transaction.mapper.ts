import type { InferEntity } from "@mikro-orm/core";
import { Money } from "../../../shared/kernel/money";
import type { FailureCode } from "../../../shared/kernel/failure-code";
import { WagerTransaction } from "../../domain/wager-transaction";
import { WagerTransactionEntity } from "./wager-transaction.entity";

type WagerTransactionRow = InferEntity<typeof WagerTransactionEntity>;

export function toWagerTransactionDomain(
  entity: WagerTransactionRow,
): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: entity.id,
    providerId: entity.providerId,
    externalTransactionId: entity.externalTransactionId,
    idempotencyKey: entity.idempotencyKey,
    payloadHash: entity.payloadHash,
    walletId: entity.walletId,
    playerId: entity.playerId,
    roundId: entity.roundId,
    gameId: entity.gameId,
    kind: entity.kind,
    money: Money.fromMinorUnits(entity.moneyAmount, entity.moneyCurrency),
    referenceExternalTransactionId:
      entity.referenceExternalTransactionId ?? undefined,
    createdAt: entity.createdAt,
    status: entity.status,
    referenceTransactionId: entity.referenceTransactionId ?? undefined,
    failureCode: (entity.failureCode as FailureCode | null) ?? undefined,
    processedAt: entity.processedAt ?? undefined,
    referenceRetryAttempts: entity.referenceRetryAttempts,
    nextReferenceRetryAt: entity.nextReferenceRetryAt ?? undefined,
  });
}

export function toWagerTransactionEntity(
  tx: WagerTransaction,
): WagerTransactionRow {
  return {
    id: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    idempotencyKey: tx.idempotencyKey,
    payloadHash: tx.payloadHash,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    moneyAmount: tx.money.toMinorUnits(),
    moneyCurrency: tx.money.currency,
    referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
    referenceTransactionId: tx.referenceTransactionId ?? null,
    status: tx.status,
    failureCode: tx.failureCode ?? null,
    createdAt: tx.createdAt,
    processedAt: tx.processedAt ?? null,
    referenceRetryAttempts: tx.referenceRetryAttempts,
    nextReferenceRetryAt: tx.nextReferenceRetryAt ?? null,
  };
}
