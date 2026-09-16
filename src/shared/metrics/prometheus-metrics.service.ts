import { Counter, Gauge, Histogram, Registry } from "prom-client";
import type { MetricsPort } from "./metrics.port";

// Todo histograma deste projeto mede tempo em milissegundos (lock wait,
// duração de processamento, lag de publicação), nunca segundos: os buckets
// default do prom-client são pra segundos e ficariam inúteis aqui (tudo
// cairia no último balde)
const HISTOGRAM_BUCKETS_MS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

/**
 * Um registro por processo (API e worker cada um com o seu, nunca o
 * registro global default do prom-client). são processos Bun separados,
 * memória separada, métricas de outbox só existem no /metrics do worker.
 */
export class PrometheusMetricsService implements MetricsPort {
  readonly registry = new Registry();

  private readonly counters = new Map<string, Counter<string>>();
  private readonly histograms = new Map<string, Histogram<string>>();
  private readonly gauges = new Map<string, Gauge<string>>();

  incrementCounter(name: string, labels: Record<string, string> = {}): void {
    this.getOrCreateCounter(name, Object.keys(labels)).inc(labels);
  }

  observeHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    this.getOrCreateHistogram(name, Object.keys(labels)).observe(labels, value);
  }

  setGauge(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    this.getOrCreateGauge(name, Object.keys(labels)).set(labels, value);
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  private getOrCreateCounter(
    name: string,
    labelNames: string[],
  ): Counter<string> {
    let counter = this.counters.get(name);
    if (!counter) {
      counter = new Counter({
        name,
        help: name,
        labelNames,
        registers: [this.registry],
      });
      this.counters.set(name, counter);
    }
    return counter;
  }

  private getOrCreateHistogram(
    name: string,
    labelNames: string[],
  ): Histogram<string> {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = new Histogram({
        name,
        help: name,
        labelNames,
        buckets: HISTOGRAM_BUCKETS_MS,
        registers: [this.registry],
      });
      this.histograms.set(name, histogram);
    }
    return histogram;
  }

  private getOrCreateGauge(name: string, labelNames: string[]): Gauge<string> {
    let gauge = this.gauges.get(name);
    if (!gauge) {
      gauge = new Gauge({
        name,
        help: name,
        labelNames,
        registers: [this.registry],
      });
      this.gauges.set(name, gauge);
    }
    return gauge;
  }
}
