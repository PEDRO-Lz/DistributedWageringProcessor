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

export class InsufficientBalanceError extends DomainError {
  readonly code = "INSUFFICIENT_BALANCE";

  constructor(walletId: string, available: string, requested: string) {
    super(
      `Wallet ${walletId} tem saldo insuficiente: disponível ${available}, solicitado ${requested}`,
    );
  }
}

export class UnbalancedLedgerEntryError extends DomainError {
  readonly code = "UNBALANCED_LEDGER_ENTRY";

  constructor() {
    super(
      "balanceBefore +/- money precisa ser igual a balanceAfter em um WalletLedgerEntry, e money precisa ser positivo",
    );
  }
}

export class MissingReferenceError extends DomainError {
  readonly code = "VALIDATION_MISSING_REFERENCE";

  constructor(kind: string) {
    super(
      `WagerTransactionKind "${kind}" exige um referenceExternalTransactionId`,
    );
  }
}

export class InvalidTransactionStateError extends DomainError {
  readonly code = "INVALID_TRANSACTION_STATE";

  constructor(currentStatus: string, attemptedTransition: string) {
    super(
      `Não é possível aplicar "${attemptedTransition}" numa WagerTransaction em status terminal "${currentStatus}"`,
    );
  }
}
export class InvariantViolationError extends DomainError {
  readonly code = "INVARIANT_VIOLATION";

  constructor(message: string) {
    super(message);
  }
}

export class InvalidCursorError extends DomainError {
  readonly code = "VALIDATION_INVALID_CURSOR";

  constructor(cursor: string) {
    super(`Cursor de paginação inválido: "${cursor}"`);
  }
}
export class DuplicateWalletError extends DomainError {
  readonly code = "WALLET_ALREADY_EXISTS";

  constructor(playerId: string, currency: string) {
    super(`Já existe uma wallet pro player ${playerId} na moeda ${currency}`);
  }
}
export class WalletNotFoundError extends DomainError {
  readonly code = "WALLET_NOT_FOUND";

  constructor(walletId: string) {
    super(`Wallet ${walletId} não encontrada`);
  }
}
