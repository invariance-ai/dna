/**
 * Shared statistics helpers.
 *
 * Extracted so that verify-index and repo-edit-bench compute confidence
 * intervals the same way. If you change `wilson` here, every downstream
 * consumer's reported CI shifts — keep that in mind.
 */

export interface WilsonCI {
  low: number;
  high: number;
}

/**
 * Wilson score interval at 95% confidence for a binomial proportion.
 *
 *   hits/n  → [low, high]
 *
 * Returns `[0, 1]` when n=0 (no information). Prefer Wilson over the
 * Normal approximation: it doesn't degenerate at p∈{0,1} and is honest
 * for small n (which bench runs always are).
 */
export function wilson(hits: number, n: number): WilsonCI {
  if (n === 0) return { low: 0, high: 1 };
  const z = 1.96;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
  };
}

/** Render a Wilson CI as `[low%, high%]` to one decimal (or whole number). */
export function formatWilsonPct(ci: WilsonCI, decimals = 0): string {
  const lo = (ci.low * 100).toFixed(decimals);
  const hi = (ci.high * 100).toFixed(decimals);
  return `[${lo}, ${hi}]`;
}
