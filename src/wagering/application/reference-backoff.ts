// Depois de esgotar as tentativas, a transação é rejeitada com REFERENCE_RESOLUTION_TIMEOUT
export const MAX_REFERENCE_RETRY_ATTEMPTS = 10;

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 300_000; // 5 minutos

export function computeReferenceBackoffMs(attempts: number): number {
  const exponential = BASE_BACKOFF_MS * 2 ** attempts;
  return Math.min(exponential, MAX_BACKOFF_MS);
}
