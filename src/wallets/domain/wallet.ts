import { Money } from "../../shared/kernel/money";
import { LedgerDirection } from "../../shared/kernel/ledger-direction";
import {
  CurrencyMismatchError,
  InsufficientBalanceError,
} from "../../shared/kernel/errors";
import { WalletLedgerEntry } from "./wallet-ledger-entry";

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  now: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// Uma movimentação sempre precisa do id da transação que a causou, do id que o lançamento de ledger vai ter, e do instante em que aconteceu
export interface WalletMovementContext {
  transactionId: string;
  ledgerEntryId: string;
  now: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.now,
      props.now,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(money: Money, ctx: WalletMovementContext): WalletLedgerEntry {
    this.assertSameCurrency(money);

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(money);
    if (balanceAfter.isNegative()) {
      throw new InsufficientBalanceError(
        this.id,
        balanceBefore.toJSON().amount,
        money.toJSON().amount,
      );
    }

    const entry = WalletLedgerEntry.create({
      id: ctx.ledgerEntryId,
      walletId: this.id,
      transactionId: ctx.transactionId,
      direction: LedgerDirection.Debit,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: ctx.now,
    });

    this.applyMovement(balanceAfter, ctx.now);
    return entry;
  }

  credit(money: Money, ctx: WalletMovementContext): WalletLedgerEntry {
    this.assertSameCurrency(money);

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(money);

    const entry = WalletLedgerEntry.create({
      id: ctx.ledgerEntryId,
      walletId: this.id,
      transactionId: ctx.transactionId,
      direction: LedgerDirection.Credit,
      money,
      balanceBefore,
      balanceAfter,
      createdAt: ctx.now,
    });

    this.applyMovement(balanceAfter, ctx.now);
    return entry;
  }

  private applyMovement(balanceAfter: Money, now: Date): void {
    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = now;
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
