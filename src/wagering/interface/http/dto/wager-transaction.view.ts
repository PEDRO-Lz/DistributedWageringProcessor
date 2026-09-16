import type { WagerTransaction } from "../../../domain/wager-transaction";
import type { MoneyProps } from "../../../../shared/kernel/money";

export interface WagerTransactionView {
  id: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  status: string;
  referenceTransactionId: string | undefined;
  failureCode: string | undefined;
  processedAt: string | undefined;
  createdAt: string;
}

export function toWagerTransactionView(
  tx: WagerTransaction,
): WagerTransactionView {
  return {
    id: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    money: tx.money.toJSON(),
    status: tx.status,
    referenceTransactionId: tx.referenceTransactionId,
    failureCode: tx.failureCode,
    processedAt: tx.processedAt?.toISOString(),
    createdAt: tx.createdAt.toISOString(),
  };
}

export interface SubmitWagerTransactionView {
  transaction: WagerTransactionView;
  idempotentReplay: boolean;
  balance: MoneyProps;
}
