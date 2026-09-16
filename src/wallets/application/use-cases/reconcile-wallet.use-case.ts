import type { EntityManager } from "@mikro-orm/postgresql";
import { WalletNotFoundError } from "../../../shared/kernel/errors";
import type { Money } from "../../../shared/kernel/money";
import {
  NOOP_METRICS,
  type MetricsPort,
} from "../../../shared/metrics/metrics.port";
import type { WalletRepositoryPort } from "../ports/wallet-repository.port";
import type { WalletLedgerRepositoryPort } from "../ports/wallet-ledger-repository.port";

export interface ReconciliationResult {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

/**
 * Divergência nunca é corrigida silenciosamente: só é reportada (e
 * contabilizada em métrica). Quem decide o que fazer com isso é quem chama.
 */
export class ReconcileWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepository: WalletRepositoryPort,
    private readonly ledgerRepository: WalletLedgerRepositoryPort,
    private readonly metrics: MetricsPort = NOOP_METRICS,
  ) {}

  async execute(walletId: string): Promise<ReconciliationResult> {
    const em = this.em.fork();
    const wallet = await this.walletRepository.findById(em, walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const { balance: calculatedBalance, checkedEntries } =
      await this.ledgerRepository.recalculateBalance(
        em,
        walletId,
        wallet.currency,
      );
    const consistent = wallet.balance.equals(calculatedBalance);
    const difference = wallet.balance.subtract(calculatedBalance);

    if (!consistent) {
      this.metrics.incrementCounter("reconciliation_mismatches_total");
    }

    return {
      walletId,
      storedBalance: wallet.balance,
      calculatedBalance,
      difference,
      consistent,
      checkedEntries,
    };
  }
}
