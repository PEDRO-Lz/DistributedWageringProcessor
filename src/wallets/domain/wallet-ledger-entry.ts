import { Money } from "../../shared/kernel/money";
import { LedgerDirection } from "../../shared/kernel/ledger-direction";
import { UnbalancedLedgerEntryError } from "../../shared/kernel/errors";

export interface CreateWalletLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export interface WalletLedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

function computeExpectedBalanceAfter(
  direction: LedgerDirection,
  balanceBefore: Money,
  money: Money,
): Money {
  return direction === LedgerDirection.Debit
    ? balanceBefore.subtract(money)
    : balanceBefore.add(money);
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  static create(props: CreateWalletLedgerEntryProps): WalletLedgerEntry {
    const {
      id,
      walletId,
      transactionId,
      direction,
      money,
      balanceBefore,
      balanceAfter,
      createdAt,
    } = props;

    if (!money.isPositive()) {
      throw new UnbalancedLedgerEntryError();
    }

    const expectedBalanceAfter = computeExpectedBalanceAfter(
      direction,
      balanceBefore,
      money,
    );
    if (!expectedBalanceAfter.equals(balanceAfter)) {
      throw new UnbalancedLedgerEntryError();
    }

    return new WalletLedgerEntry(
      id,
      walletId,
      transactionId,
      direction,
      money,
      balanceBefore,
      balanceAfter,
      createdAt,
    );
  }

  static rehydrate(state: WalletLedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  isBalanced(): boolean {
    const expectedBalanceAfter = computeExpectedBalanceAfter(
      this.direction,
      this.balanceBefore,
      this.money,
    );
    return expectedBalanceAfter.equals(this.balanceAfter);
  }
}
