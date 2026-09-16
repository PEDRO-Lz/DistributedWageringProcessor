import { describe, expect, it } from "bun:test";
import { OutboxMessage } from "../../src/messaging/outbox/outbox-message";
import {
  IntegrationEvent,
  type EventContext,
} from "../../src/shared/kernel/integration-event";
import { InvariantViolationError } from "../../src/shared/kernel/errors";

const now = new Date("2026-01-01T00:00:00.000Z");

class FakeEvent extends IntegrationEvent<{ foo: string }> {
  readonly eventType = "FakeEvent";
  readonly version = 1;

  static from(ctx: EventContext): FakeEvent {
    return new FakeEvent({
      eventId: "event-1",
      aggregateId: "aggregate-1",
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.now,
      data: { foo: "bar" },
    });
  }
}

function fakeEvent() {
  return FakeEvent.from({ correlationId: "corr-1", now });
}

describe("OutboxMessage", () => {
  describe("enqueue()", () => {
    it("nasce pendente, sem tentativas, imediatamente devida", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());
      expect(msg.isPending()).toBe(true);
      expect(msg.attempts).toBe(0);
      expect(msg.nextAttemptAt).toBeUndefined();
      expect(msg.isDue(now)).toBe(true);
    });

    it("guarda o envelope serializado do evento como payload", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());
      expect(msg.payload).toMatchObject({
        eventType: "FakeEvent",
        data: { foo: "bar" },
      });
    });
  });

  describe("markPublished()", () => {
    it("marca como publicada, deixa de estar pendente", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());
      const later = new Date("2026-01-01T00:00:05.000Z");
      msg.markPublished(later);
      expect(msg.isPending()).toBe(false);
      expect(msg.publishedAt).toEqual(later);
    });

    it("chamado duas vezes lança InvariantViolationError, nunca marca publicado duas vezes", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());
      msg.markPublished(now);
      expect(() => msg.markPublished(now)).toThrow(InvariantViolationError);
    });
  });

  describe("scheduleRetry()", () => {
    it("incrementa attempts a cada chamada", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());
      msg.scheduleRetry(now);
      expect(msg.attempts).toBe(1);
      msg.scheduleRetry(now);
      expect(msg.attempts).toBe(2);
    });

    it("backoff dobra a cada tentativa: 1s, depois 2s, depois 4s", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());

      msg.scheduleRetry(now);
      expect(msg.nextAttemptAt).toEqual(new Date(now.getTime() + 1_000));

      msg.scheduleRetry(now);
      expect(msg.nextAttemptAt).toEqual(new Date(now.getTime() + 2_000));

      msg.scheduleRetry(now);
      expect(msg.nextAttemptAt).toEqual(new Date(now.getTime() + 4_000));
    });

    it("backoff é limitado, não cresce pra sempre", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());
      for (let i = 0; i < 20; i++) {
        msg.scheduleRetry(now);
      }
      expect(msg.nextAttemptAt).toEqual(new Date(now.getTime() + 60_000));
    });

    it("depois de publicada, não agenda mais retry", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());
      msg.markPublished(now);
      expect(() => msg.scheduleRetry(now)).toThrow(InvariantViolationError);
    });
  });

  describe("isDue()", () => {
    it("false antes de nextAttemptAt, true a partir dele", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());
      msg.scheduleRetry(now);

      const beforeRetry = new Date(now.getTime() + 500);
      const atRetry = new Date(now.getTime() + 1_000);

      expect(msg.isDue(beforeRetry)).toBe(false);
      expect(msg.isDue(atRetry)).toBe(true);
    });

    it("false depois de publicada, mesmo se nextAttemptAt já passou", () => {
      const msg = OutboxMessage.enqueue(fakeEvent());
      msg.markPublished(now);
      expect(msg.isDue(new Date(now.getTime() + 999_999))).toBe(false);
    });
  });

  describe("rehydrate()", () => {
    it("reconstrói o estado exatamente como veio, sem recalcular nada", () => {
      const msg = OutboxMessage.rehydrate({
        id: "msg-1",
        aggregateId: "aggregate-1",
        eventType: "FakeEvent",
        payload: { foo: "bar" },
        occurredAt: now,
        attempts: 3,
        nextAttemptAt: undefined,
        publishedAt: now,
      });
      expect(msg.attempts).toBe(3);
      expect(msg.isPending()).toBe(false);
    });
  });
});
