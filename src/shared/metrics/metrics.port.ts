export interface MetricsPort {
  incrementCounter(name: string, labels?: Record<string, string>): void;
  observeHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
}

export const METRICS_PORT = Symbol("METRICS_PORT");

export const NOOP_METRICS: MetricsPort = {
  incrementCounter: () => undefined,
  observeHistogram: () => undefined,
  setGauge: () => undefined,
};
