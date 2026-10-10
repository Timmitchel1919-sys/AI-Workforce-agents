/**
 * Deterministic ExecutionPlan serialization (EO-3.2).
 *
 *   domain ExecutionPlan  ⇄  ExecutionPlanRecord (plain JSON, sorted keys)
 *
 * Serialization validates, refuses secrets and oversize documents, drops
 * `undefined` and orders keys canonically, so the same plan always produces
 * the same record. Deserialization is FAIL-CLOSED: a stored record that does
 * not satisfy the full contract (including the dependency graph and stage
 * references) raises `CorruptPlanRecordError` — no field is invented and no
 * partially valid plan is returned.
 */
import {
  AGENT_REJECTION_REASONS,
  BLOCKER_CODES,
  EXECUTION_PLAN_SCHEMA_VERSION,
  PLAN_STATUSES,
  ValidationError,
  validateExecutionPlan,
  type ExecutionPlan,
  type ExecutionPlanRecord,
} from "../../contracts/index.js";
import { sortKeys } from "./project-architect.js";
import { assertNoSecrets } from "./plan-secret-guard.js";

/** Firestore documents are capped at 1 MiB; stay well below. */
export const MAX_PLAN_BYTES = 200_000;

/**
 * A stored plan record failed validation. Deliberately NOT a
 * `WorkforceError`: it is a server-side integrity fault (HTTP 500), never a
 * client error, and its message never echoes stored content.
 */
export class CorruptPlanRecordError extends Error {
  readonly recordId: string | undefined;

  constructor(recordId: string | undefined, cause: unknown) {
    super("stored execution plan record failed validation");
    this.name = "CorruptPlanRecordError";
    this.recordId = recordId;
    this.cause = cause;
  }
}

/** Validate + canonicalize a plan for storage. Throws `ValidationError`. */
export function serializeExecutionPlan(
  plan: ExecutionPlan,
): ExecutionPlanRecord {
  assertPlanIntegrity(plan);
  assertNoSecrets(plan);
  const record = sortKeys(
    JSON.parse(JSON.stringify(plan)),
  ) as ExecutionPlanRecord;
  const size = JSON.stringify(record).length;
  if (size > MAX_PLAN_BYTES) {
    throw new ValidationError(
      `execution plan is too large to store (${size} bytes)`,
    );
  }
  return record;
}

/** Rebuild a plan from a stored record, or throw `CorruptPlanRecordError`. */
export function deserializeExecutionPlan(record: unknown): ExecutionPlan {
  const id =
    record && typeof record === "object" && "id" in record
      ? String((record as { id: unknown }).id)
      : undefined;
  try {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new ValidationError("record must be an object");
    }
    const plan = structuredClone(record) as unknown as ExecutionPlan;
    assertPlanIntegrity(plan);
    assertNoSecrets(plan);
    return plan;
  } catch (error) {
    throw new CorruptPlanRecordError(id, error);
  }
}

/**
 * Structural + referential integrity beyond `validateExecutionPlan`: stable
 * unique ids, stage → environment/agent references, and a valid dependency
 * graph (known edges, acyclic `order`, no duplicates). Throws
 * `ValidationError`.
 */
export function assertPlanIntegrity(plan: ExecutionPlan): void {
  validateExecutionPlan(plan);
  if (plan.schemaVersion !== EXECUTION_PLAN_SCHEMA_VERSION) {
    throw new ValidationError("unsupported plan schema version");
  }
  if (!PLAN_STATUSES.includes(plan.status)) {
    throw new ValidationError("unknown plan status");
  }
  if (!plan.approval || typeof plan.approval.state !== "string") {
    throw new ValidationError("plan.approval is required");
  }
  if (!plan.analysis || !Array.isArray(plan.analysis.technologies)) {
    throw new ValidationError("plan.analysis is malformed");
  }
  if (!plan.architecture || !Array.isArray(plan.architecture.components)) {
    throw new ValidationError("plan.architecture is malformed");
  }

  const envIds = uniqueIds(plan.environments, "environments");
  for (const env of plan.environments) {
    if (!env.match || !Array.isArray(env.match.candidates)) {
      throw new ValidationError(`environment ${env.id} has no match evidence`);
    }
    if (env.status !== "satisfied" && env.status !== "missing") {
      throw new ValidationError(`environment ${env.id} has an invalid status`);
    }
    if (
      (env.status === "satisfied") !==
      Boolean(env.match.selectedInstanceId)
    ) {
      throw new ValidationError(
        `environment ${env.id} selection and status disagree`,
      );
    }
  }

  const agentReqIds = uniqueIds(plan.agentRequirements, "agentRequirements");
  for (const assignment of plan.agents) {
    if (!agentReqIds.has(assignment.requirementId)) {
      throw new ValidationError("agent assignment references no requirement");
    }
    if (
      (assignment.qualification === "qualified") !==
      Boolean(assignment.agentId)
    ) {
      throw new ValidationError(
        "agent assignment qualification is inconsistent",
      );
    }
    for (const c of assignment.candidates) {
      c.reasonCodes.forEach((r) => {
        if (!AGENT_REJECTION_REASONS.includes(r)) {
          throw new ValidationError("unknown agent rejection reason");
        }
      });
    }
  }
  for (const model of plan.models) {
    if (!agentReqIds.has(model.agentRequirementId)) {
      throw new ValidationError(
        "model requirement references no agent requirement",
      );
    }
  }

  const buildIds = uniqueIds(plan.build, "build");
  for (const stage of plan.build) {
    if (!envIds.has(stage.environmentRequirementId)) {
      throw new ValidationError(
        `build stage ${stage.id} references no environment`,
      );
    }
    if (!agentReqIds.has(stage.agentRequirementId)) {
      throw new ValidationError(
        `build stage ${stage.id} references no agent requirement`,
      );
    }
  }
  uniqueIds(plan.tests, "tests");
  for (const stage of plan.tests) {
    if (!stage.dependsOnStageIds.every((id) => buildIds.has(id))) {
      throw new ValidationError(
        `test stage ${stage.id} depends on an unknown stage`,
      );
    }
  }
  uniqueIds(plan.security, "security");
  uniqueIds(plan.deployment, "deployment");
  uniqueIds(plan.approvalRequirements, "approvalRequirements");
  plan.blockers.forEach((b) => {
    if (!BLOCKER_CODES.includes(b.code)) {
      throw new ValidationError("unknown blocker code");
    }
  });

  // Dependency graph: unique ids, known edges, `order` is a valid topological
  // order over a subset of nodes, and every node missing from `order` is
  // explained by a recorded conflict.
  const deps = uniqueIds(plan.dependencies.items, "dependencies.items");
  const position = new Map<string, number>();
  plan.dependencies.order.forEach((id, index) => {
    if (!deps.has(id) || position.has(id)) {
      throw new ValidationError("dependency order is malformed");
    }
    position.set(id, index);
  });
  const conflicted = new Set(
    plan.dependencies.conflicts.map((c) => c.dependencyId),
  );
  for (const item of plan.dependencies.items) {
    const at = position.get(item.id);
    if (at === undefined) {
      if (
        !conflicted.has(item.id) &&
        !item.dependsOn.some((d) => !position.has(d))
      ) {
        throw new ValidationError("dependency order omits a resolvable node");
      }
      continue;
    }
    for (const dep of item.dependsOn) {
      const depAt = position.get(dep);
      if (depAt === undefined || depAt >= at) {
        throw new ValidationError("dependency order violates an edge");
      }
    }
  }
}

function uniqueIds(
  items: readonly { id: string }[],
  field: string,
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || item.id.trim() === "") {
      throw new ValidationError(`plan.${field} contains an item without id`);
    }
    if (ids.has(item.id)) {
      throw new ValidationError(
        `plan.${field} contains duplicate id ${item.id}`,
      );
    }
    ids.add(item.id);
  }
  return ids;
}
