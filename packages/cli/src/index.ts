#!/usr/bin/env node
import { Command } from "commander";
import { registerContext } from "./commands/context.js";
import { registerImpact } from "./commands/impact.js";
import { registerTests } from "./commands/tests.js";
import { registerInvariants } from "./commands/invariants.js";
import { registerInit } from "./commands/init.js";
import { registerIndex } from "./commands/index.js";
import { registerFind } from "./commands/find.js";
import { registerTrace } from "./commands/trace.js";
import { registerServe } from "./commands/serve.js";
import { registerBench } from "./commands/bench.js";
import { registerPrepare } from "./commands/prepare.js";
import { registerLearn } from "./commands/learn.js";
import { registerNotes } from "./commands/notes.js";
import { registerLearnTodos } from "./commands/learn-todos.js";

const program = new Command()
  .name("dna")
  .description("Codebase context for coding agents.")
  .version("0.0.1");

registerInit(program);
registerIndex(program);
registerPrepare(program);
registerContext(program);
registerLearn(program);
registerNotes(program);
registerLearnTodos(program);
registerImpact(program);
registerTests(program);
registerInvariants(program);
registerFind(program);
registerTrace(program);
registerServe(program);
registerBench(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
