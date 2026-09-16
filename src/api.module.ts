import { Module } from "@nestjs/common";
import { CoreModule } from "./core.module";
import { WalletsController } from "./wallets/interface/http/wallets.controller";
import { WageringController } from "./wagering/interface/http/wagering.controller";
import { HealthController } from "./health/health.controller";

// Processo da API HTTP
@Module({
  imports: [CoreModule],
  controllers: [WalletsController, WageringController, HealthController],
})
export class ApiModule {}
