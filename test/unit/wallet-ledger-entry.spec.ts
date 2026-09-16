import { describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
import { LedgerDirection } from "../../src/shared/kernel/ledger-direction";
import { UnbalancedLedgerEntryError } from "../../src/shared/kernel/errors";
import { WalletLedgerEntry } from "../../src/wallets/domain/wallet-ledger-entry";

const BRL = (amount: string) => Money.from({ amount, currency: "BRL" });

describe("WalletLedgerEntry", () => {
  describe("create()", () => {
    it("aceita um DEBIT cuja aritmética bate", () => {
      const entry = WalletLedgerEntry.create({
        id: "entry-1",
        walletId: "wallet-1",
        transactionId: "tx-1",
        direction: LedgerDirection.Debit,
        money: BRL("30.00"),
        balanceBefore: BRL("100.00"),
        balanceAfter: BRL("70.00"),
        createdAt: new Date(),
      });
      expect(entry.isBalanced()).toBe(true);
    });

    it("aceita um CREDIT cuja aritmética bate", () => {
      const entry = WalletLedgerEntry.create({
        id: "entry-1",
        walletId: "wallet-1",
        transactionId: "tx-1",
        direction: LedgerDirection.Credit,
        money: BRL("30.00"),
        balanceBefore: BRL("100.00"),
        balanceAfter: BRL("130.00"),
        createdAt: new Date(),
      });
      expect(entry.isBalanced()).toBe(true);
    });

    it("rejeita quando balanceAfter não bate com a direção (DEBIT que deveria subtrair)", () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: "entry-1",
          walletId: "wallet-1",
          transactionId: "tx-1",
          direction: LedgerDirection.Debit,
          money: BRL("30.00"),
          balanceBefore: BRL("100.00"),
          balanceAfter: BRL("130.00"), // deveria ser 70.00
          createdAt: new Date(),
        }),
      ).toThrow(UnbalancedLedgerEntryError);
    });

    it("rejeita quando balanceAfter não bate com a direção (CREDIT que deveria somar)", () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: "entry-1",
          walletId: "wallet-1",
          transactionId: "tx-1",
          direction: LedgerDirection.Credit,
          money: BRL("30.00"),
          balanceBefore: BRL("100.00"),
          balanceAfter: BRL("70.00"), // deveria ser 130.00
          createdAt: new Date(),
        }),
      ).toThrow(UnbalancedLedgerEntryError);
    });

    it('rejeita money zero, mesmo com aritmética "batendo"', () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: "entry-1",
          walletId: "wallet-1",
          transactionId: "tx-1",
          direction: LedgerDirection.Credit,
          money: Money.zero("BRL"),
          balanceBefore: BRL("100.00"),
          balanceAfter: BRL("100.00"),
          createdAt: new Date(),
        }),
      ).toThrow(UnbalancedLedgerEntryError);
    });

    it("rejeita money negativo", () => {
      expect(() =>
        WalletLedgerEntry.create({
          id: "entry-1",
          walletId: "wallet-1",
          transactionId: "tx-1",
          direction: LedgerDirection.Debit,
          money: BRL("30.00").negate(),
          balanceBefore: BRL("100.00"),
          balanceAfter: BRL("70.00"),
          createdAt: new Date(),
        }),
      ).toThrow(UnbalancedLedgerEntryError);
    });
  });

  describe("rehydrate()", () => {
    it("reconstrói o estado sem validar, mesmo que a aritmética esteja quebrada", () => {
      const entry = WalletLedgerEntry.rehydrate({
        id: "entry-1",
        walletId: "wallet-1",
        transactionId: "tx-1",
        direction: LedgerDirection.Debit,
        money: BRL("30.00"),
        balanceBefore: BRL("100.00"),
        balanceAfter: BRL("999.00"), // muito errado
        createdAt: new Date(),
      });

      expect(entry.balanceAfter.toJSON().amount).toBe("999.00");
      expect(entry.isBalanced()).toBe(false);
    });
  });
});
