/**
 * Mirror of the Control Plane contract `contracts/prompt-intelligence.ts`.
 * The UI cannot import from the repository root, so the shapes it renders are
 * copied here with identical names. The UI never builds prompts or analyses
 * anything itself: it only displays what the backend prepared.
 */

export const INTENT_CATEGORIES = [
  "UI_MODIFICATION", "THEME_MODIFICATION", "FEATURE_IMPLEMENTATION", "BUG_FIX", "REFACTOR", "TESTING",
  "CODE_REVIEW", "SECURITY_REVIEW", "DEPLOYMENT", "DOCUMENTATION", "RESEARCH", "DATA_ANALYSIS",
  "PROJECT_MANAGEMENT", "CONFIGURATION", "DESTRUCTIVE_OPERATION", "UNKNOWN",
] as const;
export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

export type RiskLevel = "low" | "medium" | "high";

export const DESTRUCTIVE_KINDS = [
  "file_deletion", "repository_deletion", "project_deletion", "agent_deletion", "workflow_deletion",
  "integration_deletion", "environment_deletion", "configuration_deletion", "secret_deletion",
  "database_destruction", "history_rewrite",
] as const;
export type DestructiveKind = (typeof DESTRUCTIVE_KINDS)[number];

export interface DestructiveFinding { kind: DestructiveKind; matched: string }

export interface AmbiguityIssue {
  code: string;
  message: string;
  severity: "low" | "high";
  appliedDefault?: string;
}

export interface ProjectResolution {
  projectId?: string;
  displayName?: string;
  via: "explicit" | "mention" | "none";
  candidates: string[];
}

export type CapabilityRole = "primary" | "supporting" | "verification";

export interface RequiredCapability { capability: string; role: CapabilityRole; reason: string }

export interface IntentAnalysis {
  language: "nl" | "en" | "unknown";
  category: IntentCategory;
  objective: string;
  project: ProjectResolution;
  target?: string;
  operation?: string;
  scope?: string;
  affectedModule?: string;
  explicitConstraints: string[];
  impliedConstraints: string[];
  expectedOutput: string;
  risk: RiskLevel;
  risks: string[];
  requiredCapabilities: RequiredCapability[];
  ambiguity: AmbiguityIssue[];
  destructive: DestructiveFinding[];
  securityOverrideAttempts: string[];
  keywords: string[];
  analyzer: string;
}

export const CONTEXT_CATEGORIES = [
  "project", "architecture", "ui", "security", "development", "preference", "task", "knowledge",
] as const;
export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

export const CONTEXT_PRECEDENCE = [
  "explicit_user_instruction", "project_security_policy", "project_architecture_rule",
  "approved_project_decision", "current_task_context", "project_documentation", "general_default",
] as const;
export type ContextPrecedence = (typeof CONTEXT_PRECEDENCE)[number];

export const CONTEXT_AUTHORITIES = ["authoritative", "curated", "derived", "advisory"] as const;
export type ContextAuthority = (typeof CONTEXT_AUTHORITIES)[number];

export type ContextSensitivity = "public" | "internal" | "restricted";

export interface ResolvedFragment {
  category: ContextCategory;
  key: string;
  value: string;
  source: string;
  origin: string;
  authority: ContextAuthority;
  precedence: ContextPrecedence;
  sensitivity: ContextSensitivity;
  projectId?: string;
  mandatory?: boolean;
  files?: string[];
  relevance: { score: number; reasons: string[] };
}

export const EXCLUDED_REASONS = [
  "not_relevant", "over_budget", "overridden", "not_cleared_for_audience", "secret_content", "wrong_project",
] as const;
export type ExcludedReason = (typeof EXCLUDED_REASONS)[number];

export interface ExcludedFragment { category: ContextCategory; key: string; source: string; reason: ExcludedReason }

export interface ContextConflict {
  category: ContextCategory;
  key: string;
  winner: { source: string; precedence: ContextPrecedence; value: string };
  overridden: { source: string; precedence: ContextPrecedence; value: string };
}

export interface SourceReport { source: string; status: "ok" | "empty" | "unavailable"; fragments: number; note?: string }

export interface ResolvedContext {
  projectId: string;
  fragments: ResolvedFragment[];
  byCategory: Record<ContextCategory, ResolvedFragment[]>;
  relevantFiles: string[];
  previousDecisions: ResolvedFragment[];
  constraints: string[];
  conflicts: ContextConflict[];
  excluded: ExcludedFragment[];
  sources: SourceReport[];
  missing: ContextCategory[];
  audience: { capabilities: string[]; clearance: ContextSensitivity };
  resolvedAt: string;
}

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
  text: string;
  /** Reusable Prompt entity; not rendered by this UI. */
  entity?: unknown;
}

export const VALIDATION_STATUSES = ["PASS", "WARN", "CLARIFY", "APPROVAL_REQUIRED", "BLOCKED"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export interface PromptValidationCheck {
  key: string;
  title: string;
  outcome: "pass" | "warn" | "fail" | "info";
  detail: string;
}

export interface PromptValidation {
  status: ValidationStatus;
  checks: PromptValidationCheck[];
  reasons: string[];
  approvalRequired: boolean;
  clarifications: string[];
}

export const APPROVAL_STATES = ["not_required", "required", "requested", "approved", "rejected", "expired"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export interface ApprovalTrace { state: ApprovalState; approvalId?: string }

export interface PromptRequestRecord {
  id: string;
  requestId: string;
  projectId: string;
  taskId?: string;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  request: string;
  intent: IntentAnalysis;
  context: ResolvedContext;
  prompt: GeneratedPrompt;
  validation: PromptValidation;
  approval: ApprovalTrace;
  executionState: "not_started";
  contextSources: string[];
  correlationId?: string;
  revision: number;
}

export interface PreparedExecutionRequest {
  requestId: string;
  projectId: string;
  taskId?: string;
  promptVersion: number;
  prompt: string;
  requiredCapabilities: RequiredCapability[];
  validation: ValidationStatus;
  approval: ApprovalTrace;
  executionReady: boolean;
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

export interface PromptRequestView { record: PromptRequestRecord; execution: PreparedExecutionRequest }

export const MAX_REQUEST_LENGTH = 4000;
export const MAX_TASK_ID_LENGTH = 128;
/** Reserved project id for a request whose project could not be identified. */
export const UNRESOLVED_PROJECT = "unresolved";
export const PREPARE_CAPABILITY = "prepare_prompt";
