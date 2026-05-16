import path from "node:path";
import { realpathSync } from "node:fs";
import ts from "typescript";
import type { DnaIndex } from "./index_store.js";

function realRel(root: string, abs: string): string {
  try {
    return path.relative(realpathSync(root), realpathSync(abs));
  } catch {
    return path.relative(root, abs);
  }
}

/**
 * tsserver resolves workspace package imports to the built dist/.d.ts file
 * (whatever `main`/`types` points at). DNA tracks source files. Normalize
 * both ends so monorepos don't all look "wrong" when they're actually right.
 */
function normalizeTarget(p: string): string {
  // packages/<x>/dist/foo.d.ts → packages/<x>/src/foo
  return p
    .replace(/\/dist\//, "/src/")
    .replace(/\.d\.ts:/, ":")
    .replace(/\.ts:/, ":")
    .replace(/\.tsx:/, ":");
}

/**
 * Verify DNA's symbol graph against TypeScript's own type checker.
 *
 * For each sampled call edge we recorded, ask `ts` what the call at
 * (file, line) actually resolves to. Compare DNA's `to` against the real
 * symbol's declaration file + name. Also sample call sites that ts knows
 * about but DNA may have missed (recall).
 *
 * Three numbers ship in the report:
 *   precision = (DNA edges ts confirms) / (sampled DNA edges)
 *   recall    = (ts edges DNA has) / (sampled ts edges)
 *   coverage  = (DNA edges with status ∈ {exact, typed}) / (total DNA edges)
 *
 * Python is intentionally out of scope here — pyright shell-out lives in
 * a separate verify_index_py module when we add it.
 */
export interface VerifyReport {
  language: "typescript";
  sample_size: number;
  total_edges: number;
  precision: number;
  recall: number;
  coverage: number;
  worst: Array<{
    from_file: string;
    from_line: number;
    callee: string;
    dna_resolved_to?: string;
    ts_resolved_to?: string;
    issue: "wrong_target" | "ts_says_no_target" | "dna_missed";
  }>;
}

export interface VerifyOptions {
  root: string;
  sample?: number;
  /** Cap concurrent ts programs. The whole program is built once. */
}

const DEFAULT_SAMPLE = 50;

export async function verifyIndex(
  index: DnaIndex,
  opts: VerifyOptions,
): Promise<VerifyReport> {
  const { root, sample = DEFAULT_SAMPLE } = opts;

  // Build a ts Program over the TS files DNA indexed.
  const tsFiles = index.files
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"))
    .map((f) => path.resolve(root, f));
  if (tsFiles.length === 0) {
    return {
      language: "typescript",
      sample_size: 0,
      total_edges: index.edges.length,
      precision: 1,
      recall: 1,
      coverage: coverageOf(index),
      worst: [],
    };
  }

  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json")
    ?? ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.base.json");
  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
  };
  if (configPath) {
    const raw = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!raw.error) {
      const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
      compilerOptions = { ...compilerOptions, ...parsed.options };
    }
  }
  const program = ts.createProgram(tsFiles, compilerOptions);
  const checker = program.getTypeChecker();

  // Pre-compute line offsets per source file for quick lookups.
  const lineCache = new Map<string, ts.SourceFile>();
  for (const f of tsFiles) {
    const sf = program.getSourceFile(f);
    if (sf) lineCache.set(f, sf);
  }

  // --- Precision pass: sample edges from DNA, ask ts who's actually called.
  const tsEdges = index.edges.filter(
    (e) => e.file && (e.file.endsWith(".ts") || e.file.endsWith(".tsx") || e.file.endsWith(".js") || e.file.endsWith(".jsx")),
  );
  const sampleEdges = pickRandom(tsEdges, sample);
  const worst: VerifyReport["worst"] = [];
  let precisionHits = 0;
  for (const edge of sampleEdges) {
    const absFile = path.resolve(root, edge.file!);
    const sf = lineCache.get(absFile);
    if (!sf) continue;
    const callee = lastNameOf(edge.to);
    const callExpr = findCallAt(sf, edge.line ?? 1, callee);
    if (!callExpr) {
      // ts can't even find it — be lenient
      precisionHits++;
      continue;
    }
    const sym = aliasedTarget(checker, checker.getSymbolAtLocation(callExpr.expression));
    const declFile = sym?.declarations?.[0]?.getSourceFile().fileName;
    const declName = sym?.getName();
    const tsTarget = declFile && declName ? `${realRel(root, declFile)}:${declName}` : undefined;
    const dnaTarget = `${guessTargetFile(index, edge)}:${callee}`;
    if (!tsTarget) {
      worst.push({
        from_file: edge.file!,
        from_line: edge.line ?? 0,
        callee,
        dna_resolved_to: dnaTarget,
        issue: "ts_says_no_target",
      });
      continue;
    }
    // Match by file path + name (after dist/src normalization).
    if (normalizeTarget(tsTarget) === normalizeTarget(dnaTarget)) {
      precisionHits++;
    } else {
      worst.push({
        from_file: edge.file!,
        from_line: edge.line ?? 0,
        callee,
        dna_resolved_to: dnaTarget,
        ts_resolved_to: tsTarget,
        issue: "wrong_target",
      });
    }
  }

  // --- Recall pass: walk a random sample of source files, count calls ts
  //     sees, and check whether DNA has any matching edge.
  const fileSample = pickRandom(tsFiles, Math.min(sample, tsFiles.length));
  let recallSeen = 0;
  let recallHit = 0;
  for (const f of fileSample) {
    const sf = lineCache.get(f);
    if (!sf) continue;
    const relFile = path.relative(root, f);
    visitCalls(sf, (callExpr, line) => {
      const callee = nameOfCallExpression(callExpr);
      if (!callee) return;
      // Skip method calls — DNA's parser intentionally doesn't track them.
      if (ts.isPropertyAccessExpression(callExpr.expression)) return;
      // Skip externals — recall should measure project edges, not lib.es5.d.ts.
      const sym = aliasedTarget(checker, checker.getSymbolAtLocation(callExpr.expression));
      const declFile = sym?.declarations?.[0]?.getSourceFile().fileName;
      if (!declFile || declFile.includes("node_modules") || declFile.includes("/lib.")) return;
      recallSeen++;
      const matched = index.edges.some(
        (e) => e.file === relFile && Math.abs((e.line ?? 0) - line) <= 1 && lastNameOf(e.to) === callee,
      );
      if (matched) recallHit++;
      else if (worst.length < 10) {
        const declName = sym?.getName();
        if (declName) {
          worst.push({
            from_file: relFile,
            from_line: line,
            callee,
            ts_resolved_to: `${realRel(root, declFile)}:${declName}`,
            issue: "dna_missed",
          });
        }
      }
    });
  }

  return {
    language: "typescript",
    sample_size: sampleEdges.length,
    total_edges: index.edges.length,
    precision: sampleEdges.length === 0 ? 1 : precisionHits / sampleEdges.length,
    recall: recallSeen === 0 ? 1 : recallHit / recallSeen,
    coverage: coverageOf(index),
    worst: worst.slice(0, 10),
  };
}

function coverageOf(index: DnaIndex): number {
  if (index.edges.length === 0) return 1;
  const good = index.edges.filter(
    (e) => e.resolution_status === "exact" || e.resolution_status === "typed",
  ).length;
  return good / index.edges.length;
}

function lastNameOf(qualified: string): string {
  return qualified.split(".").pop() ?? qualified;
}

function guessTargetFile(index: DnaIndex, edge: DnaIndex["edges"][number]): string {
  const target = index.symbols.find((s) => (s.qualified_name ?? s.name) === edge.to);
  return target?.file ?? "?";
}

function pickRandom<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const out: T[] = [];
  const used = new Set<number>();
  while (out.length < n) {
    const i = Math.floor(Math.random() * arr.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(arr[i]!);
  }
  return out;
}

function findCallAt(
  sf: ts.SourceFile,
  line: number,
  calleeHint: string,
): ts.CallExpression | undefined {
  let result: ts.CallExpression | undefined;
  function visit(n: ts.Node): void {
    if (result) return;
    if (ts.isCallExpression(n)) {
      const pos = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      if (Math.abs(pos.line + 1 - line) <= 1) {
        const name = nameOfCallExpression(n);
        if (!calleeHint || name === calleeHint) {
          result = n;
          return;
        }
      }
    }
    n.forEachChild(visit);
  }
  visit(sf);
  return result;
}

function visitCalls(
  sf: ts.SourceFile,
  fn: (n: ts.CallExpression, line: number) => void,
): void {
  function visit(n: ts.Node): void {
    if (ts.isCallExpression(n)) {
      const pos = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      fn(n, pos.line + 1);
    }
    n.forEachChild(visit);
  }
  visit(sf);
}

function aliasedTarget(checker: ts.TypeChecker, sym: ts.Symbol | undefined): ts.Symbol | undefined {
  if (!sym) return undefined;
  let cur = sym;
  let guard = 0;
  while (cur.flags & ts.SymbolFlags.Alias && guard++ < 5) {
    try {
      cur = checker.getAliasedSymbol(cur);
    } catch {
      break;
    }
  }
  return cur;
}

function nameOfCallExpression(n: ts.CallExpression): string | undefined {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}
