import { Migration } from "@mikro-orm/migrations";

export class Migration20260916133834 extends Migration {
  override name = "Migration20260916133834";

  override async up(): Promise<void> {
    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "provider_id" varchar(128) not null,
        "external_transaction_id" varchar(256) not null,
        "idempotency_key" varchar(512) not null,
        "payload_hash" char(64) not null,
        "wallet_id" uuid not null,
        "player_id" uuid not null,
        "round_id" varchar(256) not null,
        "game_id" varchar(256) not null,
        "kind" varchar(16) not null,
        "money_amount" bigint not null,
        "money_currency" char(3) not null,
        "reference_external_transaction_id" varchar(256) null,
        "reference_transaction_id" uuid null,
        "status" varchar(24) not null,
        "failure_code" varchar(64) null,
        "created_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "wager_transactions_pkey" primary key ("id"),
        constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key"),
        constraint "wager_transactions_provider_external_unique" unique ("provider_id", "external_transaction_id"),
        constraint "wager_transactions_wallet_fk" foreign key ("wallet_id") references "wallets" ("id"),
        constraint "wager_transactions_reference_fk" foreign key ("reference_transaction_id") references "wager_transactions" ("id"),
        constraint "wager_transactions_kind_check" check ("kind" in ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        constraint "wager_transactions_status_check" check ("status" in ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        constraint "wager_transactions_money_positive" check ("money_amount" >= 0)
      );
    `);
    this.addSql(
      `create index "wager_transactions_wallet_id_idx" on "wager_transactions" ("wallet_id");`,
    );
    this.addSql(
      `create index "wager_transactions_provider_id_idx" on "wager_transactions" ("provider_id");`,
    );
    // Referência não pode ser revertida duas vezes pelo mesmo tipo de reversão (REFUND ou ROLLBACK).
    this.addSql(`
      create unique index "wager_transactions_reference_once_idx"
        on "wager_transactions" ("reference_transaction_id", "kind")
        where "status" = 'PROCESSED' and "kind" in ('REFUND', 'ROLLBACK');
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
  }
}
