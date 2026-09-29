/**
 * The V1 specialist workforce.
 *
 * These are DESCRIPTORS: static identity, capability and policy. They contain
 * no runtime state and they grant no authority. Each one states, explicitly:
 *
 *   - what it generally does            (capabilities, hierarchical)
 *   - what it is suited to               (qualification constraints)
 *   - what it may never do               (limitations, denied capabilities)
 *   - which project may employ it        (projectPolicy, deny by default)
 *   - which model policy it may use      (modelPolicy — REQUIRED)
 *   - which environments it needs        (environmentRequirements)
 *   - the highest tool ceiling it may ever receive (toolPolicy)
 *   - its risk profile and review rules  (riskProfile, reviewPolicy)
 *   - who it may hand work to            (handoffPolicy)
 *   - how its cost is attributed         (costPolicy)
 *
 * `AGENT != MODEL != TOOL != ENVIRONMENT`: nothing here pins a model name, an
 * environment instance or a tool instance. The Model Router and the Environment
 * Router choose those at execution time under governance.
 *
 * LEAST PRIVILEGE is enforced by construction here, not by convention: an agent
 * that does not need an authority simply does not declare it, and the
 * declaration is validated against the canonical capability and execution
 * capability vocabularies on load.
 */
import type { AgentDescriptor } from "../../contracts/workforce.js";
import type { ExecutionCapability } from "../../contracts/index.js";
import { validateAgentDescriptor } from "../../contracts/workforce.js";

/**
 * The only provider this deployment has a real adapter for. A descriptor that
 * named any other provider would register successfully and then be unroutable
 * at execution time, so the V1 workforce states the provider explicitly rather
 * than leaving `modelPolicy` undefined (which is what previously made these
 * twelve agents permanently unable to reach a model).
 */
const V1_MODEL_POLICY = Object.freeze({ provider: "openai" });

/**
 * Every V1 agent is scoped to the same single project. Widening this is a
 * governance decision, not a code change: an agent may only work where
 * `GovernancePolicyStore` trusts the project's cost model, and
 * `set-governance-policy` is the operator-facing command for that.
 */
const V1_PROJECTS = Object.freeze(["money-mind"] as const);

const READ_ONLY: readonly ExecutionCapability[] = Object.freeze([
  "filesystem.read",
  "repository.read",
]);

const NO_SHELL: AgentDescriptor["toolPolicy"]["deniedExecutionCapabilities"] =
  Object.freeze([
    "process.invoke.bounded",
    "network.outbound.allowed-host",
    "deploy.invoke",
    "secret.reference.use",
  ]);

type DescriptorDraft = Omit<
  AgentDescriptor,
  "version" | "createdAt" | "updatedAt" | "allowedProjects" | "allowedTools"
> &
  Partial<Pick<AgentDescriptor, "version">>;

function descriptor(draft: DescriptorDraft): AgentDescriptor {
  const built: AgentDescriptor = Object.freeze({
    ...draft,
    version: draft.version ?? 1,
    // `allowedProjects` on the base Agent contract is DERIVED from the
    // descriptor's own project policy — it is never authored twice.
    allowedProjects: draft.projectPolicy.projects,
    // No tool is registered in this deployment, so no descriptor may name one.
    // `toolPolicy` states the CEILING an agent could receive; an actual grant
    // additionally requires a registered tool and a per-session policy.
    allowedTools: Object.freeze([]),
  });
  validateAgentDescriptor(built);
  return built;
}

/* ------------------------------------------------------------------ */
/* 1. Project Manager                                                 */
/* ------------------------------------------------------------------ */

const PROJECT_MANAGER: AgentDescriptor = descriptor({
  id: "pm-v1",
  name: "Project Manager",
  displayName: "Project Manager",
  role: "project_manager",
  department: "Management",
  description:
    "Interprets an approved project objective, decomposes it into work packages, establishes dependencies, coordinates specialists, tracks blockers, requests approvals and reports progress.",
  capabilities: ["project.management", "project.coordination"],
  limitations: [
    "Cannot grant itself privileges or approve its own work.",
    "Cannot bypass qualification, governance or the Model Router.",
    "Cannot fabricate task completion or verification evidence.",
  ],
  supportedTaskTypes: ["planning", "coordination", "project_management"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "write",
      agentId: "pm-v1",
      reason: "project manager authors plans, not workspace content",
    },
    {
      effect: "deny",
      action: "deploy",
      agentId: "pm-v1",
      reason: "deployment is the deployment specialist's authority",
    },
    {
      effect: "deny",
      action: "external_communication",
      agentId: "pm-v1",
      reason: "no outbound communication authority",
    },
    {
      effect: "deny",
      action: "secret_access",
      agentId: "pm-v1",
      reason: "no secret access",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "high",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "high",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: READ_ONLY,
    deniedExecutionCapabilities: NO_SHELL,
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "moderate",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "architecture.system",
      "architecture.technology_selection",
      "software.general",
      "software.frontend",
      "software.backend",
      "design.ui",
      "software.testing",
      "software.review",
      "software.security",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "project_management", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 2. Project Architect                                               */
/* ------------------------------------------------------------------ */

const PROJECT_ARCHITECT: AgentDescriptor = descriptor({
  id: "architect-v1",
  name: "Project Architect",
  displayName: "Project Architect",
  role: "project_architect",
  department: "Engineering",
  description:
    "Analyses requirements, inspects the current architecture, defines boundaries, proposes an architecture, identifies integration points and architectural risk, and records governed architecture decisions.",
  capabilities: [
    "architecture.system",
    "architecture.decision",
    "architecture.technology_selection",
  ],
  limitations: [
    "A recommendation is not an authorization: it cannot approve its own proposal.",
    "Cannot modify implementation source; it proposes, specialists implement.",
  ],
  supportedTaskTypes: ["architecture", "design", "architecture_decision"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "write",
      agentId: "architect-v1",
      reason: "architecture is a decision record, not workspace content",
    },
    {
      effect: "deny",
      action: "deploy",
      agentId: "architect-v1",
      reason: "no deployment authority",
    },
    {
      effect: "deny",
      action: "secret_access",
      agentId: "architect-v1",
      reason: "no secret access",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "high",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "moderate",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: READ_ONLY,
    deniedExecutionCapabilities: NO_SHELL,
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "moderate",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "software.frontend",
      "software.backend",
      "software.general",
      "software.testing",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "architecture", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 3. Technology Selector                                             */
/* ------------------------------------------------------------------ */

/**
 * Requirements-driven only. There is deliberately no descriptor that maps a
 * role to a single toolchain: environment selection belongs to the Environment
 * Router, and this agent only states which technologies suit a requirement.
 */
const TECHNOLOGY_SELECTOR: AgentDescriptor = descriptor({
  id: "tech-selector-v1",
  name: "Technology Selector",
  displayName: "Technology Selector",
  role: "technology_selector",
  department: "Engineering",
  description:
    "Analyses technical requirements, inspects the existing stack, evaluates candidate technologies against those requirements and environment compatibility, and recommends a selection. Avoids unnecessary rewrites.",
  capabilities: ["architecture.technology_selection"],
  limitations: [
    "Selects nothing for its own use: environment placement is the Environment Router's decision.",
    "Does not default heavy engines for ordinary web work; selection must be requirements-driven.",
    "A recommendation is not an authorization.",
  ],
  supportedTaskTypes: ["research", "selection", "technology_selection"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "write",
      agentId: "tech-selector-v1",
      reason: "selection produces a recommendation, not workspace content",
    },
    {
      effect: "deny",
      action: "deploy",
      agentId: "tech-selector-v1",
      reason: "no deployment authority",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "moderate",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "high",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: READ_ONLY,
    deniedExecutionCapabilities: NO_SHELL,
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "low",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "architecture.system",
      "software.general",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "architecture", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 4. Software Development Agent                                      */
/* ------------------------------------------------------------------ */

const SOFTWARE_DEVELOPMENT: AgentDescriptor = descriptor({
  id: "software-dev-v1",
  name: "Software Development Agent",
  displayName: "Software Development Agent",
  role: "software_developer",
  department: "Engineering",
  description:
    "General cross-stack implementation specialist for feature work, integration, refactoring and bug fixing. Not an unrestricted super-agent: where qualification indicates a frontend or backend specialist is more appropriate, that specialist is preferred.",
  capabilities: ["software.general"],
  limitations: [
    "Not an unrestricted super-agent; specialist agents are preferred when they qualify.",
    "Scoped workspace writes only; no repository push, no deployment, no protected-path writes.",
    "Cannot review its own change set.",
  ],
  supportedTaskTypes: ["implementation", "bugfix", "refactor", "integration"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "deploy",
      agentId: "software-dev-v1",
      reason: "deployment is the deployment specialist's authority",
    },
    {
      effect: "deny",
      action: "external_communication",
      agentId: "software-dev-v1",
      reason: "no outbound communication authority",
    },
    {
      effect: "deny",
      action: "secret_access",
      agentId: "software-dev-v1",
      reason: "no secret access",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "moderate",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "low",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: Object.freeze([
      "filesystem.read",
      "filesystem.write.workspace",
      "filesystem.delete.workspace",
      "repository.read",
      "repository.write",
    ]),
    deniedExecutionCapabilities: NO_SHELL,
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "moderate",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "software.testing",
      "software.review",
      "software.security",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "engineering", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 5. Frontend Engineer                                               */
/* ------------------------------------------------------------------ */

const FRONTEND_ENGINEER: AgentDescriptor = descriptor({
  id: "frontend-dev-v1",
  name: "Frontend Engineer",
  displayName: "Frontend Engineer",
  role: "frontend_engineer",
  department: "Engineering",
  description:
    "Frontend architecture and implementation: component design, API integration, responsive UI, accessibility, frontend testing and performance. Does not assume any particular framework — the project's own stack is authoritative.",
  capabilities: ["software.frontend"],
  limitations: [
    "No backend or database authority.",
    "No deployment authority; deployment is the deployment specialist's authority.",
    "No source-control push authority.",
  ],
  supportedTaskTypes: ["frontend_implementation", "implementation"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "deploy",
      agentId: "frontend-dev-v1",
      reason: "no deployment authority",
    },
    {
      effect: "deny",
      action: "secret_access",
      agentId: "frontend-dev-v1",
      reason: "no secret access",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "moderate",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "low",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: Object.freeze([
      "filesystem.read",
      "filesystem.write.workspace",
      "filesystem.delete.workspace",
      "repository.read",
      "repository.write",
    ]),
    deniedExecutionCapabilities: NO_SHELL,
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "low",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "software.testing",
      "software.review",
      "design.ui",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "engineering", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 6. Backend Engineer                                                */
/* ------------------------------------------------------------------ */

/**
 * Backend implementation capability explicitly excludes `deploy.invoke`:
 * writing server code does not grant production deployment authority.
 */
const BACKEND_ENGINEER: AgentDescriptor = descriptor({
  id: "backend-dev-v1",
  name: "Backend Engineer",
  displayName: "Backend Engineer",
  role: "backend_engineer",
  department: "Engineering",
  description:
    "API implementation, domain services, persistence, authorization, integrations, background processing and backend testing.",
  capabilities: ["software.backend"],
  limitations: [
    "Backend code capability does not grant production deployment authority.",
    "No source-control push authority; a change set is reviewed before it lands.",
    "Cannot approve its own authorization changes.",
  ],
  supportedTaskTypes: ["backend_implementation", "implementation"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "deploy",
      agentId: "backend-dev-v1",
      reason: "backend code does not grant deployment authority",
    },
    {
      effect: "deny",
      action: "external_communication",
      agentId: "backend-dev-v1",
      reason: "no outbound communication authority",
    },
    {
      effect: "deny",
      action: "secret_access",
      agentId: "backend-dev-v1",
      reason: "no secret access",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "high",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "low",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: Object.freeze([
      "filesystem.read",
      "filesystem.write.workspace",
      "filesystem.delete.workspace",
      "repository.read",
      "repository.write",
    ]),
    deniedExecutionCapabilities: NO_SHELL,
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "moderate",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "software.testing",
      "software.review",
      "software.security",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "engineering", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 7. UI Designer                                                     */
/* ------------------------------------------------------------------ */

const UI_DESIGNER: AgentDescriptor = descriptor({
  id: "ui-designer-v1",
  name: "UI Designer",
  displayName: "UI Designer",
  role: "ui_designer",
  department: "Design",
  description:
    "Design systems, visual hierarchy, layout, responsive UX, accessibility and interaction specification, component design. Each project's own design requirements are authoritative; the platform's own visual theme is not a universal rule.",
  capabilities: ["design.ui", "design.interaction"],
  limitations: [
    "No deployment authority: designing an interface is not shipping it.",
    "No source write authority by default; it specifies components, it does not implement them.",
    "Motion specification is a design deliverable, not an authority to change existing motion graphics.",
  ],
  supportedTaskTypes: ["design", "design_system", "interaction_specification"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "write",
      agentId: "ui-designer-v1",
      reason: "the designer specifies components; implementation specialists write them",
    },
    {
      effect: "deny",
      action: "deploy",
      agentId: "ui-designer-v1",
      reason: "no deployment authority",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "low",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "moderate",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: READ_ONLY,
    deniedExecutionCapabilities: NO_SHELL,
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "low",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "software.frontend",
      "software.review",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "design", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 8. Test / QA                                                       */
/* ------------------------------------------------------------------ */

/**
 * QA may invoke tests. It is explicitly NOT granted merge, push or deployment
 * authority, and it can never author the change it is testing.
 */
const QA_ENGINEER: AgentDescriptor = descriptor({
  id: "qa-v1",
  name: "QA Engineer",
  displayName: "QA Engineer",
  role: "qa_engineer",
  department: "Quality",
  description:
    "Unit, integration, end-to-end and regression testing, edge cases, failure paths, responsive and browser QA, and accessibility validation where the project requires it.",
  capabilities: ["software.testing"],
  limitations: [
    "Never fabricates test execution or results: an unrun test is reported as unrun.",
    "No merge, push or deployment authority.",
    "Cannot modify the implementation under test; findings go back to the implementer.",
  ],
  supportedTaskTypes: ["testing", "regression", "qa"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "deploy",
      agentId: "qa-v1",
      reason: "QA has no deployment authority",
    },
    {
      effect: "deny",
      action: "external_communication",
      agentId: "qa-v1",
      reason: "no outbound communication authority",
    },
    {
      effect: "deny",
      action: "secret_access",
      agentId: "qa-v1",
      reason: "no secret access",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "high",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "low",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: Object.freeze([
      "filesystem.read",
      "repository.read",
      "artifact.write",
      "test.invoke",
    ]),
    deniedExecutionCapabilities: Object.freeze([
      "filesystem.write.workspace",
      "filesystem.delete.workspace",
      "filesystem.write.protected",
      "repository.write",
      "repository.commit",
      "repository.push",
      "repository.branch.manage",
      "deploy.invoke",
      "secret.reference.use",
    ]),
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "low",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "software.review",
      "software.security",
      "software.general",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "quality", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 9. Reviewer                                                        */
/* ------------------------------------------------------------------ */

/**
 * Reviewer authority is deliberately READ-ONLY. It inspects requirements,
 * change sets, diffs, tests and verification evidence, and classifies findings.
 * It is NEVER the implementation owner.
 */
const REVIEWER: AgentDescriptor = descriptor({
  id: "reviewer-v1",
  name: "Reviewer",
  displayName: "Reviewer",
  role: "reviewer",
  department: "Engineering",
  description:
    "Independent inspection of requirements, change sets, diffs, tests and verification evidence. Identifies defects and classifies findings as BLOCKER, CRITICAL, MAJOR, MINOR or INFO.",
  capabilities: ["software.review"],
  limitations: [
    "Read-only authority: a reviewer never edits the change it reviews.",
    "May never review a change set it produced itself.",
    "A review is evidence, not an approval; approval remains a governed human action.",
  ],
  supportedTaskTypes: ["review", "code_review"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "write",
      agentId: "reviewer-v1",
      reason: "reviewer authority is read-only",
    },
    {
      effect: "deny",
      action: "deploy",
      agentId: "reviewer-v1",
      reason: "no deployment authority",
    },
    {
      effect: "deny",
      action: "secret_access",
      agentId: "reviewer-v1",
      reason: "no secret access",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "critical",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "high",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: READ_ONLY,
    deniedExecutionCapabilities: Object.freeze([
      "filesystem.write.workspace",
      "filesystem.delete.workspace",
      "filesystem.write.protected",
      "repository.write",
      "repository.commit",
      "repository.push",
      "repository.branch.manage",
      "artifact.write",
      "test.invoke",
      "build.invoke",
      "process.invoke.bounded",
      "network.outbound.allowed-host",
      "deploy.invoke",
      "secret.reference.use",
    ]),
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "low",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "software.security",
      "software.general",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "quality", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 10. Security / Compliance                                          */
/* ------------------------------------------------------------------ */

/**
 * Default posture is READ / ANALYZE / REPORT. Security review never silently
 * becomes an unrestricted code-writing superuser: a confirmed finding is
 * reported and handed to the implementer.
 */
const SECURITY_COMPLIANCE: AgentDescriptor = descriptor({
  id: "security-v1",
  name: "Security & Compliance Agent",
  displayName: "Security & Compliance Agent",
  role: "security_compliance",
  department: "Security",
  description:
    "Authorization and IDOR review, secret exposure, input validation, injection, project isolation, privilege boundaries, dependency and security review, and release risk assessment.",
  capabilities: ["software.security"],
  limitations: [
    "Default posture is read, analyze and report.",
    "Does not remediate findings itself; a finding is handed to the implementer.",
    "No deployment authority and no secret values — only scoped credential capability references.",
  ],
  supportedTaskTypes: ["security_review", "audit", "compliance_review"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "write",
      agentId: "security-v1",
      reason: "security posture is read/analyze/report",
    },
    {
      effect: "deny",
      action: "deploy",
      agentId: "security-v1",
      reason: "no deployment authority",
    },
    {
      effect: "deny",
      action: "secret_access",
      agentId: "security-v1",
      reason: "credential capability is not credential value",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "critical",
    requiredToolCapabilities: Object.freeze([]),
    reviewRequiredFromRiskLevel: "moderate",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: Object.freeze([
      ...READ_ONLY,
      "security.scan.invoke",
    ]),
    deniedExecutionCapabilities: Object.freeze([
      "filesystem.write.workspace",
      "filesystem.delete.workspace",
      "filesystem.write.protected",
      "repository.write",
      "repository.commit",
      "repository.push",
      "repository.branch.manage",
      "artifact.write",
      "test.invoke",
      "build.invoke",
      "process.invoke.bounded",
      "network.outbound.allowed-host",
      "deploy.invoke",
      "secret.reference.use",
    ]),
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "low",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze([
      "software.review",
      "software.general",
    ]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "security", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 11. GitHub Integration                                             */
/* ------------------------------------------------------------------ */

/**
 * Governed source control. Force push and history rewriting are not merely
 * unused here — they are outside the capability vocabulary entirely, so they
 * cannot be granted to this or any other agent. Private repository access is a
 * server-side scoped integration; only a credential REFERENCE ever exists.
 */
const GITHUB_INTEGRATION: AgentDescriptor = descriptor({
  id: "github-v1",
  name: "GitHub Integration Agent",
  displayName: "GitHub Integration Agent",
  role: "github_integration",
  department: "DevOps",
  description:
    "Governed source-control operations: repository status, diff, branch management, commit, push, pull request, and merge where explicitly authorized.",
  capabilities: ["integration.github"],
  limitations: [
    "No force push and no history rewriting: neither exists in the capability vocabulary.",
    "No unauthorized repository access; access is project-scoped and server-side.",
    "No credential values — only scoped credential references, never in prompts, logs or audit.",
    "No arbitrary application-source modification and no deployment.",
  ],
  supportedTaskTypes: ["source_control", "devops"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "deploy",
      agentId: "github-v1",
      reason: "deployment is the deployment specialist's authority",
    },
    {
      effect: "deny",
      action: "secret_access",
      agentId: "github-v1",
      reason: "a credential reference is not the credential",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze([]),
    maxRiskLevel: "high",
    requiredToolCapabilities: Object.freeze(["repository.commit"]),
    reviewRequiredFromRiskLevel: "moderate",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze([]),
    acceptsAnyEnvironmentType: true,
  },
  toolPolicy: {
    maxExecutionCapabilities: Object.freeze([
      "repository.read",
      "repository.write",
      "repository.commit",
      "repository.push",
      "repository.branch.manage",
      "artifact.write",
    ]),
    deniedExecutionCapabilities: Object.freeze([
      "filesystem.write.workspace",
      "filesystem.delete.workspace",
      "filesystem.write.protected",
      "process.invoke.bounded",
      "network.outbound.allowed-host",
      "deploy.invoke",
      "secret.reference.use",
    ]),
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "high",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: {
    canDelegateTo: Object.freeze(["software.review"]),
    requiresDestinationAcceptance: true,
  },
  costPolicy: { costCenter: "devops", attestsUsage: true },
});

/* ------------------------------------------------------------------ */
/* 12. Firebase Deployment                                            */
/* ------------------------------------------------------------------ */

/**
 * BUILD -> VALIDATE -> DEPLOY -> VERIFY -> HEALTH -> RELEASE RECORD.
 * A successful CLI exit is not a healthy production: health and release
 * verification are separate, explicit steps.
 */
const FIREBASE_DEPLOYMENT: AgentDescriptor = descriptor({
  id: "firebase-v1",
  name: "Firebase Deployment Agent",
  displayName: "Firebase Deployment Agent",
  role: "firebase_deployment",
  department: "DevOps",
  description:
    "Governed build and deploy operations for Firebase through the deployment orchestrator, followed by explicit health verification and a release record.",
  capabilities: ["deployment.firebase"],
  limitations: [
    "No arbitrary application-source modification: it deploys, it does not author.",
    "No source-control push authority; deployment consumes an already-reviewed revision.",
    "A successful deploy command is not a release: health and verification are separate steps.",
  ],
  supportedTaskTypes: ["deployment", "infrastructure", "release"],
  permissions: Object.freeze([
    {
      effect: "deny",
      action: "secret_access",
      agentId: "firebase-v1",
      reason: "deployment uses scoped credential references, not secrets",
    },
    {
      effect: "deny",
      action: "external_communication",
      agentId: "firebase-v1",
      reason: "no outbound communication authority",
    },
  ]),
  administrativeStatus: "active",
  modelPolicy: V1_MODEL_POLICY,
  qualification: {
    technologies: Object.freeze(["firebase"]),
    maxRiskLevel: "critical",
    requiredToolCapabilities: Object.freeze(["build.invoke", "deploy.invoke"]),
    reviewRequiredFromRiskLevel: "moderate",
  },
  environmentRequirements: {
    requiredEnvironmentTypes: Object.freeze(["web_build"]),
    acceptsAnyEnvironmentType: false,
  },
  toolPolicy: {
    maxExecutionCapabilities: Object.freeze([
      "repository.read",
      "artifact.write",
      "build.invoke",
      "deploy.invoke",
    ]),
    deniedExecutionCapabilities: Object.freeze([
      "filesystem.write.workspace",
      "filesystem.delete.workspace",
      "filesystem.write.protected",
      "repository.write",
      "repository.commit",
      "repository.push",
      "repository.branch.manage",
      "test.invoke",
      "network.outbound.allowed-host",
      "secret.reference.use",
    ]),
    allowsUnrestrictedShell: false,
  },
  projectPolicy: { mode: "allow_list", projects: V1_PROJECTS },
  riskProfile: "high",
  reviewPolicy: {
    requiresIndependentReview: true,
    minimumReviewers: 1,
    selfReviewAllowed: false,
  },
  handoffPolicy: { canDelegateTo: Object.freeze([]), requiresDestinationAcceptance: true },
  costPolicy: { costCenter: "devops", attestsUsage: true },
});

/* ------------------------------------------------------------------ */

export const V1_SPECIALIST_WORKFORCE: readonly AgentDescriptor[] =
  Object.freeze([
    PROJECT_MANAGER,
    PROJECT_ARCHITECT,
    TECHNOLOGY_SELECTOR,
    SOFTWARE_DEVELOPMENT,
    FRONTEND_ENGINEER,
    BACKEND_ENGINEER,
    UI_DESIGNER,
    QA_ENGINEER,
    REVIEWER,
    SECURITY_COMPLIANCE,
    GITHUB_INTEGRATION,
    FIREBASE_DEPLOYMENT,
  ]);

/** Read-only lookup so callers never mutate the workforce in place. */
export function findV1Descriptor(agentId: string): AgentDescriptor | undefined {
  return V1_SPECIALIST_WORKFORCE.find((a) => a.id === agentId);
}
