import type { InferEntity } from "@mikro-orm/core";
import { Money } from "../../../shared/kernel/money";
import { Wallet } from "../../domain/wallet";
import { WalletEntity } from "./wallet.entity";

type WalletRow = InferEntity<typeof WalletEntity>;

export function toWalletDomain(entity: WalletRow): Wallet {
  return Wallet.rehydrate({
    id: entity.id,
    playerId: entity.playerId,
    currency: entity.currency,
    balance: Money.fromMinorUnits(entity.balanceAmount, entity.currency),
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  });
}

// Serializa o domínio pra um objeto pronto pra `em.create(WalletEntity, ...)`
export function toWalletEntity(wallet: Wallet): WalletRow {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balanceAmount: wallet.balance.toMinorUnits(),
    version: wallet.version,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}
