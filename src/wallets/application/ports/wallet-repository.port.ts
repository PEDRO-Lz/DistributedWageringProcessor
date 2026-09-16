import type { EntityManager, LockMode } from "@mikro-orm/postgresql";
import type { Wallet } from "../../domain/wallet";

export interface WalletRepositoryPort {
  findById(
    em: EntityManager,
    id: string,
    lockMode?: LockMode,
  ): Promise<Wallet | null>;
  findByPlayerAndCurrency(
    em: EntityManager,
    playerId: string,
    currency: string,
  ): Promise<Wallet | null>;
  // Enfileira o INSERT no unit of work, não bate no banco ainda, só no próximo flush
  insert(em: EntityManager, wallet: Wallet): void;
  // Busca a entidade já rastreada e aplica o novo estado, bate no banco no flush
  save(em: EntityManager, wallet: Wallet): Promise<void>;
}

export const WALLET_REPOSITORY = Symbol("WALLET_REPOSITORY");
