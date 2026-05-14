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
import { registerDoctor } from "./commands/doctor.js";
import { registerPulse } from "./commands/pulse.js";
import { registerSeed } from "./commands/seed.js";
import { registerVerify } from "./commands/verify.js";
import { registerSync } from "./commands/sync.js";

const program = new Command()
  .name("dna")
  .description("Codebase context for coding agents.")
  .version("0.1.0");

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
registerDoctor(program);
registerPulse(program);
registerSeed(program);
registerVerify(program);
registerSync(program);

// Curate `dna --help`: only README-documented commands are visible by default.
// Experimental/internal commands stay registered (and still run) but are hidden
// from the help listing to keep first-run discoverability tight.
// Surface the full list with `dna --help-all` (commander prints hidden commands then).
const PRIMARY = new Set([
  "init",
  "install",
  "index",
  "prepare",
  "context",
  "find",
  "trace",
  "impact",
  "tests",
  "invariants",
  "learn",
  "notes",
  "learn-todos",
  "decide",
  "decisions",
  "serve",
  "suggest",
  "doctor",
  "pulse",
  "seed",
  "verify",
  "sync",
]);
for (const cmd of program.commands) {
  if (!PRIMARY.has(cmd.name())) {
    (cmd as unknown as { _hidden: boolean })._hidden = true;
  }
}
program.showHelpAfterError("(use `dna --help` to see available commands)");

program.parseAsync(process.argv).catch((err) => {
  const msg = (err && err.message) || String(err);
  // Translate the most common first-run failure: command that needs the index
  // before `dna index` has run. ENOENT on .dna/index/symbols.json bubbles up
  // from readIndex(); the raw stack is not actionable.
  if (
    err &&
    (err.code === "ENOENT" || /ENOENT/.test(msg)) &&
    /\.dna\/(index\/symbols\.json|config\.yml)/.test(msg)
  ) {
    const isConfig = /config\.yml/.test(msg);
    console.error(
      isConfig
        ? "dna is not initialized in this directory. Run `dna init` first."
        : "No symbol index found. Run `dna index` first (or `dna init` if this is a new repo).",
    );
    console.error("Run `dna doctor` to see what else is missing.");
    process.exit(1);
  }
  console.error(msg);
  process.exit(1);
});
