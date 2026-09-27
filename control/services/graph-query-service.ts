import { deriveInsights } from "../../core/orchestrator/graph-insights.js";
import {
  WorkforceGraphProjectionService,
  mixRevision,
} from "../../core/orchestrator/graph-projection.js";
import {
  GRAPH_MODES,
  type GraphMode,
  type GraphQueryOptions,
  type WorkforceGraphProjection,
} from "../../contracts/graph.js";
import type { ControlPlaneContext } from "../index.js";
import type { ExecutionManager } from "../../core/execution/execution-manager.js";
import {
  EMPTY_EXECUTION_RECORDS,
  type ExecutionGraphRecords,
} from "../../core/orchestrator/graph-execution-fragment.js";
import { GRAPH_LIMITS, type SpatialInsightsReport } from "../../contracts/graph.js";
import { inertReleaseCapabilities } from "../../contracts/release.js";
import {
  OperatorPrincipal,
  operatorCanAccessProject,
  validateOperatorPrincipal,
  operatorCan,
  PermissionDeniedError,
  ValidationError,
} from "../../contracts/index.js";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

function parseBoundedInt(
  params: URLSearchParams,
  key: string,
): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw === "") return undefined;
  if (!/^\d{1,6}$/.test(raw)) {
    throw new ValidationError(`${key} must be a positive integer`);
  }
  const value = Number(raw);
  if (value < 1) throw new ValidationError(`${key} must be a positive integer`);
  return value;
}

/**
 * Parses and validates the graph query string. Numeric bounds are clamped
 * later by the projection service; here we only reject malformed input.
 */
export function parseGraphQueryParams(
  projectId: string,
  params: URLSearchParams,
): GraphQueryOptions {
  const options: GraphQueryOptions = { projectId };
  const mode = params.get("mode");
  if (mode !== null && mode !== "") {
    const upper = mode.toUpperCase();
    if (!(GRAPH_MODES as readonly string[]).includes(upper)) {
      throw new ValidationError(`unsupported graph mode: ${mode}`);
    }
    options.mode = upper as GraphMode;
  }
  const depth = parseBoundedInt(params, "depth");
  if (depth !== undefined) options.depth = depth;
  const maxNodes = parseBoundedInt(params, "maxNodes");
  if (maxNodes !== undefined) options.maxNodes = maxNodes;
  const rootNodeId = params.get("rootNodeId");
  if (rootNodeId !== null && rootNodeId !== "") {
    if (!ID_PATTERN.test(rootNodeId)) {
      throw new ValidationError("rootNodeId is malformed");
    }
    options.rootNodeId = rootNodeId;
  }
  return options;
}

interface Collected {
  records: ExecutionGraphRecords;
  /** Configured but the read failed. */
  unavailable: string[];
  /** Not wired in this deployment at all. Distinct from "read and found nothing". */
  notConfigured: string[];
}

/** Lifecycle-record read sharing window, and its hard cap on distinct projects held. */
const RECORD_CACHE_TTL_MS = 3_000;
const RECORD_CACHE_MAX = 64;

/** Modes whose view includes execution-lifecycle nodes. */
const EXECUTION_MODES: ReadonlySet<GraphMode> = new Set(["EXECUTION", "AGENT"]);

export class GraphQueryService {
  private readonly projectionService: WorkforceGraphProjectionService;
  private readonly recordCache = new Map<
    string,
    { at: number; value: Promise<Collected> }
  >();

  constructor(private readonly ctx: ControlPlaneContext) {
    this.projectionService = new WorkforceGraphProjectionService(
      ctx.projects,
      ctx.agents,
      ctx.tasks,
      ctx.softwareFactory,
      {
        agentOps: ctx.agentOps,
        workflows: ctx.workflows,
        ...(ctx.environments ? { environments: ctx.environments } : {}),
        ...(ctx.knowledge ? { knowledge: ctx.knowledge } : {}),
      },
    );
  }

  /**
   * Authorisation happens here, before any projection work: an operator who
   * cannot access the project gets `undefined` (indistinguishable from a
   * missing project). The projection service re-clamps all bounds.
   *
   * Lifecycle records are fetched through the SAME authorised, project-scoped
   * reads the Control Center uses, with the caller's principal — the graph
   * never reads a store directly.
   */
  public async getWorkforceGraph(
    principal: OperatorPrincipal,
    options: GraphQueryOptions,
  ): Promise<WorkforceGraphProjection | undefined> {
    validateOperatorPrincipal(principal);
    if (!operatorCan(principal, "view")) {
      throw new PermissionDeniedError("Operator cannot view Control Center.");
    }
    if (!operatorCanAccessProject(principal, options.projectId)) {
      return undefined; // Hide existence of the project
    }
    const mode = options.mode ?? "WORKFORCE";
    if (!EXECUTION_MODES.has(mode)) {
      return this.projectionService.getProjection(options);
    }
    // An unknown project id (reachable by a wildcard-scoped operator) must not create cache
    // entries or cause source reads; the projection reports it as not found.
    if (!this.ctx.projects.get(options.projectId)) {
      return this.projectionService.getProjection(options);
    }
    const { records, unavailable, notConfigured } = await this.collectExecutionRecords(
      principal,
      options.projectId,
    );
    const projection = this.projectionService.getProjection(options, records);
    // A source that failed OR does not exist in this deployment must read as "unknown", never as
    // "nothing happened". The lists are part of what the client sees but not of the node/edge set,
    // so they are folded into the revision: a `since` poll can never answer "unchanged" across a
    // source failing, recovering or being wired.
    const inert = this.inertCapabilities();
    if (unavailable.length === 0 && notConfigured.length === 0 && inert.length === 0) {
      return projection;
    }
    return {
      ...projection,
      revision: mixRevision(
        projection.revision,
        `unavailable:${unavailable.join(",")}|notConfigured:${notConfigured.join(",")}|inert:${inert.join(",")}`,
      ),
      metadata: {
        ...projection.metadata,
        ...(unavailable.length > 0 ? { unavailableSources: unavailable.join(",") } : {}),
        ...(notConfigured.length > 0 ? { notConfiguredSources: notConfigured.join(",") } : {}),
        ...(inert.length > 0 ? { inertCapabilities: inert.join(",") } : {}),
      },
    };
  }

  /**
   * Spatial intelligence for one project (EO-5.8): grounded observations over the SAME authorised
   * graph the operator can see. Authorisation is identical to the graph's, and it is read-only —
   * nothing here writes, executes or invokes a command.
   */
  public async getInsights(
    principal: OperatorPrincipal,
    projectId: string,
  ): Promise<SpatialInsightsReport | undefined> {
    validateOperatorPrincipal(principal);
    if (!operatorCan(principal, "view")) {
      throw new PermissionDeniedError("Operator cannot view Control Center.");
    }
    if (!operatorCanAccessProject(principal, projectId)) return undefined;
    if (!this.ctx.projects.get(projectId)) return undefined;
    const { records, unavailable, notConfigured } = await this.collectExecutionRecords(principal, projectId);
    const graph = this.projectionService.getInsightGraph(projectId, records);
    const { findings, truncated } = deriveInsights(graph);
    return {
      projectId,
      graphRevision:
        unavailable.length === 0 && notConfigured.length === 0 && this.inertCapabilities().length === 0
          ? graph.revision
          : mixRevision(
              graph.revision,
              `unavailable:${unavailable.join(",")}|notConfigured:${notConfigured.join(",")}|inert:${this.inertCapabilities().join(",")}`,
            ),
      generatedAt: graph.generatedAt,
      findings,
      truncated,
      ...(unavailable.length > 0 ? { unavailableSources: unavailable } : {}),
      ...(notConfigured.length > 0 ? { notConfiguredSources: notConfigured } : {}),
      ...(this.inertCapabilities().length > 0 ? { inertCapabilities: this.inertCapabilities() } : {}),
      basis: "observed_state",
    };
  }

  /** Release capabilities this deployment lacks (empty when it declares none or has them all). */
  private inertCapabilities(): string[] {
    const caps = this.ctx.releaseCapabilities;
    return caps ? inertReleaseCapabilities(caps) : [];
  }

  /**
   * Lifecycle records are project-scoped and identical for every operator who passed the project
   * gate above, so one short-lived (promise-shared) read serves every concurrent poll for the
   * project. This bounds the per-poll cost (reconcile + ChangeSet fan-out) to roughly one read
   * per project per TTL no matter how many tabs are open. The cache is consulted only AFTER
   * authorisation, so it can never serve an unauthorised caller.
   */
  private collectExecutionRecords(
    principal: OperatorPrincipal,
    projectId: string,
  ): Promise<Collected> {
    const now = (this.ctx.clock ?? Date.now)();
    const hit = this.recordCache.get(projectId);
    const age = hit ? now - hit.at : Infinity;
    // A negative age (the clock stepped backwards) is NOT fresh: STALE != CURRENT.
    if (hit && age >= 0 && age < RECORD_CACHE_TTL_MS) return hit.value;
    const value = this.readExecutionRecords(principal, projectId);
    this.recordCache.delete(projectId); // replacing a key must never evict an unrelated project
    if (this.recordCache.size >= RECORD_CACHE_MAX) {
      // Bounded: drop the oldest entry (Map preserves insertion order).
      const oldest = this.recordCache.keys().next().value;
      if (oldest !== undefined) this.recordCache.delete(oldest);
    }
    this.recordCache.set(projectId, { at: now, value });
    value.catch(() => {
      // Evict only our own entry, never a newer one that replaced it.
      if (this.recordCache.get(projectId)?.value === value) this.recordCache.delete(projectId);
    });
    return value;
  }

  private async readExecutionRecords(
    principal: OperatorPrincipal,
    projectId: string,
  ): Promise<Collected> {
    const { ctx } = this;
    const limit = GRAPH_LIMITS.maxExecutionRecords;
    const unavailable = new Set<string>();
    const notConfigured = new Set<string>();
    const attempt = async <T>(
      name: string,
      configured: boolean,
      read: () => Promise<T>,
      fallback: T,
    ): Promise<T> => {
      if (!configured) {
        // Not wired in this deployment: nothing can be shown about it, which is NOT "nothing happened".
        notConfigured.add(name);
        return fallback;
      }
      try {
        return await read();
      } catch {
        unavailable.add(name);
        return fallback;
      }
    };

    // Newest first BEFORE the cap: never rely on a store's return order to keep the latest.
    const sessions = (
      await attempt(
        "sessions",
        !!ctx.execution,
        () => ctx.execution!.listSessions(principal, projectId),
        [],
      )
    )
      .slice()
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          a.sessionId.localeCompare(b.sessionId),
      )
      .slice(0, limit);

    // One failing ChangeSet read marks ChangeSets as partly unknown; it does not blank the rest.
    const changeSets: NonNullable<Awaited<ReturnType<ExecutionManager["getChangeSet"]>>>[] = [];
    if (!ctx.execution) notConfigured.add("changeSets");
    if (ctx.execution) {
      const settled = await Promise.allSettled(
        sessions.map((s) => ctx.execution!.getChangeSet(principal, s.sessionId)),
      );
      for (const r of settled) {
        if (r.status === "rejected") unavailable.add("changeSets");
        else if (r.value !== undefined) changeSets.push(r.value);
      }
    }
    const verifications = await attempt(
      "verifications",
      !!ctx.verification,
      () => ctx.verification!.listHistory(principal, projectId, limit),
      [],
    );
    const activity = await attempt<
      Pick<ExecutionGraphRecords, "reviews" | "commits">
    >(
      "sourceControl",
      !!ctx.sourceControl,
      async () => {
        const a = await ctx.sourceControl!.activity(principal, projectId, limit);
        return { reviews: a.reviews, commits: a.commits };
      },
      { reviews: [], commits: [] },
    );
    const releases = await attempt(
      "releases",
      !!ctx.deployments,
      () => ctx.deployments!.listReleases(principal, projectId, limit),
      [],
    );

    const approvalIds = new Set<string>([
      ...sessions.flatMap((s) => s.approvalIds),
      ...activity.commits.flatMap((c) => c.approvalIds),
      ...releases.flatMap((r) => r.approvalIds),
    ]);
    // Approvals carry no projectId of their own. Ids come only from same-project records, and
    // where a binding stamped a project on the approval it must match (defence in depth).
    const approvals = [...approvalIds]
      .map((id) => ctx.approvals.get(id))
      .filter((a): a is NonNullable<typeof a> => a !== undefined)
      .filter((a) => {
        const bound = a.decisionMetadata?.projectId;
        return typeof bound !== "string" || bound === projectId;
      });

    return {
      records: {
        ...EMPTY_EXECUTION_RECORDS,
        sessions,
        changeSets,
        verifications,
        reviews: activity.reviews,
        commits: activity.commits,
        releases,
        approvals,
      },
      unavailable: [...unavailable].sort(),
      notConfigured: [...notConfigured].sort(),
    };
  }
}
