import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Language, type Node } from "web-tree-sitter";
import type { SymbolRef } from "@invariance/dna-schemas";
import type { ParsedFile, ParsedLanguage } from "./parser.js";

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

export async function parseFileTS(filePath: string): Promise<ParsedFile> {
  const ext = path.extname(filePath);
  const grammar = GRAMMAR_BY_EXT[ext];
  if (!grammar) throw new Error(`tree-sitter: unsupported extension ${ext}`);
  const language: ParsedLanguage =
    ext === ".py" ? "python"
    : ext.startsWith(".j") ? "javascript"
    : "typescript";

  await ensureParserInit();
  const lang = await loadLanguage(grammar);
  const parser = new Parser();
  parser.setLanguage(lang);

  const src = await readFile(filePath, "utf8");
  const tree = parser.parse(src);
  if (!tree) {
    parser.delete();
    throw new Error(`tree-sitter: parse returned null for ${filePath}`);
  }

  const symbols: SymbolRef[] = [];
  const call_sites: ParsedFile["call_sites"] = [];
  const seen = new Set<string>();

  if (language === "python") {
    walkPython(tree.rootNode, filePath, symbols, call_sites, seen, []);
  } else {
    walkJsTs(tree.rootNode, filePath, symbols, call_sites, seen, "<module>", []);
  }

  tree.delete();
  parser.delete();
  return { path: filePath, language, symbols, call_sites };
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
      let callee: string | undefined;
      if (fn.type === "identifier") callee = fn.text;
      else if (fn.type === "member_expression") {
        callee = fn.childForFieldName("property")?.text;
      }
      if (callee && callee !== enclosing) {
        call_sites.push({
          callee_name: callee,
          line: node.startPosition.row + 1,
          from: enclosing,
        });
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
        kind: "class",
      });
      for (const c of node.children) {
        if (c) walkPython(c, filePath, symbols, call_sites, seen, [...classStack, name], name);
      }
      return;
    }
  } else if (t === "call") {
    const fn = node.childForFieldName("function");
    if (fn) {
      let callee: string | undefined;
      if (fn.type === "identifier") callee = fn.text;
      else if (fn.type === "attribute") {
        callee = fn.childForFieldName("attribute")?.text;
      }
      if (callee && callee !== enclosing) {
        call_sites.push({
          callee_name: callee,
          line: node.startPosition.row + 1,
          from: enclosing,
        });
      }
    }
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
