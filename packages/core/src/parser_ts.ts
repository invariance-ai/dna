import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Language, type Node } from "web-tree-sitter";
import type { SymbolRef } from "@invariance/dna-schemas";
import type { ImportBinding, ParsedFile, ParsedLanguage } from "./parser.js";

/**
 * v0.2 parser: tree-sitter (WASM) for TS/TSX/JS/Python. Native deps stay
 * out of the install — grammars ship as vendored .wasm files in
 * packages/core/grammars/.
 *
 * Falls through to the regex parser in parser.ts for other languages and
 * when DNA_PARSER=regex is set.
 */

const SUPPORTED = new Set<ParsedLanguage>([
  "typescript",
  "javascript",
  "python",
]);

export function treeSitterSupports(language: ParsedLanguage, filePath: string): boolean {
  if (!SUPPORTED.has(language)) return false;
  // .tsx uses a different grammar; route there only if the file is .tsx.
  return true;
}

const grammarFile = (name: string): string => {
  // packages/core/src/parser_ts.ts → packages/core/grammars/<name>.wasm
  const here = fileURLToPath(new URL(".", import.meta.url));
  return path.resolve(here, "..", "grammars", `${name}.wasm`);
};

const GRAMMAR_BY_EXT: Record<string, string> = {
  ".ts": "tree-sitter-typescript",
  ".tsx": "tree-sitter-tsx",
  ".js": "tree-sitter-javascript",
  ".jsx": "tree-sitter-javascript",
  ".mjs": "tree-sitter-javascript",
  ".cjs": "tree-sitter-javascript",
  ".py": "tree-sitter-python",
};

let parserInitPromise: Promise<void> | null = null;
const languageCache = new Map<string, Promise<Language>>();
// Pool one Parser per grammar. Cheaper than new+delete per file, and safe
// because parseFileTS is awaited end-to-end (no concurrent use of one parser
// within a single call). Parser.parse is synchronous after setLanguage.
const parserPool = new Map<string, Parser>();

async function ensureParserInit(): Promise<void> {
  if (!parserInitPromise) parserInitPromise = Parser.init();
  return parserInitPromise;
}

async function loadLanguage(grammar: string): Promise<Language> {
  let p = languageCache.get(grammar);
  if (!p) {
    p = Language.load(grammarFile(grammar));
    languageCache.set(grammar, p);
  }
  return p;
}

async function getParser(grammar: string): Promise<Parser> {
  let parser = parserPool.get(grammar);
  if (!parser) {
    const lang = await loadLanguage(grammar);
    parser = new Parser();
    parser.setLanguage(lang);
    parserPool.set(grammar, parser);
  }
  return parser;
}

export async function parseFileTS(filePath: string): Promise<ParsedFile> {
  const ext = path.extname(filePath);
  const grammar = GRAMMAR_BY_EXT[ext];
  if (!grammar) throw new Error(`tree-sitter: unsupported extension ${ext}`);
  const language: ParsedLanguage =
    ext === ".py" ? "python"
    : ext.startsWith(".j") ? "javascript"
    : "typescript";

  await ensureParserInit();
  const parser = await getParser(grammar);

  const src = await readFile(filePath, "utf8");
  const tree = parser.parse(src);
  if (!tree) {
    throw new Error(`tree-sitter: parse returned null for ${filePath}`);
  }

  const symbols: SymbolRef[] = [];
  const call_sites: ParsedFile["call_sites"] = [];
  const imports: ImportBinding[] = [];
  const re_exports: NonNullable<ParsedFile["re_exports"]> = [];
  const seen = new Set<string>();

  if (language === "python") {
    walkPython(tree.rootNode, filePath, symbols, call_sites, seen, []);
    extractPythonImports(tree.rootNode, imports);
  } else {
    walkJsTs(tree.rootNode, filePath, symbols, call_sites, seen, "<module>", []);
    extractTsImports(tree.rootNode, imports, re_exports);
  }

  tree.delete();
  return { path: filePath, language, symbols, call_sites, imports, re_exports };
}

// ---------- Import extractors ----------

function extractTsImports(
  root: Node,
  imports: ImportBinding[],
  re_exports: NonNullable<ParsedFile["re_exports"]>,
): void {
  for (const c of root.namedChildren) {
    if (!c) continue;
    if (c.type === "import_statement") {
      const source = stringLiteralText(c.childForFieldName("source"));
      if (!source) continue;
      const clause = c.namedChildren.find((n) => n?.type === "import_clause");
      if (!clause) {
        // side-effect import; skip
        continue;
      }
      for (const part of clause.namedChildren) {
        if (!part) continue;
        if (part.type === "identifier") {
          imports.push({ local: part.text, source, kind: "default" });
        } else if (part.type === "namespace_import") {
          const id = part.namedChildren.find((n) => n?.type === "identifier");
          if (id) imports.push({ local: id.text, source, kind: "namespace" });
        } else if (part.type === "named_imports") {
          for (const spec of part.namedChildren) {
            if (!spec || spec.type !== "import_specifier") continue;
            const name = spec.childForFieldName("name")?.text;
            const alias = spec.childForFieldName("alias")?.text;
            if (!name) continue;
            imports.push({ local: alias ?? name, source, imported: name, kind: "named" });
          }
        }
      }
    } else if (c.type === "export_statement") {
      const source = stringLiteralText(c.childForFieldName("source"));
      if (!source) continue; // not a re-export
      const named = c.namedChildren.find((n) => n?.type === "export_clause");
      if (named) {
        for (const spec of named.namedChildren) {
          if (!spec || spec.type !== "export_specifier") continue;
          const name = spec.childForFieldName("name")?.text;
          const alias = spec.childForFieldName("alias")?.text;
          if (!name) continue;
          re_exports.push({ local: name, exported: alias ?? name, source });
        }
      } else {
        // `export * from "./x"` — record a wildcard re-export
        re_exports.push({ exported: "*", source });
      }
    }
  }
}

function extractPythonImports(root: Node, imports: ImportBinding[]): void {
  walkPyImports(root, imports);
}

function walkPyImports(node: Node, imports: ImportBinding[]): void {
  const t = node.type;
  if (t === "import_statement") {
    // import a, b as c
    for (const child of node.namedChildren) {
      if (!child) continue;
      if (child.type === "dotted_name") {
        const name = child.text;
        imports.push({ local: name.split(".").pop()!, source: name, kind: "namespace" });
      } else if (child.type === "aliased_import") {
        const name = child.childForFieldName("name")?.text;
        const alias = child.childForFieldName("alias")?.text;
        if (name) imports.push({ local: alias ?? name, source: name, kind: "namespace" });
      }
    }
  } else if (t === "import_from_statement") {
    const moduleNode = node.childForFieldName("module_name");
    const source = moduleNode?.text;
    if (!source) return;
    // children after the source are the imported names
    for (const child of node.namedChildren) {
      if (!child || child === moduleNode) continue;
      if (child.type === "dotted_name" || child.type === "identifier") {
        const name = child.text;
        imports.push({ local: name, source, imported: name, kind: "named" });
      } else if (child.type === "aliased_import") {
        const name = child.childForFieldName("name")?.text;
        const alias = child.childForFieldName("alias")?.text;
        if (name) imports.push({ local: alias ?? name, source, imported: name, kind: "named" });
      } else if (child.type === "wildcard_import") {
        imports.push({ local: "*", source, kind: "namespace" });
      }
    }
  }
  // imports are top-level; no deep recursion needed beyond module body
  if (node.type === "module") {
    for (const child of node.children) {
      if (child) walkPyImports(child, imports);
    }
  }
}

function stringLiteralText(n: Node | null | undefined): string | undefined {
  if (!n) return undefined;
  const raw = n.text;
  if (raw.length >= 2 && (raw.startsWith('"') || raw.startsWith("'") || raw.startsWith("`"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

// ---------- TS/JS walker ----------

function walkJsTs(
  node: Node,
  filePath: string,
  symbols: SymbolRef[],
  call_sites: ParsedFile["call_sites"],
  seen: Set<string>,
  enclosing: string,
  classStack: string[],
): void {
  const t = node.type;
  let nextEnclosing = enclosing;

  // Declarations
  if (t === "function_declaration") {
    const name = node.childForFieldName("name")?.text;
    if (name) {
      pushSymbol(symbols, seen, {
        name,
        qualified_name: name,
        file: filePath,
        line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        kind: "function",
      });
      nextEnclosing = name;
    }
  } else if (t === "class_declaration") {
    const name = node.childForFieldName("name")?.text;
    if (name) {
      pushSymbol(symbols, seen, {
        name,
        qualified_name: name,
        file: filePath,
        line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        kind: "class",
      });
      // Descend with this class on the stack so methods get container.
      for (const c of node.children) {
        if (c) walkJsTs(c, filePath, symbols, call_sites, seen, name, [...classStack, name]);
      }
      return;
    }
  } else if (t === "method_definition") {
    const name = node.childForFieldName("name")?.text;
    if (name) {
      const container = classStack[classStack.length - 1];
      const qualified = container ? `${container}.${name}` : name;
      pushSymbol(symbols, seen, {
        name,
        qualified_name: qualified,
        container,
        file: filePath,
        line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        kind: "method",
      });
      nextEnclosing = qualified;
    }
  } else if (t === "interface_declaration" || t === "type_alias_declaration") {
    const name = node.childForFieldName("name")?.text;
    if (name) {
      pushSymbol(symbols, seen, {
        name,
        qualified_name: name,
        file: filePath,
        line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        kind: "type",
      });
    }
  } else if (t === "lexical_declaration" || t === "variable_declaration") {
    // const foo = (...) => ... / function expr — descend with name as enclosing.
    for (const decl of node.namedChildren) {
      if (!decl || decl.type !== "variable_declarator") continue;
      const nameNode = decl.childForFieldName("name");
      const valueNode = decl.childForFieldName("value");
      if (!nameNode || !valueNode) continue;
      if (valueNode.type === "arrow_function" || valueNode.type === "function_expression") {
        const name = nameNode.text;
        pushSymbol(symbols, seen, {
          name,
          qualified_name: name,
          file: filePath,
          line: node.startPosition.row + 1,
          // Use the function body's end, not the declarator's, so the symbol
          // range covers the actual function (declarator ends at `;`/EOL but
          // the function literal may span many lines below).
          end_line: valueNode.endPosition.row + 1,
          kind: "function",
        });
        walkJsTs(valueNode, filePath, symbols, call_sites, seen, name, classStack);
      } else if (valueNode) {
        walkJsTs(valueNode, filePath, symbols, call_sites, seen, enclosing, classStack);
      }
    }
    return;
  } else if (t === "call_expression") {
    const fn = node.childForFieldName("function");
    if (fn) {
      // Only track bare-identifier calls (`foo()`). Member calls (`x.foo()`)
      // can't be resolved from name alone without type info and produce
      // massive false-positive rates (every `.push()` matching a local
      // `function push()`). Method calls are picked up when the receiver's
      // class is in scope via the dedicated method walker.
      if (fn.type === "identifier") {
        const callee = fn.text;
        if (callee && callee !== enclosing) {
          call_sites.push({
            callee_name: callee,
            line: node.startPosition.row + 1,
            from: enclosing,
          });
        }
      }
    }
  }

  for (const c of node.children) {
    if (c) walkJsTs(c, filePath, symbols, call_sites, seen, nextEnclosing, classStack);
  }
}

// ---------- Python walker ----------

function walkPython(
  node: Node,
  filePath: string,
  symbols: SymbolRef[],
  call_sites: ParsedFile["call_sites"],
  seen: Set<string>,
  classStack: string[],
  enclosing: string = "<module>",
): void {
  const t = node.type;
  let nextEnclosing = enclosing;

  if (t === "function_definition") {
    const name = node.childForFieldName("name")?.text;
    if (name) {
      const container = classStack[classStack.length - 1];
      const qualified = container ? `${container}.${name}` : name;
      pushSymbol(symbols, seen, {
        name,
        qualified_name: qualified,
        container,
        file: filePath,
        line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        kind: container ? "method" : "function",
      });
      nextEnclosing = qualified;
    }
  } else if (t === "class_definition") {
    const name = node.childForFieldName("name")?.text;
    if (name) {
      pushSymbol(symbols, seen, {
        name,
        qualified_name: name,
        file: filePath,
        line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        kind: "class",
      });
      for (const c of node.children) {
        if (c) walkPython(c, filePath, symbols, call_sites, seen, [...classStack, name], name);
      }
      return;
    }
  } else if (t === "call") {
    const fn = node.childForFieldName("function");
    if (fn && fn.type === "identifier") {
      const callee = fn.text;
      if (callee && callee !== enclosing) {
        call_sites.push({
          callee_name: callee,
          line: node.startPosition.row + 1,
          from: enclosing,
        });
      }
    }
    // attribute calls (`self.bar()`, `obj.foo()`) skipped — see TS walker.
  }

  for (const c of node.children) {
    if (c) walkPython(c, filePath, symbols, call_sites, seen, classStack, nextEnclosing);
  }
}

function pushSymbol(
  symbols: SymbolRef[],
  seen: Set<string>,
  s: SymbolRef,
): void {
  const key = `${s.kind}:${s.qualified_name ?? s.name}:${s.line}`;
  if (seen.has(key)) return;
  seen.add(key);
  symbols.push(s);
}
