import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../http/public.decorator";
import { PrometheusMetricsService } from "./prometheus-metrics.service";

@Public()
@Controller("metrics")
export class MetricsController {
  constructor(
    @Inject(PrometheusMetricsService)
    private readonly metrics: PrometheusMetricsService,
  ) {}

  @Get()
  async get(@Res() res: Response): Promise<void> {
    res.setHeader("Content-Type", this.metrics.contentType);
    res.send(await this.metrics.metrics());
  }
}
