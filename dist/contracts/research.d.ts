/**
 * Research Agent contracts — the structured task input and structured result
 * for the first General Agent. Reusable across projects; contains no
 * project-specific logic.
 */
import { type Priority } from "./index.js";
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
/** Validate and normalise a research task. Throws `ValidationError`. */
export declare function validateResearchTask(raw: unknown): ResearchTask;
/** How much epistemic weight a finding carries. */
export type FindingKind = "fact" | "claim" | "assumption" | "inference" | "recommendation";
export type SourceType = "web_page" | "document" | "dataset" | "api" | "internal_note" | "unknown";
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
/** Assert that `raw` is a well-formed {@link ResearchResult}. */
export declare function validateResearchResult(raw: unknown): asserts raw is ResearchResult;
