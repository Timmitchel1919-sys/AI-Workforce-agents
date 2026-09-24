/**
 * UI mirror of the Control Plane execution-plan views (contracts/control.ts,
 * contracts/planning.ts). Read-only: the UI never creates, changes, approves
 * or executes a plan — it only displays what the backend derived.
 */

export type PlanStatus =
  | "draft"
  | "blocked"
  | "ready"
  | "awaiting_approval"
  | "approved"
  | "superseded";

export type BlockerCode =
  | "MISSING_ENVIRONMENT"
  | "MISSING_CAPABILITY"
  | "MISSING_TOOLCHAIN"
  | "UNSUPPORTED_TECHNOLOGY"
  | "NO_QUALIFIED_AGENT"
  | "DEPENDENCY_CONFLICT"
  | "MISSING_MODEL_CAPABILITY"
  | "APPROVAL_REJECTED";

export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
}

export interface ToolchainRequirement {
  kind: string;
  minimum?: VersionInfo;
  components?: readonly { name: string; minimum?: VersionInfo }[];
}

export interface PlannedEnvironment {
  id: string;
  componentIds: readonly string[];
  requirement: {
    requiredCapabilities?: readonly string[];
    toolchains?: readonly ToolchainRequirement[];
    os?: { os?: string; architecture?: string };
  };
  descriptorSupport: "supported" | "unsupported";
  status: "satisfied" | "missing";
  match: {
    outcome: string;
    selectedInstanceId?: string;
    candidates: readonly {
      instanceId: string;
      eligible: boolean;
      reasonCodes: readonly string[];
    }[];
  };
}

export interface PlanAgentAssignment {
  requirementId: string;
  agentId?: string;
  requiredCapabilities: readonly string[];
  matchedCapabilities: readonly string[];
  qualification: "qualified" | "none_qualified";
}

export interface PlannedStage {
  id: string;
  status: "planned";
}

export interface ExecutionBlocker {
  code: BlockerCode;
  subjectType: string;
  subjectId: string;
  reasonCodes: readonly string[];
  missing: readonly string[];
}

export interface ExecutionPlanView {
  id: string;
  planId: string;
  version: number;
  projectId: string;
  status: PlanStatus;
  current: boolean;
  request: { title: string; summary?: string };
  architecture: {
    style: "single_platform" | "multi_platform";
    layers: readonly string[];
    platforms: readonly string[];
  };
  analysis: {
    technologies: readonly { componentId: string; technologyId: string }[];
  };
  environments: readonly PlannedEnvironment[];
  agents: readonly PlanAgentAssignment[];
  dependencies: { order: readonly string[] };
  build: readonly (PlannedStage & {
    componentId: string;
    expectedArtifact: { kind: string; name: string };
  })[];
  tests: readonly (PlannedStage & { componentId: string; type: string })[];
  security: readonly (PlannedStage & { check: string })[];
  deployment: readonly (PlannedStage & {
    componentId: string;
    targetType: string;
    stage: string;
    rollbackRequired: boolean;
  })[];
  approvalRequirements: readonly { id: string; reason: string }[];
  approval: { state: string };
  blockers: readonly ExecutionBlocker[];
  createdAt: string;
  execution: { available: false; reason: string };
}

export interface ExecutionPlanSummary {
  id: string;
  planId: string;
  version: number;
  status: PlanStatus;
  current: boolean;
  title: string;
  createdAt: string;
}

export interface PageResult<T> {
  items: readonly T[];
  total: number;
  nextCursor: string | null;
}

export interface ProjectSummary {
  projectId: string;
  displayName: string;
  status: string;
}

/** 401 and 403 are kept apart: a 403 is never shown as "empty". */
export type PlanClientErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "DEGRADED"
  | "NETWORK";
