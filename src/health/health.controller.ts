import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { MikroORM } from "@mikro-orm/postgresql";
import { MIKRO_ORM } from "../shared/persistence/orm.tokens";

@Controller("health")
export class HealthController {
  constructor(@Inject(MIKRO_ORM) private readonly orm: MikroORM) {}

  @Get()
  async check(): Promise<{ status: "ok"; postgres: "ok" }> {
    try {
      await this.orm.em.getConnection().execute("select 1");
    } catch (err) {
      throw new ServiceUnavailableException("Postgres indisponível");
    }
    return { status: "ok", postgres: "ok" };
  }
}
