import { InvalidCursorError } from "../kernel/errors";

// Paginação por keyset
export interface LedgerCursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: LedgerCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string): LedgerCursor {
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as LedgerCursor).createdAt !== "string" ||
      typeof (parsed as LedgerCursor).id !== "string"
    ) {
      throw new Error("shape inválido");
    }
    return parsed as LedgerCursor;
  } catch {
    throw new InvalidCursorError(value);
  }
}
