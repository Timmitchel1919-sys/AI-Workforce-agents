/**
 * UI mirror of the Control Plane execution-plan contracts
 * (contracts/planning.ts, contracts/control.ts). The UI never derives a plan
 * status, never approves locally and never executes: it displays what the
 * backend planned and sends authorized commands back to the Control Plane.
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

export type ApprovalState = "not_requested" | "requested" | "approved" | "rejected" | "expired";

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

export interface EnvironmentCandidate {
  instanceId: string;
  hostId: string;
  descriptorId: string;
  environmentType: string;
  trustLevel: string;
  eligible: boolean;
  reasonCodes: readonly string[];
  matchedCapabilities: readonly string[];
  missingCapabilities: readonly string[];
  missingToolchains: readonly string[];
}

export interface PlannedEnvironment {
  id: string;
  componentIds: readonly string[];
  requirement: {
    environmentType?: string;
    requiredCapabilities?: readonly string[];
    toolchains?: readonly ToolchainRequirement[];
    os?: { os?: string; architecture?: string };
  };
  descriptorSupport: "supported" | "unsupported";
  status: "satisfied" | "missing";
  match: {
    outcome: string;
    selectedInstanceId?: string;
    supportingDescriptorId?: string;
    candidates: readonly EnvironmentCandidate[];
  };
}

export interface AgentRequirement {
  id: string;
  purpose: "build" | "test" | "security_review";
  componentIds: readonly string[];
  requiredCapabilities: readonly string[];
  modelCapabilities: readonly string[];
}

export interface AgentCandidate {
  agentId: string;
  qualifies: boolean;
  matchedCapabilities: readonly string[];
  missingCapabilities: readonly string[];
  reasonCodes: readonly string[];
}

export interface PlanAgentAssignment {
  requirementId: string;
  agentId?: string;
  requiredCapabilities: readonly string[];
  matchedCapabilities: readonly string[];
  qualification: "qualified" | "none_qualified";
  candidates: readonly AgentCandidate[];
}

export interface ModelRequirement {
  id: string;
  agentRequirementId: string;
  capabilities: readonly string[];
  agentId?: string;
  eligibleProfileIds: readonly string[];
  missingCapabilities: readonly string[];
  status: "satisfied" | "missing" | "not_evaluated";
}

export interface DependencyRequirement {
  id: string;
  kind: "toolchain" | "toolchain_component";
  toolchainKind: string;
  name: string;
  minimum?: VersionInfo;
  requiredBy: readonly string[];
  dependsOn: readonly string[];
}

export interface ExecutionBlocker {
  code: BlockerCode;
  subjectType: "environment" | "agent" | "model" | "dependency" | "technology" | "approval";
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
  analysis: {
    technologies: readonly {
      componentId: string;
      technologyId: string;
      toolchains: readonly ToolchainRequirement[];
      os?: { os?: string };
      capabilities: readonly string[];
    }[];
    unsupportedTechnologies: readonly { componentId: string; technologyId: string; reason: string }[];
  };
  architecture: {
    style: "single_platform" | "multi_platform";
    layers: readonly string[];
    platforms: readonly string[];
    components: readonly { componentId: string; kind: string; platforms: readonly string[] }[];
  };
  environments: readonly PlannedEnvironment[];
  agentRequirements: readonly AgentRequirement[];
  agents: readonly PlanAgentAssignment[];
  models: readonly ModelRequirement[];
  dependencies: {
    items: readonly DependencyRequirement[];
    order: readonly string[];
    conflicts: readonly { dependencyId: string; reason: string }[];
  };
  build: readonly {
    id: string;
    componentId: string;
    status: "planned";
    environmentRequirementId: string;
    dependencyIds: readonly string[];
    expectedArtifact: { kind: string; name: string };
    validation: readonly string[];
  }[];
  tests: readonly { id: string; componentId: string; type: string; status: "planned"; environmentRequirementId: string }[];
  security: readonly { id: string; check: string; status: "planned"; componentIds: readonly string[] }[];
  deployment: readonly {
    id: string;
    componentId: string;
    targetType: string;
    stage: string;
    status: "planned";
    requiredArtifact: { kind: string; name: string };
    preDeploymentGates: readonly string[];
    rollbackRequired: boolean;
    credentialRef?: { kind: string };
  }[];
  approvalRequirements: readonly { id: string; reason: string; subjectIds: readonly string[] }[];
  approval: { approvalId?: string; state: ApprovalState };
  blockers: readonly ExecutionBlocker[];
  supersedes?: string;
  supersededBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  execution: { available: false; reason: string };
}

export interface ExecutionPlanSummary {
  id: string;
  planId: string;
  version: number;
  status: PlanStatus;
  current: boolean;
  title: string;
  blockerCodes: readonly string[];
  approvalState: ApprovalState;
  createdAt: string;
  updatedAt: string;
  supersededBy?: string;
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

/** `GET /api/projects/:id` (contracts/control.ts `ProjectView`). */
export interface ProjectDetail extends ProjectSummary {
  adapterStatus: string;
  capabilities: readonly { operation: string; description: string; action: string }[];
  connectedAgents: readonly string[];
  activeWorkflows: number;
  /** Optional, operator-declared reference (https, credential-free). Absent unless declared. */
  repository?: { url: string; defaultBranch: string };
}

export interface TechnologyEntry {
  id: string;
  label: string;
  componentKinds: readonly string[];
  platforms: readonly string[];
}

/** The planning request the create form sends (validated server-side). */
export interface PlanningRequestInput {
  projectId: string;
  title: string;
  summary?: string;
  components: readonly { id: string; kind: string; platforms: readonly string[]; technologies: readonly string[] }[];
  deployments?: readonly { componentId: string; targetType: string; stage: string }[];
}

/** 401 / 403 / 404 / 409 / 5xx are kept apart — a 403 is never "empty". */
export type PlanClientErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"
  | "DEGRADED"
  | "NETWORK";
