/**
 * QA Agent contracts.
 *
 * The structural validator itself enforces "QA must not automatically approve
 * its own work": `validateQAResult` rejects a `"pass"` verdict unless there is
 * at least one finding and every finding is satisfied. A model that asserts
 * `"pass"` without evidence produces an invalid result, not a passing one.
 */
import { requireText, ValidationError } from "./index.js";

export interface QAArtifact {
  id: string;
  description: string;
  /** The content to inspect, given directly — QA does not fetch anything itself. */
  content?: string;
}

export interface QATaskDraft {
  objective: string;
  acceptanceCriteria?: readonly string[];
  artifacts?: readonly QAArtifact[];
  constraints?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface QATask {
  objective: string;
  acceptanceCriteria: readonly string[];
  artifacts: readonly QAArtifact[];
  constraints: readonly string[];
  metadata: Record<string, unknown>;
}

export type QAVerdict = "pass" | "fail" | "blocked";

export interface QAFinding {
  criterion: string;
  satisfied: boolean;
  evidence: string;
}

export type DefectSeverity = "low" | "medium" | "high" | "critical";

export interface QADefect {
  id: string;
  severity: DefectSeverity;
  description: string;
  remediation: string;
}

export interface QAResult {
  taskId: string;
  agentId: string;
  verdict: QAVerdict;
  findings: readonly QAFinding[];
  defects: readonly QADefect[];
  recommendation: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

const VERDICTS: readonly QAVerdict[] = ["pass", "fail", "blocked"];
const SEVERITIES: readonly DefectSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

export function validateQATask(raw: unknown): QATask {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("qa task must be an object");
  }
  const draft = raw as QATaskDraft;
  requireText(draft.objective, "qaTask.objective");
  const acceptanceCriteria = [...(draft.acceptanceCriteria ?? [])];
  if (acceptanceCriteria.length === 0) {
    throw new ValidationError(
      "qaTask.acceptanceCriteria must not be empty — QA needs something to check",
    );
  }
  return {
    objective: draft.objective,
    acceptanceCriteria,
    artifacts: (draft.artifacts ?? []).map((a) => ({ ...a })),
    constraints: [...(draft.constraints ?? [])],
    metadata: { ...(draft.metadata ?? {}) },
  };
}

export function validateQAResult(raw: unknown): asserts raw is QAResult {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("qa result must be an object");
  }
  const result = raw as QAResult;
  requireText(result.taskId, "result.taskId");
  requireText(result.agentId, "result.agentId");
  requireText(result.recommendation, "result.recommendation");
  requireText(result.createdAt, "result.createdAt");
  if (!VERDICTS.includes(result.verdict)) {
    throw new ValidationError(
      `result.verdict must be one of ${VERDICTS.join(", ")}`,
    );
  }
  if (!Array.isArray(result.findings)) {
    throw new ValidationError("result.findings must be an array");
  }
  if (!Array.isArray(result.defects)) {
    throw new ValidationError("result.defects must be an array");
  }
  result.findings.forEach((finding, index) => {
    requireText(finding.criterion, `result.findings[${index}].criterion`);
    requireText(finding.evidence, `result.findings[${index}].evidence`);
    if (typeof finding.satisfied !== "boolean") {
      throw new ValidationError(
        `result.findings[${index}].satisfied must be a boolean`,
      );
    }
  });
  result.defects.forEach((defect, index) => {
    requireText(defect.id, `result.defects[${index}].id`);
    requireText(defect.description, `result.defects[${index}].description`);
    requireText(defect.remediation, `result.defects[${index}].remediation`);
    if (!SEVERITIES.includes(defect.severity)) {
      throw new ValidationError(
        `result.defects[${index}].severity must be one of ${SEVERITIES.join(", ")}`,
      );
    }
  });

  // Structural guarantee: QA cannot self-approve without evidence.
  if (result.verdict === "pass") {
    if (result.findings.length === 0) {
      throw new ValidationError(
        'result.verdict "pass" requires at least one finding as evidence',
      );
    }
    if (!result.findings.every((f) => f.satisfied)) {
      throw new ValidationError(
        'result.verdict "pass" requires every finding to be satisfied',
      );
    }
  }
}
