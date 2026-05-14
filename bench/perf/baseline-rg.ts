/**
 * rg (ripgrep) baseline: emulates the "just grep for it" workflow a coding
 * agent falls back to when it doesn't have a structural index. Two query
 * shapes per symbol mirror what an agent would actually run:
 *
 *   1. rg --json <symbol>                  — get hit locations
 *   2. rg -n -A 5 -B 2 <symbol> | head -50 — read snippets
 *
 * We sum tokens + latency across both as the "rg context bundle" for that
 * symbol, since neither call alone gives an agent enough to act on.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { approxTokens, stats, timeIt, type LatencyStats } from "./measure.js";

/**
 * Resolve a real ripgrep binary. On some setups `rg` on PATH is a shell
 * function/wrapper that doesn't behave like the real binary when spawned
 * from Node (no shell). Allow override via RG_BIN; otherwise try common
 * install locations before falling back to plain "rg".
 */
function resolveRgBin(): string {
  if (process.env.RG_BIN && existsSync(process.env.RG_BIN)) return process.env.RG_BIN;
  const candidates = [
    "/opt/homebrew/bin/rg",
    "/usr/local/bin/rg",
    "/usr/bin/rg",
    "/usr/local/lib/node_modules/@openai/codex/bin/rg",
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return "rg";
}

const RG_BIN = resolveRgBin();

export interface RgQueryResult {
  symbol: string;
  output: string;
  ms: number;
  tokens: number;
}

export interface RgStats {
  tool: "rg";
  latency: LatencyStats;
  tokens_mean: number;
  tokens_p95: number;
}

function runRg(cwd: string, args: string[]): Promise<{ stdout: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(RG_BIN, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let settled = false;
    const finish = (out: string): void => {
      if (settled) return;
      settled = true;
      resolve({ stdout: out, ms: performance.now() - t0 });
    };
    const killer = setTimeout(() => {
      child.kill();
      finish(stdout);
    }, 5_000);
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.on("close", () => {
      clearTimeout(killer);
      finish(stdout);
    });
    child.on("error", () => {
      clearTimeout(killer);
      finish("");
    });
  });
}

export async function rgQueryBundle(cwd: string, symbol: string): Promise<RgQueryResult> {
  const t0 = performance.now();
  // -F (--fixed-strings) -w (--word-regexp) sidesteps regex escaping issues
  // for symbol names while still matching whole-word identifiers.
  // Pass an explicit search path; without it, rg reads from stdin when spawned
  // (no controlling TTY) and hangs forever.
  const [hits, snippets] = await Promise.all([
    runRg(cwd, ["--json", "--max-count=25", "-w", "-F", symbol, "."]),
    runRg(cwd, ["-n", "-A", "5", "-B", "2", "--max-count=10", "-w", "-F", symbol, "."]),
  ]);
  const ms = performance.now() - t0;
  // Truncate snippets to first ~50 lines (mirrors `| head -50`).
  const truncated = snippets.stdout.split("\n").slice(0, 50).join("\n");
  const output = `# rg hits\n${hits.stdout}\n# rg snippets\n${truncated}`;
  return { symbol, output, ms, tokens: approxTokens(output) };
}

export async function runRgBundle(
  cwd: string,
  symbols: string[],
): Promise<{ stats: RgStats; results: RgQueryResult[] }> {
  const results: RgQueryResult[] = [];
  for (const sym of symbols) {
    const { result } = await timeIt(async () => rgQueryBundle(cwd, sym));
    results.push(result);
  }
  const lats = results.map((r) => r.ms);
  const toks = results.map((r) => r.tokens);
  return {
    stats: {
      tool: "rg",
      latency: stats(lats),
      tokens_mean: toks.reduce((a, b) => a + b, 0) / Math.max(1, toks.length),
      tokens_p95: stats(toks).p95,
    },
    results,
  };
}
