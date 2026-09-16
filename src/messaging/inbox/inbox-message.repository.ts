import type { EntityManager } from '@mikro-orm/postgresql';
import type { InboxRepositoryPort } from './inbox-repository.port';
import type { InboxMessage } from './inbox-message';
import { InboxMessageEntity } from './inbox-message.entity';
import { toInboxMessageDomain, toInboxMessageEntity } from './inbox-message.mapper';

export class MikroOrmInboxRepository implements InboxRepositoryPort {
  /** Insert + flush imediato: a violação de (consumerName, messageId) já duplicado estoura aqui. */
  async claim(em: EntityManager, message: InboxMessage): Promise<void> {
    em.create(InboxMessageEntity, toInboxMessageEntity(message));
    await em.flush();
  }

  async findByConsumerAndMessageId(em: EntityManager, consumerName: string, messageId: string) {
    const row = await em.findOne(InboxMessageEntity, { consumerName, messageId });
    return row ? toInboxMessageDomain(row) : null;
  }

  async markProcessed(em: EntityManager, consumerName: string, messageId: string, at: Date): Promise<void> {
    const row = await em.findOneOrFail(InboxMessageEntity, { consumerName, messageId });
    const domain = toInboxMessageDomain(row);
    domain.markProcessed(at);
    em.assign(row, toInboxMessageEntity(domain));
  }
}
