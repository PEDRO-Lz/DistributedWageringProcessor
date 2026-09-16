import { Migration } from "@mikro-orm/migrations";

export class Migration20260916160249 extends Migration {
  override name = "Migration20260916160249";

  override async up(): Promise<void> {
    this.addSql(
      `alter table "wager_transactions" add column "reference_retry_attempts" integer not null default 0;`,
    );
    this.addSql(
      `alter table "wager_transactions" add column "next_reference_retry_at" timestamptz null;`,
    );
    this.addSql(`
      create index "wager_transactions_due_pending_reference_idx"
        on "wager_transactions" ("next_reference_retry_at")
        where "status" = 'PENDING_REFERENCE';
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "wager_transactions_due_pending_reference_idx";`);
    this.addSql(
      `alter table "wager_transactions" drop column "next_reference_retry_at";`,
    );
    this.addSql(
      `alter table "wager_transactions" drop column "reference_retry_attempts";`,
    );
  }
}
