/**
 * Ports (Layer 4). Each service the orchestrator depends on is a narrow
 * interface, so Context Engine, Planner, Router, Model Router, Runtime,
 * Verification, Approval and Audit stay decoupled and independently testable.
 */
import type {
  FailureClass,
  ModelAssignment,
  OrchTask,
  TaskResult,
} from "../../contracts/execution-orchestration.js";
import type { Agent } from "../../contracts/index.js";
import type { ModelNeed } from "./policies.js";

/** What a runtime receives: only the context the task needs (least context). */
export interface TaskExecutionContext {
  runId: string;
  projectId: string;
  objective: string;
  constraints: readonly string[];
  acceptanceCriteria: readonly string[];
  relevantFiles: readonly string[];
  prompt: string;
  /** Direct upstream results only — summaries, never raw secrets. */
  upstream: readonly { taskId: string; title: string; summary: string }[];
  permittedTools: readonly string[];
  model?: ModelAssignment;
  agentId: string;
}

export type RuntimeOutcome =
  | {
      kind: "success";
      summary: string;
      evidence: string[];
      checks?: { name: string; passed: boolean }[];
      verdict?: "approved" | "changes_requested";
    }
  | {
      kind: "failure";
      error: string;
      classification?: FailureClass;
      tool?: string;
    };

/** Executes ONE task with ONE agent. Local/cloud/Docker/IDE runners implement this. */
export interface TaskRuntimePort {
  readonly id: string;
  execute(
    task: OrchTask,
    context: TaskExecutionContext,
  ): Promise<RuntimeOutcome>;
  /** Stop live work of a cancelled run immediately (optional). */
  cancelRun?(runId: string): void;
}

/** Decides whether a CLAIMED success is VERIFIED. */
export interface VerifierPort {
  verify(
    task: OrchTask,
    claimed: TaskResult,
  ): { verified: boolean; detail: string };
}

export interface ModelRouterPort {
  select(input: {
    projectId: string;
    taskId: string;
    agent: Agent;
    need: ModelNeed;
  }): Promise<ModelAssignment>;
}

export interface CostGate {
  /** Pre-execution budget check (AI Cost Center). */
  preflight(
    projectId: string,
    taskId: string,
  ): Promise<{ allowed: boolean; status: string; detail: string }>;
  /** Actual spend recorded for the task so far, if the ledger priced it. */
  spent?(projectId: string, taskId: string): Promise<number | undefined>;
}

/** Honest default: nothing can execute until a real runtime is configured. */
export class UnavailableTaskRuntime implements TaskRuntimePort {
  readonly id = "unavailable";
  async execute(): Promise<RuntimeOutcome> {
    return {
      kind: "failure",
      error: "no execution runtime is configured",
      classification: "APPROVAL",
    };
  }
}

/**
 * Evidence-based verification: a claimed success is verified only if it
 * carries evidence and every reported check passed; test tasks must report
 * checks; review tasks must carry a verdict.
 */
export class EvidenceVerifier implements VerifierPort {
  verify(
    task: OrchTask,
    claimed: TaskResult,
  ): { verified: boolean; detail: string } {
    if (claimed.claimed !== "success")
      return { verified: false, detail: "no success claimed" };
    if (claimed.evidence.length === 0) {
      return { verified: false, detail: "success claimed without evidence" };
    }
    const failed = claimed.checks.filter((c) => !c.passed);
    if (failed.length > 0) {
      return {
        verified: false,
        detail: `failed checks: ${failed.map((c) => c.name).join(", ")}`,
      };
    }
    if (task.type === "TEST" && claimed.checks.length === 0) {
      return { verified: false, detail: "a test task must report its checks" };
    }
    if (
      (task.type === "REVIEW" || task.type === "SECURITY") &&
      claimed.verdict === undefined
    ) {
      return { verified: false, detail: "a review task must report a verdict" };
    }
    return {
      verified: true,
      detail: `${claimed.evidence.length} evidence item(s), ${claimed.checks.length} check(s) passed`,
    };
  }
}
