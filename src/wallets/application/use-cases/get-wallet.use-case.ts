import type { EntityManager } from "@mikro-orm/postgresql";
import type { WalletRepositoryPort } from "../ports/wallet-repository.port";
import type { Wallet } from "../../domain/wallet";

export class GetWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepositoryPort,
  ) {}

  async execute(walletId: string): Promise<Wallet | null> {
    return this.walletRepository.findById(this.em.fork(), walletId);
  }
}
