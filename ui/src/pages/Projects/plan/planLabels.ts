/**
 * Backend enum value → translation key. The UI never re-derives a status: it
 * only labels the values the Control Plane returned. Unknown values fall back
 * to the raw value, so a new backend value is visible rather than hidden.
 */
import type { MessageKey } from "../../../i18n";
import type { ApprovalState, BlockerCode, PlanStatus } from "../../../features/executionPlans";

export const PLAN_STATUS: Record<PlanStatus, MessageKey> = {
  draft: "plans.statusDraft",
  blocked: "plans.statusBlocked",
  ready: "plans.statusReady",
  awaiting_approval: "plans.statusAwaitingApproval",
  approved: "plans.statusApproved",
  superseded: "plans.statusSuperseded",
};

export const APPROVAL_STATE: Record<ApprovalState, MessageKey> = {
  not_requested: "plans.approvalNotRequested",
  requested: "plans.approvalRequested",
  approved: "plans.approvalApproved",
  rejected: "plans.approvalRejected",
  expired: "plans.approvalExpired",
};

export const BLOCKER: Record<BlockerCode, { label: MessageKey; explain: MessageKey; guide: MessageKey }> = {
  MISSING_ENVIRONMENT: {
    label: "plans.blockerMissingEnvironment",
    explain: "plans.explainMissingEnvironment",
    guide: "plans.guideMissingEnvironment",
  },
  MISSING_CAPABILITY: {
    label: "plans.blockerMissingCapability",
    explain: "plans.explainMissingCapability",
    guide: "plans.guideMissingCapability",
  },
  MISSING_TOOLCHAIN: {
    label: "plans.blockerMissingToolchain",
    explain: "plans.explainMissingToolchain",
    guide: "plans.guideMissingToolchain",
  },
  UNSUPPORTED_TECHNOLOGY: {
    label: "plans.blockerUnsupportedTechnology",
    explain: "plans.explainUnsupportedTechnology",
    guide: "plans.guideUnsupportedTechnology",
  },
  NO_QUALIFIED_AGENT: {
    label: "plans.blockerNoQualifiedAgent",
    explain: "plans.explainNoQualifiedAgent",
    guide: "plans.guideNoQualifiedAgent",
  },
  DEPENDENCY_CONFLICT: {
    label: "plans.blockerDependencyConflict",
    explain: "plans.explainDependencyConflict",
    guide: "plans.guideDependencyConflict",
  },
  MISSING_MODEL_CAPABILITY: {
    label: "plans.blockerMissingModelCapability",
    explain: "plans.explainMissingModelCapability",
    guide: "plans.guideMissingModelCapability",
  },
  APPROVAL_REJECTED: {
    label: "plans.blockerApprovalRejected",
    explain: "plans.explainApprovalRejected",
    guide: "plans.guideApprovalRejected",
  },
};

const REASONS: Record<string, MessageKey> = {
  instance_unavailable: "plans.reasonInstanceUnavailable",
  host_unavailable: "plans.reasonHostUnavailable",
  host_unknown: "plans.reasonHostUnknown",
  descriptor_mismatch: "plans.reasonDescriptorMismatch",
  environment_type_mismatch: "plans.reasonEnvironmentTypeMismatch",
  os_mismatch: "plans.reasonOsMismatch",
  architecture_mismatch: "plans.reasonArchitectureMismatch",
  trust_too_low: "plans.reasonTrustTooLow",
  missing_capability: "plans.reasonMissingCapability",
  missing_toolchain: "plans.reasonMissingToolchain",
  toolchain_version_too_low: "plans.reasonToolchainVersionTooLow",
  missing_toolchain_component: "plans.reasonMissingToolchainComponent",
  toolchain_component_version_too_low: "plans.reasonToolchainComponentVersionTooLow",
  no_eligible_instance_registered: "plans.reasonNoEligibleInstance",
  no_supporting_descriptor: "plans.reasonNoSupportingDescriptor",
  no_agent_declares_all_required_capabilities: "plans.reasonNoAgentDeclares",
  no_declared_model_profile_covers_requirement: "plans.reasonNoModelProfile",
  approval_rejected: "plans.reasonApprovalRejected",
  cycle: "plans.reasonCycle",
  unknown_dependency: "plans.reasonUnknownDependency",
  unknown_technology: "plans.reasonUnknownTechnology",
  incompatible_component_kind: "plans.reasonIncompatibleKind",
  incompatible_platform: "plans.reasonIncompatiblePlatform",
};

const AGENT_REASONS: Record<string, MessageKey> = {
  agent_disabled: "plans.reasonAgentDisabled",
  project_not_allowed: "plans.reasonProjectNotAllowed",
  missing_capability: "plans.reasonAgentMissingCapability",
};

const KINDS: Record<string, MessageKey> = {
  web_frontend: "plans.kindWebFrontend",
  backend_service: "plans.kindBackendService",
  mobile_app: "plans.kindMobileApp",
  desktop_app: "plans.kindDesktopApp",
  game: "plans.kindGame",
  "3d_application": "plans.kind3dApplication",
  library: "plans.kindLibrary",
};

const PLATFORMS: Record<string, MessageKey> = {
  web: "plans.platformWeb",
  ios: "plans.platformIos",
  android: "plans.platformAndroid",
  windows: "plans.platformWindows",
  macos: "plans.platformMacos",
  linux: "plans.platformLinux",
};

const TESTS: Record<string, MessageKey> = {
  unit: "plans.testUnit",
  integration: "plans.testIntegration",
  ui: "plans.testUi",
  e2e: "plans.testE2e",
  build_verification: "plans.testBuildVerification",
  security: "plans.testSecurity",
  platform_specific: "plans.testPlatformSpecific",
};

const CHECKS: Record<string, MessageKey> = {
  sast: "plans.checkSast",
  dependency_scan: "plans.checkDependencyScan",
  secret_scan: "plans.checkSecretScan",
  permission_review: "plans.checkPermissionReview",
  security_agent_review: "plans.checkSecurityAgentReview",
};

const TARGETS: Record<string, MessageKey> = {
  firebase_hosting: "plans.targetFirebaseHosting",
  cloud_run: "plans.targetCloudRun",
  app_store: "plans.targetAppStore",
  play_store: "plans.targetPlayStore",
  container_registry: "plans.targetContainerRegistry",
  desktop_installer: "plans.targetDesktopInstaller",
};

const STAGES: Record<string, MessageKey> = {
  local: "plans.stageLocal",
  test: "plans.stageTestEnv",
  staging: "plans.stageStaging",
  production: "plans.stageProduction",
};

const APPROVAL_REASONS: Record<string, MessageKey> = {
  production_deployment: "plans.approvalReasonProduction",
  destructive_migration: "plans.approvalReasonMigration",
  privileged_infrastructure: "plans.approvalReasonPrivileged",
};

type Translate = (key: MessageKey) => string;

function lookup(table: Record<string, MessageKey>, t: Translate, value: string): string {
  const key = table[value];
  return key ? t(key) : value;
}

export const label = {
  reason: (t: Translate, v: string) => lookup(REASONS, t, v),
  agentReason: (t: Translate, v: string) => lookup(AGENT_REASONS, t, v),
  kind: (t: Translate, v: string) => lookup(KINDS, t, v),
  platform: (t: Translate, v: string) => lookup(PLATFORMS, t, v),
  test: (t: Translate, v: string) => lookup(TESTS, t, v),
  check: (t: Translate, v: string) => lookup(CHECKS, t, v),
  target: (t: Translate, v: string) => lookup(TARGETS, t, v),
  stage: (t: Translate, v: string) => lookup(STAGES, t, v),
  approvalReason: (t: Translate, v: string) => lookup(APPROVAL_REASONS, t, v),
  blocker: (t: Translate, v: string) =>
    v in BLOCKER ? t(BLOCKER[v as BlockerCode].label) : v,
};

export const COMPONENT_KINDS = Object.keys(KINDS);
export const TARGET_PLATFORMS = Object.keys(PLATFORMS);
export const DEPLOYMENT_TARGETS = Object.keys(TARGETS);
export const DEPLOYMENT_STAGES = Object.keys(STAGES);

/** `{ major, minor }` → "20.0" style minimum label. */
export function versionLabel(v?: { major: number; minor: number; patch: number }): string {
  if (!v) return "";
  return v.patch ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}`;
}
