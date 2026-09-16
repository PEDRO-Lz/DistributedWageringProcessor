import { Money } from "../../shared/kernel/money";
import { LedgerDirection } from "../../shared/kernel/ledger-direction";
import { FailureCode } from "../../shared/kernel/failure-code";
import {
  InvalidTransactionStateError,
  InvariantViolationError,
  MissingReferenceError,
} from "../../shared/kernel/errors";
import { WagerTransactionKind } from "./wager-transaction-kind.enum";
import { WagerTransactionStatus } from "./wager-transaction-status.enum";

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface CreateOpeningWagerTransactionProps {
  id: string;
  walletId: string;
  playerId: string;
  money: Money;
  now: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  processedAt: Date | undefined;
  referenceRetryAttempts: number;
  nextReferenceRetryAt: Date | undefined;
}

function requiresReferenceFor(kind: WagerTransactionKind): boolean {
  return (
    kind === WagerTransactionKind.Refund ||
    kind === WagerTransactionKind.Rollback
  );
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId: string | undefined,
    private _failureCode: FailureCode | undefined,
    private _processedAt: Date | undefined,
    private _referenceRetryAttempts: number,
    private _nextReferenceRetryAt: Date | undefined,
  ) {}

  // Nasce PENDING. Valida a exigência de referência por kind. OPENING não pode entrar por aqui
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvariantViolationError(
        "WagerTransactionKind.OPENING não pode ser submetido externamente, use createOpening()",
      );
    }
    if (
      requiresReferenceFor(props.kind) &&
      !props.referenceExternalTransactionId
    ) {
      throw new MissingReferenceError(props.kind);
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      WagerTransactionStatus.Pending,
      undefined,
      undefined,
      undefined,
      0,
      undefined,
    );
  }

  // Uso interno exclusivo do OpenWalletUseCase. Nasce já PROCESSED, nunca passa por PENDING
  static createOpening(
    props: CreateOpeningWagerTransactionProps,
  ): WagerTransaction {
    return new WagerTransaction(
      props.id,
      "internal",
      props.id,
      `opening:${props.walletId}`,
      "internal",
      props.walletId,
      props.playerId,
      "internal",
      "internal",
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      props.now,
      WagerTransactionStatus.Processed,
      undefined,
      undefined,
      props.now,
      0,
      undefined,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.referenceRetryAttempts,
      state.nextReferenceRetryAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get referenceRetryAttempts(): number {
    return this._referenceRetryAttempts;
  }

  get nextReferenceRetryAt(): Date | undefined {
    return this._nextReferenceRetryAt;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal("markProcessed");
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  // Cada chamada é uma nova tentativa: incrementa o contador e agenda a próxima
  markPendingReference(nextRetryAt: Date): void {
    this.assertNotTerminal("markPendingReference");
    this._status = WagerTransactionStatus.PendingReference;
    this._referenceRetryAttempts += 1;
    this._nextReferenceRetryAt = nextRetryAt;
  }

  reject(code: FailureCode, at: Date): void {
    this.assertNotTerminal("reject");
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = at;
  }

  fail(code: FailureCode, at: Date): void {
    this.assertNotTerminal("fail");
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = at;
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  /** false só para LOSS: registra o resultado sem mover saldo. */
  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  /** true para REFUND e ROLLBACK. */
  requiresReference(): boolean {
    return requiresReferenceFor(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * BET debita, WIN/REFUND/OPENING creditam. ROLLBACK inverte a direção
   * da transação referenciada (reverte um débito com crédito, e vice-versa).
   * LOSS nunca deve chegar aqui, não gera lançamento.
   */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new InvariantViolationError(
            "ROLLBACK precisa da transação referenciada para determinar a direção do ledger",
          );
        }
        const referenceDirection = reference.ledgerDirectionFor();
        return referenceDirection === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      }
      case WagerTransactionKind.Loss:
        throw new InvariantViolationError(
          "LOSS não gera lançamento de ledger, não tem direção",
        );
    }
  }

  private assertNotTerminal(attemptedTransition: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status, attemptedTransition);
    }
  }
}
