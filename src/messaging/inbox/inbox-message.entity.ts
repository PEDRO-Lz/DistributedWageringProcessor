import { defineEntity, p } from "@mikro-orm/core";

export const InboxMessageEntity = defineEntity({
  name: "InboxMessageEntity",
  tableName: "inbox_messages",
  properties: {
    consumerName: p.string().primary(),
    messageId: p.string().primary(),
    payloadHash: p.string(),
    receivedAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
});
