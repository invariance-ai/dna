import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { SymbolRef } from "@invariance/dna-schemas";
import type { ImportBinding, ParsedFile } from "./parser.js";

/**
 * Cross-file import / re-export resolver.
 *
 * Inputs: the parsed file set + repo root.
 * Output: a function `resolveCall(fromFile, callerEnclosing, calleeName)` →
 *   `{ target: SymbolRef, status: "exact" | "heuristic" | "unresolved" }`.
 *
 * Strategy (per call site):
 *   1. file-local declaration matches → exact
 *   2. import binding for `calleeName` in `fromFile` → resolve to the
 *      imported module's exported symbol; if found → exact, else unresolved.
 *   3. namespace import + method call (`ns.foo()`) — name-only fallback.
 *   4. fall back to name-table lookup → heuristic.
 *   5. nothing → unresolved.
 *
 * The resolver also chases re-exports up to a small depth (3) so barrel
 * files like `index.ts` re-exporting from sibling modules resolve correctly.
 *
 * No type information is used here — that's the "typed" tier (verify_index
 * uses tsserver). This module ships an "exact" tier that's import-graph-
 * correct, which is enough to flip most regex misses into resolved edges.
 */
export interface ResolvedCall {
  target?: SymbolRef;
  status: "exact" | "heuristic" | "unresolved";
  reason?: string;
}

export interface ResolverOptions {
  root: string;
  /** Optional path aliases from tsconfig.json compilerOptions.paths. */
  tsAliases?: Record<string, string[]>;
  /** Optional baseUrl from tsconfig.json compilerOptions.baseUrl. */
  tsBaseUrl?: string;
  /** Workspace package name → directory map (monorepos). */
  workspacePackages?: Record<string, string>;
}

export interface Resolver {
  resolveCall(fromAbsFile: string, calleeName: string): ResolvedCall;
}

export async function buildResolver(
  parsed: ParsedFile[],
  options: ResolverOptions,
): Promise<Resolver> {
  const { root } = options;
  const tsAliases = options.tsAliases ?? (await loadTsAliases(root)).paths;
  const tsBaseUrl = options.tsBaseUrl ?? (await loadTsAliases(root)).baseUrl;
  const workspacePackages =
    options.workspacePackages ?? (await loadWorkspacePackages(root));

  // exportName → SymbolRef[] per file (absolute path)
  const exportsByFile = new Map<string, Map<string, SymbolRef>>();
  // file abs path → ParsedFile
  const filesByAbs = new Map<string, ParsedFile>();
  for (const pf of parsed) {
    filesByAbs.set(pf.path, pf);
    const exports = new Map<string, SymbolRef>();
    for (const s of pf.symbols) {
      // Only register top-level symbols as importable export names.
      // Class methods (container set + qualified_name like `Cls.method`) are
      // not importable as bare `method` from outside — registering them as
      // top-level made unrelated callers resolve to the wrong target.
      const isNested = !!s.container || (!!s.qualified_name && s.qualified_name !== s.name);
      if (isNested) continue;
      const name = s.name;
      if (!exports.has(name)) exports.set(name, s);
    }
    exportsByFile.set(pf.path, exports);
  }

  function resolveModuleSpec(
    fromAbsFile: string,
    spec: string,
  ): string | undefined {
    const fromDir = path.dirname(fromAbsFile);
    // 1a. Python relative import: `.`, `..`, `..foo.bar` etc.
    //     Each leading dot beyond the first walks up one package directory.
    //     `from . import x`     → spec === "."   → target dir = fromDir
    //     `from .. import x`    → spec === ".."  → target dir = parent(fromDir)
    //     `from ..util import x`→ spec === "..util" → parent(fromDir)/util
    if (spec.length > 0 && spec[0] === "." && fromAbsFile.endsWith(".py")) {
      let i = 0;
      while (i < spec.length && spec[i] === ".") i++;
      const dots = i;
      const tail = spec.slice(i).replace(/\./g, path.sep);
      let dir = fromDir;
      // First dot = current package; each extra dot = one level up.
      for (let up = 1; up < dots; up++) dir = path.dirname(dir);
      const base = tail ? path.join(dir, tail) : dir;
      return resolveFileLike(base);
    }
    // 1b. JS/TS relative
    if (spec.startsWith(".")) {
      const base = path.resolve(fromDir, spec);
      return resolveFileLike(base);
    }
    // 2. Workspace package
    for (const [pkgName, pkgDir] of Object.entries(workspacePackages)) {
      if (spec === pkgName) {
        return resolveFileLike(path.join(pkgDir, "src/index"));
      }
      if (spec.startsWith(pkgName + "/")) {
        return resolveFileLike(path.join(pkgDir, spec.slice(pkgName.length + 1)));
      }
    }
    // 3. tsconfig path alias
    for (const [pattern, targets] of Object.entries(tsAliases)) {
      const matched = matchAlias(pattern, spec);
      if (matched === undefined) continue;
      for (const t of targets) {
        const resolved = path.resolve(root, tsBaseUrl ?? ".", t.replace("*", matched));
        const file = resolveFileLike(resolved);
        if (file) return file;
      }
    }
    // 4. Absolute with baseUrl
    if (tsBaseUrl) {
      const file = resolveFileLike(path.resolve(root, tsBaseUrl, spec));
      if (file) return file;
    }
    return undefined;
  }

  function resolveFileLike(base: string): string | undefined {
    const exts = [".ts", ".tsx", ".js", ".jsx", ".py", ""];
    for (const ext of exts) {
      const candidate = ext ? `${base}${ext}` : base;
      if (filesByAbs.has(candidate)) return candidate;
    }
    // Try as directory with index file
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".py"]) {
      const candidate = path.join(base, `index${ext}`);
      if (filesByAbs.has(candidate)) return candidate;
    }
    // Python __init__.py
    const pyInit = path.join(base, "__init__.py");
    if (filesByAbs.has(pyInit)) return pyInit;
    return undefined;
  }

  const MAX_REEXPORT_DEPTH = 10;
  function resolveExport(
    targetFile: string,
    exportedName: string,
    visited: Set<string> = new Set(),
    depth = 0,
  ): SymbolRef | undefined {
    // Cycle guard: visited keyed by `file|exportName` lets legitimate long
    // barrel chains succeed while still terminating on cycles. Hard depth
    // cap is a safety net for pathological graphs.
    if (depth > MAX_REEXPORT_DEPTH) return undefined;
    const visitKey = `${targetFile}|${exportedName}`;
    if (visited.has(visitKey)) return undefined;
    visited.add(visitKey);

    const fileExports = exportsByFile.get(targetFile);
    if (fileExports?.has(exportedName)) return fileExports.get(exportedName)!;
    // Chase re-exports
    const pf = filesByAbs.get(targetFile);
    if (!pf?.re_exports) return undefined;
    // Named re-exports first (deterministic, name-targeted).
    for (const rx of pf.re_exports) {
      if (rx.exported === "*") continue;
      if (rx.exported !== exportedName) continue;
      const nextFile = resolveModuleSpec(targetFile, rx.source);
      if (!nextFile) continue;
      const sought = rx.local ?? exportedName;
      const found = resolveExport(nextFile, sought, visited, depth + 1);
      if (found) return found;
    }
    // Wildcard re-exports: iterate in lexical source order (the parser already
    // emits re_exports in file order). If two `export *` modules both expose
    // the same name, the first wins — and we warn in debug to surface the
    // collision. Without this the winner depended on Map iteration order.
    const wildcardHits: Array<{ src: string; sym: SymbolRef }> = [];
    for (const rx of pf.re_exports) {
      if (rx.exported !== "*") continue;
      const nextFile = resolveModuleSpec(targetFile, rx.source);
      if (!nextFile) continue;
      const found = resolveExport(nextFile, exportedName, visited, depth + 1);
      if (found) wildcardHits.push({ src: rx.source, sym: found });
    }
    if (wildcardHits.length > 1 && process.env.DNA_DEBUG) {
      const sources = wildcardHits.map((h) => h.src).join(", ");
      // eslint-disable-next-line no-console
      console.warn(
        `[resolver] ambiguous \`export *\` for "${exportedName}" in ${targetFile}: ${sources}; picking first by source order`,
      );
    }
    return wildcardHits[0]?.sym;
  }

  function bindingFor(file: string, name: string): ImportBinding | undefined {
    const pf = filesByAbs.get(file);
    if (!pf?.imports) return undefined;
    return pf.imports.find((b) => b.local === name);
  }

  return {
    resolveCall(fromAbsFile: string, calleeName: string): ResolvedCall {
      // 1. File-local
      const localExports = exportsByFile.get(fromAbsFile);
      const localHit = localExports?.get(calleeName);
      if (localHit) return { target: localHit, status: "exact", reason: "local" };

      // 2. Direct import
      const binding = bindingFor(fromAbsFile, calleeName);
      if (binding) {
        const targetFile = resolveModuleSpec(fromAbsFile, binding.source);
        if (!targetFile) {
          return { status: "unresolved", reason: `module not found: ${binding.source}` };
        }
        const wantedName =
          binding.kind === "named"
            ? binding.imported ?? binding.local
            : binding.kind === "default"
            ? "default"
            : binding.local;
        const hit = resolveExport(targetFile, wantedName);
        if (hit) return { target: hit, status: "exact", reason: `import:${binding.kind}` };
        return { status: "unresolved", reason: `${wantedName} not found in ${binding.source}` };
      }

      return { status: "unresolved", reason: "no binding" };
    },
  };
}

function matchAlias(pattern: string, spec: string): string | undefined {
  if (!pattern.includes("*")) {
    return pattern === spec ? "" : undefined;
  }
  const [prefix, suffix] = pattern.split("*");
  if (spec.startsWith(prefix!) && spec.endsWith(suffix!)) {
    return spec.slice(prefix!.length, spec.length - suffix!.length);
  }
  return undefined;
}

async function loadTsAliases(
  root: string,
): Promise<{ paths: Record<string, string[]>; baseUrl?: string }> {
  for (const name of ["tsconfig.json", "tsconfig.base.json"]) {
    const file = path.join(root, name);
    const merged = await loadTsConfigChain(file, new Set());
    if (merged && (merged.paths || merged.baseUrl !== undefined)) {
      return { paths: merged.paths ?? {}, baseUrl: merged.baseUrl };
    }
  }
  return { paths: {} };
}

/**
 * Walk `extends` to merge compilerOptions.paths/baseUrl. Most monorepos put
 * paths on a base tsconfig the per-package configs extend from; without this
 * chase the alias map silently came back empty.
 *
 * Precedence: child wins over parent for both `paths` and `baseUrl`.
 * `baseUrl` is resolved relative to the file that declared it (tsc semantics).
 * `paths` keys/values are kept verbatim — they're resolved later against the
 * effective baseUrl.
 */
async function loadTsConfigChain(
  file: string,
  seen: Set<string>,
): Promise<{ paths?: Record<string, string[]>; baseUrl?: string } | undefined> {
  const abs = path.resolve(file);
  if (seen.has(abs)) return undefined;
  seen.add(abs);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch {
    return undefined;
  }
  let data: {
    compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string };
    extends?: string | string[];
  };
  try {
    data = JSON.parse(stripJsonComments(raw));
  } catch {
    return undefined;
  }
  const co = data.compilerOptions ?? {};
  const here = path.dirname(abs);
  // Resolve extends (may be string or array in newer tsc).
  const parents = Array.isArray(data.extends)
    ? data.extends
    : data.extends
    ? [data.extends]
    : [];
  const merged: { paths?: Record<string, string[]>; baseUrl?: string } = {};
  for (const ext of parents) {
    const parentPath = ext.endsWith(".json") ? ext : `${ext}.json`;
    const parentAbs = parentPath.startsWith(".")
      ? path.resolve(here, parentPath)
      : // bare specifier — best-effort: look under node_modules at here.
        path.resolve(here, "node_modules", parentPath);
    const parent = await loadTsConfigChain(parentAbs, seen);
    if (!parent) continue;
    if (parent.paths) merged.paths = { ...merged.paths, ...parent.paths };
    if (parent.baseUrl !== undefined) merged.baseUrl = parent.baseUrl;
  }
  if (co.paths) merged.paths = { ...merged.paths, ...co.paths };
  if (co.baseUrl !== undefined) {
    // tsc resolves baseUrl relative to the declaring config. Convert to an
    // absolute path here so the caller can use it without knowing the chain.
    merged.baseUrl = path.resolve(here, co.baseUrl);
  }
  return merged;
}

async function loadWorkspacePackages(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const pkgFiles = await fg("packages/*/package.json", {
      cwd: root,
      absolute: true,
      ignore: ["**/node_modules/**"],
    });
    for (const f of pkgFiles) {
      try {
        const raw = await readFile(f, "utf8");
        const data = JSON.parse(raw) as { name?: string };
        if (data.name) out[data.name] = path.dirname(f);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return out;
}

// Minimal JSON-with-comments stripper for tsconfig.json
function stripJsonComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}
