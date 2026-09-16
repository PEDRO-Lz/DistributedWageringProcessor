import { Migration } from "@mikro-orm/migrations";

export class Migration20260916134109 extends Migration {
  override name = "Migration20260916134109";

  override async up(): Promise<void> {
    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar(8) not null,
        "money_amount" bigint not null,
        "money_currency" char(3) not null,
        "balance_before_amount" bigint not null,
        "balance_before_currency" char(3) not null,
        "balance_after_amount" bigint not null,
        "balance_after_currency" char(3) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entries_pkey" primary key ("id"),
        constraint "wallet_ledger_entries_transaction_unique" unique ("transaction_id"),
        constraint "wallet_ledger_entries_wallet_fk" foreign key ("wallet_id") references "wallets" ("id"),
        constraint "wallet_ledger_entries_transaction_fk" foreign key ("transaction_id") references "wager_transactions" ("id"),
        constraint "wallet_ledger_entries_direction_check" check ("direction" in ('DEBIT', 'CREDIT')),
        constraint "wallet_ledger_entries_money_positive" check ("money_amount" > 0),
        constraint "wallet_ledger_entries_balance_non_negative" check ("balance_before_amount" >= 0 and "balance_after_amount" >= 0)
      );
    `);
    this.addSql(
      `create index "wallet_ledger_entries_wallet_id_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`,
    );

    // Imutabilidade estrutural: nenhum UPDATE ou DELETE é permitido
    this.addSql(`
      create or replace function "reject_ledger_mutation"() returns trigger as $$
      begin
        raise exception 'wallet_ledger_entries rows are immutable: % is not allowed on id=%', TG_OP, old.id;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger "wallet_ledger_entries_no_update"
      before update on "wallet_ledger_entries"
      for each row execute function "reject_ledger_mutation"();
    `);
    this.addSql(`
      create trigger "wallet_ledger_entries_no_delete"
      before delete on "wallet_ledger_entries"
      for each row execute function "reject_ledger_mutation"();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop trigger if exists "wallet_ledger_entries_no_delete" on "wallet_ledger_entries";`,
    );
    this.addSql(
      `drop trigger if exists "wallet_ledger_entries_no_update" on "wallet_ledger_entries";`,
    );
    this.addSql(`drop function if exists "reject_ledger_mutation"();`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
  }
}
