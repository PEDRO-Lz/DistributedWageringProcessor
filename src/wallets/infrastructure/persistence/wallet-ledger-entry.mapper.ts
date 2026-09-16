import type { InferEntity } from "@mikro-orm/core";
import { Money } from "../../../shared/kernel/money";
import { WalletLedgerEntry } from "../../domain/wallet-ledger-entry";
import { WalletLedgerEntryEntity } from "./wallet-ledger-entry.entity";

type WalletLedgerEntryRow = InferEntity<typeof WalletLedgerEntryEntity>;

export function toWalletLedgerEntryDomain(
  entity: WalletLedgerEntryRow,
): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: entity.id,
    walletId: entity.walletId,
    transactionId: entity.transactionId,
    direction: entity.direction,
    money: Money.fromMinorUnits(entity.moneyAmount, entity.moneyCurrency),
    balanceBefore: Money.fromMinorUnits(
      entity.balanceBeforeAmount,
      entity.balanceBeforeCurrency,
    ),
    balanceAfter: Money.fromMinorUnits(
      entity.balanceAfterAmount,
      entity.balanceAfterCurrency,
    ),
    createdAt: entity.createdAt,
  });
}

export function toWalletLedgerEntryEntity(
  entry: WalletLedgerEntry,
): WalletLedgerEntryRow {
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    direction: entry.direction,
    moneyAmount: entry.money.toMinorUnits(),
    moneyCurrency: entry.money.currency,
    balanceBeforeAmount: entry.balanceBefore.toMinorUnits(),
    balanceBeforeCurrency: entry.balanceBefore.currency,
    balanceAfterAmount: entry.balanceAfter.toMinorUnits(),
    balanceAfterCurrency: entry.balanceAfter.currency,
    createdAt: entry.createdAt,
  };
}
