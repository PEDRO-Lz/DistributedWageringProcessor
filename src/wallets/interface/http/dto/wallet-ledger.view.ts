import type { LedgerPage } from "../../../application/ports/wallet-ledger-repository.port";
import type { MoneyProps } from "../../../../shared/kernel/money";

export interface WalletLedgerEntryView {
  id: string;
  transactionId: string;
  direction: string;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface WalletLedgerPageView {
  entries: WalletLedgerEntryView[];
  nextCursor: string | undefined;
}

export function toWalletLedgerPageView(page: LedgerPage): WalletLedgerPageView {
  return {
    entries: page.entries.map((entry) => ({
      id: entry.id,
      transactionId: entry.transactionId,
      direction: entry.direction,
      money: entry.money.toJSON(),
      balanceBefore: entry.balanceBefore.toJSON(),
      balanceAfter: entry.balanceAfter.toJSON(),
      createdAt: entry.createdAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}
