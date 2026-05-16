import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseFile } from "./parser.js";

describe("parser (tree-sitter)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "dna-parser-"));
    await mkdir(dir, { recursive: true });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("extracts TS classes, methods, function decls, and arrow fns", async () => {
    const file = path.join(dir, "a.ts");
    await writeFile(file, `
export class Foo {
  bar() { return baz(); }
  async qux() { return this.bar(); }
}
function baz() { return 1; }
export const arrow = () => baz();
interface Iface { x: number }
type Alias = string;
`);
    const parsed = await parseFile(file);
    const names = parsed.symbols.map((s) => `${s.kind}:${s.qualified_name}`).sort();
    expect(names).toContain("class:Foo");
    expect(names).toContain("method:Foo.bar");
    expect(names).toContain("method:Foo.qux");
    expect(names).toContain("function:baz");
    expect(names).toContain("function:arrow");
    expect(names).toContain("type:Iface");
    expect(names).toContain("type:Alias");

    const calls = parsed.call_sites.map((c) => `${c.from}->${c.callee_name}`).sort();
    expect(calls).toContain("Foo.bar->baz");
    expect(calls).toContain("arrow->baz");
  });

  it("extracts Python classes, methods, functions, and call sites", async () => {
    const file = path.join(dir, "a.py");
    await writeFile(file, `
class Foo:
    def bar(self):
        return baz()
    def qux(self):
        return self.bar()

def baz():
    return 1
`);
    const parsed = await parseFile(file);
    const names = parsed.symbols.map((s) => `${s.kind}:${s.qualified_name}`).sort();
    expect(names).toContain("class:Foo");
    expect(names).toContain("method:Foo.bar");
    expect(names).toContain("method:Foo.qux");
    expect(names).toContain("function:baz");

    const calls = parsed.call_sites.map((c) => `${c.from}->${c.callee_name}`).sort();
    expect(calls).toContain("Foo.bar->baz");
    // self.bar() is an attribute call — intentionally skipped (see parser_ts).
  });

  it("falls back to regex for unsupported extensions (.go)", async () => {
    const file = path.join(dir, "a.go");
    await writeFile(file, `
package main
func Hello() string { return "hi" }
type T struct {}
`);
    const parsed = await parseFile(file);
    const names = parsed.symbols.map((s) => `${s.kind}:${s.name}`);
    expect(names).toContain("function:Hello");
    expect(names).toContain("type:T");
  });
});
