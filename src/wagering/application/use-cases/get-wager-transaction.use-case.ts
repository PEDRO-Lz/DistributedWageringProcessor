import type { EntityManager } from "@mikro-orm/postgresql";
import type { WagerTransactionRepositoryPort } from "../ports/wager-transaction-repository.port";
import type { WagerTransaction } from "../../domain/wager-transaction";

export class GetWagerTransactionUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly wagerTransactionRepository: WagerTransactionRepositoryPort,
  ) {}

  async byId(transactionId: string): Promise<WagerTransaction | null> {
    return this.wagerTransactionRepository.findById(
      this.em.fork(),
      transactionId,
    );
  }

  async byProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    return this.wagerTransactionRepository.findByProviderAndExternalId(
      this.em.fork(),
      providerId,
      externalTransactionId,
    );
  }
}
