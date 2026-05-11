import type {
  ContextResult,
  GetContextInput,
  ImpactInput,
  ImpactResult,
} from "@invariance/dna-schemas";

/**
 * Top-level query layer. CLI commands and MCP tool handlers are thin wrappers
 * around these — keep all retrieval/ranking logic here so surfaces never drift.
 */
export async function getContext(_args: GetContextInput): Promise<ContextResult> {
  throw new Error("query.getContext: not implemented");
}

export async function impactOf(_args: ImpactInput): Promise<ImpactResult> {
  throw new Error("query.impactOf: not implemented");
}
