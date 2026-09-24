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
import {
  canTransitionPlan,
  NotFoundError,
  StateTransitionError,
  ValidationError,
  type ExecutionPlan,
  type Repository,
} from "../../contracts/index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { serializeExecutionPlan } from "./execution-plan-serialization.js";

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

  /* -------------------------------------------------------------- */
  /* Rules                                                         */
  /* -------------------------------------------------------------- */

  /** A NEW version must be storable and continue its series without gaps. */
  assertNewVersion(plan: ExecutionPlan): void {
    serializeExecutionPlan(plan);
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
  }

  /** A lifecycle change may only touch lifecycle fields, along the lifecycle. */
  assertTransition(current: ExecutionPlan, next: ExecutionPlan): void {
    if (current.id !== next.id) {
      throw new ValidationError("a transition must target the same version");
    }
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
    serializeExecutionPlan(next);
  }

  /* -------------------------------------------------------------- */
  /* Local writes (after a successful store commit, or in tests)   */
  /* -------------------------------------------------------------- */

  /** Cache a plan that is known to be valid and committed. */
  load(plan: ExecutionPlan): void {
    this.repo.upsert(plan);
  }

  /** Check + cache a new version (local-only use; production commits first). */
  create(plan: ExecutionPlan): ExecutionPlan {
    this.assertNewVersion(plan);
    this.repo.upsert(plan);
    return plan;
  }

  /** Check + cache a lifecycle change (local-only use). */
  transition(next: ExecutionPlan): ExecutionPlan {
    this.assertTransition(this.require(next.id), next);
    this.repo.upsert(next);
    return next;
  }

  /* -------------------------------------------------------------- */
  /* Reads                                                         */
  /* -------------------------------------------------------------- */

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

  /** Current revision = highest version number. */
  latestVersion(planId: string): ExecutionPlan | undefined {
    return this.versions(planId)[0];
  }

  /**
   * All plan documents of a project in a deterministic order: newest first
   * by `createdAt`, then version descending, then id descending.
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
}
