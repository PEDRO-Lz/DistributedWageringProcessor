import type { EntityManager, LockMode } from "@mikro-orm/postgresql";
import type { WalletRepositoryPort } from "../../application/ports/wallet-repository.port";
import type { Wallet } from "../../domain/wallet";
import { WalletEntity } from "./wallet.entity";
import { toWalletDomain, toWalletEntity } from "./wallet.mapper";

// Implementa WalletRepositoryPort com o MikroORM. Ninguém fora daqui importa WalletEntity
export class MikroOrmWalletRepository implements WalletRepositoryPort {
  async findById(
    em: EntityManager,
    id: string,
    lockMode?: LockMode,
  ): Promise<Wallet | null> {
    const row = await em.findOne(
      WalletEntity,
      { id },
      lockMode ? { lockMode } : undefined,
    );
    return row ? toWalletDomain(row) : null;
  }

  async findByPlayerAndCurrency(
    em: EntityManager,
    playerId: string,
    currency: string,
  ): Promise<Wallet | null> {
    const row = await em.findOne(WalletEntity, { playerId, currency });
    return row ? toWalletDomain(row) : null;
  }

  insert(em: EntityManager, wallet: Wallet): void {
    em.create(WalletEntity, toWalletEntity(wallet));
  }

  async save(em: EntityManager, wallet: Wallet): Promise<void> {
    const row = await em.findOneOrFail(WalletEntity, { id: wallet.id });
    em.assign(row, toWalletEntity(wallet));
  }
}
