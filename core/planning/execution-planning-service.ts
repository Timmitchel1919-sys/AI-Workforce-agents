/**
 * ExecutionPlanningService — converts a structured project request into a
 * validated, auditable, versioned ExecutionPlan.
 *
 *   ProjectRequest → TaskAnalyzer → ProjectArchitect → TechnologySelector /
 *   EnvironmentRouter.evaluate → AgentQualificationRouter.evaluateCandidates →
 *   ModelCapabilityRegistry → dependency DAG → stage planner → blockers →
 *   ExecutionPlan → ExecutionPlanRepository (+ audit)
 *
 * EO-3.1 PLANS WORK. IT DOES NOT EXECUTE WORK. This service has no execution
 * path: it never runs a command, a probe, a build, a model, or a deployment.
 * An APPROVED plan only changes governance state; execution belongs to EO-4.
 *
 * BLOCKED ≠ ERROR: a project that needs an environment nobody registered is a
 * valid plan with `status: "blocked"` and structured blockers. Exceptions are
 * reserved for invalid input and invalid state transitions.
 */
import {
  NotFoundError,
  StateTransitionError,
  ValidationError,
  normalizeProjectRequest,
  type Approval,
  type BlockerCode,
  type EnvironmentCandidateEvidence,
  type EnvironmentRejectionReason,
  type ExecutionBlocker,
  type ExecutionPlan,
  type ModelRequirement,
  type PlanAgentAssignment,
  type PlannedEnvironmentRequirement,
  type ProjectRequest,
} from "../../contracts/index.js";
import { type ApprovalSystem } from "../approvals/approval-system.js";
import { type AuditLog } from "../audit/audit-log.js";
import { AgentQualificationRouter } from "../environments/agent-qualification-router.js";
import { type EnvironmentRegistry } from "../environments/environment-registry.js";
import { EnvironmentRouter } from "../environments/environment-router.js";
import { fnv1aHex } from "../environments/fingerprint.js";
import { type AgentRegistry } from "../registry/agent-registry.js";
import { now } from "../shared.js";
import { TechnologySelector } from "../technology/technology-selector.js";
import {
  dependencyRequirements,
  planDependencies,
} from "./dependency-graph.js";
import { ExecutionPlanRepository } from "./execution-plan-repository.js";
import { ModelCapabilityRegistry } from "./model-capability-registry.js";
import { ProjectArchitect, canonicalKey } from "./project-architect.js";
import { planStages } from "./stage-planner.js";
import { TaskAnalyzer } from "./task-analyzer.js";
import { TechnologyCatalog } from "./technology-catalog.js";

export const EXECUTION_PLAN_APPROVAL_ACTION = "execution_plan.approve";
/** Bump when blocker/approval policy changes so replans detect it. */
export const PLANNING_POLICY_VERSION = "eo-3.1";

export interface ExecutionPlanningServiceOptions {
  environments: EnvironmentRegistry;
  agents: Pick<AgentRegistry, "list" | "get">;
  audit: AuditLog;
  approvals: ApprovalSystem;
  repository?: ExecutionPlanRepository;
  models?: ModelCapabilityRegistry;
  catalog?: TechnologyCatalog;
  isAgentEnabled?: (agentId: string) => boolean;
  /** When provided, plans can only be created for existing projects. */
  projectExists?: (projectId: string) => boolean;
  clock?: () => string;
  /** New plan-series ids. Must be globally unique in production. */
  idFactory?: () => string;
}

export interface PlanActor {
  id: string;
  correlationId?: string;
}

/** Everything a plan derives from inputs — no ids, versions or timestamps. */
export type PlanEvaluation = Pick<
  ExecutionPlan,
  | "request"
  | "analysis"
  | "architecture"
  | "environments"
  | "agentRequirements"
  | "agents"
  | "models"
  | "dependencies"
  | "build"
  | "tests"
  | "security"
  | "deployment"
  | "approvalRequirements"
  | "blockers"
  | "inputsFingerprint"
>;

export type ReplanOutcome = "replanned" | "unchanged";

const PLACEMENT_REASONS: ReadonlySet<EnvironmentRejectionReason> = new Set([
  "instance_unavailable",
  "host_unavailable",
  "host_unknown",
  "descriptor_mismatch",
  "environment_type_mismatch",
  "os_mismatch",
  "architecture_mismatch",
  "trust_too_low",
]);

export class ExecutionPlanningService {
  readonly repository: ExecutionPlanRepository;
  private readonly analyzer: TaskAnalyzer;
  private readonly architect = new ProjectArchitect();
  private readonly selector: TechnologySelector;
  private readonly router: EnvironmentRouter;
  private readonly qualification: AgentQualificationRouter;
  private readonly models: ModelCapabilityRegistry;
  private readonly catalog: TechnologyCatalog;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(private readonly options: ExecutionPlanningServiceOptions) {
    this.repository = options.repository ?? new ExecutionPlanRepository();
    this.catalog = options.catalog ?? new TechnologyCatalog();
    this.analyzer = new TaskAnalyzer(this.catalog);
    this.selector = new TechnologySelector(options.environments);
    this.router = new EnvironmentRouter(options.environments);
    this.qualification = new AgentQualificationRouter(options.environments);
    this.models = options.models ?? new ModelCapabilityRegistry();
    this.clock = options.clock ?? now;
    this.idFactory = options.idFactory ?? defaultPlanId;
  }

  /* -------------------------------------------------------------- */
  /* Pure evaluation                                               */
  /* -------------------------------------------------------------- */

  /** Deterministic: identical inputs and registry state → identical result. */
  evaluate(request: ProjectRequest): PlanEvaluation {
    const analysis = this.analyzer.analyze(request);
    const architecture = this.architect.architecture(analysis);
    const drafts = this.architect.environmentRequirements(analysis);

    const environments: PlannedEnvironmentRequirement[] = drafts.map((d) => {
      const support = this.selector.select(d.requirement);
      const match = this.router.evaluate(d.requirement);
      return {
        id: d.id,
        componentIds: [...d.componentIds],
        requirement: d.requirement,
        descriptorSupport:
          support.outcome === "SUPPORTED" ? "supported" : "unsupported",
        match,
        status: match.selectedInstanceId ? "satisfied" : "missing",
      };
    });

    const dependencyItems = dependencyRequirements(
      analysis.technologies,
      this.catalog,
    );
    const dependencies = planDependencies(dependencyItems);
    const stages = planStages(
      request,
      analysis,
      drafts,
      dependencyItems,
      this.catalog,
    );

    const agentList = this.options.agents.list();
    const isEnabled = this.options.isAgentEnabled ?? (() => true);
    const agents: PlanAgentAssignment[] = stages.agentRequirements.map((r) => {
      const candidates = this.qualification.evaluateCandidates(
        agentList,
        {
          projectId: request.projectId,
          requiredCapabilities: r.requiredCapabilities,
        },
        isEnabled,
      );
      const chosen = candidates.find((c) => c.qualifies);
      return {
        requirementId: r.id,
        ...(chosen ? { agentId: chosen.agentId } : {}),
        requiredCapabilities: [...r.requiredCapabilities],
        matchedCapabilities: chosen ? [...chosen.matchedCapabilities] : [],
        qualification: chosen ? "qualified" : "none_qualified",
        candidates,
      };
    });

    const models: ModelRequirement[] = stages.agentRequirements.map((r) => {
      const assignment = agents.find((a) => a.requirementId === r.id);
      const agent = assignment?.agentId
        ? this.options.agents.get(assignment.agentId)
        : undefined;
      const base = {
        id: `model:${r.id}`,
        agentRequirementId: r.id,
        capabilities: [...r.modelCapabilities],
      };
      if (!agent) {
        return {
          ...base,
          eligibleProfileIds: [],
          missingCapabilities: [],
          status: "not_evaluated",
        };
      }
      const eligibility = this.models.eligibility(agent, r.modelCapabilities);
      return {
        ...base,
        agentId: agent.id,
        eligibleProfileIds: eligibility.eligibleProfileIds,
        missingCapabilities: eligibility.missingCapabilities,
        status:
          eligibility.eligibleProfileIds.length > 0 ? "satisfied" : "missing",
      };
    });

    const blockers = sortBlockers([
      ...analysis.unsupportedTechnologies.map((u): ExecutionBlocker => ({
        code: "UNSUPPORTED_TECHNOLOGY",
        subjectType: "technology",
        subjectId: `${u.componentId}:${u.technologyId}`,
        reasonCodes: [u.reason],
        missing: [u.technologyId],
      })),
      ...environments
        .filter((e) => e.status === "missing")
        .map(environmentBlocker),
      ...agents
        .filter((a) => a.qualification === "none_qualified")
        .map((a): ExecutionBlocker => ({
          code: "NO_QUALIFIED_AGENT",
          subjectType: "agent",
          subjectId: a.requirementId,
          reasonCodes: ["no_agent_declares_all_required_capabilities"],
          missing: [...a.requiredCapabilities],
        })),
      ...models
        .filter((m) => m.status === "missing")
        .map((m): ExecutionBlocker => ({
          code: "MISSING_MODEL_CAPABILITY",
          subjectType: "model",
          subjectId: m.id,
          reasonCodes: ["no_declared_model_profile_covers_requirement"],
          missing: [...m.missingCapabilities],
        })),
      ...dependencies.conflicts.map((c): ExecutionBlocker => ({
        code: "DEPENDENCY_CONFLICT",
        subjectType: "dependency",
        subjectId: c.dependencyId,
        reasonCodes: [c.reason],
        missing: [],
      })),
    ]);

    return {
      request,
      analysis,
      architecture,
      environments,
      agentRequirements: stages.agentRequirements,
      agents,
      models,
      dependencies,
      build: stages.build,
      tests: stages.tests,
      security: stages.security,
      deployment: stages.deployment,
      approvalRequirements: stages.approvalRequirements,
      blockers,
      inputsFingerprint: this.fingerprint(request),
    };
  }

  /* -------------------------------------------------------------- */
  /* Plan lifecycle                                                */
  /* -------------------------------------------------------------- */

  /** Validate an untrusted request, plan it, persist version 1, audit. */
  createPlan(input: unknown, actor: PlanActor): ExecutionPlan {
    const request = normalizeProjectRequest(input);
    this.assertProjectExists(request.projectId);
    const planId = this.idFactory();
    const plan = this.materialize(this.evaluate(request), {
      planId,
      version: 1,
      createdBy: actor.id,
    });
    this.repository.create(plan);
    this.audit("created", plan, actor);
    this.audit(plan.status === "blocked" ? "blocked" : "ready", plan, actor);
    return plan;
  }

  /**
   * Re-evaluate the current revision against today's registry, agents and
   * policy. Unchanged inputs return the current revision; otherwise a new
   * version is created and the previous one is superseded (never rewritten).
   */
  replan(
    planId: string,
    actor: PlanActor,
  ): { plan: ExecutionPlan; outcome: ReplanOutcome; previous: ExecutionPlan } {
    const previous = this.requireLatest(planId);
    this.assertProjectExists(previous.projectId);
    const evaluation = this.evaluate(previous.request);
    if (evaluation.inputsFingerprint === previous.inputsFingerprint) {
      this.audit("replan_unchanged", previous, actor);
      return { plan: previous, outcome: "unchanged", previous };
    }

    const next = this.materialize(evaluation, {
      planId,
      version: previous.version + 1,
      createdBy: actor.id,
      supersedes: previous.id,
    });
    this.repository.create(next);

    let approval = previous.approval;
    if (approval.state === "requested" && approval.approvalId) {
      try {
        this.options.approvals.expire(approval.approvalId);
        approval = { ...approval, state: "expired" };
      } catch (error) {
        if (!(error instanceof StateTransitionError)) throw error;
      }
    }
    const superseded = this.repository.transition({
      ...previous,
      status: "superseded",
      approval,
      supersededBy: next.id,
      updatedAt: this.clock(),
    });

    this.audit("replanned", next, actor, { supersedes: previous.id });
    this.audit("superseded", superseded, actor, { supersededBy: next.id });
    this.audit(next.status === "blocked" ? "blocked" : "ready", next, actor);
    return { plan: next, outcome: "replanned", previous: superseded };
  }

  /**
   * Ask for the human approval a READY plan with protected stages needs. Uses
   * the existing ApprovalSystem; the plan never approves itself.
   */
  submitForApproval(planId: string, actor: PlanActor): ExecutionPlan {
    const plan = this.requireLatest(planId);
    if (plan.status !== "ready") {
      throw new StateTransitionError(
        `execution plan ${plan.id} is ${plan.status}; only a ready plan can be submitted`,
      );
    }
    if (plan.approvalRequirements.length === 0) {
      throw new ValidationError(
        `execution plan ${plan.id} has no approval requirements`,
      );
    }
    const approval = this.options.approvals.request({
      action: EXECUTION_PLAN_APPROVAL_ACTION,
      requestedBy: actor.id,
      reason:
        `Execution plan ${plan.planId} v${plan.version} requires approval: ` +
        plan.approvalRequirements.map((r) => r.reason).join(", "),
      metadata: {
        executionPlanId: plan.id,
        projectId: plan.projectId,
        planVersion: plan.version,
      },
    });
    const next = this.repository.transition({
      ...plan,
      status: "awaiting_approval",
      approval: { approvalId: approval.id, state: "requested" },
      updatedAt: this.clock(),
    });
    this.audit("approval_required", next, actor, { approvalId: approval.id });
    return next;
  }

  /**
   * Mirror an authoritative approval decision onto its plan. Returns the
   * updated plan, or `undefined` when the approval is not (or no longer) the
   * pending approval of a current plan.
   */
  applyApprovalDecision(
    approval: Approval,
    actor: PlanActor,
  ): ExecutionPlan | undefined {
    const planDocId = approval.decisionMetadata?.executionPlanId;
    if (typeof planDocId !== "string") return undefined;
    const plan = this.repository.get(planDocId);
    if (
      !plan ||
      plan.status !== "awaiting_approval" ||
      plan.approval.approvalId !== approval.id
    ) {
      return undefined;
    }
    if (approval.status === "approved") {
      const next = this.repository.transition({
        ...plan,
        status: "approved",
        approval: { approvalId: approval.id, state: "approved" },
        updatedAt: this.clock(),
      });
      this.audit("approved", next, actor, { approvalId: approval.id });
      return next;
    }
    if (approval.status === "rejected") {
      const next = this.repository.transition({
        ...plan,
        status: "blocked",
        approval: { approvalId: approval.id, state: "rejected" },
        blockers: [
          {
            code: "APPROVAL_REJECTED",
            subjectType: "approval",
            subjectId: approval.id,
            reasonCodes: ["approval_rejected"],
            missing: [],
          },
        ],
        updatedAt: this.clock(),
      });
      this.audit("approval_rejected", next, actor, { approvalId: approval.id });
      return next;
    }
    return undefined;
  }

  /* -------------------------------------------------------------- */
  /* Reads                                                         */
  /* -------------------------------------------------------------- */

  get(id: string): ExecutionPlan | undefined {
    return this.repository.get(id);
  }

  latest(planId: string): ExecutionPlan | undefined {
    return this.repository.latestVersion(planId);
  }

  versions(planId: string): ExecutionPlan[] {
    return this.repository.versions(planId);
  }

  listByProject(projectId: string): ExecutionPlan[] {
    return this.repository.listByProject(projectId);
  }

  /* -------------------------------------------------------------- */
  /* Internals                                                     */
  /* -------------------------------------------------------------- */

  private requireLatest(planId: string): ExecutionPlan {
    const plan = this.repository.latestVersion(planId);
    if (!plan) throw new NotFoundError(`unknown execution plan: ${planId}`);
    return plan;
  }

  private assertProjectExists(projectId: string): void {
    if (this.options.projectExists && !this.options.projectExists(projectId)) {
      throw new NotFoundError(`unknown project: ${projectId}`);
    }
  }

  private materialize(
    evaluation: PlanEvaluation,
    meta: {
      planId: string;
      version: number;
      createdBy: string;
      supersedes?: string;
    },
  ): ExecutionPlan {
    const timestamp = this.clock();
    return {
      id: `${meta.planId}@v${meta.version}`,
      planId: meta.planId,
      version: meta.version,
      projectId: evaluation.request.projectId,
      status: evaluation.blockers.length > 0 ? "blocked" : "ready",
      schemaVersion: 1,
      ...evaluation,
      approval: { state: "not_requested" },
      ...(meta.supersedes ? { supersedes: meta.supersedes } : {}),
      createdBy: meta.createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
      cost: { status: "not_estimated" },
    };
  }

  /** Stable hash of every input that can change a planning decision. */
  private fingerprint(request: ProjectRequest): string {
    const registry = this.options.environments;
    const isEnabled = this.options.isAgentEnabled ?? (() => true);
    const snapshot = {
      policy: PLANNING_POLICY_VERSION,
      catalog: this.catalog.version,
      request,
      descriptors: registry
        .listDescriptors()
        .sort((a, b) => a.id.localeCompare(b.id)),
      hosts: registry
        .listHosts()
        .map((h) => ({
          hostId: h.hostId,
          availability: h.availability,
          os: h.os,
          trustLevel: h.trustLevel,
        }))
        .sort((a, b) => a.hostId.localeCompare(b.hostId)),
      instances: registry
        .listInstances()
        .map((i) => ({
          id: i.id,
          descriptorId: i.descriptorId,
          hostId: i.hostId,
          environmentType: i.environmentType,
          availability: i.availability,
          trustLevel: i.trustLevel,
          version: i.version,
          capabilities: i.capabilities.map((c) => ({
            capability: c.capability,
            available: c.available,
          })),
          toolchains: i.toolchains.map((t) => ({
            kind: t.kind,
            version: t.version,
            components: t.componentVersions,
          })),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      agents: this.options.agents
        .list()
        .map((a) => ({
          id: a.id,
          capabilities: [...a.capabilities].sort(),
          allowedProjects: [...a.allowedProjects].sort(),
          enabled: isEnabled(a.id),
          modelPolicy: a.modelPolicy
            ? { provider: a.modelPolicy.provider, model: a.modelPolicy.model }
            : undefined,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      models: this.models.list(),
    };
    const canonical = canonicalKey(snapshot);
    return `${fnv1aHex(canonical)}${fnv1aHex(canonical.split("").reverse().join(""))}`;
  }

  private audit(
    action: string,
    plan: ExecutionPlan,
    actor: PlanActor,
    extra: Record<string, unknown> = {},
  ): void {
    this.options.audit.record("execution_plan_event", {
      projectId: plan.projectId,
      data: {
        action,
        planId: plan.planId,
        executionPlanId: plan.id,
        version: plan.version,
        status: plan.status,
        blockerCodes: plan.blockers.map((b) => b.code),
        actor: actor.id,
        ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
        ...extra,
      },
    });
  }
}

function environmentBlocker(
  environment: PlannedEnvironmentRequirement,
): ExecutionBlocker {
  const near = environment.match.candidates
    .filter((c) => c.reasonCodes.every((r) => !PLACEMENT_REASONS.has(r)))
    .sort(
      (a, b) =>
        a.reasonCodes.length - b.reasonCodes.length ||
        a.instanceId.localeCompare(b.instanceId),
    );
  const best: EnvironmentCandidateEvidence | undefined = near[0];
  const required = [
    ...(environment.requirement.requiredCapabilities ?? []),
    ...(environment.requirement.toolchains ?? []).flatMap((t) => [
      t.kind,
      ...(t.components ?? []).map((c) => `${t.kind}:${c.name}`),
    ]),
  ];
  if (!best) {
    return {
      code: "MISSING_ENVIRONMENT",
      subjectType: "environment",
      subjectId: environment.id,
      reasonCodes: [
        environment.match.outcome === "REQUIRES_PROVISIONING"
          ? "no_eligible_instance_registered"
          : "no_supporting_descriptor",
      ],
      missing: required,
    };
  }
  const code: BlockerCode =
    best.missingToolchains.length > 0
      ? "MISSING_TOOLCHAIN"
      : "MISSING_CAPABILITY";
  return {
    code,
    subjectType: "environment",
    subjectId: environment.id,
    reasonCodes: [...best.reasonCodes],
    missing: [...best.missingCapabilities, ...best.missingToolchains],
  };
}

function sortBlockers(blockers: ExecutionBlocker[]): ExecutionBlocker[] {
  return blockers.sort(
    (a, b) =>
      a.code.localeCompare(b.code) || a.subjectId.localeCompare(b.subjectId),
  );
}

function defaultPlanId(): string {
  const random = globalThis.crypto.randomUUID().replace(/-/g, "");
  return `plan_${random}`;
}
