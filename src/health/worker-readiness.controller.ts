import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { MikroORM } from "@mikro-orm/postgresql";
import { MIKRO_ORM } from "../shared/persistence/orm.tokens";
import { SQS_PORT, type SqsPort } from "../messaging/sqs/sqs.port";
import { WAGER_TRANSACTIONS_QUEUE } from "../messaging/sqs/queue-names";
import { Public } from "../shared/http/public.decorator";

/**
 * Exclusivo do worker (não vive em HealthController, que é compartilhado com
 * a API): o worker depende de SQS, a API não. Separar evita precisar
 * injetar SqsPort num controller que a API também usa sem nunca ter esse
 * provider disponível
 */
@Public()
@Controller("health/ready")
export class WorkerReadinessController {
  constructor(
    @Inject(MIKRO_ORM) private readonly orm: MikroORM,
    @Inject(SQS_PORT) private readonly sqs: SqsPort,
  ) {}

  @Get()
  async check(): Promise<{ status: "ok"; postgres: "ok"; sqs: "ok" }> {
    try {
      await this.orm.em.getConnection().execute("select 1");
    } catch {
      throw new ServiceUnavailableException("Postgres indisponível");
    }
    try {
      await this.sqs.checkConnection(WAGER_TRANSACTIONS_QUEUE);
    } catch {
      throw new ServiceUnavailableException("SQS indisponível");
    }
    return { status: "ok", postgres: "ok", sqs: "ok" };
  }
}
