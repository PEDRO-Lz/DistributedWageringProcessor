import { Migration } from "@mikro-orm/migrations";

export class Migration20260916134249 extends Migration {
  override name = "Migration20260916134249";

  override async up(): Promise<void> {
    this.addSql(`
      create table "inbox_messages" (
        "consumer_name" varchar(128) not null,
        "message_id" varchar(256) not null,
        "payload_hash" char(64) not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey" primary key ("consumer_name", "message_id")
      );
    `);
    this.addSql(`
      create index "inbox_messages_unprocessed_idx" on "inbox_messages" ("received_at")
        where "processed_at" is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
  }
}
