import { InvariantViolationError } from "../../shared/kernel/errors";
import type { IntegrationEvent } from "../../shared/kernel/integration-event";

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | undefined;
  publishedAt: Date | undefined;
}

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

// Backoff exponencial, dobra a cada tentativa, limitado a MAX_BACKOFF_MS
function computeBackoffMs(attempts: number): number {
  const exponential = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  return Math.min(exponential, MAX_BACKOFF_MS);
}

// Linha da tabela de outbox: um evento de integração esperando ser publicado
export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt: Date | undefined,
    private _publishedAt: Date | undefined,
  ) {}

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      event.toJSON() as unknown as Readonly<Record<string, unknown>>,
      event.occurredAt,
      0,
      undefined,
      undefined,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  // MikroORM reidrata uma coluna vazia como `null`, não `undefined`,
  // mesmo a interface declarando `Date | undefined`
  // `!= null` cobre os dois de uma vez
  isPending(): boolean {
    return this._publishedAt == null;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) {
      return false;
    }
    return this._nextAttemptAt == null || this._nextAttemptAt <= now;
  }

  markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new InvariantViolationError(
        "OutboxMessage já foi publicada, não pode publicar de novo",
      );
    }
    this._publishedAt = at;
  }

  // Incrementa attempts e agenda a próxima tentativa com backoff exponencial
  scheduleRetry(now: Date): void {
    if (!this.isPending()) {
      throw new InvariantViolationError(
        "OutboxMessage já foi publicada, não precisa de retry",
      );
    }
    this._attempts += 1;
    this._nextAttemptAt = new Date(
      now.getTime() + computeBackoffMs(this._attempts),
    );
  }
}
