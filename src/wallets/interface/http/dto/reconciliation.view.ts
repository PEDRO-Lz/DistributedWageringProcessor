import type { ReconciliationResult } from "../../../application/use-cases/reconcile-wallet.use-case";
import type { MoneyProps } from "../../../../shared/kernel/money";

export interface ReconciliationView {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

export function toReconciliationView(
  result: ReconciliationResult,
): ReconciliationView {
  return {
    walletId: result.walletId,
    storedBalance: result.storedBalance.toJSON(),
    calculatedBalance: result.calculatedBalance.toJSON(),
    difference: result.difference.toJSON(),
    consistent: result.consistent,
    checkedEntries: result.checkedEntries,
  };
}
