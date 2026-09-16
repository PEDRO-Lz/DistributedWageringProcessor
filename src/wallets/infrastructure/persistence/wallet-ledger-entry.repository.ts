import type { EntityManager } from "@mikro-orm/postgresql";
import { Money } from "../../../shared/kernel/money";
import { decodeCursor, encodeCursor } from "../../../shared/pagination/cursor";
import type {
  LedgerPage,
  RecalculatedBalance,
  WalletLedgerRepositoryPort,
} from "../../application/ports/wallet-ledger-repository.port";
import type { WalletLedgerEntry } from "../../domain/wallet-ledger-entry";
import { WalletLedgerEntryEntity } from "./wallet-ledger-entry.entity";
import {
  toWalletLedgerEntryDomain,
  toWalletLedgerEntryEntity,
} from "./wallet-ledger-entry.mapper";

interface LedgerSumRow {
  direction: string;
  money_amount: string;
}

export class MikroOrmWalletLedgerRepository implements WalletLedgerRepositoryPort {
  insert(em: EntityManager, entry: WalletLedgerEntry): void {
    em.create(WalletLedgerEntryEntity, toWalletLedgerEntryEntity(entry));
  }

  async findPage(
    em: EntityManager,
    walletId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<LedgerPage> {
    const qb = em
      .createQueryBuilder(WalletLedgerEntryEntity, "e")
      .where({ walletId })
      .orderBy({ createdAt: "asc", id: "asc" })
      .limit(limit);

    if (cursor) {
      const decoded = decodeCursor(cursor);
      qb.andWhere("(e.created_at, e.id) > (?, ?)", [
        decoded.createdAt,
        decoded.id,
      ]);
    }

    const rows = await qb.getResultList();
    const entries = rows.map(toWalletLedgerEntryDomain);
    const last = rows.at(-1);
    const nextCursor =
      rows.length === limit && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : undefined;

    return { entries, nextCursor };
  }

  // Soma o extrato inteiro do zero (DEBIT subtrai, CREDIT soma). É a fonte de verdade que a reconciliação compara contra o saldo materializado
  async recalculateBalance(
    em: EntityManager,
    walletId: string,
    currency: string,
  ): Promise<RecalculatedBalance> {
    const rows: LedgerSumRow[] = await em
      .getConnection()
      .execute(
        "select direction, money_amount from wallet_ledger_entries where wallet_id = ?",
        [walletId],
      );

    let total = 0n;
    for (const row of rows) {
      const amount = BigInt(row.money_amount);
      total += row.direction === "DEBIT" ? -amount : amount;
    }

    return { balance: Money.fromMinorUnits(total, currency), checkedEntries: rows.length };
  }
}
