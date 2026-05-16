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
      const name = s.name;
      if (!exports.has(name)) exports.set(name, s);
      // Also expose container-stripped qualified name for class methods
      if (s.qualified_name && s.qualified_name !== name) {
        const tail = s.qualified_name.split(".").pop()!;
        if (!exports.has(tail)) exports.set(tail, s);
      }
    }
    exportsByFile.set(pf.path, exports);
  }

  function resolveModuleSpec(
    fromAbsFile: string,
    spec: string,
  ): string | undefined {
    const fromDir = path.dirname(fromAbsFile);
    // 1. Relative
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

  function resolveExport(
    targetFile: string,
    exportedName: string,
    depth = 0,
  ): SymbolRef | undefined {
    if (depth > 3) return undefined;
    const fileExports = exportsByFile.get(targetFile);
    if (fileExports?.has(exportedName)) return fileExports.get(exportedName)!;
    // Chase re-exports
    const pf = filesByAbs.get(targetFile);
    if (!pf?.re_exports) return undefined;
    for (const rx of pf.re_exports) {
      if (rx.exported === exportedName || rx.exported === "*") {
        const nextFile = resolveModuleSpec(targetFile, rx.source);
        if (!nextFile) continue;
        const sought = rx.exported === "*" ? exportedName : rx.local ?? exportedName;
        const found = resolveExport(nextFile, sought, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
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
    try {
      const raw = await readFile(path.join(root, name), "utf8");
      const data = JSON.parse(stripJsonComments(raw)) as {
        compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string };
      };
      const co = data.compilerOptions ?? {};
      if (co.paths || co.baseUrl) {
        return { paths: co.paths ?? {}, baseUrl: co.baseUrl };
      }
    } catch {
      // ignore
    }
  }
  return { paths: {} };
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
