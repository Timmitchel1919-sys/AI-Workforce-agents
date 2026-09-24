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
import { type ExecutionPlan, type ExecutionPlanRecord } from "../../contracts/index.js";
/** Firestore documents are capped at 1 MiB; stay well below. */
export declare const MAX_PLAN_BYTES = 200000;
/**
 * A stored plan record failed validation. Deliberately NOT a
 * `WorkforceError`: it is a server-side integrity fault (HTTP 500), never a
 * client error, and its message never echoes stored content.
 */
export declare class CorruptPlanRecordError extends Error {
    readonly recordId: string | undefined;
    constructor(recordId: string | undefined, cause: unknown);
}
/** Validate + canonicalize a plan for storage. Throws `ValidationError`. */
export declare function serializeExecutionPlan(plan: ExecutionPlan): ExecutionPlanRecord;
/** Rebuild a plan from a stored record, or throw `CorruptPlanRecordError`. */
export declare function deserializeExecutionPlan(record: unknown): ExecutionPlan;
/**
 * Structural + referential integrity beyond `validateExecutionPlan`: stable
 * unique ids, stage → environment/agent references, and a valid dependency
 * graph (known edges, acyclic `order`, no duplicates). Throws
 * `ValidationError`.
 */
export declare function assertPlanIntegrity(plan: ExecutionPlan): void;
