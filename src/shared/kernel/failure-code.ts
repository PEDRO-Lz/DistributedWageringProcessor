export enum FailureCode {
  InsufficientBalance = "INSUFFICIENT_BALANCE",
  // Diferente de InsufficientBalance de propósito: uma reversão que deixaria
  // o saldo negativo é diferente de uma aposta sem saldo
  RollbackInsufficientBalance = "ROLLBACK_INSUFFICIENT_BALANCE",
  WalletCurrencyMismatch = "WALLET_CURRENCY_MISMATCH",
  ReferenceMismatch = "REFERENCE_MISMATCH",
  ReferenceInvalidKind = "REFERENCE_INVALID_KIND",
  ReferenceInvalidState = "REFERENCE_INVALID_STATE",
  ReferenceAmountMismatch = "REFERENCE_AMOUNT_MISMATCH",
  ReferenceAlreadyReversed = "REFERENCE_ALREADY_REVERSED",
  PersistenceFailure = "PERSISTENCE_FAILURE",
}
