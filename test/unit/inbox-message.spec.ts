import { describe, expect, it } from "bun:test";
import { InboxMessage } from "../../src/messaging/inbox/inbox-message";
import { InvariantViolationError } from "../../src/shared/kernel/errors";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("InboxMessage", () => {
  it("receive() nasce não processada", () => {
    const msg = InboxMessage.receive({
      consumerName: "c1",
      messageId: "m1",
      payloadHash: "hash1",
      receivedAt: now,
    });
    expect(msg.isProcessed()).toBe(false);
    expect(msg.processedAt).toBeUndefined();
  });

  it("markProcessed() marca como processada", () => {
    const msg = InboxMessage.receive({
      consumerName: "c1",
      messageId: "m1",
      payloadHash: "hash1",
      receivedAt: now,
    });
    const later = new Date("2026-01-01T00:00:05.000Z");
    msg.markProcessed(later);
    expect(msg.isProcessed()).toBe(true);
    expect(msg.processedAt).toEqual(later);
  });

  it("markProcessed() chamado duas vezes lança InvariantViolationError, nunca marca duas vezes", () => {
    const msg = InboxMessage.receive({
      consumerName: "c1",
      messageId: "m1",
      payloadHash: "hash1",
      receivedAt: now,
    });
    msg.markProcessed(now);
    expect(() => msg.markProcessed(now)).toThrow(InvariantViolationError);
  });

  describe("rehydrate()", () => {
    it("reconstrói uma mensagem ainda não processada", () => {
      const msg = InboxMessage.rehydrate({
        consumerName: "c1",
        messageId: "m1",
        payloadHash: "hash1",
        receivedAt: now,
        processedAt: undefined,
      });
      expect(msg.isProcessed()).toBe(false);
    });

    it("reconstrói uma mensagem já processada, e a garantia de não marcar duas vezes continua valendo", () => {
      const msg = InboxMessage.rehydrate({
        consumerName: "c1",
        messageId: "m1",
        payloadHash: "hash1",
        receivedAt: now,
        processedAt: now,
      });
      expect(msg.isProcessed()).toBe(true);
      expect(() => msg.markProcessed(now)).toThrow(InvariantViolationError);
    });
  });
});
