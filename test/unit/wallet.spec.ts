import { describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
import { LedgerDirection } from "../../src/shared/kernel/ledger-direction";
import {
  CurrencyMismatchError,
  InsufficientBalanceError,
} from "../../src/shared/kernel/errors";
import { Wallet } from "../../src/wallets/domain/wallet";

const BRL = (amount: string) => Money.from({ amount, currency: "BRL" });
const now = new Date("2026-01-01T00:00:00.000Z");

function ctx(n = 1) {
  return { transactionId: `tx-${n}`, ledgerEntryId: `entry-${n}`, now };
}

describe("Wallet", () => {
  describe("open()", () => {
    it("aplica o saldo inicial e começa com version 1", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("100.00"),
        now,
      });
      expect(wallet.balance.toJSON().amount).toBe("100.00");
      expect(wallet.version).toBe(1);
    });

    it("saldo de abertura zero também começa com version 1", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: Money.zero("BRL"),
        now,
      });
      expect(wallet.version).toBe(1);
    });

    it("currency da wallet vem do currency do saldo inicial", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("100.00"),
        now,
      });
      expect(wallet.currency).toBe("BRL");
    });
  });

  describe("debit()", () => {
    it("reduz o saldo, incrementa version e retorna um lançamento DEBIT", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("100.00"),
        now,
      });
      const entry = wallet.debit(BRL("30.00"), ctx());

      expect(wallet.balance.toJSON().amount).toBe("70.00");
      expect(wallet.version).toBe(2);
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.balanceBefore.toJSON().amount).toBe("100.00");
      expect(entry.balanceAfter.toJSON().amount).toBe("70.00");
    });

    it("permite debitar até deixar o saldo exatamente em zero", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("50.00"),
        now,
      });
      wallet.debit(BRL("50.00"), ctx());
      expect(wallet.balance.isZero()).toBe(true);
    });

    it("rejeita débito que deixaria o saldo negativo, sem alterar o estado", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("50.00"),
        now,
      });

      expect(() => wallet.debit(BRL("50.01"), ctx())).toThrow(
        InsufficientBalanceError,
      );
      expect(wallet.balance.toJSON().amount).toBe("50.00");
      expect(wallet.version).toBe(1);
    });

    it("rejeita débito em moeda diferente da wallet", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("50.00"),
        now,
      });
      const usd = Money.from({ amount: "10.00", currency: "USD" });
      expect(() => wallet.debit(usd, ctx())).toThrow(CurrencyMismatchError);
    });
  });

  describe("credit()", () => {
    it("aumenta o saldo, incrementa version e retorna um lançamento CREDIT", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("100.00"),
        now,
      });
      const entry = wallet.credit(BRL("25.00"), ctx());

      expect(wallet.balance.toJSON().amount).toBe("125.00");
      expect(wallet.version).toBe(2);
      expect(entry.direction).toBe(LedgerDirection.Credit);
    });

    it("nunca falha por causa do saldo, por maior que seja o crédito", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("0.00"),
        now,
      });
      expect(() => wallet.credit(BRL("999999.99"), ctx())).not.toThrow();
    });

    it("rejeita crédito em moeda diferente da wallet", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("50.00"),
        now,
      });
      const usd = Money.from({ amount: "10.00", currency: "USD" });
      expect(() => wallet.credit(usd, ctx())).toThrow(CurrencyMismatchError);
    });
  });

  describe("version", () => {
    it("sobe exatamente 1 por movimentação, e não muda com a abertura", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("100.00"),
        now,
      });
      expect(wallet.version).toBe(1);

      wallet.debit(BRL("10.00"), ctx(1));
      expect(wallet.version).toBe(2);

      wallet.credit(BRL("5.00"), ctx(2));
      expect(wallet.version).toBe(3);
    });

    it("uma movimentação rejeitada não incrementa a version", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("10.00"),
        now,
      });
      expect(() => wallet.debit(BRL("999.00"), ctx())).toThrow(
        InsufficientBalanceError,
      );
      expect(wallet.version).toBe(1);
    });
  });

  describe("encadeamento de lançamentos", () => {
    it("o balanceAfter de um lançamento é o balanceBefore do próximo", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("100.00"),
        now,
      });
      const first = wallet.debit(BRL("30.00"), ctx(1));
      const second = wallet.credit(BRL("10.00"), ctx(2));

      expect(second.balanceBefore.equals(first.balanceAfter)).toBe(true);
    });
  });

  describe("rehydrate()", () => {
    it("reconstrói o estado exatamente como veio, sem recalcular nada", () => {
      const wallet = Wallet.rehydrate({
        id: "w1",
        playerId: "p1",
        currency: "BRL",
        balance: BRL("42.00"),
        version: 7,
        createdAt: now,
        updatedAt: now,
      });

      expect(wallet.balance.toJSON().amount).toBe("42.00");
      expect(wallet.version).toBe(7);
    });
  });

  describe("updatedAt", () => {
    it("muda a cada movimentação, createdAt nunca muda", () => {
      const wallet = Wallet.open({
        id: "w1",
        playerId: "p1",
        initialBalance: BRL("100.00"),
        now,
      });
      const later = new Date("2026-06-01T00:00:00.000Z");

      wallet.debit(BRL("10.00"), {
        transactionId: "tx-1",
        ledgerEntryId: "entry-1",
        now: later,
      });

      expect(wallet.updatedAt).toEqual(later);
      expect(wallet.createdAt).toEqual(now);
    });
  });
});
