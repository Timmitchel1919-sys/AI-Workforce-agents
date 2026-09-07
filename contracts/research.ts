/**
 * Research Agent contracts — the structured task input and structured result
 * for the first General Agent. Reusable across projects; contains no
 * project-specific logic.
 */
import { type Priority, requireText, ValidationError } from "./index.js";

/* ------------------------------------------------------------------ */
/* Task                                                               */
/* ------------------------------------------------------------------ */

export type ResearchOutputFormat = "structured" | "summary" | "brief";

export interface ResearchTask {
  /** Why the research is being done. */
  objective: string;
  /** The single question to answer. */
  question: string;
  /** Optional bound on what to cover / exclude. */
  scope?: string;
  /**
   * A human label for the project context. The *actual* context values are
   * read from the `ContextSystem`, scoped to the task's project — never from
   * this field.
   */
  projectContext?: string;
  constraints: readonly string[];
  /** Shape of the returned result. Default `"structured"`. */
  outputFormat: ResearchOutputFormat;
  /** Target number of verified sources. Default 3. */
  sourcesRequired: number;
  priority?: Priority;
  /** ISO-8601 deadline, informational. */
  deadline?: string;
  metadata: Record<string, unknown>;
}

export interface ResearchTaskDraft {
  objective: string;
  question: string;
  scope?: string;
  projectContext?: string;
  constraints?: readonly string[];
  outputFormat?: ResearchOutputFormat;
  sourcesRequired?: number;
  priority?: Priority;
  deadline?: string;
  metadata?: Record<string, unknown>;
}

const OUTPUT_FORMATS: readonly ResearchOutputFormat[] = [
  "structured",
  "summary",
  "brief",
];

/** Validate and normalise a research task. Throws `ValidationError`. */
export function validateResearchTask(raw: unknown): ResearchTask {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("research task must be an object");
  }
  const draft = raw as ResearchTaskDraft;
  requireText(draft.objective, "research.objective");
  requireText(draft.question, "research.question");

  const outputFormat = draft.outputFormat ?? "structured";
  if (!OUTPUT_FORMATS.includes(outputFormat)) {
    throw new ValidationError(
      `research.outputFormat must be one of ${OUTPUT_FORMATS.join(", ")}`,
    );
  }

  const sourcesRequired = draft.sourcesRequired ?? 3;
  if (!Number.isInteger(sourcesRequired) || sourcesRequired < 1) {
    throw new ValidationError(
      "research.sourcesRequired must be a positive integer",
    );
  }

  if (draft.constraints !== undefined && !Array.isArray(draft.constraints)) {
    throw new ValidationError("research.constraints must be an array");
  }
  if (
    draft.deadline !== undefined &&
    (typeof draft.deadline !== "string" ||
      Number.isNaN(Date.parse(draft.deadline)))
  ) {
    throw new ValidationError("research.deadline must be an ISO-8601 string");
  }

  return {
    objective: draft.objective,
    question: draft.question,
    scope: draft.scope,
    projectContext: draft.projectContext,
    constraints: [...(draft.constraints ?? [])],
    outputFormat,
    sourcesRequired,
    priority: draft.priority,
    deadline: draft.deadline,
    metadata: { ...(draft.metadata ?? {}) },
  };
}

/* ------------------------------------------------------------------ */
/* Result                                                             */
/* ------------------------------------------------------------------ */

/** How much epistemic weight a finding carries. */
export type FindingKind =
  "fact" | "claim" | "assumption" | "inference" | "recommendation";

export type SourceType =
  "web_page" | "document" | "dataset" | "api" | "internal_note" | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ResearchSource {
  id: string;
  title: string;
  /** URL or opaque identifier; empty string when none is available. */
  reference: string;
  sourceType: SourceType;
  retrievedAt: string;
  /** 0..1 — how on-topic this source is for the question. */
  relevance: number;
  /** 0..1 — computed from source type + retrieval outcome, not model wording. */
  reliability: number;
  reliabilityBasis: string;
  /** True only when the source content was actually retrieved. */
  verified: boolean;
}

export interface ResearchFinding {
  statement: string;
  kind: FindingKind;
  supportingSourceIds: readonly string[];
}

export interface ResearchEvidence {
  sourceId: string;
  excerpt: string;
}

export interface ResearchConfidence {
  level: ConfidenceLevel;
  /** 0..1 composite score. */
  score: number;
  /** Human-readable explanation of how the score was derived. */
  basis: string;
}

export interface ResearchResult {
  taskId: string;
  agentId: string;
  question: string;
  executiveSummary: string;
  findings: readonly ResearchFinding[];
  evidence: readonly ResearchEvidence[];
  sources: readonly ResearchSource[];
  assumptions: readonly string[];
  limitations: readonly string[];
  confidence: ResearchConfidence;
  recommendations: readonly string[];
  createdAt: string;
  metadata: Record<string, unknown>;
}

const FINDING_KINDS: readonly FindingKind[] = [
  "fact",
  "claim",
  "assumption",
  "inference",
  "recommendation",
];
const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ["high", "medium", "low"];

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

/** Assert that `raw` is a well-formed {@link ResearchResult}. */
export function validateResearchResult(
  raw: unknown,
): asserts raw is ResearchResult {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("research result must be an object");
  }
  const result = raw as ResearchResult;
  requireText(result.taskId, "result.taskId");
  requireText(result.agentId, "result.agentId");
  requireText(result.question, "result.question");
  requireText(result.executiveSummary, "result.executiveSummary");
  requireText(result.createdAt, "result.createdAt");

  for (const key of [
    "findings",
    "evidence",
    "sources",
    "assumptions",
    "limitations",
    "recommendations",
  ] as const) {
    if (!Array.isArray(result[key])) {
      throw new ValidationError(`result.${key} must be an array`);
    }
  }

  result.sources.forEach((source, index) => {
    requireText(source.id, `result.sources[${index}].id`);
    if (!isUnitInterval(source.relevance)) {
      throw new ValidationError(
        `result.sources[${index}].relevance must be within 0..1`,
      );
    }
    if (!isUnitInterval(source.reliability)) {
      throw new ValidationError(
        `result.sources[${index}].reliability must be within 0..1`,
      );
    }
  });

  const sourceIds = new Set(result.sources.map((s) => s.id));
  result.findings.forEach((finding, index) => {
    requireText(finding.statement, `result.findings[${index}].statement`);
    if (!FINDING_KINDS.includes(finding.kind)) {
      throw new ValidationError(
        `result.findings[${index}].kind must be one of ${FINDING_KINDS.join(", ")}`,
      );
    }
    if (!Array.isArray(finding.supportingSourceIds)) {
      throw new ValidationError(
        `result.findings[${index}].supportingSourceIds must be an array`,
      );
    }
    for (const id of finding.supportingSourceIds) {
      if (!sourceIds.has(id)) {
        throw new ValidationError(
          `result.findings[${index}] references unknown source "${id}"`,
        );
      }
    }
    if (
      (finding.kind === "fact" || finding.kind === "claim") &&
      finding.supportingSourceIds.length === 0
    ) {
      throw new ValidationError(
        `result.findings[${index}] is a ${finding.kind} with no supporting source`,
      );
    }
  });

  if (
    !result.confidence ||
    !CONFIDENCE_LEVELS.includes(result.confidence.level) ||
    !isUnitInterval(result.confidence.score)
  ) {
    throw new ValidationError(
      "result.confidence must have a valid level and a 0..1 score",
    );
  }
}
