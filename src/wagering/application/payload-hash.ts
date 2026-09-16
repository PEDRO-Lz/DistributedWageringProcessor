import { createHash } from "node:crypto";
import type { MoneyProps } from "../../shared/kernel/money";
import { canonicalJson } from "./canonical-json";

export interface PayloadHashInput {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export function computePayloadHash(input: PayloadHashInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
