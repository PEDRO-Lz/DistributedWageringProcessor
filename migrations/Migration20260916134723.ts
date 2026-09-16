import { Migration } from "@mikro-orm/migrations";

/**
 * wager_transactions: UPDATE é permitido enquanto status não é terminal
 * (PENDING/PENDING_REFERENCE mudam de estado o tempo todo). Uma vez
 * PROCESSED/REJECTED/FAILED, qualquer UPDATE que mude alguma coluna é
 * rejeitado. DELETE nunca é permitido, em nenhum status.
 *  outbox_messages: o envelope do evento (id, aggregate_id, event_type,
 * payload, occurred_at) nunca pode mudar, publicado ou não. As colunas
 * de bookkeeping (attempts, next_attempt_at, published_at) podem mudar
 * normalmente até a linha ser publicada, depois disso a linha inteira
 * fica congelada. DELETE nunca é permitido.
 */
export class Migration20260916134723 extends Migration {
  override name = "Migration20260916134723";

  override async up(): Promise<void> {
    this.addSql(`
      create or replace function "reject_terminal_wager_transaction_mutation"() returns trigger as $$
      begin
        if old.status in ('PROCESSED', 'REJECTED', 'FAILED')
           and row(new.*) is distinct from row(old.*) then
          raise exception 'wager_transactions row id=% is terminal (status=%) and immutable', old.id, old.status;
        end if;
        return new;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger "wager_transactions_terminal_immutable"
      before update on "wager_transactions"
      for each row execute function "reject_terminal_wager_transaction_mutation"();
    `);
    this.addSql(`
      create or replace function "reject_wager_transaction_delete"() returns trigger as $$
      begin
        raise exception 'wager_transactions rows are never deleted, id=%', old.id;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger "wager_transactions_no_delete"
      before delete on "wager_transactions"
      for each row execute function "reject_wager_transaction_delete"();
    `);

    this.addSql(`
      create or replace function "reject_outbox_message_mutation"() returns trigger as $$
      begin
        if old.published_at is not null then
          raise exception 'outbox_messages row id=% is published and terminal, immutable', old.id;
        end if;
        if new.id is distinct from old.id
           or new.aggregate_id is distinct from old.aggregate_id
           or new.event_type is distinct from old.event_type
           or new.payload is distinct from old.payload
           or new.occurred_at is distinct from old.occurred_at then
          raise exception 'outbox_messages envelope is immutable, id=%', old.id;
        end if;
        return new;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger "outbox_messages_envelope_immutable"
      before update on "outbox_messages"
      for each row execute function "reject_outbox_message_mutation"();
    `);
    this.addSql(`
      create or replace function "reject_outbox_message_delete"() returns trigger as $$
      begin
        raise exception 'outbox_messages rows are never deleted, id=%', old.id;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger "outbox_messages_no_delete"
      before delete on "outbox_messages"
      for each row execute function "reject_outbox_message_delete"();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop trigger if exists "outbox_messages_no_delete" on "outbox_messages";`,
    );
    this.addSql(`drop function if exists "reject_outbox_message_delete"();`);
    this.addSql(
      `drop trigger if exists "outbox_messages_envelope_immutable" on "outbox_messages";`,
    );
    this.addSql(`drop function if exists "reject_outbox_message_mutation"();`);
    this.addSql(
      `drop trigger if exists "wager_transactions_no_delete" on "wager_transactions";`,
    );
    this.addSql(`drop function if exists "reject_wager_transaction_delete"();`);
    this.addSql(
      `drop trigger if exists "wager_transactions_terminal_immutable" on "wager_transactions";`,
    );
    this.addSql(
      `drop function if exists "reject_terminal_wager_transaction_mutation"();`,
    );
  }
}
