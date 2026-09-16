import { Migration } from "@mikro-orm/migrations";

export class Migration20260916134604 extends Migration {
  override name = "Migration20260916134604";

  override async up(): Promise<void> {
    this.addSql(`
      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" varchar(256) not null,
        "event_type" varchar(128) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_messages_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index "outbox_messages_pending_idx" on "outbox_messages" ("occurred_at")
        where "published_at" is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
  }
}
