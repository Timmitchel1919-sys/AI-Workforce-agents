/**
 * KnowledgeControlService — the governed read/command surface for Knowledge,
 * Memory & Context Intelligence.
 *
 * Reads need `view` plus access to the memory's project (platform SYSTEM memory
 * is readable by every operator). Commands need `manage_knowledge`, are audited
 * as `control_command`, and act as the signed-in user: only a user can confirm
 * memory, resolve a conflict or mark something CRITICAL. Frontend claims are
 * never trusted — authorization is derived from the principal here, and the
 * retrieval engine enforces project scope again independently.
 */
import {
  NotFoundError,
  PermissionDeniedError,
  StateTransitionError,
  ValidationError,
  operatorCan,
  operatorCanAccessProject,
  type CommandOptions,
  type ControlCommand,
  type ControlCommandResult,
  type ControlErrorKind,
  type OperatorPrincipal,
} from "../../contracts/index.js";
import {
  KNOWLEDGE_COMMANDS,
  MEMORY_CONFIDENCE,
  MEMORY_IMPORTANCE,
  MEMORY_SOURCES,
  MEMORY_STATUSES,
  MEMORY_TYPES,
  RELATION_TYPES,
  type ContextPackage,
  type MemoryRecord,
  type MemoryStatus,
} from "../../contracts/knowledge-memory.js";
import {
  KnowledgeError,
  clip,
  type Actor,
  type KnowledgeSystem,
  type MemoryProposal,
  type ProjectFileSource,
} from "../../core/index.js";
import { resolveCorrelationId } from "../correlation.js";
import { redact } from "../redaction.js";

type Body = Record<string, unknown>;

export interface KnowledgeControlDeps {
  knowledge: KnowledgeSystem;
  audit: import("../../core/index.js").AuditLog;
  /** Does the project exist in the registry? */
  projectExists: (projectId: string) => boolean;
  /** Where a project's files can be read from (workspace / GitHub), if anywhere. */
  sourceFor?: (projectId: string) => Promise<ProjectFileSource | undefined>;
  clock?: () => string;
}

const asString = (
  v: unknown,
  name: string,
  required = true,
): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ValidationError(`${name} is required`);
    return undefined;
  }
  if (typeof v !== "string")
    throw new ValidationError(`${name} must be a string`);
  return v;
};
const oneOf = <T extends string>(
  v: unknown,
  list: readonly T[],
  name: string,
): T | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !(list as readonly string[]).includes(v))
    throw new ValidationError(`${name} must be one of: ${list.join(", ")}`);
  return v as T;
};

export function summaryOf(m: MemoryRecord) {
  return {
    memoryId: m.memoryId,
    type: m.type,
    title: m.title,
    summary: m.summary,
    projectId: m.projectId ?? null,
    source: m.source,
    sourceRef: m.sourceRef ?? null,
    confidence: m.confidence,
    importance: m.importance,
    status: m.status,
    freshness: m.freshness,
    version: m.version,
    tags: m.tags,
    retention: m.retention,
    expiresAt: m.expiresAt ?? null,
    updatedAt: m.updatedAt,
    createdAt: m.createdAt,
  };
}

export class KnowledgeControlService {
  private readonly clock: () => string;
  private readonly k: KnowledgeSystem;

  constructor(private readonly deps: KnowledgeControlDeps) {
    this.k = deps.knowledge;
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  private requireReader(p: OperatorPrincipal): void {
    if (!operatorCan(p, "view"))
      throw new PermissionDeniedError("insufficient capabilities");
  }
  private canSee(p: OperatorPrincipal, m: MemoryRecord): boolean {
    return m.projectId === undefined
      ? true
      : operatorCanAccessProject(p, m.projectId);
  }
  private requireProject(
    p: OperatorPrincipal,
    projectId: string | undefined,
  ): void {
    if (projectId !== undefined && !operatorCanAccessProject(p, projectId))
      throw new NotFoundError("project not found");
  }
  private mustSee(p: OperatorPrincipal, id: unknown): MemoryRecord {
    if (typeof id !== "string" || id === "")
      throw new ValidationError("memoryId is required");
    const m = this.k.memory.get(id);
    if (!m || !this.canSee(p, m)) throw new NotFoundError("memory not found");
    return m;
  }
  private scope(p: OperatorPrincipal) {
    return {
      projectIds:
        p.allowedProjects === "*" ? ("*" as const) : [...p.allowedProjects],
      actor: p.id,
    };
  }
  private actor(p: OperatorPrincipal): Actor {
    return { id: p.id, kind: "USER", admin: p.role === "admin" };
  }

  /* ---------------------------- reads ---------------------------- */

  overview(p: OperatorPrincipal, projectId?: string) {
    this.requireReader(p);
    this.requireProject(p, projectId);
    const allowed = (id?: string) =>
      id === undefined || operatorCanAccessProject(p, id);
    const health = this.k.health(projectId);
    // Health over all visible projects when no project is chosen.
    const findings = this.k.auditor
      .run(projectId)
      .filter((f) => allowed(f.projectId));
    return {
      health: projectId ? health : this.visibleHealth(p),
      findings,
      conflicts: this.k.memory
        .listConflicts(projectId)
        .filter((c) => allowed(c.projectId)).length,
      candidates: this.listFiltered(p, { projectId, statuses: ["DRAFT"] })
        .length,
      capabilities: {
        retrieval:
          "hybrid: keyword (BM25 + synonyms) + trigram similarity + metadata + graph",
        embeddings: false,
        pdfExtraction: false,
        canWrite: operatorCan(p, "manage_knowledge"),
      },
      generatedAt: this.clock(),
    };
  }

  private visibleHealth(p: OperatorPrincipal) {
    const base = this.k.health();
    if (p.allowedProjects === "*") return base;
    // Recompute over visible memories only (never leak counts from other projects).
    const out = {
      ...base,
      total: 0,
      potentiallyStale: 0,
      unverified: 0,
      drafts: 0,
      documents: 0,
    };
    out.byStatus = Object.fromEntries(
      MEMORY_STATUSES.map((s) => [s, 0]),
    ) as typeof base.byStatus;
    out.byType = Object.fromEntries(
      MEMORY_TYPES.map((t) => [t, 0]),
    ) as typeof base.byType;
    for (const m of this.k.memory.all()) {
      if (!this.canSee(p, m)) continue;
      out.total++;
      out.byStatus[m.status]++;
      out.byType[m.type]++;
      if (m.type === "DOCUMENT") out.documents++;
      if (m.status === "DRAFT") out.drafts++;
      if (
        (m.status === "ACTIVE" || m.status === "DRAFT") &&
        m.freshness === "POTENTIALLY_STALE"
      )
        out.potentiallyStale++;
      if (
        (m.status === "ACTIVE" || m.status === "DRAFT") &&
        (m.confidence === "UNVERIFIED" || m.confidence === "INFERRED")
      )
        out.unverified++;
    }
    out.conflicts = this.k.memory
      .listConflicts()
      .filter((c) => operatorCanAccessProject(p, c.projectId)).length;
    return out;
  }

  private listFiltered(
    p: OperatorPrincipal,
    f: {
      projectId?: string | undefined;
      types?: readonly string[];
      statuses?: readonly MemoryStatus[];
      sources?: readonly string[];
      confidences?: readonly string[];
      importances?: readonly string[];
      since?: string | undefined;
      q?: string | undefined;
    },
  ): MemoryRecord[] {
    const q = f.q?.toLowerCase().trim();
    return this.k.memory
      .all()
      .filter((m) => this.canSee(p, m))
      .filter((m) => !f.projectId || m.projectId === f.projectId)
      .filter(
        (m) => !f.types || f.types.length === 0 || f.types.includes(m.type),
      )
      .filter(
        (m) =>
          !f.statuses ||
          f.statuses.length === 0 ||
          f.statuses.includes(m.status),
      )
      .filter(
        (m) =>
          !f.sources || f.sources.length === 0 || f.sources.includes(m.source),
      )
      .filter(
        (m) =>
          !f.confidences ||
          f.confidences.length === 0 ||
          f.confidences.includes(m.confidence),
      )
      .filter(
        (m) =>
          !f.importances ||
          f.importances.length === 0 ||
          f.importances.includes(m.importance),
      )
      .filter((m) => !f.since || m.updatedAt >= f.since)
      .filter(
        (m) =>
          !q ||
          `${m.title} ${m.summary} ${m.tags.join(" ")}`
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private csv<T extends string>(
    v: string | null | undefined,
    list: readonly T[],
    name: string,
  ): T[] | undefined {
    if (!v) return undefined;
    return v
      .split(",")
      .map((x) => oneOf(x.trim(), list, name)!)
      .filter(Boolean);
  }

  list(p: OperatorPrincipal, params: URLSearchParams) {
    this.requireReader(p);
    const projectId = params.get("projectId") ?? undefined;
    this.requireProject(p, projectId);
    const limit = Math.min(
      Math.max(Number(params.get("limit") ?? "100") || 100, 1),
      300,
    );
    const rows = this.listFiltered(p, {
      projectId,
      types: this.csv(params.get("type"), MEMORY_TYPES, "type"),
      statuses: this.csv(params.get("status"), MEMORY_STATUSES, "status"),
      sources: this.csv(params.get("source"), MEMORY_SOURCES, "source"),
      confidences: this.csv(
        params.get("confidence"),
        MEMORY_CONFIDENCE,
        "confidence",
      ),
      importances: this.csv(
        params.get("importance"),
        MEMORY_IMPORTANCE,
        "importance",
      ),
      since: params.get("since") ?? undefined,
      q: params.get("q") ?? undefined,
    });
    return {
      memories: rows.slice(0, limit).map(summaryOf),
      total: rows.length,
    };
  }

  search(p: OperatorPrincipal, params: URLSearchParams) {
    this.requireReader(p);
    const projectId = params.get("projectId") ?? undefined;
    this.requireProject(p, projectId);
    const q = params.get("q") ?? "";
    if (q.trim() === "") throw new ValidationError("q is required");
    const hits = this.k.retrieval.search(
      {
        text: q.slice(0, 500),
        ...(projectId ? { projectId } : {}),
        limit: Math.min(Number(params.get("limit") ?? "20") || 20, 50),
        statuses: this.csv(params.get("status"), MEMORY_STATUSES, "status") ?? [
          "ACTIVE",
        ],
        ...(params.get("type")
          ? { types: this.csv(params.get("type"), MEMORY_TYPES, "type")! }
          : {}),
        ...(params.get("source")
          ? {
              sources: this.csv(
                params.get("source"),
                MEMORY_SOURCES,
                "source",
              )!,
            }
          : {}),
        ...(params.get("confidence")
          ? {
              confidences: this.csv(
                params.get("confidence"),
                MEMORY_CONFIDENCE,
                "confidence",
              )!,
            }
          : {}),
        ...(params.get("importance")
          ? {
              importances: this.csv(
                params.get("importance"),
                MEMORY_IMPORTANCE,
                "importance",
              )!,
            }
          : {}),
        ...(params.get("since") ? { since: params.get("since")! } : {}),
      },
      this.scope(p),
    );
    return {
      hits: hits.map((h) => ({
        ...summaryOf(h.memory),
        score: h.score,
        signals: h.signals,
        reasons: h.reasons,
        stale: h.stale,
        conflictWith: h.conflictWith,
      })),
    };
  }

  detail(p: OperatorPrincipal, memoryId: string) {
    this.requireReader(p);
    const m = this.mustSee(p, memoryId);
    const edges = this.k.memory.repos.edges
      .list()
      .filter(
        (e) => e.from === `mem:${m.memoryId}` || e.to === `mem:${m.memoryId}`,
      );
    const related = edges
      .map((e) => {
        const other = e.from === `mem:${m.memoryId}` ? e.to : e.from;
        const mem = other.startsWith("mem:")
          ? this.k.memory.get(other.slice(4))
          : undefined;
        const ent = this.k.memory.repos.entities.findById(other);
        return {
          relation: e.type,
          direction: e.from === `mem:${m.memoryId}` ? "out" : "in",
          node: other,
          label: mem?.title ?? ent?.label ?? other,
          memoryId: mem && this.canSee(p, mem) ? mem.memoryId : null,
        };
      })
      .slice(0, 40);
    const brief = (id?: string) => {
      const x = id ? this.k.memory.get(id) : undefined;
      return x && this.canSee(p, x)
        ? { memoryId: x.memoryId, title: x.title, status: x.status }
        : null;
    };
    return {
      memory: {
        ...summaryOf(m),
        content: m.content,
        references: m.references,
        facets: m.facets,
        createdBy: m.createdBy,
        statusReason: m.statusReason ?? null,
        reinforced: m.reinforced,
        agentId: m.agentId ?? null,
      },
      provenance: {
        source: m.source,
        sourceRef: m.sourceRef ?? null,
        createdBy: m.createdBy,
        createdAt: m.createdAt,
        answer: `Created by ${m.createdBy} from ${m.source}${m.sourceRef ? ` (${m.sourceRef})` : ""}, confidence ${m.confidence}.`,
      },
      supersedes: brief(m.supersedes),
      supersededBy: brief(m.supersededBy),
      versions: this.k.memory
        .history(m.memoryId)
        .map((v) => ({
          version: v.version,
          at: v.at,
          by: v.by,
          change: v.change,
          status: v.snapshot.status,
          title: v.snapshot.title,
        })),
      related,
      usage: this.k.retrieval
        .usageFor(m.memoryId)
        .slice(-20)
        .map((u) => ({
          taskId: u.taskId,
          agentId: u.agentId,
          reason: u.reason,
          result: u.result,
          at: u.at,
        })),
      conflicts: this.k.memory.conflictsFor(m),
    };
  }

  graph(p: OperatorPrincipal, params: URLSearchParams) {
    this.requireReader(p);
    const projectId = asString(params.get("projectId"), "projectId")!;
    this.requireProject(p, projectId);
    const types = this.csv(params.get("types"), RELATION_TYPES, "types");
    const includeMemories = params.get("memories") === "1";
    const nodes = this.k.memory.repos.entities
      .list()
      .filter(
        (e) =>
          e.projectId === projectId && (includeMemories || e.kind !== "MEMORY"),
      )
      .slice(0, 300);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = this.k.memory.repos.edges
      .list()
      .filter(
        (e) =>
          ids.has(e.from) &&
          ids.has(e.to) &&
          (!types || types.includes(e.type)),
      )
      .slice(0, 800);
    return {
      projectId,
      nodes: nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
      edges: edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        type: e.type,
        source: e.source,
      })),
      truncated: nodes.length >= 300,
    };
  }

  conflicts(p: OperatorPrincipal, projectId?: string) {
    this.requireReader(p);
    this.requireProject(p, projectId);
    return {
      conflicts: this.k.memory
        .listConflicts(projectId)
        .filter((c) => operatorCanAccessProject(p, c.projectId)),
    };
  }

  documents(p: OperatorPrincipal, projectId?: string) {
    this.requireReader(p);
    this.requireProject(p, projectId);
    const sources = this.k.memory.repos.sources
      .list()
      .filter(
        (s) =>
          (!projectId || s.projectId === projectId) &&
          operatorCanAccessProject(p, s.projectId) &&
          !s.ref.startsWith("commit:"),
      )
      .map((s) => {
        const mems = s.memoryIds
          .map((id) => this.k.memory.get(id))
          .filter((m): m is MemoryRecord => !!m);
        return {
          projectId: s.projectId,
          ref: s.ref,
          ingestedAt: s.ingestedAt,
          chunks: mems.length,
          active: mems.filter((m) => m.status === "ACTIVE").length,
          potentiallyStale: mems.filter(
            (m) => m.freshness === "POTENTIALLY_STALE",
          ).length,
          tags: [...new Set(mems.flatMap((m) => m.tags))].slice(0, 8),
        };
      })
      .sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt));
    return { documents: sources };
  }

  decisions(p: OperatorPrincipal, projectId?: string) {
    this.requireReader(p);
    this.requireProject(p, projectId);
    return {
      decisions: this.listFiltered(p, {
        projectId,
        types: ["ARCHITECTURAL"],
      }).map(summaryOf),
    };
  }

  candidates(p: OperatorPrincipal, projectId?: string) {
    this.requireReader(p);
    this.requireProject(p, projectId);
    return {
      candidates: this.listFiltered(p, { projectId, statuses: ["DRAFT"] }).map(
        summaryOf,
      ),
    };
  }

  health(p: OperatorPrincipal, projectId?: string) {
    this.requireReader(p);
    this.requireProject(p, projectId);
    return projectId ? this.k.health(projectId) : this.visibleHealth(p);
  }

  findings(p: OperatorPrincipal, projectId?: string) {
    this.requireReader(p);
    this.requireProject(p, projectId);
    return {
      findings: this.k.auditor
        .run(projectId)
        .filter(
          (f) =>
            f.projectId === undefined ||
            operatorCanAccessProject(p, f.projectId),
        ),
    };
  }

  /** Preview the context package an agent of `role` would receive. */
  context(p: OperatorPrincipal, params: URLSearchParams): ContextPackage {
    this.requireReader(p);
    const projectId = asString(params.get("projectId"), "projectId")!;
    this.requireProject(p, projectId);
    const q = asString(params.get("q"), "q")!;
    return this.k.assembler.assemble({
      projectId,
      query: q.slice(0, 500),
      agent: { id: `preview:${p.id}`, role: params.get("role") ?? "developer" },
      scope: this.scope(p),
    });
  }

  /* --------------------------- commands -------------------------- */

  async execute(
    command: string,
    principal: OperatorPrincipal,
    body: Body,
    options?: CommandOptions,
  ): Promise<ControlCommandResult> {
    const correlationId = resolveCorrelationId(options);
    const resourceId =
      typeof body?.["memoryId"] === "string"
        ? (body["memoryId"] as string)
        : typeof body?.["projectId"] === "string"
          ? (body["projectId"] as string)
          : undefined;
    try {
      if (!(KNOWLEDGE_COMMANDS as readonly string[]).includes(command))
        throw new NotFoundError(`unknown command: ${command}`);
      if (!operatorCan(principal, "manage_knowledge"))
        throw new PermissionDeniedError(
          `role "${principal.role}" may not manage knowledge`,
        );
      const details = await this.run(command, principal, body ?? {});
      return this.result(
        principal,
        command as ControlCommand,
        "executed",
        undefined,
        "ok",
        resourceId,
        correlationId,
        details,
      );
    } catch (error) {
      const { outcome, kind } = classify(error);
      return this.result(
        principal,
        command as ControlCommand,
        outcome,
        kind,
        errorText(error),
        resourceId,
        correlationId,
        {},
      );
    }
  }

  private proposal(
    p: OperatorPrincipal,
    b: Body,
    fallbackType?: MemoryRecord["type"],
  ): MemoryProposal {
    const projectId = asString(b["projectId"], "projectId", false);
    if (projectId !== undefined) {
      if (!operatorCanAccessProject(p, projectId))
        throw new NotFoundError("project not found");
      if (!this.deps.projectExists(projectId))
        throw new NotFoundError("project not found");
    }
    const type = oneOf(b["type"], MEMORY_TYPES, "type") ?? fallbackType;
    if (!type) throw new ValidationError("type is required");
    const tags = Array.isArray(b["tags"])
      ? (b["tags"] as unknown[]).filter(
          (t): t is string => typeof t === "string",
        )
      : undefined;
    return {
      type,
      title: asString(b["title"], "title")!,
      content: asString(b["content"], "content")!,
      ...(projectId ? { projectId } : {}),
      source: "USER",
      ...(oneOf(b["importance"], MEMORY_IMPORTANCE, "importance")
        ? {
            importance: oneOf(
              b["importance"],
              MEMORY_IMPORTANCE,
              "importance",
            )!,
          }
        : {}),
      ...(tags ? { tags } : {}),
      // Created through the UI by the signed-in user: explicit unless they save it as a draft.
      explicit: b["draft"] === true ? false : true,
      ...(b["retention"] === "TEMPORARY" || b["retention"] === "PERMANENT"
        ? { retention: b["retention"] }
        : {}),
      ...(typeof b["expiresAt"] === "string"
        ? { expiresAt: b["expiresAt"] }
        : {}),
    };
  }

  private async run(
    command: string,
    p: OperatorPrincipal,
    b: Body,
  ): Promise<Record<string, unknown>> {
    const actor = this.actor(p);
    const mem = this.k.memory;
    switch (command) {
      case "knowledge_create_memory": {
        const res = mem.create(this.proposal(p, b), actor);
        return {
          memoryId: res.memory.memoryId,
          status: res.memory.status,
          outcome: res.outcome,
          decision: res.decision,
          projectId: res.memory.projectId,
        };
      }
      case "knowledge_update_memory": {
        const cur = this.mustSee(p, b["memoryId"]);
        const next = mem.update(
          cur.memoryId,
          {
            ...(typeof b["title"] === "string" ? { title: b["title"] } : {}),
            ...(typeof b["content"] === "string"
              ? { content: b["content"] }
              : {}),
            ...(Array.isArray(b["tags"])
              ? {
                  tags: (b["tags"] as unknown[]).filter(
                    (t): t is string => typeof t === "string",
                  ),
                }
              : {}),
            ...(oneOf(b["importance"], MEMORY_IMPORTANCE, "importance")
              ? {
                  importance: oneOf(
                    b["importance"],
                    MEMORY_IMPORTANCE,
                    "importance",
                  )!,
                }
              : {}),
          },
          actor,
          typeof b["reason"] === "string" ? clip(b["reason"], 120) : "updated",
        );
        return {
          memoryId: next.memoryId,
          version: next.version,
          projectId: next.projectId,
        };
      }
      case "knowledge_confirm_memory": {
        const cur = this.mustSee(p, b["memoryId"]);
        const next = mem.confirm(cur.memoryId, actor);
        return {
          memoryId: next.memoryId,
          status: next.status,
          confidence: next.confidence,
          projectId: next.projectId,
        };
      }
      case "knowledge_archive_memory": {
        const cur = this.mustSee(p, b["memoryId"]);
        return {
          memoryId: cur.memoryId,
          status: mem.archive(
            cur.memoryId,
            actor,
            typeof b["reason"] === "string"
              ? clip(b["reason"], 120)
              : "archived",
          ).status,
          projectId: cur.projectId,
        };
      }
      case "knowledge_restore_memory": {
        const cur = this.mustSee(p, b["memoryId"]);
        return {
          memoryId: cur.memoryId,
          status: mem.restore(cur.memoryId, actor).status,
          projectId: cur.projectId,
        };
      }
      case "knowledge_revoke_memory": {
        const cur = this.mustSee(p, b["memoryId"]);
        return {
          memoryId: cur.memoryId,
          status: mem.revoke(
            cur.memoryId,
            actor,
            typeof b["reason"] === "string"
              ? clip(b["reason"], 120)
              : "revoked",
          ).status,
          projectId: cur.projectId,
        };
      }
      case "knowledge_delete_memory": {
        const cur = this.mustSee(p, b["memoryId"]);
        mem.remove(cur.memoryId, actor);
        return {
          memoryId: cur.memoryId,
          deleted: true,
          projectId: cur.projectId,
        };
      }
      case "knowledge_supersede_memory": {
        const cur = this.mustSee(p, b["memoryId"]);
        const proposal = this.proposal(p, {
          ...b,
          projectId: cur.projectId,
          type: cur.type,
        });
        const res = mem.supersede(cur.memoryId, proposal, actor);
        return {
          memoryId: res.created.memoryId,
          supersededMemoryId: res.old.memoryId,
          projectId: cur.projectId,
        };
      }
      case "knowledge_link": {
        const projectId = asString(b["projectId"], "projectId")!;
        this.requireProject(p, projectId);
        if (!this.deps.projectExists(projectId))
          throw new NotFoundError("project not found");
        const type = oneOf(b["type"], RELATION_TYPES, "type");
        if (!type) throw new ValidationError("type is required");
        const nodeRef = (v: unknown, name: string): string => {
          const s = asString(v, name)!;
          if (s.startsWith("mem:")) {
            const m = this.mustSee(p, s.slice(4));
            if (m.projectId !== projectId)
              throw new ValidationError(
                "memories must belong to the same project",
              );
            return s;
          }
          return mem.entity(projectId, clip(s, 80), "OTHER").id;
        };
        const edge = mem.link(
          nodeRef(b["from"], "from"),
          nodeRef(b["to"], "to"),
          type,
          p.id,
          "USER",
          projectId,
        );
        return { edgeId: edge.id, projectId };
      }
      case "knowledge_resolve_conflict": {
        const conflictId = asString(b["conflictId"], "conflictId")!;
        const resolution = oneOf(
          b["resolution"],
          ["SUPERSEDED_OTHER", "KEPT_BOTH", "ARCHIVED_OTHER"] as const,
          "resolution",
        );
        if (!resolution) throw new ValidationError("resolution is required");
        const [a] = conflictId.split("|");
        const first = a ? mem.get(a) : undefined;
        if (!first || !this.canSee(p, first))
          throw new NotFoundError("conflict not found");
        const res = mem.resolveConflict(
          conflictId,
          resolution,
          actor,
          asString(b["winner"], "winner", false),
          asString(b["note"], "note", false),
        );
        return {
          conflictId: res.conflictId,
          resolution: res.resolution,
          projectId: res.projectId,
        };
      }
      case "knowledge_ingest_document": {
        const projectId = asString(b["projectId"], "projectId")!;
        this.requireProject(p, projectId);
        if (!this.deps.projectExists(projectId))
          throw new NotFoundError("project not found");
        const report = this.k.ingestion.ingestDocument({
          projectId,
          ref: asString(b["ref"], "ref")!,
          text: typeof b["text"] === "string" ? b["text"] : "",
          ...(typeof b["contentType"] === "string"
            ? { contentType: b["contentType"] }
            : {}),
          source: "DOCUMENT",
          requestedBy: p.id,
        });
        return { projectId, ...report };
      }
      case "knowledge_discover_project":
      case "knowledge_refresh_project": {
        const projectId = asString(b["projectId"], "projectId")!;
        this.requireProject(p, projectId);
        if (!this.deps.projectExists(projectId))
          throw new NotFoundError("project not found");
        const source = await this.deps.sourceFor?.(projectId);
        if (!source)
          throw new StateTransitionError(
            "no readable source is available for this project (no workspace is registered and no repository could be read)",
          );
        const report = await this.k.discovery.run({
          projectId,
          source,
          requestedBy: p.id,
          mode:
            command === "knowledge_refresh_project" ? "refresh" : "discover",
        });
        return {
          projectId,
          source: report.source,
          topics: report.topics.length,
          documents: report.documents.filter((d) => d.status === "ingested")
            .length,
          unchanged: report.documents.filter((d) => d.status === "unchanged")
            .length,
          staleMarked: report.staleMarked.length,
          conflicts: report.conflicts,
          truncated: report.truncated,
          unavailable: report.unavailable.slice(0, 8),
        };
      }
      case "knowledge_apply_retention": {
        if (p.role !== "admin")
          throw new PermissionDeniedError(
            "only an administrator applies retention",
          );
        const res = mem.applyRetention(actor);
        return { archived: res.archived.length };
      }
    }
    throw new NotFoundError(`unknown command: ${command}`);
  }

  private result(
    principal: OperatorPrincipal,
    command: ControlCommand,
    outcome: ControlCommandResult["outcome"],
    errorKind: ControlErrorKind | undefined,
    reason: string,
    resourceId: string | undefined,
    correlationId: string,
    details: Record<string, unknown>,
  ): ControlCommandResult {
    const event = this.deps.audit.record("control_command", {
      projectId:
        typeof details["projectId"] === "string"
          ? details["projectId"]
          : undefined,
      data: {
        ...redact(details),
        command,
        outcome,
        errorKind,
        correlationId,
        actor: principal?.id ?? "unknown",
        actorRole: principal?.role ?? "unknown",
        resourceId,
        reason,
      },
    });
    return {
      command,
      outcome,
      ok: outcome === "executed",
      errorKind,
      reason,
      resourceId,
      correlationId,
      details: redact(details) as Record<string, unknown>,
      auditEventId: event.id,
      timestamp: this.clock(),
    };
  }
}

function classify(error: unknown): {
  outcome: ControlCommandResult["outcome"];
  kind: ControlErrorKind;
} {
  if (error instanceof PermissionDeniedError)
    return { outcome: "denied", kind: "forbidden" };
  if (error instanceof KnowledgeError) {
    if (error.code === "policy" || error.code === "access_denied")
      return { outcome: "denied", kind: "forbidden" };
    if (error.code === "not_found")
      return { outcome: "rejected", kind: "not_found" };
    if (error.code === "invalid_state")
      return { outcome: "rejected", kind: "invalid_state" };
    return { outcome: "rejected", kind: "invalid_request" };
  }
  if (error instanceof NotFoundError)
    return { outcome: "rejected", kind: "not_found" };
  if (error instanceof StateTransitionError)
    return { outcome: "rejected", kind: "invalid_state" };
  if (error instanceof ValidationError)
    return { outcome: "rejected", kind: "invalid_request" };
  return { outcome: "rejected", kind: "command_failure" };
}

function errorText(error: unknown): string {
  if (
    error instanceof PermissionDeniedError ||
    error instanceof NotFoundError ||
    error instanceof StateTransitionError ||
    error instanceof ValidationError ||
    error instanceof KnowledgeError
  )
    return error.message;
  return "the command failed";
}
