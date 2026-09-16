// Base de todo erro de domínio do sistema
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMoneyAmountError extends DomainError {
  readonly code = "INVALID_MONEY_AMOUNT";

  constructor(amount: string) {
    super(
      `Valor inválido "${amount}": esperada uma string decimal não negativa com 2 casas decimais ("25.00")`,
    );
  }
}

export class NegativeMoneyAmountError extends DomainError {
  readonly code = "NEGATIVE_MONEY_AMOUNT";

  constructor(amount: string) {
    super(`Valor negativo "${amount}" não é permitido`);
  }
}

export class InvalidCurrencyError extends DomainError {
  readonly code = "INVALID_CURRENCY";

  constructor(currency: string) {
    super(`Código de moeda inválido "${currency}"`);
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = "CURRENCY_MISMATCH";

  constructor(expected: string, actual: string) {
    super(`Moedas incompatíveis: esperada "${expected}", recebida "${actual}"`);
  }
}
