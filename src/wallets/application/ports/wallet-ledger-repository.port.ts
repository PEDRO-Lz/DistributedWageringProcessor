import type { EntityManager } from "@mikro-orm/postgresql";
import type { Money } from "../../../shared/kernel/money";
import type { WalletLedgerEntry } from "../../domain/wallet-ledger-entry";

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor: string | undefined;
}

export interface WalletLedgerRepositoryPort {
  insert(em: EntityManager, entry: WalletLedgerEntry): void;
  findPage(
    em: EntityManager,
    walletId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<LedgerPage>;
  // Soma todo o extrato da wallet do zero: é a fonte de verdade que a reconciliação compara contra o saldo materializado
  recalculateBalance(
    em: EntityManager,
    walletId: string,
    currency: string,
  ): Promise<Money>;
}

export const WALLET_LEDGER_REPOSITORY = Symbol("WALLET_LEDGER_REPOSITORY");
