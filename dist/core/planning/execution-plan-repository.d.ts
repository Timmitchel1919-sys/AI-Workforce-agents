/**
 * ExecutionPlanRepository — plan persistence over the provider-neutral
 * `Repository<ExecutionPlan>` port (in-memory by default; Firestore through
 * `FirebaseRepositoryProvider` → `CachedRepository` in production). The
 * planning domain never imports Firestore.
 *
 * Versions are separate documents (`${planId}@v${version}`) and are never
 * overwritten with different content: after creation a document may only
 * change its lifecycle fields (status, approval, blockers on rejection,
 * supersede links, updatedAt), and only along an allowed transition.
 */
import { type ExecutionPlan, type Repository } from "../../contracts/index.js";
/** Firestore documents are capped at 1 MiB; stay well below. */
export declare const MAX_PLAN_BYTES = 200000;
export declare class ExecutionPlanRepository {
    private readonly repo;
    constructor(repo?: Repository<ExecutionPlan>);
    /** Store a NEW version. Refuses to overwrite an existing document. */
    create(plan: ExecutionPlan): ExecutionPlan;
    /** Apply a lifecycle change to an existing version. */
    transition(next: ExecutionPlan): ExecutionPlan;
    get(id: string): ExecutionPlan | undefined;
    require(id: string): ExecutionPlan;
    /** Every version of one plan series, newest first. */
    versions(planId: string): ExecutionPlan[];
    /** Current revision = highest version number (never a client timestamp). */
    latestVersion(planId: string): ExecutionPlan | undefined;
    /**
     * All plan documents of a project: newest series first (by creation of its
     * first version), versions descending, id as final tie-break.
     */
    listByProject(projectId: string): ExecutionPlan[];
    private assertStorable;
}
