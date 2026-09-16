import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
  NegativeMoneyAmountError,
} from "./errors";

export interface MoneyProps {
  amount: string; // string decimal "25.00"
  currency: string; // "BRL"
}

// (2 casas decimais, sem sinal, sem notação científica, sem zero à esquerda) OU "0"
const VALID_AMOUNT = /^(0|[1-9]\d*)\.\d{2}$/;
const NEGATIVE_AMOUNT = /^-(0|[1-9]\d*)\.\d{2}$/;
const VALID_CURRENCY = /^[A-Z]{3}$/;

function assertValidCurrency(currency: string): void {
  if (!VALID_CURRENCY.test(currency)) {
    throw new InvalidCurrencyError(currency);
  }
}

function decimalStringToMinorUnits(amount: string): bigint {
  const [integerPart, fractionalPart] = amount.split(".");
  return BigInt(integerPart!) * 100n + BigInt(fractionalPart!);
}

function minorUnitsToDecimalString(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;
  const integerPart = absolute / 100n;
  const fractionalPart = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${integerPart}.${fractionalPart}`;
}

// Dinheiro como bigint de centavos
// Imutável: toda operação retorna uma nova instância
export class Money {
  private constructor(
    private readonly minorUnits: bigint,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    const { amount, currency } = props;

    if (NEGATIVE_AMOUNT.test(amount)) {
      throw new NegativeMoneyAmountError(amount);
    }
    if (!VALID_AMOUNT.test(amount)) {
      throw new InvalidMoneyAmountError(amount);
    }
    assertValidCurrency(currency);

    return new Money(decimalStringToMinorUnits(amount), currency);
  }

  static zero(currency: string): Money {
    assertValidCurrency(currency);
    return new Money(0n, currency);
  }

  // Reidratação a partir de uma coluna bigint do banco
  static fromMinorUnits(minorUnits: bigint, currency: string): Money {
    assertValidCurrency(currency);
    return new Money(minorUnits, currency);
  }

  toMinorUnits(): bigint {
    return this.minorUnits;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  negate(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits < other.minorUnits;
  }

  // Moedas diferentes nunca são iguais
  equals(other: Money): boolean {
    return (
      this.currency === other.currency && this.minorUnits === other.minorUnits
    );
  }

  toJSON(): MoneyProps {
    return {
      amount: minorUnitsToDecimalString(this.minorUnits),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${minorUnitsToDecimalString(this.minorUnits)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
