/**
 * Minimal Prometheus metrics (text exposition format 0.0.4), dependency-free like the
 * rest of the platform's security/ops code. Served at GET /metrics (src/http/observability.ts).
 *
 *   counter    monotonically increasing, by label set
 *   histogram  cumulative buckets + _sum + _count, by label set (p99 via histogram_quantile)
 *   gauge      read at scrape time from a callback (current state, e.g. queue depth)
 *
 * One process-wide registry (`metrics`). Gauges are re-bound by each app instance.
 */
type Labels = Record<string, string>;

const labelKey = (labels: Labels): string =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`)
    .join(",");

const fmtLabels = (key: string, extra?: string): string => {
  const all = [key, extra].filter(Boolean).join(",");
  return all ? `{${all}}` : "";
};

class Counter {
  readonly values = new Map<string, number>();
  constructor(readonly name: string, readonly help: string) {}
  inc(labels: Labels = {}, by = 1): void {
    const k = labelKey(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.values) lines.push(`${this.name}${fmtLabels(k)} ${v}`);
    return lines.join("\n");
  }
}

class Histogram {
  private readonly series = new Map<string, { buckets: number[]; sum: number; count: number }>();
  constructor(readonly name: string, readonly help: string, readonly bounds: number[]) {}
  observe(value: number, labels: Labels = {}): void {
    const k = labelKey(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    this.bounds.forEach((b, i) => {
      if (value <= b) s!.buckets[i] += 1;
    });
    s.sum += value;
    s.count += 1;
  }
  count(labels: Labels = {}): number {
    return this.series.get(labelKey(labels))?.count ?? 0;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, s] of this.series) {
      this.bounds.forEach((b, i) => lines.push(`${this.name}_bucket${fmtLabels(k, `le="${b}"`)} ${s.buckets[i]}`));
      lines.push(`${this.name}_bucket${fmtLabels(k, 'le="+Inf"')} ${s.count}`);
      lines.push(`${this.name}_sum${fmtLabels(k)} ${s.sum}`);
      lines.push(`${this.name}_count${fmtLabels(k)} ${s.count}`);
    }
    return lines.join("\n");
  }
}

class Gauge {
  private source: () => number = () => 0;
  constructor(readonly name: string, readonly help: string) {}
  bind(fn: () => number): void {
    this.source = fn;
  }
  render(): string {
    let v = 0;
    try {
      v = this.source();
    } catch {
      v = NaN;
    }
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`, `${this.name} ${v}`].join("\n");
  }
}

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const metrics = {
  httpRequests: new Counter("rgs_http_requests_total", "HTTP requests by method, route and status class."),
  httpDuration: new Histogram("rgs_http_request_duration_seconds", "HTTP request latency by method and route.", LATENCY_BUCKETS),
  walletCall: new Histogram("rgs_wallet_webhook_duration_seconds", "Casino wallet webhook latency by action and outcome (ok, declined, failed).", LATENCY_BUCKETS),
  dbFlush: new Histogram("rgs_db_flush_duration_seconds", "Postgres write-through flush latency per request (persistence enabled only).", LATENCY_BUCKETS),
  dbQuarantined: new Counter("rgs_db_rows_quarantined_total", "Rows Postgres permanently refused (constraint/trigger), by table. They were not written: alert on any increase."),
  dbFlushFailures: new Counter("rgs_db_flush_failures_total", "Flushes that failed, by kind (transient = retried, permanent = rows quarantined)."),
  walletTx: new Counter("rgs_wallet_transactions_total", "Money-movement records by type and status."),
  rounds: new Counter("rgs_rounds_total", "Rounds resolved, by kind (paid, buy, free_spin, free_round)."),
  engineIntegrity: new Counter("rgs_engine_integrity_violations_total", "Engine results refused by the fail-closed guard, by check. Must stay 0: alert on any increase."),
  activeSessions: new Gauge("rgs_active_sessions", "Player sessions currently active."),
  pendingReversals: new Gauge("rgs_debit_reversals_pending", "Lost-debit reversals the casino has not acknowledged yet (reconciliation queue)."),
  failedSettlements: new Gauge("rgs_failed_settlements_pending", "Wins whose credit failed and is not yet settled."),
  processUptime: new Gauge("rgs_process_uptime_seconds", "Seconds since this process started.")
};

export function renderMetrics(): string {
  return `${Object.values(metrics).map((m) => m.render()).join("\n")}\n`;
}
