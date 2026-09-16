import { describe, expect, it } from "bun:test";
import { Money } from "../../src/shared/kernel/money";
import { LedgerDirection } from "../../src/shared/kernel/ledger-direction";
import { FailureCode } from "../../src/shared/kernel/failure-code";
import {
  InvalidTransactionStateError,
  InvariantViolationError,
  MissingReferenceError,
} from "../../src/shared/kernel/errors";
import { WagerTransaction } from "../../src/wagering/domain/wager-transaction";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "../../src/wagering/domain/wager-transaction-status.enum";

const BRL = (amount: string) => Money.from({ amount, currency: "BRL" });
const now = new Date("2026-01-01T00:00:00.000Z");

function baseProps(
  overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {},
) {
  return {
    id: "tx-1",
    providerId: "provider-a",
    externalTransactionId: "ext-1",
    idempotencyKey: "provider-a:ext-1",
    payloadHash: "hash-1",
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerTransactionKind.Bet,
    money: BRL("25.00"),
    createdAt: now,
    ...overrides,
  };
}

describe("WagerTransaction", () => {
  describe("create()", () => {
    it("nasce PENDING", () => {
      const tx = WagerTransaction.create(baseProps());
      expect(tx.status).toBe(WagerTransactionStatus.Pending);
    });

    it("rejeita OPENING, que só nasce via createOpening()", () => {
      expect(() =>
        WagerTransaction.create(
          baseProps({ kind: WagerTransactionKind.Opening }),
        ),
      ).toThrow(InvariantViolationError);
    });

    it("REFUND sem referenceExternalTransactionId lança MissingReferenceError", () => {
      expect(() =>
        WagerTransaction.create(
          baseProps({ kind: WagerTransactionKind.Refund }),
        ),
      ).toThrow(MissingReferenceError);
    });

    it("ROLLBACK sem referenceExternalTransactionId lança MissingReferenceError", () => {
      expect(() =>
        WagerTransaction.create(
          baseProps({ kind: WagerTransactionKind.Rollback }),
        ),
      ).toThrow(MissingReferenceError);
    });

    it("REFUND com referenceExternalTransactionId é aceito", () => {
      const tx = WagerTransaction.create(
        baseProps({
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: "bet-1",
        }),
      );
      expect(tx.status).toBe(WagerTransactionStatus.Pending);
    });

    it("BET/WIN/LOSS não exigem referência", () => {
      expect(() =>
        WagerTransaction.create(baseProps({ kind: WagerTransactionKind.Bet })),
      ).not.toThrow();
      expect(() =>
        WagerTransaction.create(baseProps({ kind: WagerTransactionKind.Win })),
      ).not.toThrow();
      expect(() =>
        WagerTransaction.create(baseProps({ kind: WagerTransactionKind.Loss })),
      ).not.toThrow();
    });
  });

  describe("createOpening()", () => {
    it("nasce já PROCESSED, nunca passa por PENDING", () => {
      const tx = WagerTransaction.createOpening({
        id: "tx-open",
        walletId: "wallet-1",
        playerId: "player-1",
        money: BRL("100.00"),
        now,
      });
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.kind).toBe(WagerTransactionKind.Opening);
      expect(tx.processedAt).toEqual(now);
    });
  });

  describe("transições", () => {
    it("markProcessed() move PENDING -> PROCESSED e grava processedAt", () => {
      const tx = WagerTransaction.create(baseProps());
      tx.markProcessed(undefined, now);
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.processedAt).toEqual(now);
    });

    it("markProcessed() grava a referência resolvida quando houver", () => {
      const tx = WagerTransaction.create(
        baseProps({
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: "bet-1",
        }),
      );
      tx.markProcessed("tx-bet-1", now);
      expect(tx.referenceTransactionId).toBe("tx-bet-1");
    });

    it("markPendingReference() move PENDING -> PENDING_REFERENCE", () => {
      const tx = WagerTransaction.create(
        baseProps({
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: "bet-1",
        }),
      );
      tx.markPendingReference();
      expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
    });

    it("reject() move para REJECTED com failureCode e processedAt", () => {
      const tx = WagerTransaction.create(baseProps());
      tx.reject(FailureCode.InsufficientBalance, now);
      expect(tx.status).toBe(WagerTransactionStatus.Rejected);
      expect(tx.failureCode).toBe(FailureCode.InsufficientBalance);
      expect(tx.processedAt).toEqual(now);
    });

    it("fail() move para FAILED com failureCode e processedAt", () => {
      const tx = WagerTransaction.create(baseProps());
      tx.fail(FailureCode.PersistenceFailure, now);
      expect(tx.status).toBe(WagerTransactionStatus.Failed);
      expect(tx.failureCode).toBe(FailureCode.PersistenceFailure);
    });
  });

  describe("estados terminais são realmente terminais", () => {
    it("PROCESSED rejeita qualquer nova transição", () => {
      const tx = WagerTransaction.create(baseProps());
      tx.markProcessed(undefined, now);

      expect(() => tx.markProcessed(undefined, now)).toThrow(
        InvalidTransactionStateError,
      );
      expect(() => tx.reject(FailureCode.InsufficientBalance, now)).toThrow(
        InvalidTransactionStateError,
      );
      expect(() => tx.fail(FailureCode.PersistenceFailure, now)).toThrow(
        InvalidTransactionStateError,
      );
      expect(() => tx.markPendingReference()).toThrow(
        InvalidTransactionStateError,
      );
    });

    it("REJECTED e FAILED também são terminais", () => {
      const rejected = WagerTransaction.create(baseProps());
      rejected.reject(FailureCode.InsufficientBalance, now);
      expect(() => rejected.markProcessed(undefined, now)).toThrow(
        InvalidTransactionStateError,
      );

      const failed = WagerTransaction.create(
        baseProps({
          id: "tx-2",
          externalTransactionId: "ext-2",
          idempotencyKey: "provider-a:ext-2",
        }),
      );
      failed.fail(FailureCode.PersistenceFailure, now);
      expect(() => failed.markProcessed(undefined, now)).toThrow(
        InvalidTransactionStateError,
      );
    });

    it("PENDING_REFERENCE não é terminal, aceita novas transições", () => {
      const tx = WagerTransaction.create(
        baseProps({
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: "bet-1",
        }),
      );
      tx.markPendingReference();
      expect(tx.isTerminal()).toBe(false);
      expect(() => tx.markProcessed("tx-bet-1", now)).not.toThrow();
    });
  });

  describe("affectsBalance()", () => {
    it("false apenas para LOSS", () => {
      expect(
        WagerTransaction.create(
          baseProps({ kind: WagerTransactionKind.Loss }),
        ).affectsBalance(),
      ).toBe(false);
      expect(
        WagerTransaction.create(
          baseProps({ kind: WagerTransactionKind.Bet }),
        ).affectsBalance(),
      ).toBe(true);
      expect(
        WagerTransaction.create(
          baseProps({ kind: WagerTransactionKind.Win }),
        ).affectsBalance(),
      ).toBe(true);
    });
  });

  describe("ledgerDirectionFor()", () => {
    it("BET debita", () => {
      const tx = WagerTransaction.create(
        baseProps({ kind: WagerTransactionKind.Bet }),
      );
      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    });

    it("WIN credita", () => {
      const tx = WagerTransaction.create(
        baseProps({ kind: WagerTransactionKind.Win }),
      );
      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it("REFUND credita", () => {
      const tx = WagerTransaction.create(
        baseProps({
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: "bet-1",
        }),
      );
      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it("ROLLBACK inverte a direção da referência: reverte um BET (débito) com crédito", () => {
      const bet = WagerTransaction.create(
        baseProps({ kind: WagerTransactionKind.Bet }),
      );
      const rollback = WagerTransaction.create(
        baseProps({
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: "bet-1",
          id: "tx-2",
        }),
      );
      expect(rollback.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
    });

    it("ROLLBACK inverte a direção da referência: reverte um WIN (crédito) com débito", () => {
      const win = WagerTransaction.create(
        baseProps({ kind: WagerTransactionKind.Win }),
      );
      const rollback = WagerTransaction.create(
        baseProps({
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: "win-1",
          id: "tx-2",
        }),
      );
      expect(rollback.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
    });

    it("ROLLBACK sem a referência informada lança InvariantViolationError", () => {
      const rollback = WagerTransaction.create(
        baseProps({
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: "bet-1",
        }),
      );
      expect(() => rollback.ledgerDirectionFor()).toThrow(
        InvariantViolationError,
      );
    });

    it("LOSS não tem direção, é erro de programação perguntar", () => {
      const tx = WagerTransaction.create(
        baseProps({ kind: WagerTransactionKind.Loss }),
      );
      expect(() => tx.ledgerDirectionFor()).toThrow(InvariantViolationError);
    });
  });

  describe("matchesPayload()", () => {
    it("compara o payloadHash armazenado", () => {
      const tx = WagerTransaction.create(baseProps({ payloadHash: "abc123" }));
      expect(tx.matchesPayload("abc123")).toBe(true);
      expect(tx.matchesPayload("outro")).toBe(false);
    });
  });

  describe("rehydrate()", () => {
    it("reconstrói o estado exatamente como veio, sem revalidar", () => {
      const tx = WagerTransaction.rehydrate({
        ...baseProps(),
        referenceExternalTransactionId: undefined,
        status: WagerTransactionStatus.Processed,
        referenceTransactionId: undefined,
        failureCode: undefined,
        processedAt: now,
      });
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
    });
  });
});
