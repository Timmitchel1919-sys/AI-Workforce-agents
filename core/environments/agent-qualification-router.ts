/**
 * AgentQualificationRouter — the ONE qualification router, intentionally
 * SEPARATED from environment routing.
 *
 *   CAPABILITY     answers "what does this agent generally do?"
 *   QUALIFICATION  answers "is this agent suitable for THIS task under THESE
 *                             constraints?"
 *   ENVIRONMENT    answers "is a real, usable environment installed?"
 *   GOVERNANCE     answers "is this agent allowed to do it at all?"
 *
 * The two routers must not blur: a qualified agent with no environment is
 * `REQUIRES_PROVISIONING`, never a fabricated success, and an unqualified agent
 * is rejected even when an environment is available.
 *
 * This is STRICT by design. There is no wildcard, no nearest match, and no
 * "everyone is a little bit of everything" fallback:
 *
 *   NO QUALIFIED AGENT  ->  task BLOCKED with `NO_QUALIFIED_AGENT`
 *   NEVER               ->  pick a random available agent
 *
 * AVAILABLE != QUALIFIED. Being free does not make an agent suitable, and being
 * suitable does not mean the agent is free.
 */
import {
  type Agent,
  type AgentCandidateEvidence,
  type AgentRejectionReason,
  type AgentQualificationResult,
  type AgentRouteResult,
  type Assignment,
  type CapabilityId,
  type EnvironmentRequirement,
  type QualificationEvidence,
  type TaskRequirements,
  ValidationError,
  acceptsNewAssignments,
  capabilitySatisfies,
  missingCapabilities,
  riskWithinCeiling,
  satisfiedCapabilities,
  validateAssignment,
  validateTaskRequirements,
  type AgentDescriptor,
} from "../../contracts/index.js";
import { EnvironmentRegistry } from "./environment-registry.js";
import { EnvironmentRouter } from "./environment-router.js";

/** The honest answer when a task cannot be staffed. */
export const NO_QUALIFIED_AGENT = "NO_QUALIFIED_AGENT" as const;

export interface QualificationOutcome {
  readonly outcome: "QUALIFIED" | typeof NO_QUALIFIED_AGENT;
  /** Qualified candidates, most specific first, then by id. */
  readonly candidates: readonly AgentDescriptor[];
  /** Every candidate considered, including the rejected ones and why. */
  readonly evidence: readonly AgentCandidateEvidence[];
}

export class AgentQualificationRouter {
  private readonly router: EnvironmentRouter;

  constructor(registry: EnvironmentRegistry) {
    this.router = new EnvironmentRouter(registry);
  }

  /* ---------------------------------------------------------------- */
  /* Strict qualification against full task requirements              */
  /* ---------------------------------------------------------------- */

  /**
   * Qualify a single descriptor against one task.
   *
   * Returns structured evidence either way. There is no "close enough": a
   * single unmet constraint disqualifies the agent, and the reason code says
   * which one.
   */
  qualifyDescriptor(
    descriptor: AgentDescriptor,
    requirements: TaskRequirements,
    context: {
      isEnabled?: (agentId: string, projectId: string) => boolean;
    } = {},
  ): AgentCandidateEvidence {
    const reasons: AgentRejectionReason[] = [];

    /* 1. administrative lifecycle — a suspended agent gets no NEW work */
    if (!acceptsNewAssignments(descriptor.administrativeStatus)) {
      reasons.push("administratively_inactive");
    }

    /* 2. operational enablement (control-plane flag, project-scoped) */
    if (
      context.isEnabled &&
      !context.isEnabled(descriptor.id, requirements.projectId)
    ) {
      reasons.push("agent_disabled");
    }

    /* 3. project access — deny by default, allow-list only */
    if (!descriptor.projectPolicy.projects.includes(requirements.projectId)) {
      reasons.push("project_not_allowed");
    }

    /* 4. task type support */
    if (
      requirements.taskType.length > 0 &&
      !descriptor.supportedTaskTypes.includes(requirements.taskType)
    ) {
      reasons.push("missing_capability");
    }

    /* 5. capabilities, with least-privilege hierarchy */
    const matched = satisfiedCapabilities(
      descriptor.capabilities,
      requirements.requiredCapabilities,
    );
    const missing = missingCapabilities(
      descriptor.capabilities,
      requirements.requiredCapabilities,
    );
    if (missing.length > 0) reasons.push("missing_capability");

    /* 6. technology */
    const technologies = requirements.technologyRequirements ?? [];
    if (
      technologies.length > 0 &&
      !technologies.some((t) =>
        descriptor.qualification.technologies.includes(t),
      )
    ) {
      reasons.push("technology_mismatch");
    }

    /* 7. risk ceiling — an agent may never exceed its declared maximum */
    if (
      !riskWithinCeiling(
        requirements.riskLevel,
        descriptor.qualification.maxRiskLevel,
      )
    ) {
      reasons.push("risk_above_ceiling");
    }

    /* 8. tool ceiling — the task needs more than this agent may ever receive */
    const needed = requirements.toolRequirements ?? [];
    if (
      needed.some(
        (c) => !descriptor.toolPolicy.maxExecutionCapabilities.includes(c),
      )
    ) {
      reasons.push("tool_capability_denied");
    }

    /* 9. environment compatibility */
    const environments = requirements.environmentRequirements ?? [];
    if (
      environments.length > 0 &&
      !descriptor.environmentRequirements.acceptsAnyEnvironmentType &&
      !environments.some((e) =>
        descriptor.environmentRequirements.requiredEnvironmentTypes.includes(e),
      )
    ) {
      reasons.push("environment_incompatible");
    }

    /* 10. explicit exclusion (e.g. the implementer of a change under review) */
    if (requirements.excludeAgentIds?.includes(descriptor.id)) {
      reasons.push("agent_excluded");
    }

    /* 11. review independence — the implementer may never review its own work */
    if (
      requirements.implementerAgentId !== undefined &&
      requirements.implementerAgentId === descriptor.id
    ) {
      reasons.push("review_independence_violated");
    }

    return {
      agentId: descriptor.id,
      qualifies: reasons.length === 0,
      matchedCapabilities: matched,
      missingCapabilities: missing,
      // De-duplicated: a task that is both the wrong type and missing a
      // capability must not report the same code twice.
      reasonCodes: [...new Set(reasons)],
    };
  }

  /**
   * Qualify every candidate against a task's full requirements.
   *
   * Deterministic: qualified agents first, then by id. Ties are broken by
   * specificity — an agent that covers MORE of the required capabilities is
   * ranked ahead of a generalist — then alphabetically, so the same inputs
   * always produce the same order and a routing decision is reproducible.
   */
  qualify(
    requirements: TaskRequirements,
    descriptors: readonly AgentDescriptor[],
    context: {
      isEnabled?: (agentId: string, projectId: string) => boolean;
    } = {},
  ): QualificationOutcome {
    validateTaskRequirements(requirements);

    const evidence = descriptors
      .map((descriptor) =>
        this.qualifyDescriptor(descriptor, requirements, context),
      )
      .sort((a, b) => {
        if (a.qualifies !== b.qualifies)
          return Number(b.qualifies) - Number(a.qualifies);
        const aMatched = a.matchedCapabilities.length;
        const bMatched = b.matchedCapabilities.length;
        if (aMatched !== bMatched) return bMatched - aMatched;
        return a.agentId.localeCompare(b.agentId);
      });

    const qualified = evidence
      .filter((e) => e.qualifies)
      .map((e) => descriptors.find((d) => d.id === e.agentId)!);

    return {
      outcome: qualified.length > 0 ? "QUALIFIED" : NO_QUALIFIED_AGENT,
      candidates: qualified,
      evidence,
    };
  }

  /**
   * Pick ONE agent, and return the assignment evidence that goes with it.
   *
   * This is the only path that may produce an {@link Assignment}. It is
   * strictly derived from `qualify`, so an assignment can never exist without
   * the qualification evidence that justifies it.
   */
  selectAssignment(
    requirements: TaskRequirements,
    descriptors: readonly AgentDescriptor[],
    options: {
      assignmentId: string;
      taskId: string;
      assignedBy: string;
      correlationId?: string;
      /** Do not return an agent that already holds this task (idempotent retry). */
      excludeAgentIds?: readonly string[];
      now: string;
      isEnabled?: (agentId: string, projectId: string) => boolean;
    },
  ):
    | { assignment: Assignment }
    | {
        blocked: typeof NO_QUALIFIED_AGENT;
        evidence: readonly AgentCandidateEvidence[];
      } {
    const effective: TaskRequirements = {
      ...requirements,
      excludeAgentIds: [
        ...(requirements.excludeAgentIds ?? []),
        ...(options.excludeAgentIds ?? []),
      ],
    };
    const outcome = this.qualify(effective, descriptors, {
      isEnabled: options.isEnabled,
    });
    if (outcome.candidates.length === 0) {
      return { blocked: NO_QUALIFIED_AGENT, evidence: outcome.evidence };
    }
    const chosen = outcome.candidates[0]!;
    const evidence = outcome.evidence.find((e) => e.agentId === chosen.id)!;
    const assignment = buildAssignment({
      requirements: effective,
      descriptor: chosen,
      evidence,
      assignmentId: options.assignmentId,
      taskId: options.taskId,
      assignedBy: options.assignedBy,
      correlationId: options.correlationId,
      now: options.now,
    });
    return { assignment };
  }

  /* ---------------------------------------------------------------- */
  /* Environment-aware routing (unchanged separation)                 */
  /* ---------------------------------------------------------------- */

  /**
   * Legacy capability-only qualification against an environment requirement.
   * Retained because the environment router and planning pipeline call it; the
   * strict descriptor-aware path above is what assignment uses.
   */
  qualifyLegacy(
    agent: Agent,
    requirement: EnvironmentRequirement,
  ): AgentQualificationResult {
    const capabilities = agent.capabilities;
    const requiredCapabilities = requirement.requiredCapabilities ?? [];

    for (const capability of requiredCapabilities) {
      if (!capabilities.includes(capability)) {
        return {
          agentId: agent.id,
          qualifies: false,
          reason: `agent does not declare capability "${capability}"`,
          matchedCapability: undefined,
        };
      }
    }

    if (
      requirement.environmentType !== undefined &&
      !capabilities.includes(requirement.environmentType) &&
      !capabilities.includes("*")
    ) {
      return {
        agentId: agent.id,
        qualifies: false,
        reason: `agent does not declare environment type "${requirement.environmentType}"`,
        matchedCapability: undefined,
      };
    }

    if (
      requirement.descriptorId !== undefined &&
      !capabilities.includes(requirement.descriptorId) &&
      !capabilities.includes("*")
    ) {
      return {
        agentId: agent.id,
        qualifies: false,
        reason: `agent does not declare descriptor "${requirement.descriptorId}"`,
        matchedCapability: undefined,
      };
    }

    return {
      agentId: agent.id,
      qualifies: true,
      reason: "agent declares all required capabilities",
      matchedCapability: requiredCapabilities[0] as CapabilityId | undefined,
    };
  }

  /**
   * Planning-time evaluation (EO-3.1) over the legacy flat `Agent` shape.
   *
   * Retained unchanged for the planning pipeline, which operates on agents
   * that predate specialist descriptors. It stays strict: no wildcard, no
   * nearest match.
   */
  evaluateCandidates(
    agents: readonly Agent[],
    requirement: { projectId: string; requiredCapabilities: readonly string[] },
    isEnabled: (agentId: string, projectId: string) => boolean = () => true,
  ): AgentCandidateEvidence[] {
    return [...agents]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((agent) => {
        const reasons: AgentRejectionReason[] = [];
        if (!isEnabled(agent.id, requirement.projectId))
          reasons.push("agent_disabled");
        if (
          agent.allowedProjects.length > 0 &&
          !agent.allowedProjects.includes(requirement.projectId)
        ) {
          reasons.push("project_not_allowed");
        }
        const matched = requirement.requiredCapabilities.filter((c) =>
          agent.capabilities.includes(c),
        );
        const missing = requirement.requiredCapabilities.filter(
          (c) => !agent.capabilities.includes(c),
        );
        if (missing.length > 0) reasons.push("missing_capability");
        return {
          agentId: agent.id,
          qualifies: reasons.length === 0,
          matchedCapabilities: matched,
          missingCapabilities: missing,
          reasonCodes: reasons,
        };
      })
      .sort(
        (a, b) =>
          Number(b.qualifies) - Number(a.qualifies) ||
          a.agentId.localeCompare(b.agentId),
      );
  }

  route(agent: Agent, requirement: EnvironmentRequirement): AgentRouteResult {
    const qualification = this.qualifyLegacy(agent, requirement);
    if (!qualification.qualifies) {
      return {
        outcome: "NOT_QUALIFIED",
        agentId: agent.id,
        reason: qualification.reason,
      };
    }
    const placement = this.router.route(requirement);
    switch (placement.outcome) {
      case "ROUTED":
        return {
          outcome: "ROUTED",
          agentId: agent.id,
          instance: placement.instance,
        };
      case "REQUIRES_PROVISIONING":
        return {
          outcome: "REQUIRES_PROVISIONING",
          agentId: agent.id,
          reason: placement.reason,
        };
      case "NO_AVAILABLE_ENVIRONMENT":
        return {
          outcome: "NO_AVAILABLE_ENVIRONMENT",
          agentId: agent.id,
          reason: placement.reason,
        };
    }
  }
}

/* ------------------------------------------------------------------ */

function buildAssignment(input: {
  requirements: TaskRequirements;
  descriptor: AgentDescriptor;
  evidence: AgentCandidateEvidence;
  assignmentId: string;
  taskId: string;
  assignedBy: string;
  correlationId?: string;
  now: string;
}): Assignment {
  if (!input.evidence.qualifies) {
    throw new ValidationError(
      "refusing to build an assignment for an agent that did not qualify",
    );
  }
  const qualification: QualificationEvidence = {
    agentId: input.descriptor.id,
    descriptorVersion: input.descriptor.version,
    qualified: true,
    matchedCapabilities: input.evidence.matchedCapabilities,
    missingCapabilities: input.evidence.missingCapabilities,
    reasonCodes: input.evidence.reasonCodes,
    // The agent's own stated limits travel with the assignment, so a reviewer
    // can see what the agent was NOT supposed to be doing without re-deriving it.
    consideredLimitations: input.descriptor.limitations,
    evaluatedAt: input.now,
  };
  const assignment: Assignment = {
    assignmentId: input.assignmentId,
    projectId: input.requirements.projectId,
    taskId: input.taskId,
    agentId: input.descriptor.id,
    descriptorVersion: input.descriptor.version,
    qualification,
    status: "assigned",
    assignedAt: input.now,
    assignedBy: input.assignedBy,
    updatedAt: input.now,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.requirements.writeScope?.length
      ? { writeScope: [...input.requirements.writeScope] }
      : {}),
  };
  validateAssignment(assignment);
  return Object.freeze(assignment);
}

/** Re-exported so callers can express hierarchy without a second import. */
export { capabilitySatisfies };
