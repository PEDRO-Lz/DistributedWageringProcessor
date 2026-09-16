import { LockMode, type EntityManager } from '@mikro-orm/postgresql';
import type { OutboxRepositoryPort } from './outbox-repository.port';
import type { OutboxMessage } from './outbox-message';
import { OutboxMessageEntity } from './outbox-message.entity';
import { toOutboxMessageDomain, toOutboxMessageEntity } from './outbox-message.mapper';

export class MikroOrmOutboxRepository implements OutboxRepositoryPort {
  insert(em: EntityManager, message: OutboxMessage): void {
    em.create(OutboxMessageEntity, toOutboxMessageEntity(message));
  }

  /** FOR UPDATE SKIP LOCKED: qualquer número de publishers concorrentes pode rodar isso ao mesmo tempo sem colidir. */
  async findDueBatch(em: EntityManager, now: Date, limit: number): Promise<OutboxMessage[]> {
    const rows = await em
      .createQueryBuilder(OutboxMessageEntity, 'o')
      .where({ publishedAt: null })
      .andWhere('(o.next_attempt_at is null or o.next_attempt_at <= ?)', [now])
      .orderBy({ occurredAt: 'asc' })
      .limit(limit)
      .setLockMode(LockMode.PESSIMISTIC_PARTIAL_WRITE)
      .getResultList();
    return rows.map(toOutboxMessageDomain);
  }

  async save(em: EntityManager, message: OutboxMessage): Promise<void> {
    const row = await em.findOneOrFail(OutboxMessageEntity, { id: message.id });
    em.assign(row, toOutboxMessageEntity(message));
  }
}
