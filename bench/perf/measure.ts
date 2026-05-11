export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

export interface LatencyStats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

export function stats(samples: number[]): LatencyStats {
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    mean: s.length ? sum / s.length : 0,
    min: s[0] ?? 0,
    max: s[s.length - 1] ?? 0,
  };
}

// Rough token estimate. cl100k_base averages ~4 chars/token for code/JSON
// payloads. Avoids native deps; we report this as an approximation.
export function approxTokens(payload: unknown): number {
  const s = typeof payload === "string" ? payload : JSON.stringify(payload);
  return Math.ceil(s.length / 4);
}

export async function timeIt<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const t0 = performance.now();
  const result = await fn();
  return { ms: performance.now() - t0, result };
}
