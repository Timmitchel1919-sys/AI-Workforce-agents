import type { GraphOperationalState } from "../../contracts/graph.js";
import type { ApprovalStatus, ExecutionSessionStatus, ChangeSetStatus, ReleaseStatus, ReviewStatus, VerificationStatus } from "../../contracts/index.js";
/**
 * Typed normalisation of each execution-lifecycle domain's status enum into
 * the graph's operational vocabulary (EO-5.6). Every table is an exhaustive
 * `Record` over the source union, so a new source status is a compile error
 * here instead of a silently-wrong colour. Source-domain semantics are never
 * changed: the raw status stays on the node, only `state` is derived.
 *
 * The shared `toGraphState` map cannot serve these domains because the same
 * word means different things (`pending` is "awaiting review" for a review but
 * "awaiting approval" for an approval and merely "queued" for a release).
 */
export declare const SESSION_STATE: Readonly<Record<ExecutionSessionStatus, GraphOperationalState>>;
export declare const CHANGESET_STATE: Readonly<Record<ChangeSetStatus, GraphOperationalState>>;
export declare const VERIFICATION_STATE: Readonly<Record<VerificationStatus, GraphOperationalState>>;
export declare const REVIEW_STATE: Readonly<Record<ReviewStatus, GraphOperationalState>>;
export declare const APPROVAL_STATE: Readonly<Record<ApprovalStatus, GraphOperationalState>>;
export declare const RELEASE_STATE: Readonly<Record<ReleaseStatus, GraphOperationalState>>;
/**
 * Lookup that never invents a state for a status the table does not know.
 * `hasOwn` keeps inherited keys ("constructor", "__proto__") from resolving.
 */
export declare function normalise<S extends string>(table: Readonly<Record<S, GraphOperationalState>>, status: string): GraphOperationalState;
