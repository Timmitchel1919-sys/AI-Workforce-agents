/**
 * Centralized orchestration policy (Layer 4): capability registry, tool
 * policy, failure policy, queue ordering and model-requirement mapping.
 *
 * Routing and authorization rules live HERE and nowhere else, so changing a
 * policy never means hunting through the application.
 */
import { canonicalizeCapability } from "../../contracts/capabilities.js";
import type {
  FailureClass,
  OrchPriority,
  OrchTask,
  OrchTaskType,
  RecoveryAction,
} from "../../contracts/execution-orchestration.js";
import type { ModelCapability } from "../../contracts/planning.js";
import type { RoutingProfile } from "../../contracts/routing.js";

/* ------------------------------------------------------------------ */
/* Agent capability registry                                          */
/* ------------------------------------------------------------------ */

export interface AgentCapabilityDefinition {
  /** Product-level capability name. */
  readonly id: string;
  /** Canonical taxonomy ids (contracts/capabilities.ts) it maps onto. */
  readonly taxonomy: readonly string[];
  readonly description: string;
  /** `v2` entries are declared for the future; no agent is implied. */
  readonly status: "v1" | "v2";
}

export const AGENT_CAPABILITY_REGISTRY: readonly AgentCapabilityDefinition[] =
  Object.freeze([
    {
      id: "SOFTWARE_DEVELOPER",
      taxonomy: ["software.general", "software.frontend", "software.backend"],
      description: "Implements and builds software.",
      status: "v1",
    },
    {
      id: "CODE_REVIEWER",
      taxonomy: ["software.review"],
      description: "Independent review of changes.",
      status: "v1",
    },
    {
      id: "PROJECT_MANAGER",
      taxonomy: ["project.management", "project.coordination"],
      description: "Plans and coordinates; never does specialist work.",
      status: "v1",
    },
    {
      id: "GITHUB_INTEGRATOR",
      taxonomy: ["integration.github"],
      description: "Governed source control operations.",
      status: "v1",
    },
    {
      id: "FIREBASE_DEPLOYER",
      taxonomy: ["deployment.firebase", "deployment"],
      description: "Governed build/deploy/verify.",
      status: "v1",
    },
    {
      id: "UI_DESIGNER",
      taxonomy: ["design.ui"],
      description: "Design systems and visual review.",
      status: "v1",
    },
    {
      id: "TEST_QA",
      taxonomy: ["software.testing"],
      description: "Test authoring and execution.",
      status: "v1",
    },
    {
      id: "AI_COST_CENTER",
      taxonomy: [],
      description: "Platform service (budget/usage); not a task executor.",
      status: "v1",
    },
    {
      id: "AI_AUDITOR",
      taxonomy: [],
      description: "Platform service (rule-based audit); not a task executor.",
      status: "v1",
    },
    {
      id: "SECURITY_COMPLIANCE",
      taxonomy: ["software.security"],
      description: "Security and compliance review.",
      status: "v1",
    },
    {
      id: "DATA_ENGINEERING",
      taxonomy: ["data"],
      description: "Future specialist.",
      status: "v2",
    },
    {
      id: "DATA_ANALYSIS",
      taxonomy: ["data"],
      description: "Future specialist.",
      status: "v2",
    },
    {
      id: "GRAPHICS_3D",
      taxonomy: ["media.graphics"],
      description: "Future specialist.",
      status: "v2",
    },
    {
      id: "MOTION_INTERACTION",
      taxonomy: ["media.motion"],
      description: "Future specialist.",
      status: "v2",
    },
    {
      id: "FINANCE_ACCOUNTING",
      taxonomy: ["finance"],
      description: "Future specialist.",
      status: "v2",
    },
    {
      id: "LEGAL_COMPLIANCE",
      taxonomy: ["legal"],
      description: "Future specialist.",
      status: "v2",
    },
    {
      id: "RESEARCH_KNOWLEDGE",
      taxonomy: ["research"],
      description: "Future specialist.",
      status: "v2",
    },
    {
      id: "PROCUREMENT_COST_OPTIMIZER",
      taxonomy: [],
      description: "Future specialist.",
      status: "v2",
    },
  ]);

/** The product-level name(s) of a taxonomy capability (for display). */
export function productNamesFor(taxonomyId: string): string[] {
  return AGENT_CAPABILITY_REGISTRY.filter((c) =>
    c.taxonomy.includes(taxonomyId),
  ).map((c) => c.id);
}

/** Taxonomy ids for a product-level capability name; unknown → undefined. */
export function taxonomyFor(productId: string): readonly string[] | undefined {
  return AGENT_CAPABILITY_REGISTRY.find((c) => c.id === productId)?.taxonomy;
}

/* ------------------------------------------------------------------ */
/* Tool authorization policy                                          */
/* ------------------------------------------------------------------ */

/** Tools a task of a given type MAY use. Everything else is denied. */
const TOOLS_BY_TYPE: Readonly<Record<OrchTaskType, readonly string[]>> = {
  RESEARCH: ["repo.read", "docs.read"],
  ANALYSIS: ["repo.read", "docs.read"],
  DESIGN: ["repo.read", "docs.read"],
  DEVELOPMENT: ["repo.read", "repo.edit", "tests.run", "build.run"],
  REVIEW: ["repo.read", "diff.read"],
  TEST: ["repo.read", "tests.run"],
  SECURITY: ["repo.read", "diff.read", "security.scan"],
  DOCUMENTATION: ["repo.read", "repo.edit"],
  INTEGRATION: ["git.status", "git.diff"],
  DEPLOYMENT: ["build.run"],
  MAINTENANCE: ["repo.read"],
};

/** Tools usable only after an approved human decision for THIS task. */
const APPROVAL_GATED_TOOLS: Readonly<
  Partial<Record<OrchTaskType, readonly string[]>>
> = {
  INTEGRATION: ["git.commit", "git.push"],
  DEPLOYMENT: ["deploy.firebase"],
  MAINTENANCE: ["repo.delete", "project.delete", "data.delete"],
};

/** Never granted to any agent through orchestration. */
export const ALWAYS_DENIED_TOOLS: readonly string[] = Object.freeze([
  "secrets.read",
  "secrets.write",
  "infra.delete_production",
  "audit.modify",
  "policy.modify",
]);

export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "repo.edit",
  "git.commit",
  "git.push",
  "deploy.firebase",
  "repo.delete",
  "project.delete",
  "data.delete",
  "build.run",
]);

export interface ToolAuthorization {
  permitted: string[];
  denied: string[];
  reasons: string[];
}

/**
 * Least privilege: the task type's allow-list, plus approval-gated tools only
 * when THIS task's human approval has been granted, minus anything an agent
 * profile forbids. Destructive tools additionally require `destructive`.
 */
export function authorizeTools(
  task: Pick<OrchTask, "type" | "destructive">,
  options: {
    approved: boolean;
    agentToolAccess?: "none" | "read_only" | "standard";
  },
): ToolAuthorization {
  const base = [...TOOLS_BY_TYPE[task.type]];
  const gated = [...(APPROVAL_GATED_TOOLS[task.type] ?? [])];
  const reasons: string[] = [];
  let permitted = [...base];
  const denied: string[] = [...ALWAYS_DENIED_TOOLS];
  if (options.approved) {
    for (const tool of gated) {
      const destructiveTool = /delete/.test(tool);
      if (destructiveTool && !task.destructive) {
        denied.push(tool);
        reasons.push(`${tool} denied: the task is not classified destructive`);
      } else {
        permitted.push(tool);
      }
    }
  } else {
    for (const tool of gated) {
      denied.push(tool);
      reasons.push(`${tool} requires an approved human decision for this task`);
    }
  }
  if (options.agentToolAccess === "none") {
    reasons.push("agent profile grants no tools");
    denied.push(...permitted);
    permitted = [];
  } else if (options.agentToolAccess === "read_only") {
    const keep = permitted.filter((t) => !WRITE_TOOLS.has(t));
    for (const t of permitted) if (!keep.includes(t)) denied.push(t);
    reasons.push("agent profile is read-only: write tools removed");
    permitted = keep;
  }
  return {
    permitted: [...new Set(permitted)],
    denied: [...new Set(denied)],
    reasons,
  };
}

/** Does a task need any write tool to do its job? */
export function needsWriteTools(
  type: OrchTaskType,
  approvedGated: boolean,
): boolean {
  const tools = [
    ...TOOLS_BY_TYPE[type],
    ...(approvedGated ? (APPROVAL_GATED_TOOLS[type] ?? []) : []),
  ];
  return tools.some((t) => WRITE_TOOLS.has(t));
}

/* ------------------------------------------------------------------ */
/* Failure policy                                                     */
/* ------------------------------------------------------------------ */

const TRANSIENT =
  /(timeout|timed out|rate.?limit|429|503|502|econn|etimedout|temporar|unavailable|overloaded|network)/i;
const SECURITY =
  /(secret|credential|token leak|forbidden|permission denied|unauthori[sz]ed|policy violation|security|injection|exfiltrat)/i;

/** Classify a failure message when the runtime did not say. */
export function classifyFailure(
  error: string,
  hint?: FailureClass,
): FailureClass {
  if (hint) return hint;
  if (SECURITY.test(error)) return "SECURITY";
  if (TRANSIENT.test(error)) return "TRANSIENT";
  return "LOGICAL";
}

export interface RecoveryContext {
  classification: FailureClass;
  attempts: number;
  maxAttempts: number;
  corrections: number;
  maxCorrections: number;
  isGate: boolean;
  hasCorrectionTarget: boolean;
  alternativeAgentAvailable: boolean;
}

/**
 * RETRY transient · CORRECT logical · BLOCK security · WAIT approval ·
 * REASSIGN when retries are spent but another qualified agent exists ·
 * ESCALATE when the limits are reached. Never retries indefinitely.
 */
export function decideRecovery(ctx: RecoveryContext): RecoveryAction {
  switch (ctx.classification) {
    case "SECURITY":
      return "BLOCK";
    case "APPROVAL":
      return "WAIT";
    case "TRANSIENT":
      if (ctx.attempts < ctx.maxAttempts) return "RETRY";
      return ctx.alternativeAgentAvailable ? "REASSIGN" : "ESCALATE";
    case "LOGICAL":
      if (ctx.isGate && ctx.hasCorrectionTarget) {
        return ctx.corrections < ctx.maxCorrections ? "CORRECT" : "ESCALATE";
      }
      return ctx.attempts < ctx.maxAttempts ? "CORRECT" : "ESCALATE";
  }
}

/* ------------------------------------------------------------------ */
/* Queue ordering                                                     */
/* ------------------------------------------------------------------ */

const PRIORITY_WEIGHT: Readonly<Record<OrchPriority, number>> = {
  low: 0,
  normal: 100,
  high: 200,
  critical: 300,
};
const RISK_WEIGHT = { low: 0, medium: 5, high: 10 } as const;

/**
 * Higher runs first: explicit priority, then dependency criticality (how many
 * tasks wait on this one), risk (gates early), and earlier workflow position.
 */
export function queueScore(
  task: OrchTask,
  dependents: number,
  position: number,
): number {
  return (
    PRIORITY_WEIGHT[task.priority] +
    dependents * 10 +
    RISK_WEIGHT[task.risk] -
    position * 0.1
  );
}

/* ------------------------------------------------------------------ */
/* Model requirement mapping                                          */
/* ------------------------------------------------------------------ */

export interface ModelNeed {
  requiredCapabilities: ModelCapability[];
  routingProfile: RoutingProfile;
  structuredOutput: boolean;
  /** Plain-language rationale recorded on the task. */
  rationale: string;
}

/** Deterministic, configurable-by-edit mapping from task shape to a model need. */
export function modelNeedFor(
  task: Pick<OrchTask, "type" | "risk" | "estimate">,
): ModelNeed {
  const small = (task.estimate?.inputTokens ?? 0) < 800 && task.risk === "low";
  switch (task.type) {
    case "DEVELOPMENT":
      return task.risk === "high" || !small
        ? {
            requiredCapabilities: ["coding", "reasoning"],
            routingProfile:
              task.risk === "high" ? "high_assurance" : "quality_first",
            structuredOutput: false,
            rationale: "Non-trivial code change: coding + reasoning",
          }
        : {
            requiredCapabilities: ["coding"],
            routingProfile: "cost_efficient",
            structuredOutput: false,
            rationale: "Small, low-risk edit: efficient coding model",
          };
    case "REVIEW":
    case "SECURITY":
      return {
        requiredCapabilities: ["coding", "reasoning"],
        routingProfile: "high_assurance",
        structuredOutput: true,
        rationale: "Review needs coding and reasoning with structured findings",
      };
    case "DESIGN":
      return {
        requiredCapabilities: ["reasoning"],
        routingProfile: "balanced",
        structuredOutput: false,
        rationale: "Design reasoning",
      };
    case "MAINTENANCE":
      return {
        requiredCapabilities: ["reasoning"],
        routingProfile: "high_assurance",
        structuredOutput: true,
        rationale: "Destructive-adjacent work: high assurance",
      };
    case "INTEGRATION":
    case "DEPLOYMENT":
      return {
        requiredCapabilities: ["structured_output"],
        routingProfile: "cost_efficient",
        structuredOutput: true,
        rationale: "Tool-driven step: efficient structured model",
      };
    case "RESEARCH":
      return {
        requiredCapabilities: ["reasoning", "large_context"],
        routingProfile: "balanced",
        structuredOutput: false,
        rationale: "Research: reasoning with a large context",
      };
    default:
      return {
        requiredCapabilities: ["reasoning"],
        routingProfile: "cost_efficient",
        structuredOutput: false,
        rationale: "Analysis/test/documentation: efficient model",
      };
  }
}

/** Canonicalize a list of capability ids; throws on an unknown id. */
export function requireCanonical(ids: readonly string[]): string[] {
  return ids.map((id) => {
    const canonical = canonicalizeCapability(id);
    if (!canonical) throw new Error(`orchestration: unknown capability ${id}`);
    return canonical;
  });
}
