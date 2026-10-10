/**
 * Provisioning planner (PROJECT-2) — pure.
 *
 * Composes the analysis, the operator's draft and the REAL state of the
 * platform (environment descriptors + usable instances, registered agents,
 * reader capability) into one immutable `ProvisioningPlan`. It executes
 * nothing. Every "cannot do this yet" is a truthful pending requirement or
 * warning, never a fabricated success:
 *
 *   PLANNED != EXECUTED · AVAILABLE != QUALIFIED · CONFIGURED != DEPLOYED
 */
import { createHash } from "node:crypto";
import type { Agent, EnvironmentDescriptor } from "../../contracts/index.js";
import type {
  AutonomyPolicy,
  CostPolicy,
  DeploymentPlan,
  DeploymentTargetPlan,
  EnvironmentPlanItem,
  Finding,
  GitPolicy,
  IntegrationPlanItem,
  KnowledgeRef,
  OnboardingSession,
  PipelineStage,
  PipelineStep,
  PlanIssue,
  PlannedStep,
  ProjectAnalysis,
  ProjectPolicyCapability,
  ProvisioningPlan,
  SecretRequirement,
  TechnologyPlan,
  WorkforcePlanItem,
} from "../../contracts/onboarding.js";
import { PIPELINE_STAGES } from "../../contracts/onboarding.js";

export interface PlanningContext {
  now: string;
  descriptors: readonly EnvironmentDescriptor[];
  /** Descriptor ids that have at least one USABLE registered instance. */
  usableDescriptorIds: ReadonlySet<string>;
  agents: readonly Agent[];
  /** Whether a read credential for private GitHub repositories is configured. */
  githubPrivateAccess: boolean;
  /** Platform gaps (honest capability reporting). */
  githubRepositoryCreation: false;
  firebaseProvisioning: false;
}

const LEVEL_CAPABILITIES: Readonly<
  Record<number, readonly ProjectPolicyCapability[]>
> = {
  1: ["repository.read"],
  2: [
    "repository.read",
    "repository.write",
    "branch.create",
    "tests.run",
    "commit.create",
  ],
  3: [
    "repository.read",
    "repository.write",
    "branch.create",
    "tests.run",
    "commit.create",
    "push",
    "pull_request.create",
  ],
  4: [
    "repository.read",
    "repository.write",
    "branch.create",
    "tests.run",
    "commit.create",
    "push",
    "pull_request.create",
    "deployment.staging",
    "deployment.production",
  ],
  5: [
    "repository.read",
    "repository.write",
    "branch.create",
    "tests.run",
    "commit.create",
    "push",
    "pull_request.create",
    "merge",
    "deployment.staging",
    "deployment.production",
  ],
};

/**
 * What the platform can actually GRANT today. The execution layer is a
 * deny-all baseline (EO-4.1), so only reading is operational; the rest are
 * recorded as requested and take effect only when an execution layer and
 * project policy grant them. A level is never a security bypass.
 */
export const PLATFORM_GRANTABLE: readonly ProjectPolicyCapability[] = [
  "repository.read",
];

export const ALWAYS_APPROVAL_GATED: readonly string[] = [
  "destructive database change",
  "security-rule change",
  "production deployment",
  "repository deletion",
  "secret rotation",
  "large spend",
  "permission escalation",
];

export const DEFAULT_GIT_POLICY: GitPolicy = Object.freeze({
  agentBranchPattern: "agent/<task-id>",
  testsRequired: true,
  reviewRequired: true,
  securityCheckRequired: true,
  autoCommit: false,
  autoPush: false,
  pullRequestRequired: true,
  mergePolicy: "manual",
  allowDirectDefaultBranchWrites: false,
});

export const DEFAULT_COST_POLICY: CostPolicy = Object.freeze({
  warningThresholdPercent: 80,
  hardStop: true,
  currency: "USD",
  enforcement: "not_enforced",
  enforcementNote:
    "Recorded as the project's budget policy. Server-side enforcement is not implemented yet (no AI Cost Center is wired), so limits are NOT enforced today.",
});

export const VISIBILITY_SLA_MINUTES = 5;

/** Stable JSON: object keys sorted, so a hash is content-only. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashPlanContent(
  plan: Omit<ProvisioningPlan, "planHash" | "planVersion" | "generatedAt">,
): string {
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

function values(list: readonly Finding[]): string[] {
  return list.map((item) => item.value);
}

function addOverride(list: Finding[], value: string): void {
  if (!list.some((item) => item.value === value)) {
    list.push({ value, evidence: "operator override", confidence: "high" });
  }
}

function buildTechnology(
  session: OnboardingSession,
  analysis: ProjectAnalysis,
): TechnologyPlan {
  const technology: TechnologyPlan = {
    origin: analysis.basis === "repository" ? "detected" : "proposed",
    languages: [...analysis.languages],
    frameworks: [...analysis.frameworks],
    dataStorage: [
      ...analysis.structure.database,
      ...analysis.structure.storage,
    ],
    authentication: [...analysis.structure.authentication],
    packageManagers: [...analysis.packageManagers],
    buildSystems: [...analysis.buildSystems],
    testSystems: [...analysis.testFrameworks],
    deploymentTargets: [...analysis.deployment],
    overrides: session.draft.overrides.map((override) => ({ ...override })),
  };
  const target: Record<string, Finding[]> = {
    language: technology.languages,
    framework: technology.frameworks,
    database: technology.dataStorage,
    authentication: technology.authentication,
    packageManager: technology.packageManagers,
    buildSystem: technology.buildSystems,
    testSystem: technology.testSystems,
    deployment: technology.deploymentTargets,
  };
  for (const override of technology.overrides) {
    const list = target[override.field];
    if (list) addOverride(list, override.value);
  }
  return technology;
}

function environmentItems(
  analysis: ProjectAnalysis,
  context: PlanningContext,
): EnvironmentPlanItem[] {
  const langs = new Set(values(analysis.languages));
  const build = new Set(values(analysis.buildSystems));
  const fw = new Set(values(analysis.frameworks));
  const needs: Array<{
    type: string;
    purpose: string;
    requirements: string[];
  }> = [];
  const push = (type: string, purpose: string, requirements: string[]) => {
    if (!needs.some((need) => need.type === type))
      needs.push({ type, purpose, requirements });
  };
  const nodeStack =
    ["npm", "pnpm", "yarn"].some((pm) =>
      values(analysis.packageManagers).includes(pm),
    ) ||
    langs.has("TypeScript") ||
    langs.has("JavaScript");
  if (nodeStack)
    push(
      "web_build",
      "Install, build and test the JavaScript/TypeScript project",
      ["Node.js", "npm-compatible package manager"],
    );
  if (build.has(".NET SDK") || langs.has("C#"))
    push("desktop_build", "Build the .NET project", [".NET SDK"]);
  if (
    build.has("Xcode build") ||
    langs.has("Swift") ||
    langs.has("Objective-C")
  ) {
    push("xcode", "Build the Apple-platform project", [
      "macOS host",
      "Xcode",
      "Swift toolchain",
    ]);
  }
  if (
    analysis.structure.infrastructure.some((item) => item.value === "Docker")
  ) {
    push("docker", "Build or run container images", ["Container runtime"]);
  }
  const unsupported: Array<{
    type: string;
    purpose: string;
    requirements: string[];
  }> = [];
  if (langs.has("Python"))
    unsupported.push({
      type: "python",
      purpose: "Run the Python project",
      requirements: ["Python runtime"],
    });
  if (
    langs.has("Java") ||
    langs.has("Kotlin") ||
    build.has("Gradle") ||
    build.has("Maven")
  ) {
    unsupported.push({
      type: "jvm",
      purpose: "Build the JVM project",
      requirements: ["JDK", build.has("Maven") ? "Maven" : "Gradle"],
    });
  }
  if (langs.has("Go"))
    unsupported.push({
      type: "go",
      purpose: "Build the Go project",
      requirements: ["Go toolchain"],
    });
  if (langs.has("Rust"))
    unsupported.push({
      type: "rust",
      purpose: "Build the Rust project",
      requirements: ["Cargo"],
    });
  if (fw.has("Unity"))
    unsupported.push({
      type: "unity",
      purpose: "Build the Unity project",
      requirements: ["Unity Editor"],
    });
  if (fw.has("Unreal Engine"))
    unsupported.push({
      type: "unreal",
      purpose: "Build the Unreal project",
      requirements: ["Unreal Engine"],
    });
  if (langs.has("Kotlin") && !unsupported.some((u) => u.type === "android")) {
    /* Android Studio is not a declared descriptor: reported via jvm above. */
  }

  const items: EnvironmentPlanItem[] = needs.map((need) => {
    const descriptor = context.descriptors.find(
      (d) => d.environmentType === need.type,
    );
    if (!descriptor) {
      return {
        environmentType: need.type,
        purpose: need.purpose,
        requirements: need.requirements,
        supported: false,
        availability: "unsupported",
        provisioningNeed:
          "No environment descriptor declares support for this type; nothing will be routed to it.",
      };
    }
    const usable = context.usableDescriptorIds.has(descriptor.id);
    return {
      descriptorId: descriptor.id,
      environmentType: need.type,
      purpose: need.purpose,
      requirements: need.requirements,
      supported: true,
      availability: usable
        ? "qualified_instance_available"
        : "no_qualified_instance",
      provisioningNeed: usable
        ? "A usable registered instance exists; qualification is re-checked per task."
        : "Declared as supported, but no qualified host/instance is registered. One must be discovered before work can run.",
    };
  });
  for (const need of unsupported) {
    items.push({
      environmentType: need.type,
      purpose: need.purpose,
      requirements: need.requirements,
      supported: false,
      availability: "unsupported",
      provisioningNeed:
        "No environment descriptor declares support for this type; nothing will be routed to it.",
    });
  }
  return items;
}

function workforceItems(
  analysis: ProjectAnalysis,
  projectId: string,
  context: PlanningContext,
): WorkforcePlanItem[] {
  const items: WorkforcePlanItem[] = [];
  // Real registered agents: qualification is per project (allowedProjects).
  for (const agent of context.agents) {
    const qualified =
      agent.allowedProjects.includes(projectId) ||
      agent.allowedProjects.includes("*");
    items.push({
      role: agent.name,
      agentId: agent.id,
      availability: "registered",
      qualified,
      reason: qualified
        ? "Registered and permitted for this project."
        : "Registered, but its definition does not list this project; widening an agent's scope is a trusted code change and is not done during onboarding.",
    });
  }
  const roadmap = (role: string, why: string): void => {
    items.push({
      role,
      availability: "roadmap",
      qualified: false,
      reason: `No production agent implements this role yet (${why}).`,
    });
  };
  roadmap("Project Manager", "always recommended");
  roadmap("Reviewer", "independent review before integration");
  roadmap("Security", "independent security review");
  const s = analysis.structure;
  if (s.frontend.length > 0) roadmap("Frontend", "frontend evidence");
  if (s.backend.length > 0 || s.functions.length > 0)
    roadmap("Backend", "backend/functions evidence");
  if (s.database.length > 0) roadmap("Database", "data-store evidence");
  if (
    analysis.deployment.some((d) => d.value.startsWith("Firebase")) ||
    analysis.frameworks.some((f) => f.value.startsWith("Firebase"))
  ) {
    roadmap("Firebase", "Firebase evidence");
  }
  if (s.tests.length > 0 || analysis.testFrameworks.length > 0)
    roadmap("Test/QA", "test evidence");
  if (analysis.repository.repositoryUrl)
    roadmap("GitHub Integration", "repository binding");
  if (analysis.deployment.length > 0)
    roadmap("Deployment", "deployment evidence");
  return items;
}

function autonomyPolicy(
  level: OnboardingSession["draft"]["autonomyLevel"],
): AutonomyPolicy {
  const requested = [...(LEVEL_CAPABILITIES[level] ?? LEVEL_CAPABILITIES[1]!)];
  const granted = requested.filter((capability) =>
    PLATFORM_GRANTABLE.includes(capability),
  );
  return {
    level,
    requested,
    granted,
    approvalRequired: [...ALWAYS_APPROVAL_GATED],
    note: "Capabilities are authoritative; the level only selects a preset. Only capabilities the platform can operate today are granted; the rest are recorded as requested and stay gated by approvals.",
  };
}

function pipeline(analysis: ProjectAnalysis): PipelineStep[] {
  return PIPELINE_STAGES.map((stage: PipelineStage): PipelineStep => {
    const found = analysis.commands.find(
      (command) => command.purpose === stage,
    );
    return found
      ? {
          stage,
          status: "resolved",
          command: found.command,
          evidence: found.evidence,
        }
      : { stage, status: "unresolved" };
  });
}

function deploymentPlan(
  analysis: ProjectAnalysis,
  steps: PipelineStep[],
): DeploymentPlan {
  const buildCommand = steps.find((step) => step.stage === "build")?.command;
  const origin = analysis.basis === "repository" ? "detected" : "proposed";
  const targets: DeploymentTargetPlan[] = analysis.deployment.map((item) => ({
    environment: "unspecified",
    provider: item.value,
    origin,
    state: "modelled_not_deployed",
    ...(buildCommand ? { buildCommand } : {}),
    evidence: item.evidence,
  }));
  return {
    targets,
    visibilitySlaMinutes: VISIBILITY_SLA_MINUTES,
    slaNote:
      "Operational objective: a validated deployment should be visible within 5 minutes of the deployment starting, where the provider supports it. Compliance is measured per deployment and is not asserted by onboarding.",
    existingDeploymentPreserved:
      analysis.basis === "repository" && analysis.deployment.length > 0,
  };
}

function integrations(
  session: OnboardingSession,
  analysis: ProjectAnalysis,
  context: PlanningContext,
): IntegrationPlanItem[] {
  const items: IntegrationPlanItem[] = [];
  if (analysis.basis === "repository") {
    items.push({
      provider: "GitHub",
      purpose: "Read the source repository",
      state: "connected",
      note: `Read access was verified by analysis${analysis.repository.commit ? ` at commit ${analysis.repository.commit.slice(0, 7)}` : ""}${
        analysis.repository.visibility === "private"
          ? " using the server-side GitHub credential"
          : ""
      }. Write access is not granted (REPOSITORY CONNECTED != AUTHORIZED).`,
    });
  } else if (session.draft.source.createRepository) {
    items.push({
      provider: "GitHub",
      purpose: "Create a private repository for the new project",
      state: "unavailable",
      note: "Governed GitHub repository creation is not implemented; this remains a pending requirement.",
    });
  } else {
    items.push({
      provider: "GitHub",
      purpose: "Source control",
      state: "optional",
      note: "No repository is bound yet. A repository can be bound later.",
    });
  }
  const providerNames = new Set(
    values(analysis.deployment).map((v) => v.split(" ")[0]!),
  );
  for (const provider of providerNames) {
    items.push({
      provider,
      purpose: "Deployment target",
      state: "needs_authorization",
      note: `No ${provider} deployment credential is bound to this project. Credentials are project-scoped and are never shared across projects.`,
    });
  }
  void context;
  return items;
}

function secrets(analysis: ProjectAnalysis): SecretRequirement[] {
  return analysis.envVars.map((variable) => ({
    name: variable.name,
    classification: variable.classification,
    status: "reference_required",
    evidence: variable.evidence,
  }));
}

function knowledge(analysis: ProjectAnalysis): KnowledgeRef[] {
  return analysis.documentation.map((doc) => ({
    path: doc.path,
    kind: doc.kind,
  }));
}

export function buildPlan(
  session: OnboardingSession,
  analysis: ProjectAnalysis,
  planVersion: number,
  context: PlanningContext,
): ProvisioningPlan {
  const draft = session.draft;
  const isImport = session.kind === "import_existing";
  const technology = buildTechnology(session, analysis);
  const pipelineSteps = pipeline(analysis);
  const gitBase: GitPolicy = {
    ...DEFAULT_GIT_POLICY,
    ...(draft.gitPolicy ?? {}),
  };
  if (
    analysis.repository.defaultBranch &&
    gitBase.defaultBranch === undefined
  ) {
    gitBase.defaultBranch = analysis.repository.defaultBranch;
  }
  const cost: CostPolicy = {
    ...DEFAULT_COST_POLICY,
    ...(draft.costPolicy ?? {}),
    enforcement: "not_enforced",
    enforcementNote: DEFAULT_COST_POLICY.enforcementNote,
    currency: "USD",
  };

  const blockers: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const blocker = (code: string, message: string) =>
    blockers.push({ code, message });
  const warn = (code: string, message: string) =>
    warnings.push({ code, message });

  if (isImport && analysis.basis !== "repository") {
    blocker(
      "analysis-required",
      "An import requires a repository analysis before a plan can be approved.",
    );
  }
  if (session.kind === "create_new") {
    if (
      !draft.source.specification ||
      draft.source.specification.trim().length < 20
    ) {
      blocker(
        "specification-required",
        "A new project needs a requirements specification (at least a short description).",
      );
    }
  }
  for (const finding of analysis.findings.concat(analysis.security)) {
    if (finding.severity === "blocker") blocker(finding.code, finding.message);
    if (finding.severity === "warning") warn(finding.code, finding.message);
  }
  const unresolvedStages = pipelineSteps
    .filter((step) => step.status === "unresolved")
    .map((step) => step.stage);
  if (isImport && unresolvedStages.length > 0) {
    warn(
      "pipeline-unresolved",
      `No repository evidence for: ${unresolvedStages.join(", ")}. These commands are left unresolved, not guessed.`,
    );
  }
  const environments = environmentItems(analysis, context);
  for (const env of environments) {
    if (!env.supported)
      warn(
        "environment-unsupported",
        `No supported environment for ${env.environmentType}.`,
      );
    else if (env.availability === "no_qualified_instance")
      warn(
        "environment-unavailable",
        `No qualified ${env.environmentType} instance is registered yet.`,
      );
  }
  const autonomy = autonomyPolicy(draft.autonomyLevel);
  if (draft.autonomyLevel >= 4) {
    warn(
      "autonomy-not-operational",
      `Autonomy level ${draft.autonomyLevel} is recorded as requested; the platform does not yet operate ${autonomy.requested.filter((c) => !autonomy.granted.includes(c)).join(", ")}.`,
    );
  }
  if (session.kind === "create_new" && draft.source.createRepository) {
    warn(
      "repository-creation-pending",
      "Repository creation is not implemented; the project will be registered without a repository.",
    );
  }
  if (
    session.kind === "create_new" &&
    !draft.source.repositoryUrl &&
    !draft.source.createRepository
  ) {
    warn("no-repository", "No repository is bound to this project.");
  }
  if (
    cost.dailyLimit === undefined &&
    cost.monthlyLimit === undefined &&
    cost.taskLimit === undefined
  ) {
    warn(
      "no-budget",
      "No budget limits are set; and enforcement is not implemented in any case.",
    );
  }
  const deployment = deploymentPlan(analysis, pipelineSteps);
  if (deployment.targets.length === 0) {
    warn("no-deployment-target", "No deployment target is defined.");
  }
  for (const override of technology.overrides) {
    warn(
      "override",
      `Override recorded: ${override.field} = ${override.value}${override.recommended ? ` (recommended: ${override.recommended})` : ""}.`,
    );
  }
  if (analysis.truncated)
    warn(
      "analysis-truncated",
      "The repository listing was truncated; discovery may be incomplete.",
    );

  const wantsFirebase =
    analysis.deployment.some((item) => item.value.startsWith("Firebase")) ||
    (session.kind === "create_new" &&
      analysis.deployment.some((item) => item.value === "Firebase"));

  const steps: PlannedStep[] = [
    {
      key: "registry_entry",
      title: "Register project in the Project Registry",
      external: false,
      mandatory: true,
      executable: true,
      description:
        "Persist the project record and register it so authorized operators can discover it.",
    },
  ];
  if (analysis.repository.repositoryUrl) {
    steps.push({
      key: "repository_binding",
      title: "Bind repository",
      external: false,
      mandatory: isImport,
      executable: true,
      description:
        "Record the credential-free repository reference and reject duplicate bindings. No repository is created or modified.",
    });
  }
  if (session.kind === "create_new" && draft.source.createRepository) {
    steps.push({
      key: "repository_creation",
      title: "Create private repository",
      external: true,
      mandatory: false,
      executable: false,
      description:
        "Pending requirement: governed GitHub repository creation is not implemented on this platform.",
    });
  }
  steps.push(
    {
      key: "environment_profile",
      title: "Record environment profile",
      external: false,
      mandatory: true,
      executable: true,
      description:
        "Record required environments and their real availability. Nothing is provisioned on a host.",
    },
    {
      key: "agent_policy",
      title: "Record agent policy and qualification",
      external: false,
      mandatory: true,
      executable: true,
      description:
        "Record the workforce plan and capability policy. Agents are not started or assigned.",
    },
    {
      key: "integration_policies",
      title: "Record integration policies",
      external: false,
      mandatory: false,
      executable: true,
      description:
        "Record project-scoped integration requirements and their state.",
    },
    {
      key: "secret_requirements",
      title: "Record secret requirements",
      external: false,
      mandatory: false,
      executable: true,
      description:
        "Record required variable NAMES only; no value is captured or stored.",
    },
    {
      key: "git_workflow",
      title: "Record Git workflow policy",
      external: false,
      mandatory: true,
      executable: true,
      description: "Record the conservative Git policy.",
    },
    {
      key: "build_test_pipeline",
      title: "Record build/test pipeline",
      external: false,
      mandatory: true,
      executable: true,
      description:
        "Record resolved commands; unresolved commands stay unresolved.",
    },
    {
      key: "deployment_configuration",
      title: "Record deployment configuration",
      external: false,
      mandatory: false,
      executable: true,
      description: "Model deployment targets. Nothing is deployed.",
    },
  );
  if (wantsFirebase && session.kind === "create_new") {
    steps.push({
      key: "firebase_provisioning",
      title: "Provision Firebase project",
      external: true,
      mandatory: false,
      executable: false,
      description:
        "Pending requirement: automatic Firebase project creation is not implemented; no Firebase project is created.",
    });
  }
  steps.push(
    {
      key: "cost_policy",
      title: "Record cost budget policy",
      external: false,
      mandatory: false,
      executable: true,
      description:
        "Record the budget policy. Enforcement is not implemented and is reported as such.",
    },
    {
      key: "audit_baseline",
      title: "Establish audit baseline",
      external: false,
      mandatory: true,
      executable: true,
      description:
        "Capture a baseline from real data; unknown fields stay 'Unavailable'.",
    },
    {
      key: "project_knowledge",
      title: "Register project knowledge",
      external: false,
      mandatory: false,
      executable: true,
      description:
        "Register documentation references (paths only; no content is ingested).",
    },
  );

  const core: Omit<
    ProvisioningPlan,
    "planHash" | "planVersion" | "generatedAt"
  > = {
    basis: analysis.basis,
    identity: { ...draft.identity, projectId: session.projectId },
    source: { ...draft.source },
    repository: { ...analysis.repository },
    technology,
    architecture: {
      summary: architectureSummary(analysis),
      components: components(analysis),
      findings: [...analysis.findings, ...analysis.security],
    },
    environments,
    workforce: workforceItems(analysis, session.projectId, context),
    autonomy,
    integrations: integrations(session, analysis, context),
    secrets: secrets(analysis),
    git: gitBase,
    pipeline: pipelineSteps,
    deployment,
    cost,
    governance: {
      auditBaseline: [
        "repository commit",
        "branch",
        "architecture revision",
        "dependency summary",
        "test status",
        "security findings",
        "deployment state",
      ],
      approvals: [...ALWAYS_APPROVAL_GATED],
      securityFindings: analysis.security.length,
    },
    knowledge: knowledge(analysis),
    steps,
    blockers,
    warnings,
  };
  return {
    ...core,
    planVersion,
    planHash: hashPlanContent(core),
    generatedAt: context.now,
  };
}

function architectureSummary(analysis: ProjectAnalysis): string {
  const parts = [
    ...values(analysis.applicationKinds),
    ...values(analysis.languages),
    ...values(analysis.frameworks),
    ...values(analysis.deployment),
  ];
  const prefix = analysis.basis === "repository" ? "Detected" : "Proposed";
  return parts.length === 0
    ? "No architecture could be established from the available evidence."
    : `${prefix}: ${[...new Set(parts)].join(" · ")}`;
}

function components(
  analysis: ProjectAnalysis,
): ProvisioningPlan["architecture"]["components"] {
  const out: ProvisioningPlan["architecture"]["components"] = [];
  for (const [kind, list] of Object.entries(analysis.structure)) {
    for (const item of list as Finding[]) {
      out.push({ kind, name: item.value, evidence: item.evidence });
    }
  }
  return out;
}
