import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../../mikro-orm.config";
import {
  IntegrationEvent,
  type EventContext,
} from "../../src/shared/kernel/integration-event";
import { OutboxMessage } from "../../src/messaging/outbox/outbox-message";
import { MikroOrmOutboxRepository } from "../../src/messaging/outbox/outbox-message.repository";

class FakeEvent extends IntegrationEvent<{ foo: string }> {
  readonly eventType = "FakeEvent";
  readonly version = 1;

  static from(ctx: EventContext): FakeEvent {
    return new FakeEvent({
      eventId: crypto.randomUUID(),
      aggregateId: "aggregate-1",
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.now,
      data: { foo: "bar" },
    });
  }
}

describe("MikroOrmOutboxRepository (integração, Postgres real)", () => {
  let orm: MikroORM;
  const repository = new MikroOrmOutboxRepository();

  beforeEach(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.em.getConnection().execute("truncate outbox_messages cascade");
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("uma mensagem recém reidratada do banco, nunca publicada, ainda reporta isPending() === true", async () => {
    const now = new Date();
    const message = OutboxMessage.enqueue(
      FakeEvent.from({ correlationId: "corr-1", now }),
    );
    await orm.em.transactional(async (em) => repository.insert(em, message));

    const reloaded = await orm.em.transactional(async (em) => {
      const [row] = await repository.findDueBatch(em, now, 10);
      return row;
    });
    expect(reloaded!.isPending()).toBe(true);
  });

  it("findDueBatch() encontra e markPublished() funciona numa mensagem nunca publicada antes", async () => {
    const now = new Date();
    const message = OutboxMessage.enqueue(
      FakeEvent.from({ correlationId: "corr-1", now }),
    );
    await orm.em.transactional(async (em) => repository.insert(em, message));

    await orm.em.transactional(async (em) => {
      const [due] = await repository.findDueBatch(em, now, 10);
      due!.markPublished(now);
      await repository.save(em, due!);
    });

    const afterPublish = await orm.em.transactional(async (em) => {
      const [row] = await repository.findDueBatch(em, now, 10);
      return row;
    });
    expect(afterPublish).toBeUndefined();
  });
});
