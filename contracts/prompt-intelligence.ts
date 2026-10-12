/**
 * Prompt Intelligence contracts (Phase 3) — Context Engine + Prompt Engineer.
 *
 *   USER INTENT → INTENT ANALYSIS → CONTEXT RESOLUTION → PROMPT ENGINEERING
 *               → PROMPT VALIDATION → EXECUTION-READY REQUEST → (Phase 4) ROUTER
 *
 * This layer establishes intelligence BEFORE execution. It never runs an
 * agent, tool or command. Its output is a typed, validated, traceable
 * `PreparedExecutionRequest` that Phase 4 (Project Manager / Agent Router) consumes.
 *
 * Distinctions encoded here:
 *   PREPARED != APPROVED          a prepared prompt is not permission to run
 *   VISIBLE != AUTHORIZED         context is filtered server-side per audience
 *   RELEVANT != AUTHORITATIVE     every fragment records its source + authority
 *   REQUIRED CAPABILITY != AGENT  capabilities are requirements, never a pick
 *   SECURITY > INSTRUCTION        a user instruction never overrides a policy
 */
import type { Entity } from "./persistence.js";
import type { Prompt } from "./prompt.js";

/* ------------------------------------------------------------------ */
/* Intent                                                             */
/* ------------------------------------------------------------------ */

export const INTENT_CATEGORIES = [
  "UI_MODIFICATION",
  "THEME_MODIFICATION",
  "FEATURE_IMPLEMENTATION",
  "BUG_FIX",
  "REFACTOR",
  "TESTING",
  "CODE_REVIEW",
  "SECURITY_REVIEW",
  "DEPLOYMENT",
  "DOCUMENTATION",
  "RESEARCH",
  "DATA_ANALYSIS",
  "PROJECT_MANAGEMENT",
  "CONFIGURATION",
  "DESTRUCTIVE_OPERATION",
  "UNKNOWN",
] as const;
export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

export type RiskLevel = "low" | "medium" | "high";

export const DESTRUCTIVE_KINDS = [
  "file_deletion",
  "repository_deletion",
  "project_deletion",
  "agent_deletion",
  "workflow_deletion",
  "integration_deletion",
  "environment_deletion",
  "configuration_deletion",
  "secret_deletion",
  "database_destruction",
  "history_rewrite",
] as const;
export type DestructiveKind = (typeof DESTRUCTIVE_KINDS)[number];

export interface DestructiveFinding {
  kind: DestructiveKind;
  /** The request fragment that triggered the finding (bounded, secret-free). */
  matched: string;
}

export interface AmbiguityIssue {
  code: string;
  message: string;
  /** `high` ambiguity is never silently defaulted; it needs a human. */
  severity: "low" | "high";
  /** For low severity: the safe default that was applied. */
  appliedDefault?: string;
}

export interface ProjectResolution {
  /** Resolved project, or undefined when none could be identified. */
  projectId?: string;
  displayName?: string;
  via: "explicit" | "mention" | "none";
  /** Candidate project ids when the request matched more than one. */
  candidates: string[];
}

export type CapabilityRole = "primary" | "supporting" | "verification";

export interface RequiredCapability {
  /** A canonical id from the capability taxonomy (contracts/capabilities.ts). */
  capability: string;
  role: CapabilityRole;
  reason: string;
}

export interface IntentAnalysis {
  language: "nl" | "en" | "unknown";
  category: IntentCategory;
  objective: string;
  project: ProjectResolution;
  /** What is being changed (e.g. "login card"), if identifiable. */
  target?: string;
  /** The requested operation in plain words. */
  operation?: string;
  /** The aspect of the target being changed (e.g. "vertical dimensions"). */
  scope?: string;
  affectedModule?: string;
  /** Constraints the user stated explicitly — always preserved. */
  explicitConstraints: string[];
  /** Constraints inferred from the intent (never contradict explicit ones). */
  impliedConstraints: string[];
  expectedOutput: string;
  risk: RiskLevel;
  risks: string[];
  requiredCapabilities: RequiredCapability[];
  ambiguity: AmbiguityIssue[];
  destructive: DestructiveFinding[];
  /** Explicit instructions that try to weaken a security requirement. */
  securityOverrideAttempts: string[];
  /** Words the analyzer used for relevance matching. */
  keywords: string[];
  /** `rules` today; a model-assisted analyzer can plug in behind the port. */
  analyzer: string;
}

/* ------------------------------------------------------------------ */
/* Context                                                            */
/* ------------------------------------------------------------------ */

export const CONTEXT_CATEGORIES = [
  "project",
  "architecture",
  "ui",
  "security",
  "development",
  "preference",
  "task",
  "knowledge",
] as const;
export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

/**
 * Where a fragment ranks when two fragments disagree. Lower number wins.
 * Security restrictions are rank 2 and nothing below rank 1 (an explicit user
 * instruction) can override them — and an explicit instruction that conflicts
 * with a security fragment is recorded as a conflict, not obeyed.
 */
export const CONTEXT_PRECEDENCE = [
  "explicit_user_instruction",
  "project_security_policy",
  "project_architecture_rule",
  "approved_project_decision",
  "current_task_context",
  "project_documentation",
  "general_default",
] as const;
export type ContextPrecedence = (typeof CONTEXT_PRECEDENCE)[number];

export function precedenceRank(precedence: ContextPrecedence): number {
  return CONTEXT_PRECEDENCE.indexOf(precedence) + 1;
}

export type ContextAuthority =
  /** Configured by the Control Plane / platform policy. */
  | "authoritative"
  /** Operator-curated knowledge (approved). */
  | "curated"
  /** Derived from other state (history, discovery). */
  | "derived"
  /** Free-form notes; useful but not binding. */
  | "advisory";

/** `restricted` is only exposed to an audience cleared for it. */
export type ContextSensitivity = "public" | "internal" | "restricted";

export interface ContextFragment {
  category: ContextCategory;
  /** Stable key inside the category (used for conflict detection). */
  key: string;
  /** Plain, bounded text. Never a credential. */
  value: string;
  /** Source id (`ContextSource.id`) that supplied it. */
  source: string;
  /** Human-readable origin (document title, registry, policy name). */
  origin: string;
  authority: ContextAuthority;
  precedence: ContextPrecedence;
  sensitivity: ContextSensitivity;
  /** The project this fragment belongs to; undefined = platform-wide. */
  projectId?: string;
  /** Mandatory fragments (security) are included regardless of relevance. */
  mandatory?: boolean;
  /** Files this fragment points at (relative paths). */
  files?: string[];
}

export interface ResolvedFragment extends ContextFragment {
  /** WHY it was selected. */
  relevance: { score: number; reasons: string[] };
}

export interface ExcludedFragment {
  category: ContextCategory;
  key: string;
  source: string;
  reason:
    | "not_relevant"
    | "over_budget"
    | "overridden"
    | "not_cleared_for_audience"
    | "secret_content"
    | "wrong_project";
}

export interface ContextConflict {
  category: ContextCategory;
  key: string;
  winner: { source: string; precedence: ContextPrecedence; value: string };
  overridden: { source: string; precedence: ContextPrecedence; value: string };
}

export interface SourceReport {
  source: string;
  status: "ok" | "empty" | "unavailable";
  fragments: number;
  note?: string;
}

export interface ResolvedContext {
  projectId: string;
  fragments: ResolvedFragment[];
  /** Fragments grouped for consumers; mirrors `fragments`. */
  byCategory: Record<ContextCategory, ResolvedFragment[]>;
  relevantFiles: string[];
  previousDecisions: ResolvedFragment[];
  constraints: string[];
  conflicts: ContextConflict[];
  excluded: ExcludedFragment[];
  sources: SourceReport[];
  /** Context that was needed for this intent but no source supplied. */
  missing: ContextCategory[];
  audience: ContextAudience;
  resolvedAt: string;
}

/** Who the context is being assembled for (server-derived, never client-supplied). */
export interface ContextAudience {
  /** Capabilities the eventual agent must offer. */
  capabilities: string[];
  /** `restricted` fragments are exposed only to a `restricted`-cleared audience. */
  clearance: ContextSensitivity;
}

export interface ContextRequest {
  projectId: string;
  taskId?: string;
  intent: IntentAnalysis;
  audience: ContextAudience;
}

/**
 * An extension point: anything that can contribute context. GitHub, the
 * design system, external research, connected apps … plug in here without
 * touching the engine. A source MUST scope its output to `request.projectId`.
 */
export interface ContextSource {
  readonly id: string;
  readonly categories: readonly ContextCategory[];
  fetch(
    request: ContextRequest,
  ): Promise<readonly ContextFragment[]> | readonly ContextFragment[];
}

/** Resolves repository file paths that may be relevant to the request. */
export interface RelevantFileResolver {
  resolve(
    projectId: string,
    keywords: readonly string[],
  ): Promise<
    { ok: true; files: string[]; note?: string } | { ok: false; note: string }
  >;
}

/* ------------------------------------------------------------------ */
/* Prompt                                                             */
/* ------------------------------------------------------------------ */

/** The 17 conceptual sections; a section with nothing to say is omitted. */
export interface PromptSections {
  role: string;
  project: string;
  objective: string;
  context: string[];
  scope: string[];
  requirements: string[];
  nonFunctional: string[];
  technicalConstraints: string[];
  uiux: string[];
  security: string[];
  relevantFiles: string[];
  dependencies: string[];
  requiredCapability: string[];
  implementationSteps: string[];
  validation: string[];
  acceptanceCriteria: string[];
  deployment: string[];
}

export interface GeneratedPrompt {
  version: number;
  sections: PromptSections;
  /** Rendered, agent-ready text. Contains no credential. */
  text: string;
  /** The reusable `Prompt` entity (contracts/prompt.ts) for this prompt. */
  entity: Prompt;
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

export const VALIDATION_STATUSES = [
  "PASS",
  "WARN",
  "CLARIFY",
  "APPROVAL_REQUIRED",
  "BLOCKED",
] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export interface PromptValidationCheck {
  key: string;
  title: string;
  /** `fail` is blocking; `warn` is surfaced; `info` is neutral. */
  outcome: "pass" | "warn" | "fail" | "info";
  detail: string;
}

export interface PromptValidation {
  status: ValidationStatus;
  checks: PromptValidationCheck[];
  /** Why a human is needed (empty on PASS/WARN). */
  reasons: string[];
  /** Approval is mandatory (destructive / protected operation). */
  approvalRequired: boolean;
  /** Questions to put to the user when status is CLARIFY. */
  clarifications: string[];
}

/* ------------------------------------------------------------------ */
/* Traceability + execution-ready request                             */
/* ------------------------------------------------------------------ */

export type ApprovalState =
  | "not_required"
  | "required"
  | "requested"
  | "approved"
  | "rejected"
  | "expired";

export type RequestExecutionState = "not_started";

export interface ApprovalTrace {
  state: ApprovalState;
  approvalId?: string;
}

/** Durable, secret-free trace of one prepared request (`prompt_requests`). */
export interface PromptRequestRecord extends Entity {
  /** The request id (== `id`). */
  requestId: string;
  projectId: string;
  taskId?: string;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  /** The user's request text (secret-scanned before storage). */
  request: string;
  intent: IntentAnalysis;
  context: ResolvedContext;
  prompt: GeneratedPrompt;
  validation: PromptValidation;
  approval: ApprovalTrace;
  /** Phase 4 advances this; Phase 3 never executes anything. */
  executionState: RequestExecutionState;
  /** Which context sources contributed (ids only). */
  contextSources: string[];
  correlationId?: string;
  revision: number;
}

/** What Phase 4 receives: validated, capability-bearing, approval-aware. */
export interface PreparedExecutionRequest {
  requestId: string;
  projectId: string;
  taskId?: string;
  promptVersion: number;
  prompt: string;
  requiredCapabilities: RequiredCapability[];
  validation: ValidationStatus;
  approval: ApprovalTrace;
  /** True only when validated AND any mandatory approval is granted. */
  executionReady: boolean;
  /** Why it is not ready (empty when ready). */
  blockedBy: string[];
}

export interface PromptRequestSummary {
  requestId: string;
  projectId: string;
  taskId?: string;
  requestedBy: string;
  createdAt: string;
  intent: IntentCategory;
  validation: ValidationStatus;
  approval: ApprovalState;
  executionReady: boolean;
  requiredCapabilities: string[];
  request: string;
}

/** `GET /api/prompt-intelligence` view of one request (safe for the UI). */
export interface PromptRequestView {
  record: PromptRequestRecord;
  execution: PreparedExecutionRequest;
}

export const PROMPT_COMMANDS = [
  "prompt_prepare",
  "prompt_request_approval",
] as const;
export type PromptCommand = (typeof PROMPT_COMMANDS)[number];

/** Reserved project id for a request whose project could not be identified. */
export const UNRESOLVED_PROJECT = "unresolved";

/** Bounds on untrusted input. */
export const MAX_REQUEST_LENGTH = 4000;
