import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../../mikro-orm.config";
import { InboxMessage } from "../../src/messaging/inbox/inbox-message";
import { MikroOrmInboxRepository } from "../../src/messaging/inbox/inbox-message.repository";

describe("MikroOrmInboxRepository (integração, Postgres real)", () => {
  let orm: MikroORM;
  const repository = new MikroOrmInboxRepository();

  beforeEach(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    await orm.em.getConnection().execute("truncate inbox_messages cascade");
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("uma mensagem recém reidratada do banco, nunca processada, ainda reporta isProcessed() === false", async () => {
    const message = InboxMessage.receive({
      consumerName: "consumer-1",
      messageId: "msg-1",
      payloadHash: "hash-1",
      receivedAt: new Date(),
    });
    await orm.em.transactional(async (em) => repository.claim(em, message));

    const reloaded = await repository.findByConsumerAndMessageId(
      orm.em.fork(),
      "consumer-1",
      "msg-1",
    );
    expect(reloaded!.isProcessed()).toBe(false);
  });

  it("markProcessed() funciona numa mensagem nunca processada antes", async () => {
    const message = InboxMessage.receive({
      consumerName: "consumer-1",
      messageId: "msg-2",
      payloadHash: "hash-1",
      receivedAt: new Date(),
    });
    await orm.em.transactional(async (em) => repository.claim(em, message));

    const now = new Date();
    await orm.em.transactional(async (em) =>
      repository.markProcessed(em, "consumer-1", "msg-2", now),
    );

    const reloaded = await repository.findByConsumerAndMessageId(
      orm.em.fork(),
      "consumer-1",
      "msg-2",
    );
    expect(reloaded!.isProcessed()).toBe(true);
  });
});
