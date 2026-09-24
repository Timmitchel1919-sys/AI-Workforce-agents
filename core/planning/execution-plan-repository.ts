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
import {
  canTransitionPlan,
  NotFoundError,
  StateTransitionError,
  ValidationError,
  validateExecutionPlan,
  type ExecutionPlan,
  type Repository,
} from "../../contracts/index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { assertNoSecrets } from "./plan-secret-guard.js";

/** Firestore documents are capped at 1 MiB; stay well below. */
export const MAX_PLAN_BYTES = 200_000;

const LIFECYCLE_FIELDS = new Set([
  "status",
  "approval",
  "blockers",
  "supersededBy",
  "updatedAt",
]);

export class ExecutionPlanRepository {
  constructor(
    private readonly repo: Repository<ExecutionPlan> = new InMemoryRepository<ExecutionPlan>(),
  ) {}

  /** Store a NEW version. Refuses to overwrite an existing document. */
  create(plan: ExecutionPlan): ExecutionPlan {
    this.assertStorable(plan);
    if (this.repo.findById(plan.id)) {
      throw new ValidationError(`execution plan ${plan.id} already exists`);
    }
    const latest = this.latestVersion(plan.planId);
    if (latest && plan.version !== latest.version + 1) {
      throw new ValidationError(
        `execution plan ${plan.planId} must continue at version ${latest.version + 1}`,
      );
    }
    if (!latest && plan.version !== 1) {
      throw new ValidationError("a new execution plan starts at version 1");
    }
    this.repo.upsert(plan);
    return plan;
  }

  /** Apply a lifecycle change to an existing version. */
  transition(next: ExecutionPlan): ExecutionPlan {
    const current = this.require(next.id);
    for (const key of Object.keys({
      ...current,
      ...next,
    }) as (keyof ExecutionPlan)[]) {
      if (LIFECYCLE_FIELDS.has(key)) continue;
      if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) {
        throw new ValidationError(
          `execution plan field "${key}" is immutable once created`,
        );
      }
    }
    if (
      current.status !== next.status &&
      !canTransitionPlan(current.status, next.status)
    ) {
      throw new StateTransitionError(
        `execution plan ${next.id} cannot move from ${current.status} to ${next.status}`,
      );
    }
    this.assertStorable(next);
    this.repo.upsert(next);
    return next;
  }

  get(id: string): ExecutionPlan | undefined {
    return this.repo.findById(id);
  }

  require(id: string): ExecutionPlan {
    const plan = this.get(id);
    if (!plan) throw new NotFoundError(`unknown execution plan: ${id}`);
    return plan;
  }

  /** Every version of one plan series, newest first. */
  versions(planId: string): ExecutionPlan[] {
    return this.repo
      .list()
      .filter((p) => p.planId === planId)
      .sort((a, b) => b.version - a.version);
  }

  /** Current revision = highest version number (never a client timestamp). */
  latestVersion(planId: string): ExecutionPlan | undefined {
    return this.versions(planId)[0];
  }

  /**
   * All plan documents of a project: newest series first (by creation of its
   * first version), versions descending, id as final tie-break.
   */
  listByProject(projectId: string): ExecutionPlan[] {
    return this.repo
      .list()
      .filter((p) => p.projectId === projectId)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          b.version - a.version ||
          b.id.localeCompare(a.id),
      );
  }

  private assertStorable(plan: ExecutionPlan): void {
    validateExecutionPlan(plan);
    assertNoSecrets(plan);
    const size = JSON.stringify(plan).length;
    if (size > MAX_PLAN_BYTES) {
      throw new ValidationError(
        `execution plan is too large to store (${size} bytes)`,
      );
    }
  }
}
