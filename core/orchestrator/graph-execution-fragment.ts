import {
  GRAPH_LIMITS,
  type GraphFragment,
  type GraphOperationalState,
  type WorkforceGraphEdge,
  type WorkforceGraphEdgeType,
  type WorkforceGraphNode,
  type WorkforceGraphNodeType,
} from "../../contracts/graph.js";
import type {
  Approval,
  ChangeSet,
  CommitReceipt,
  ExecutionSession,
  ReleaseReceipt,
  ReviewRecord,
  VerificationResult,
} from "../../contracts/index.js";
import {
  APPROVAL_STATE,
  CHANGESET_STATE,
  RELEASE_STATE,
  REVIEW_STATE,
  SESSION_STATE,
  VERIFICATION_STATE,
  normalise,
} from "./graph-execution-state.js";
import { byId, safeMetadata, truncate } from "./graph-util.js";

const MAX_LABEL = 120;

/**
 * Authoritative execution-lifecycle records for ONE project, already fetched
 * through authorised control-plane reads. This module is pure: it never
 * fetches, never mutates, and never invents a record or a relationship.
 */
export interface ExecutionGraphRecords {
  sessions: readonly ExecutionSession[];
  changeSets: readonly ChangeSet[];
  verifications: readonly VerificationResult[];
  reviews: readonly ReviewRecord[];
  commits: readonly CommitReceipt[];
  releases: readonly ReleaseReceipt[];
  /** Approvals referenced by the records above, resolved by id. */
  approvals: readonly Approval[];
}

export const EMPTY_EXECUTION_RECORDS: ExecutionGraphRecords = {
  sessions: [],
  changeSets: [],
  verifications: [],
  reviews: [],
  commits: [],
  releases: [],
  approvals: [],
};

export interface ExecutionFragmentInput {
  projectId: string;
  projectNodeId: string;
  records: ExecutionGraphRecords;
  /**
   * Ids already present in the base graph. Edges to tasks, agents and
   * environment instances are only emitted when the endpoint really exists,
   * so the fragment can never dangle or reference another project's node.
   */
  existingNodeIds: ReadonlySet<string>;
  /** Maps a registry environment-instance id to its opaque graph node id. */
  environmentNodeId?: (instanceId: string) => string;
}

/** Stable graph ids. Exported so the UI/tests never re-derive them by hand. */
export const executionNodeId = {
  session: (id: string) => `session-${id}`,
  changeSet: (id: string) => `changeset-${id}`,
  verification: (id: string) => `verification-${id}`,
  review: (id: string) => `review-${id}`,
  approval: (id: string) => `approval-${id}`,
  commit: (id: string) => `commit-${id}`,
  deployment: (id: string) => `deployment-${id}`,
} as const;

/** Newest first by the given timestamp, then id, capped per family. */
function newest<T>(
  items: readonly T[],
  at: (item: T) => string | undefined,
  id: (item: T) => string,
): T[] {
  return [...items]
    .sort(
      (a, b) =>
        (at(b) ?? "").localeCompare(at(a) ?? "") || id(a).localeCompare(id(b)),
    )
    .slice(0, GRAPH_LIMITS.maxExecutionRecords);
}

export function buildExecutionFragment(
  input: ExecutionFragmentInput,
): GraphFragment {
  const { projectId, records, existingNodeIds } = input;
  const nodes = new Map<string, WorkforceGraphNode>();
  const edges = new Map<string, WorkforceGraphEdge>();

  const node = (
    id: string,
    type: WorkforceGraphNodeType,
    referenceId: string,
    label: string,
    status: string,
    state: GraphOperationalState,
    metadata: Record<string, string | number | boolean | undefined>,
  ): void => {
    if (nodes.has(id)) return;
    const safe = safeMetadata(metadata);
    nodes.set(id, {
      id,
      type,
      label: truncate(label, MAX_LABEL),
      status,
      state,
      projectId,
      referenceId,
      ...(safe ? { metadata: safe } : {}),
    });
  };
  const has = (id: string): boolean =>
    nodes.has(id) || existingNodeIds.has(id);
  const edge = (
    type: WorkforceGraphEdgeType,
    source: string,
    target: string,
    status?: string,
  ): void => {
    if (!has(source) || !has(target)) return;
    const id = `${type.toLowerCase()}-${source}-${target}`;
    if (!edges.has(id)) {
      edges.set(id, { id, type, source, target, ...(status ? { status } : {}) });
    }
  };

  const sessions = newest(records.sessions, (s) => s.createdAt, (s) => s.sessionId);
  const changeSets = newest(records.changeSets, (c) => c.updatedAt, (c) => c.changeSetId);
  const verifications = newest(records.verifications, (v) => v.createdAt, (v) => v.verificationId);
  const reviews = newest(records.reviews, (r) => r.createdAt, (r) => r.reviewId);
  const commits = newest(records.commits, (c) => c.createdAt, (c) => c.receiptId);
  const releases = newest(records.releases, (r) => r.startedAt, (r) => r.releaseId);

  // ---- nodes (every record is same-project; foreign rows are dropped) ----
  for (const s of sessions) {
    if (s.projectId !== projectId) continue;
    node(
      executionNodeId.session(s.sessionId),
      "EXECUTION_SESSION",
      s.sessionId,
      `Session ${s.stageKind}`,
      s.status,
      normalise(SESSION_STATE, s.status),
      {
        stageKind: s.stageKind,
        risk: s.risk,
        attempts: s.attempts.length,
        revision: s.revision,
        policyVersion: s.policy.version,
        createdAt: s.createdAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        cancelRequested: s.cancellation ? true : undefined,
      },
    );
  }
  for (const c of changeSets) {
    if (c.projectId !== projectId) continue;
    node(
      executionNodeId.changeSet(c.changeSetId),
      "CHANGESET",
      c.changeSetId,
      "ChangeSet",
      c.status,
      normalise(CHANGESET_STATE, c.status),
      // Counts only — never paths, hashes or file contents.
      { fileCount: c.entries.length, baselineCount: c.baseline.length, updatedAt: c.updatedAt },
    );
  }
  for (const v of verifications) {
    if (v.projectId !== projectId) continue;
    node(
      executionNodeId.verification(v.verificationId),
      "VERIFICATION",
      v.verificationId,
      "Verification",
      v.status,
      normalise(VERIFICATION_STATE, v.status),
      {
        stages: v.stages.length,
        passedStages: v.stages.filter((s) => s.status === "passed").length,
        failedStages: v.stages.filter((s) => s.status === "failed").length,
        unverifiedStages: v.unverifiedStageIds.length,
        createdAt: v.createdAt,
        completedAt: v.completedAt,
      },
    );
  }
  for (const r of reviews) {
    if (r.projectId !== projectId) continue;
    node(
      executionNodeId.review(r.reviewId),
      "REVIEW",
      r.reviewId,
      "Review",
      r.status,
      normalise(REVIEW_STATE, r.status),
      { reviewerKind: r.reviewerKind, createdAt: r.createdAt },
    );
  }
  for (const c of commits) {
    if (c.projectId !== projectId) continue;
    node(
      executionNodeId.commit(c.receiptId),
      "COMMIT",
      c.receiptId,
      `Commit ${c.commitSha.slice(0, 7)}`,
      "committed",
      "completed",
      { commitSha: c.commitSha, branch: c.branch, createdAt: c.createdAt },
    );
  }
  for (const r of releases) {
    if (r.projectId !== projectId) continue;
    node(
      executionNodeId.deployment(r.releaseId),
      "DEPLOYMENT",
      r.releaseId,
      // VISUALIZATION != EXECUTION: a simulated release must never read as a real one.
      `Deployment ${r.targetClass}${r.simulated ? " (simulated)" : ""}`,
      r.status,
      normalise(RELEASE_STATE, r.status),
      {
        targetClass: r.targetClass,
        simulated: r.simulated,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationMs: r.durationMs,
      },
    );
  }

  // ---- approvals: only those a same-project record actually references ----
  const approvalById = new Map(records.approvals.map((a) => [a.id, a]));
  const approvalEdge = (sourceId: string, ids: readonly string[]): void => {
    if (!nodes.has(sourceId)) return;
    for (const approvalId of ids) {
      const a = approvalById.get(approvalId);
      if (!a) continue;
      node(
        executionNodeId.approval(a.id),
        "APPROVAL",
        a.id,
        // The action says WHAT is being approved (commit / push / deployment / a tool call); a bare
        // "Approval" would make different decisions indistinguishable at the point of deciding.
        `Approval: ${a.action}`,
        a.status,
        normalise(APPROVAL_STATE, a.status),
        {
          action: a.action,
          requestedAt: a.requestedAt,
          decidedAt: a.decidedAt,
          expiresAt: a.expiresAt,
        },
      );
      edge("REQUIRES_APPROVAL", sourceId, executionNodeId.approval(a.id));
    }
  };

  // ---- edges: only from authoritative identifiers on the records ----
  for (const s of sessions) {
    const sid = executionNodeId.session(s.sessionId);
    if (!nodes.has(sid)) continue;
    if (s.taskId) edge("EXECUTES", `task-${s.taskId}`, sid);
    edge("EXECUTES", `agent-${s.agentId}`, sid);
    if (input.environmentNodeId) {
      edge("RUNS_ON", sid, input.environmentNodeId(s.environmentInstanceId));
    }
    approvalEdge(sid, s.approvalIds);
  }
  for (const c of changeSets) {
    edge(
      "PRODUCES",
      executionNodeId.session(c.sessionId),
      executionNodeId.changeSet(c.changeSetId),
    );
  }
  for (const v of verifications) {
    const vid = executionNodeId.verification(v.verificationId);
    if (v.changeSetId && has(executionNodeId.changeSet(v.changeSetId))) {
      edge("VERIFIED_BY", executionNodeId.changeSet(v.changeSetId), vid);
    } else if (v.sourceSessionId) {
      edge("VERIFIED_BY", executionNodeId.session(v.sourceSessionId), vid);
    }
  }
  for (const r of reviews) {
    edge(
      "REVIEWED_BY",
      executionNodeId.changeSet(r.changeSetId),
      executionNodeId.review(r.reviewId),
    );
  }
  const commitByHash = new Map<string, string>();
  for (const c of commits) {
    const cid = executionNodeId.commit(c.receiptId);
    commitByHash.set(c.commitSha, cid);
    edge("COMMITTED_AS", executionNodeId.changeSet(c.changeSetId), cid);
    approvalEdge(cid, c.approvalIds);
  }
  for (const r of releases) {
    const did = executionNodeId.deployment(r.releaseId);
    // COMMIT != DEPLOYMENT: linked only through the release's own commit SHA.
    const commitId = commitByHash.get(r.commitSha);
    if (commitId) edge("DEPLOYED_TO", commitId, did);
    approvalEdge(did, r.approvalIds);
  }

  // Every record is authoritatively owned by this project. A node with no
  // lifecycle parent (e.g. a commit whose ChangeSet fell outside the bound)
  // hangs directly off the project so it stays reachable — the ownership is
  // real (`projectId`), only the intermediate link is not claimed.
  const hasParent = new Set([...edges.values()].map((e) => e.target));
  for (const n of nodes.values()) {
    if (n.type !== "APPROVAL" && !hasParent.has(n.id)) {
      edge("CONTAINS", input.projectNodeId, n.id);
    }
  }

  return {
    nodes: [...nodes.values()].sort(byId),
    edges: [...edges.values()].sort(byId),
  };
}
