import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CoreModule } from "./core.module";
import { WalletsController } from "./wallets/interface/http/wallets.controller";
import { WageringController } from "./wagering/interface/http/wagering.controller";
import { HealthController } from "./health/health.controller";
import { KeycloakAuthGuard } from "./shared/http/keycloak-auth.guard";
import { CorrelationIdMiddleware } from "./shared/http/correlation-id.middleware";
import { MetricsController } from "./shared/metrics/metrics.controller";

// Processo da API HTTP. KeycloakAuthGuard como APP_GUARD roda em toda rota
// exceto as marcadas com @Public()
@Module({
  imports: [CoreModule],
  controllers: [
    WalletsController,
    WageringController,
    HealthController,
    MetricsController,
  ],
  providers: [{ provide: APP_GUARD, useClass: KeycloakAuthGuard }],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
