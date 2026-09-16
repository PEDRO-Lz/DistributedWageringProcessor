import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(WorkerModule);

  // Sem isso o Nest nunca chama onApplicationShutdown() que é onde
  // ApiModule fecha a conexão com o Postgres quando o processo recebe
  // SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = Number(process.env.WORKER_PORT ?? 3001);
  await app.listen(port);
}

bootstrap();
