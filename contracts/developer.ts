/**
 * Developer Agent contracts.
 *
 * Phase 5's Developer Agent is planning/review-oriented: it produces a
 * structured plan and a list of *proposed* changes with rationale and risk —
 * never a real file write, shell command, or repository mutation. Turning a
 * proposal into an actual change is a separate, approval-gated capability for
 * a later phase.
 */
import { requireText, ValidationError } from "./index.js";

export type DeveloperMode = "plan" | "review" | "implement";

export interface DeveloperTaskDraft {
  mode?: DeveloperMode;
  objective: string;
  instructions: string;
  /** Descriptive context hints (e.g. "auth module", prior findings) — plain text, not file access. */
  context?: readonly string[];
  acceptanceCriteria?: readonly string[];
  constraints?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface DeveloperTask {
  mode: DeveloperMode;
  objective: string;
  instructions: string;
  context: readonly string[];
  acceptanceCriteria: readonly string[];
  constraints: readonly string[];
  metadata: Record<string, unknown>;
}

export type ChangeRiskLevel = "low" | "medium" | "high";

export interface ProposedChange {
  description: string;
  rationale: string;
  riskLevel: ChangeRiskLevel;
}

export type DeveloperRecommendation =
  "ready_for_qa" | "needs_clarification" | "blocked";

export interface DeveloperResult {
  taskId: string;
  agentId: string;
  mode: DeveloperMode;
  summary: string;
  plan: readonly string[];
  /** Proposals only — never an applied change. */
  proposedChanges: readonly ProposedChange[];
  risks: readonly string[];
  openQuestions: readonly string[];
  recommendation: DeveloperRecommendation;
  createdAt: string;
  metadata: Record<string, unknown>;
}

const MODES: readonly DeveloperMode[] = ["plan", "review", "implement"];
const RISK_LEVELS: readonly ChangeRiskLevel[] = ["low", "medium", "high"];
const RECOMMENDATIONS: readonly DeveloperRecommendation[] = [
  "ready_for_qa",
  "needs_clarification",
  "blocked",
];

export function validateDeveloperTask(raw: unknown): DeveloperTask {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("developer task must be an object");
  }
  const draft = raw as DeveloperTaskDraft;
  requireText(draft.objective, "developerTask.objective");
  requireText(draft.instructions, "developerTask.instructions");
  const mode = draft.mode ?? "plan";
  if (!MODES.includes(mode)) {
    throw new ValidationError(
      `developerTask.mode must be one of ${MODES.join(", ")}`,
    );
  }
  return {
    mode,
    objective: draft.objective,
    instructions: draft.instructions,
    context: [...(draft.context ?? [])],
    acceptanceCriteria: [...(draft.acceptanceCriteria ?? [])],
    constraints: [...(draft.constraints ?? [])],
    metadata: { ...(draft.metadata ?? {}) },
  };
}

export function validateDeveloperResult(
  raw: unknown,
): asserts raw is DeveloperResult {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("developer result must be an object");
  }
  const result = raw as DeveloperResult;
  requireText(result.taskId, "result.taskId");
  requireText(result.agentId, "result.agentId");
  requireText(result.summary, "result.summary");
  requireText(result.createdAt, "result.createdAt");
  if (!MODES.includes(result.mode)) {
    throw new ValidationError(`result.mode must be one of ${MODES.join(", ")}`);
  }
  if (!RECOMMENDATIONS.includes(result.recommendation)) {
    throw new ValidationError(
      `result.recommendation must be one of ${RECOMMENDATIONS.join(", ")}`,
    );
  }
  for (const key of [
    "plan",
    "risks",
    "openQuestions",
    "proposedChanges",
  ] as const) {
    if (!Array.isArray(result[key])) {
      throw new ValidationError(`result.${key} must be an array`);
    }
  }
  result.proposedChanges.forEach((change, index) => {
    requireText(
      change.description,
      `result.proposedChanges[${index}].description`,
    );
    requireText(change.rationale, `result.proposedChanges[${index}].rationale`);
    if (!RISK_LEVELS.includes(change.riskLevel)) {
      throw new ValidationError(
        `result.proposedChanges[${index}].riskLevel must be one of ${RISK_LEVELS.join(", ")}`,
      );
    }
  });
}
