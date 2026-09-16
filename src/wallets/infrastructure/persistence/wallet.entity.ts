import { defineEntity, p } from "@mikro-orm/core";

export const WalletEntity = defineEntity({
  name: "WalletEntity",
  tableName: "wallets",
  properties: {
    id: p.uuid().primary(),
    playerId: p.uuid(),
    currency: p.string(),
    balanceAmount: p.bigint(),
    version: p.integer(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});
