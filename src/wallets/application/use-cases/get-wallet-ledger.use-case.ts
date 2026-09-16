import type { EntityManager } from "@mikro-orm/postgresql";
import type {
  LedgerPage,
  WalletLedgerRepositoryPort,
} from "../ports/wallet-ledger-repository.port";

export interface GetWalletLedgerQuery {
  walletId: string;
  cursor?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export class GetWalletLedgerUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly ledgerRepository: WalletLedgerRepositoryPort,
  ) {}

  async execute(query: GetWalletLedgerQuery): Promise<LedgerPage> {
    return this.ledgerRepository.findPage(
      this.em.fork(),
      query.walletId,
      query.cursor,
      query.limit ?? DEFAULT_LIMIT,
    );
  }
}
