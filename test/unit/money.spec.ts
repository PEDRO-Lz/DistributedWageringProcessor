import { describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  NegativeMoneyAmountError,
} from "../../src/shared/kernel/errors";

describe("Money", () => {
  describe("from(): escala e arredondamento", () => {
    it("aceita um valor com exatamente 2 casas decimais", () => {
      const money = Money.from({ amount: "25.00", currency: "BRL" });
      expect(money.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
    });

    it("aceita zero", () => {
      const money = Money.from({ amount: "0.00", currency: "BRL" });
      expect(money.isZero()).toBe(true);
    });

    it("aceita o menor valor possível, 1 centavo", () => {
      const money = Money.from({ amount: "0.01", currency: "BRL" });
      expect(money.toJSON().amount).toBe("0.01");
    });

    it("aceita valores grandes sem perder precisão", () => {
      const money = Money.from({ amount: "99999999999.99", currency: "BRL" });
      expect(money.toJSON().amount).toBe("99999999999.99");
    });

    it("rejeita mais de 2 casas decimais, sem arredondar", () => {
      expect(() => Money.from({ amount: "25.001", currency: "BRL" })).toThrow(
        InvalidMoneyAmountError,
      );
    });

    it("rejeita menos de 2 casas decimais", () => {
      expect(() => Money.from({ amount: "25.1", currency: "BRL" })).toThrow(
        InvalidMoneyAmountError,
      );
    });

    it("rejeita valor sem casa decimal nenhuma", () => {
      expect(() => Money.from({ amount: "25", currency: "BRL" })).toThrow(
        InvalidMoneyAmountError,
      );
    });
  });

  describe("from(): entradas inválidas", () => {
    it("rejeita string vazia", () => {
      expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(
        InvalidMoneyAmountError,
      );
    });

    it('rejeita "NaN"', () => {
      expect(() => Money.from({ amount: "NaN", currency: "BRL" })).toThrow(
        InvalidMoneyAmountError,
      );
    });

    it('rejeita "Infinity"', () => {
      expect(() => Money.from({ amount: "Infinity", currency: "BRL" })).toThrow(
        InvalidMoneyAmountError,
      );
    });

    it("rejeita notação científica", () => {
      expect(() => Money.from({ amount: "2.5e1", currency: "BRL" })).toThrow(
        InvalidMoneyAmountError,
      );
    });

    it("rejeita valor negativo com um erro específico, não o genérico", () => {
      expect(() => Money.from({ amount: "-25.00", currency: "BRL" })).toThrow(
        NegativeMoneyAmountError,
      );
    });

    it("rejeita moeda em minúsculo", () => {
      expect(() => Money.from({ amount: "25.00", currency: "brl" })).toThrow(
        InvalidCurrencyError,
      );
    });

    it("rejeita moeda com tamanho errado", () => {
      expect(() => Money.from({ amount: "25.00", currency: "BR" })).toThrow(
        InvalidCurrencyError,
      );
    });
  });

  describe("conflito de moeda", () => {
    it("add() entre moedas diferentes lança CurrencyMismatchError", () => {
      const brl = Money.from({ amount: "10.00", currency: "BRL" });
      const usd = Money.from({ amount: "10.00", currency: "USD" });
      expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    });

    it("subtract() entre moedas diferentes lança CurrencyMismatchError", () => {
      const brl = Money.from({ amount: "10.00", currency: "BRL" });
      const usd = Money.from({ amount: "10.00", currency: "USD" });
      expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    });

    it("isLessThan() entre moedas diferentes lança CurrencyMismatchError", () => {
      const brl = Money.from({ amount: "10.00", currency: "BRL" });
      const usd = Money.from({ amount: "10.00", currency: "USD" });
      expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
    });

    it("equals() entre moedas diferentes retorna false, não lança", () => {
      const brl = Money.from({ amount: "10.00", currency: "BRL" });
      const usd = Money.from({ amount: "10.00", currency: "USD" });
      expect(brl.equals(usd)).toBe(false);
    });
  });

  describe("imutabilidade", () => {
    it("add() não altera a instância original", () => {
      const original = Money.from({ amount: "10.00", currency: "BRL" });
      const result = original.add(
        Money.from({ amount: "5.00", currency: "BRL" }),
      );

      expect(original.toJSON().amount).toBe("10.00");
      expect(result.toJSON().amount).toBe("15.00");
      expect(result).not.toBe(original);
    });

    it("subtract() não altera a instância original", () => {
      const original = Money.from({ amount: "10.00", currency: "BRL" });
      original.subtract(Money.from({ amount: "3.00", currency: "BRL" }));

      expect(original.toJSON().amount).toBe("10.00");
    });

    it("negate() não altera a instância original", () => {
      const original = Money.from({ amount: "10.00", currency: "BRL" });
      const negated = original.negate();

      expect(original.toJSON().amount).toBe("10.00");
      expect(negated.toJSON().amount).toBe("-10.00");
    });
  });

  describe("aritmética", () => {
    it("add() soma corretamente", () => {
      const result = Money.from({ amount: "10.00", currency: "BRL" }).add(
        Money.from({ amount: "5.50", currency: "BRL" }),
      );
      expect(result.toJSON().amount).toBe("15.50");
    });

    it("subtract() pode resultar em valor negativo (uso interno)", () => {
      const result = Money.from({ amount: "5.00", currency: "BRL" }).subtract(
        Money.from({ amount: "8.00", currency: "BRL" }),
      );
      expect(result.toJSON().amount).toBe("-3.00");
      expect(result.isNegative()).toBe(true);
    });

    it("isLessThan() compara corretamente", () => {
      const five = Money.from({ amount: "5.00", currency: "BRL" });
      const ten = Money.from({ amount: "10.00", currency: "BRL" });
      expect(five.isLessThan(ten)).toBe(true);
      expect(ten.isLessThan(five)).toBe(false);
    });

    it("isPositive()/isNegative()/isZero() refletem o sinal", () => {
      expect(Money.from({ amount: "1.00", currency: "BRL" }).isPositive()).toBe(
        true,
      );
      expect(Money.zero("BRL").isZero()).toBe(true);
      expect(
        Money.from({ amount: "1.00", currency: "BRL" }).negate().isNegative(),
      ).toBe(true);
    });

    it("equals() compara valor e moeda", () => {
      const a = Money.from({ amount: "10.00", currency: "BRL" });
      const b = Money.from({ amount: "10.00", currency: "BRL" });
      const c = Money.from({ amount: "10.01", currency: "BRL" });
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });
  });

  describe("zero() e persistência (fromMinorUnits/toMinorUnits)", () => {
    it("zero() cria um valor zerado na moeda informada", () => {
      const money = Money.zero("BRL");
      expect(money.toJSON()).toEqual({ amount: "0.00", currency: "BRL" });
    });

    it("fromMinorUnits()/toMinorUnits() fazem o roundtrip exato usado pela persistência", () => {
      const original = Money.from({ amount: "123.45", currency: "BRL" });
      const rehydrated = Money.fromMinorUnits(
        original.toMinorUnits(),
        original.currency,
      );
      expect(rehydrated.equals(original)).toBe(true);
      expect(original.toMinorUnits()).toBe(12345n);
    });
  });

  describe("toString()", () => {
    it('formata como "valor moeda"', () => {
      const money = Money.from({ amount: "25.00", currency: "BRL" });
      expect(money.toString()).toBe("25.00 BRL");
    });
  });
});
