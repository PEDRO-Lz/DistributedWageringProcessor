import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ApiModule } from "./api.module";
import { DomainExceptionFilter } from "./shared/http/domain-exception.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiModule);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());

  // Sem isso o Nest nunca chama onApplicationShutdown() que é onde
  // ApiModule fecha a conexão com o Postgres quando o processo recebe
  // SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

bootstrap();
