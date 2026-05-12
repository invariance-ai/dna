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
import { registerInstall } from "./commands/install.js";
import { registerPrepare } from "./commands/prepare.js";
import { registerLearn } from "./commands/learn.js";
import { registerNotes } from "./commands/notes.js";
import { registerLearnTodos } from "./commands/learn-todos.js";
import { registerDecide } from "./commands/decide.js";
import { registerDecisions } from "./commands/decisions.js";
import { registerSuggest } from "./commands/suggest.js";
import { registerPostmortem } from "./commands/postmortem.js";
import { registerPromote } from "./commands/promote.js";
import { registerAttach } from "./commands/attach.js";
import { registerPrIntent } from "./commands/pr-intent.js";
import { registerContextFromPrompt } from "./commands/context-from-prompt.js";
import { registerRecordFailure } from "./commands/record-failure.js";
import { registerWizard } from "./commands/wizard.js";
import { registerPrefer } from "./commands/prefer.js";
import { registerPreferences } from "./commands/preferences.js";
import { registerCapturePreference } from "./commands/capture-preference.js";
import { registerFeature } from "./commands/feature.js";
import { registerValidate } from "./commands/validate.js";
import { registerAsk } from "./commands/ask.js";
import { registerQuestions } from "./commands/questions.js";
import { registerSession } from "./commands/session.js";
import { registerWhy } from "./commands/why.js";
import { registerStale } from "./commands/stale.js";
import { registerContributors } from "./commands/contributors.js";
import { registerConflicts } from "./commands/conflicts.js";
import { registerAssume } from "./commands/assume.js";
import { registerHealth } from "./commands/health.js";
import { registerLessons } from "./commands/lessons.js";
import { registerGate } from "./commands/gate.js";
import { registerWaive } from "./commands/waive.js";
import { registerPlan } from "./commands/plan.js";
import { registerTestRecord } from "./commands/test-record.js";
import { registerRuntime } from "./commands/runtime.js";
import { registerAudit } from "./commands/audit.js";
import { registerReviewMemory } from "./commands/review-memory.js";
import { registerVerifyContract } from "./commands/verify-contract.js";
import { registerCheckProposal } from "./commands/check-proposal.js";

export function buildProgram(): Command {
  const program = new Command()
    .name("dna")
    .description("Codebase context for coding agents.")
    .version("0.1.0");

  program.addHelpText(
    "beforeAll",
    [
      "Core 5 (the happy path):",
      "  dna init                              write .dna/config.yml + invariants.yml",
      "  dna install <claude|codex|cursor>     wire agent hooks + CLAUDE.md / AGENTS.md / .cursor/",
      "  dna index                             build the symbol graph",
      "  dna prepare <symbol> --intent <...>   decision-ready brief before edits",
      "  dna learn <symbol> --lesson <...>     record what an edit taught you",
      "",
      "Everything else (44 commands) is the full surface for power users and automation.",
      "See https://github.com/invariance-ai/dna#cli for the grouped reference.",
      "",
    ].join("\n"),
  );

  registerAll(program);
  return program;
}

function registerAll(program: Command): void {
  registerInit(program);
registerWizard(program);
registerInstall(program);
registerPrefer(program);
registerPreferences(program);
registerCapturePreference(program);
registerFeature(program);
registerIndex(program);
registerPrepare(program);
registerContext(program);
registerLearn(program);
registerNotes(program);
registerLearnTodos(program);
registerDecide(program);
registerDecisions(program);
registerSuggest(program);
registerPostmortem(program);
registerPromote(program);
registerAttach(program);
registerPrIntent(program);
registerImpact(program);
registerTests(program);
registerInvariants(program);
registerFind(program);
registerTrace(program);
registerServe(program);
registerBench(program);
registerContextFromPrompt(program);
registerRecordFailure(program);
registerValidate(program);
registerAsk(program);
registerQuestions(program);
registerSession(program);
registerWhy(program);
registerStale(program);
registerContributors(program);
registerConflicts(program);
registerAssume(program);
registerHealth(program);
registerLessons(program);
registerGate(program);
registerWaive(program);
registerPlan(program);
registerTestRecord(program);
registerRuntime(program);
registerAudit(program);
registerReviewMemory(program);
  registerVerifyContract(program);
  registerCheckProposal(program);
}

const isMain = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const url = new URL(`file://${entry}`).href;
    return import.meta.url === url;
  } catch {
    return false;
  }
})();

if (isMain) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}
