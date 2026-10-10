/**
 * ExecutionPlanRepository — the in-process view of execution plans plus the
 * domain rules every revision must satisfy.
 *
 * Since EO-3.2 the AUTHORITATIVE copy lives in an `ExecutionPlanStore`
 * (Firestore in production) and every write is an atomic store commit made by
 * `ExecutionPlanningService`. This repository holds validated plans loaded
 * from — or just committed to — that store, and enforces:
 *
 *   - versions are separate documents (`${planId}@v${version}`), numbered
 *     1, 2, 3 … without gaps, never overwritten with different content;
 *   - after creation only lifecycle fields (status, approval, blockers on
 *     rejection, supersededBy, updatedAt) may change, along allowed
 *     transitions only;
 *   - the CURRENT revision is the highest version number — never a client
 *     timestamp.
 *
 * It never imports Firestore.
 */
import { type ExecutionPlan, type Repository } from "../../contracts/index.js";
export declare class ExecutionPlanRepository {
    private readonly repo;
    constructor(repo?: Repository<ExecutionPlan>);
    /** A NEW version must be storable and continue its series without gaps. */
    assertNewVersion(plan: ExecutionPlan): void;
    /** A lifecycle change may only touch lifecycle fields, along the lifecycle. */
    assertTransition(current: ExecutionPlan, next: ExecutionPlan): void;
    /** Cache a plan that is known to be valid and committed. */
    load(plan: ExecutionPlan): void;
    /** Check + cache a new version (local-only use; production commits first). */
    create(plan: ExecutionPlan): ExecutionPlan;
    /** Check + cache a lifecycle change (local-only use). */
    transition(next: ExecutionPlan): ExecutionPlan;
    get(id: string): ExecutionPlan | undefined;
    require(id: string): ExecutionPlan;
    /** Every version of one plan series, newest first. */
    versions(planId: string): ExecutionPlan[];
    /** Current revision = highest version number. */
    latestVersion(planId: string): ExecutionPlan | undefined;
    /**
     * All plan documents of a project in a deterministic order: newest first
     * by `createdAt`, then version descending, then id descending.
     */
    listByProject(projectId: string): ExecutionPlan[];
}
