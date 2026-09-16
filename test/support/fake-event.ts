import {
  IntegrationEvent,
  type EventContext,
} from "../../src/shared/kernel/integration-event";

// Evento mínimo só pra exercitar OutboxMessage/publishers em teste, sem
// precisar de nenhum evento de domínio real.
export class FakeEvent extends IntegrationEvent<{ foo: string }> {
  readonly eventType = "FakeEvent";
  readonly version = 1;

  static from(aggregateId: string, ctx: EventContext): FakeEvent {
    return new FakeEvent({
      eventId: crypto.randomUUID(),
      aggregateId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.now,
      data: { foo: "bar" },
    });
  }
}
