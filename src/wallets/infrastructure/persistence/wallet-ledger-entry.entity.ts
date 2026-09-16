import { defineEntity, p } from "@mikro-orm/core";
import { LedgerDirection } from "../../../shared/kernel/ledger-direction";

export const WalletLedgerEntryEntity = defineEntity({
  name: "WalletLedgerEntryEntity",
  tableName: "wallet_ledger_entries",
  properties: {
    id: p.uuid().primary(),
    walletId: p.uuid(),
    transactionId: p.uuid(),
    direction: p.enum(() => LedgerDirection),
    moneyAmount: p.bigint(),
    moneyCurrency: p.string(),
    balanceBeforeAmount: p.bigint(),
    balanceBeforeCurrency: p.string(),
    balanceAfterAmount: p.bigint(),
    balanceAfterCurrency: p.string(),
    createdAt: p.datetime(),
  },
});
