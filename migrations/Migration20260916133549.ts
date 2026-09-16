import { Migration } from "@mikro-orm/migrations";

export class Migration20260916133549 extends Migration {
  override name = "Migration20260916133549";

  override async up(): Promise<void> {
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" uuid not null,
        "currency" char(3) not null,
        "balance_amount" bigint not null,
        "version" integer not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallets_pkey" primary key ("id"),
        constraint "wallets_player_currency_unique" unique ("player_id", "currency"),
        constraint "wallets_balance_non_negative" check ("balance_amount" >= 0)
      );
    `);
    this.addSql(
      `create index "wallets_player_id_idx" on "wallets" ("player_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "wallets" cascade;`);
  }
}
