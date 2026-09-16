import { Money } from "../../shared/kernel/money";
import { WagerTransactionKind } from "../domain/wager-transaction-kind.enum";
import type { SubmitWagerTransactionCommand } from "./use-cases/submit-wager-transaction.use-case";

// Erro de shape de mensagem
export class InvalidWagerTransactionMessageError extends Error {
  constructor(reason: string) {
    super(`Mensagem de wager transaction inválida: ${reason}`);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidWagerTransactionMessageError(
      `campo "${field}" ausente ou não é string`,
    );
  }
  return value;
}

const VALID_KINDS = new Set<string>(Object.values(WagerTransactionKind));

export function parseWagerTransactionMessage(
  body: string,
): SubmitWagerTransactionCommand {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InvalidWagerTransactionMessageError("body não é JSON válido");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new InvalidWagerTransactionMessageError("body não é um objeto");
  }
  const raw = parsed as Record<string, unknown>;

  const kind = requireString(raw.kind, "kind");
  if (!VALID_KINDS.has(kind)) {
    throw new InvalidWagerTransactionMessageError(`kind "${kind}" inválido`);
  }

  const money = raw.money;
  if (typeof money !== "object" || money === null) {
    throw new InvalidWagerTransactionMessageError('campo "money" ausente');
  }
  const moneyRaw = money as Record<string, unknown>;

  const referenceExternalTransactionId =
    raw.referenceExternalTransactionId === undefined
      ? undefined
      : requireString(
          raw.referenceExternalTransactionId,
          "referenceExternalTransactionId",
        );

  return {
    providerId: requireString(raw.providerId, "providerId"),
    externalTransactionId: requireString(
      raw.externalTransactionId,
      "externalTransactionId",
    ),
    idempotencyKey: requireString(raw.idempotencyKey, "idempotencyKey"),
    playerId: requireString(raw.playerId, "playerId"),
    walletId: requireString(raw.walletId, "walletId"),
    roundId: requireString(raw.roundId, "roundId"),
    gameId: requireString(raw.gameId, "gameId"),
    kind: kind as WagerTransactionKind,
    money: Money.from({
      amount: requireString(moneyRaw.amount, "money.amount"),
      currency: requireString(moneyRaw.currency, "money.currency"),
    }),
    referenceExternalTransactionId,
  };
}
