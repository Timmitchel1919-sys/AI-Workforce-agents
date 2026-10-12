/**
 * MemoryService — the single governed write path for memory.
 *
 *   INGEST → CLASSIFY → VALIDATE → DEDUPLICATE → LINK → INDEX → ACTIVATE
 *
 * Every state change is versioned, audited (`knowledge_event`) and observable
 * through `subscribe` (the retrieval index listens). Critical architectural
 * decisions are never overwritten: they are superseded, which keeps history.
 */
import { randomBytes } from "node:crypto";
import { RELATION_TYPES, } from "../../contracts/knowledge-memory.js";
import { extractFacets, disagreements } from "./facets.js";
import { clip, contentHashOf, jaccard, slug, summarize, tokenize, } from "./text.js";
import { KnowledgeError, confidenceRank, decideWrite, importanceRank, } from "./write-policy.js";
/**
 * Write-through cache: the durable repository stays the source of truth, but
 * reads come from memory without defensive copies. Records are treated as
 * immutable by every caller (updates always build a new object).
 */
export class SyncCache {
    inner;
    items = new Map();
    constructor(inner) {
        this.inner = inner;
        for (const item of inner.list())
            this.items.set(item.id, item);
    }
    upsert(entity) {
        this.inner.upsert(entity);
        this.items.set(entity.id, entity);
    }
    findById(id) {
        return this.items.get(id);
    }
    list() {
        return [...this.items.values()];
    }
    delete(id) {
        this.inner.delete(id);
        return this.items.delete(id);
    }
    clear() {
        this.inner.clear();
        this.items.clear();
    }
}
/** Types whose statements can contradict each other. */
const DECISION_TYPES = [
    "ARCHITECTURAL",
    "PROJECT",
    "USER_PREFERENCE",
    "SYSTEM",
];
const newId = (prefix) => `${prefix}-${randomBytes(6).toString("hex")}`;
export class MemoryService {
    audit;
    clock;
    listeners = new Set();
    announced = new Set();
    suppress = new Set();
    /** Bumped on every change; retrieval caches key on it. */
    version = 0;
    /** Cached view over the durable repositories (reads never clone). */
    repos;
    tokenCache = new Map();
    constructor(repos, audit, clock = Date.now) {
        this.audit = audit;
        this.clock = clock;
        this.repos = {
            memories: new SyncCache(repos.memories),
            versions: new SyncCache(repos.versions),
            entities: new SyncCache(repos.entities),
            edges: new SyncCache(repos.edges),
            usage: new SyncCache(repos.usage),
            resolutions: new SyncCache(repos.resolutions),
            sources: new SyncCache(repos.sources),
        };
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    notify(change) {
        this.version++;
        for (const l of this.listeners)
            l(change);
    }
    iso() {
        return new Date(this.clock()).toISOString();
    }
    record(operation, actor, fields) {
        this.audit.record("knowledge_event", {
            ...(fields.projectId ? { projectId: fields.projectId } : {}),
            data: {
                operation,
                actor: typeof actor === "string" ? actor : actor.id,
                ...(typeof actor === "string" ? {} : { actorKind: actor.kind }),
                ...(fields.memoryId ? { memoryId: fields.memoryId } : {}),
                ...(fields.source ? { source: fields.source } : {}),
                result: fields.result ?? "ok",
                ...(fields.detail ?? {}),
            },
        });
    }
    /* ---------------------------------------------------------------- */
    /* Reads                                                            */
    /* ---------------------------------------------------------------- */
    get(memoryId) {
        return this.repos.memories.findById(memoryId);
    }
    require(memoryId) {
        const m = this.get(memoryId);
        if (!m)
            throw new KnowledgeError("not_found", "memory not found");
        return m;
    }
    all() {
        return this.repos.memories.list();
    }
    history(memoryId) {
        return this.repos.versions
            .list()
            .filter((v) => v.memoryId === memoryId)
            .sort((a, b) => a.version - b.version);
    }
    /* ---------------------------------------------------------------- */
    /* Create                                                           */
    /* ---------------------------------------------------------------- */
    create(proposal, actor) {
        const decision = decideWrite(proposal, actor, this.clock());
        const projectWords = proposal.projectId
            ? [proposal.projectId, ...proposal.projectId.split(/[-_]/)]
            : [];
        const facets = DECISION_TYPES.includes(proposal.type)
            ? extractFacets(`${decision.title}. ${decision.content}`, projectWords)
            : {};
        const contentHash = contentHashOf(decision.content);
        // DEDUPLICATE: the same statement reinforces the existing memory.
        const duplicate = this.findDuplicate(proposal, decision.content, contentHash, actor);
        if (duplicate) {
            const reinforced = this.reinforce(duplicate, proposal, decision, actor);
            return {
                memory: reinforced,
                outcome: "REINFORCED",
                decision: "duplicate: existing memory reinforced",
            };
        }
        const now = this.iso();
        const id = newId("mem");
        const memory = {
            id,
            memoryId: id,
            type: proposal.type,
            title: decision.title,
            content: decision.content,
            summary: summarize(decision.content),
            ...(proposal.projectId ? { projectId: proposal.projectId } : {}),
            source: proposal.source,
            ...(proposal.sourceRef ? { sourceRef: proposal.sourceRef } : {}),
            ...(proposal.sourceHash ? { sourceHash: proposal.sourceHash } : {}),
            createdAt: now,
            updatedAt: now,
            createdBy: actor.id,
            confidence: decision.confidence,
            importance: decision.importance,
            status: decision.status,
            version: 1,
            tags: decision.tags,
            references: (proposal.references ?? []).slice(0, 20),
            retention: decision.retention,
            ...(decision.expiresAt ? { expiresAt: decision.expiresAt } : {}),
            freshness: "FRESH",
            facets,
            contentHash,
            ...(proposal.type === "AGENT"
                ? { agentId: proposal.agentId ?? actor.agentId }
                : {}),
            reinforced: 0,
            statusReason: decision.reason,
        };
        this.repos.memories.upsert(memory);
        this.snapshot(memory, actor.id, "created");
        this.notify({ kind: "upsert", memory });
        this.record("memory.created", actor, {
            projectId: memory.projectId,
            memoryId: id,
            source: memory.source,
            detail: {
                type: memory.type,
                status: memory.status,
                confidence: memory.confidence,
                importance: memory.importance,
                redacted: decision.redacted,
            },
        });
        if (memory.status === "ACTIVE")
            this.afterActivation(memory, actor);
        return { memory, outcome: "CREATED", decision: decision.reason };
    }
    findDuplicate(proposal, content, contentHash, actor) {
        const tokens = new Set(tokenize(content));
        for (const m of this.repos.memories.list()) {
            if (m.contentHash === contentHash &&
                m.type === proposal.type &&
                m.projectId === proposal.projectId &&
                (m.status === "ACTIVE" || m.status === "DRAFT") &&
                m.type !== "AGENT")
                return m;
            if (m.type !== proposal.type || m.projectId !== proposal.projectId)
                continue;
            if (m.status !== "ACTIVE" && m.status !== "DRAFT")
                continue;
            if (m.type === "AGENT" &&
                m.agentId !== (proposal.agentId ?? actor.agentId))
                continue;
            if (m.contentHash === contentHash)
                return m;
            if (proposal.type !== "DOCUMENT" &&
                tokens.size >= 4 &&
                jaccard(tokens, this.tokensOf(m)) >= 0.92)
                return m;
        }
        return undefined;
    }
    tokensOf(m) {
        const key = `${m.memoryId}@${m.contentHash}`;
        let t = this.tokenCache.get(key);
        if (!t) {
            t = new Set(tokenize(m.content));
            this.tokenCache.set(key, t);
        }
        return t;
    }
    reinforce(existing, proposal, decision, actor) {
        const next = { ...existing };
        next.reinforced += 1;
        next.lastReinforcedAt = this.iso();
        next.updatedAt = next.lastReinforcedAt;
        for (const ref of proposal.references ?? []) {
            if (!next.references.some((r) => r.kind === ref.kind && r.ref === ref.ref))
                next.references = [...next.references, ref].slice(0, 20);
        }
        // A stronger statement of the same fact upgrades it; a weaker one never downgrades.
        let activated = false;
        if (confidenceRank(decision.confidence) > confidenceRank(next.confidence)) {
            next.confidence = decision.confidence;
            if (next.status === "DRAFT" && decision.status === "ACTIVE") {
                next.status = "ACTIVE";
                activated = true;
            }
        }
        if (importanceRank(decision.importance) > importanceRank(next.importance))
            next.importance = decision.importance;
        this.repos.memories.upsert(next);
        this.notify({ kind: "upsert", memory: next });
        this.record("memory.updated", actor, {
            projectId: next.projectId,
            memoryId: next.memoryId,
            source: proposal.source,
            detail: { reinforced: next.reinforced, activated },
        });
        if (activated)
            this.afterActivation(next, actor);
        return next;
    }
    snapshot(memory, by, change) {
        this.repos.versions.upsert({
            id: `${memory.memoryId}@${memory.version}`,
            memoryId: memory.memoryId,
            version: memory.version,
            at: this.iso(),
            by,
            change,
            snapshot: {
                title: memory.title,
                content: memory.content,
                summary: memory.summary,
                status: memory.status,
                confidence: memory.confidence,
                importance: memory.importance,
                tags: [...memory.tags],
                references: [...memory.references],
            },
        });
    }
    afterActivation(memory, actor) {
        if (memory.projectId) {
            this.ensureProjectLinks(memory);
            for (const conflict of this.conflictsFor(memory)) {
                if (this.announced.has(conflict.conflictId))
                    continue;
                this.announced.add(conflict.conflictId);
                this.record("memory.conflict_detected", actor, {
                    projectId: conflict.projectId,
                    memoryId: memory.memoryId,
                    detail: {
                        conflictId: conflict.conflictId,
                        facet: conflict.facet,
                        values: conflict.values,
                    },
                });
            }
        }
    }
    /** LINK: a memory is attached to its project entity in the graph. */
    ensureProjectLinks(memory) {
        if (!memory.projectId)
            return;
        const project = this.entity(memory.projectId, memory.projectId, "PROJECT");
        const node = this.repos.entities.findById(`mem:${memory.memoryId}`);
        if (!node) {
            this.repos.entities.upsert({
                id: `mem:${memory.memoryId}`,
                projectId: memory.projectId,
                label: clip(memory.title, 80),
                kind: "MEMORY",
                createdAt: this.iso(),
            });
        }
        this.link(`mem:${memory.memoryId}`, project.id, "BELONGS_TO", "system", "SYSTEM", memory.projectId);
        for (const [facet, value] of Object.entries(memory.facets)) {
            const label = value
                .split(" ")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ");
            const tech = this.entity(memory.projectId, label, facet === "theme" ? "AREA" : "TECHNOLOGY");
            this.link(`mem:${memory.memoryId}`, tech.id, "RELATED_TO", "system", "SYSTEM", memory.projectId);
        }
    }
    /* ---------------------------------------------------------------- */
    /* Lifecycle                                                        */
    /* ---------------------------------------------------------------- */
    update(memoryId, patch, actor, reason = "updated") {
        const current = this.require(memoryId);
        this.assertWritable(current, actor);
        if (current.status === "SUPERSEDED" || current.status === "REVOKED")
            throw new KnowledgeError("invalid_state", `a ${current.status} memory cannot be edited`);
        const protectedMemory = current.importance === "CRITICAL" || current.type === "ARCHITECTURAL";
        if (patch.content !== undefined &&
            patch.content !== current.content &&
            protectedMemory)
            throw new KnowledgeError("policy", "critical and architectural memory is never overwritten: supersede it with a new version");
        if (patch.importance === "CRITICAL" && actor.kind !== "USER")
            throw new KnowledgeError("policy", "only the user can mark memory CRITICAL");
        const next = { ...current };
        if (patch.title !== undefined)
            next.title = patch.title.trim() || current.title;
        if (patch.content !== undefined) {
            const decision = decideWrite({
                type: current.type,
                title: next.title,
                content: patch.content,
                ...(current.projectId ? { projectId: current.projectId } : {}),
                source: current.source,
                explicit: true,
                ...(current.agentId ? { agentId: current.agentId } : {}),
            }, actor.kind === "AGENT" ? { ...actor, kind: "AGENT" } : actor, this.clock());
            next.content = decision.content;
            next.summary = summarize(decision.content);
            next.contentHash = contentHashOf(decision.content);
            if (DECISION_TYPES.includes(next.type))
                next.facets = extractFacets(`${next.title}. ${next.content}`, next.projectId ? [next.projectId] : []);
            next.freshness = "FRESH";
        }
        if (patch.tags)
            next.tags = [
                ...new Set(patch.tags.map((t) => t.toLowerCase().trim()).filter(Boolean)),
            ].slice(0, 12);
        if (patch.importance)
            next.importance = patch.importance;
        next.version = current.version + 1;
        next.updatedAt = this.iso();
        this.repos.memories.upsert(next);
        this.snapshot(next, actor.id, reason);
        this.notify({ kind: "upsert", memory: next });
        this.record("memory.updated", actor, {
            projectId: next.projectId,
            memoryId,
            detail: { version: next.version },
        });
        if (next.status === "ACTIVE")
            this.afterActivation(next, actor);
        return next;
    }
    /** The user confirms a candidate: DRAFT → ACTIVE, USER_CONFIRMED. */
    confirm(memoryId, actor) {
        if (actor.kind !== "USER")
            throw new KnowledgeError("policy", "only the user can confirm memory");
        const current = this.require(memoryId);
        if (current.type === "SYSTEM" && !actor.admin)
            throw new KnowledgeError("policy", "only an administrator may confirm SYSTEM memory");
        if (current.status !== "DRAFT")
            throw new KnowledgeError("invalid_state", "only a draft can be confirmed");
        const next = this.transition(current, "ACTIVE", actor, "confirmed by the user");
        next.confidence = "USER_CONFIRMED";
        next.freshness = "FRESH";
        this.repos.memories.upsert(next);
        this.notify({ kind: "upsert", memory: next });
        this.afterActivation(next, actor);
        return next;
    }
    archive(memoryId, actor, reason = "archived") {
        const current = this.require(memoryId);
        this.assertWritable(current, actor);
        if (current.status === "ARCHIVED")
            return current;
        if (current.status === "REVOKED")
            throw new KnowledgeError("invalid_state", "a revoked memory cannot be archived");
        const next = this.transition(current, "ARCHIVED", actor, reason);
        this.record("memory.archived", actor, {
            projectId: next.projectId,
            memoryId,
        });
        return next;
    }
    restore(memoryId, actor) {
        const current = this.require(memoryId);
        this.assertWritable(current, actor);
        if (current.status !== "ARCHIVED")
            throw new KnowledgeError("invalid_state", "only an archived memory can be restored");
        if (current.expiresAt && Date.parse(current.expiresAt) <= this.clock())
            throw new KnowledgeError("invalid_state", "the memory has expired; edit its retention first");
        const next = this.transition(current, "ACTIVE", actor, "restored");
        this.record("memory.restored", actor, {
            projectId: next.projectId,
            memoryId,
        });
        this.afterActivation(next, actor);
        return next;
    }
    revoke(memoryId, actor, reason = "revoked") {
        const current = this.require(memoryId);
        if (actor.kind === "AGENT")
            throw new KnowledgeError("policy", "an agent cannot revoke memory");
        if ((current.importance === "CRITICAL" || current.type === "SYSTEM") &&
            !actor.admin)
            throw new KnowledgeError("policy", "revoking critical or system memory needs an administrator");
        if (current.status === "REVOKED")
            return current;
        const next = this.transition(current, "REVOKED", actor, reason);
        this.record("memory.revoked", actor, {
            projectId: next.projectId,
            memoryId,
            detail: { reason },
        });
        return next;
    }
    /**
     * Replace a decision by a new one. The old record is kept as SUPERSEDED and the
     * two are linked both ways (`supersedes` / `supersededBy` + a SUPERSEDES edge).
     */
    supersede(oldId, proposal, actor) {
        const old = this.require(oldId);
        this.assertWritable(old, actor);
        if (actor.kind === "AGENT")
            throw new KnowledgeError("policy", "an agent cannot supersede memory");
        if (old.status !== "ACTIVE" && old.status !== "DRAFT")
            throw new KnowledgeError("invalid_state", `a ${old.status} memory cannot be superseded`);
        if (proposal.projectId !== old.projectId || proposal.type !== old.type)
            throw new KnowledgeError("invalid_request", "the replacement must have the same project and type");
        // The old record is about to be superseded: it must not be announced as a conflict.
        this.suppress.add(old.memoryId);
        let res;
        try {
            res = this.create({ ...proposal, explicit: proposal.explicit ?? true }, actor);
        }
        finally {
            this.suppress.delete(old.memoryId);
        }
        if (res.outcome === "REINFORCED")
            throw new KnowledgeError("invalid_request", "the replacement says the same thing as an existing memory");
        const created = res.memory;
        if (created.status !== "ACTIVE")
            throw new KnowledgeError("policy", "the replacement did not become active; confirm it first");
        const oldNext = this.transition(old, "SUPERSEDED", actor, `superseded by ${created.memoryId}`);
        oldNext.supersededBy = created.memoryId;
        this.repos.memories.upsert(oldNext);
        const createdNext = {
            ...created,
            supersedes: old.memoryId,
            version: created.version,
        };
        this.repos.memories.upsert(createdNext);
        this.link(`mem:${createdNext.memoryId}`, `mem:${old.memoryId}`, "SUPERSEDES", actor.id, "USER", old.projectId);
        this.notify({ kind: "upsert", memory: oldNext });
        this.notify({ kind: "upsert", memory: createdNext });
        this.record("memory.superseded", actor, {
            projectId: old.projectId,
            memoryId: old.memoryId,
            detail: { supersededBy: createdNext.memoryId },
        });
        return { old: oldNext, created: createdNext };
    }
    remove(memoryId, actor) {
        const current = this.require(memoryId);
        this.assertWritable(current, actor);
        if (current.importance === "CRITICAL" ||
            current.type === "ARCHITECTURAL" ||
            current.type === "SYSTEM")
            throw new KnowledgeError("policy", "critical, architectural and system memory cannot be deleted; revoke it to keep the history");
        if (current.status === "ACTIVE")
            throw new KnowledgeError("invalid_state", "archive or revoke an active memory before deleting it");
        this.repos.memories.delete(memoryId);
        this.notify({ kind: "remove", id: memoryId });
        // Version history and the audit trail are kept.
        this.record("memory.deleted", actor, {
            projectId: current.projectId,
            memoryId,
        });
    }
    assertWritable(memory, actor) {
        if (memory.type === "SYSTEM" && !actor.admin && actor.kind !== "SYSTEM")
            throw new KnowledgeError("policy", "only an administrator may change SYSTEM memory");
        if (actor.kind === "AGENT") {
            if (memory.type !== "AGENT" || memory.agentId !== actor.agentId)
                throw new KnowledgeError("policy", "an agent may only change its own agent memory");
        }
    }
    transition(current, to, actor, reason) {
        const next = {
            ...current,
            status: to,
            statusReason: reason,
            version: current.version + 1,
            updatedAt: this.iso(),
        };
        this.repos.memories.upsert(next);
        this.snapshot(next, actor.id, reason);
        this.notify({ kind: "upsert", memory: next });
        return next;
    }
    /* ---------------------------------------------------------------- */
    /* Staleness & retention                                            */
    /* ---------------------------------------------------------------- */
    markStale(memoryId, reason, actor = "system") {
        const m = this.get(memoryId);
        if (!m || m.freshness === "POTENTIALLY_STALE")
            return m;
        if (m.status !== "ACTIVE" && m.status !== "DRAFT")
            return m;
        const next = {
            ...m,
            freshness: "POTENTIALLY_STALE",
            statusReason: reason,
            updatedAt: this.iso(),
        };
        this.repos.memories.upsert(next);
        this.notify({ kind: "upsert", memory: next });
        this.record("memory.marked_stale", actor, {
            projectId: m.projectId,
            memoryId,
            detail: { reason },
        });
        return next;
    }
    /** Re-validate: the memory is checked by a human and is fresh again. */
    validateFresh(memoryId, actor) {
        if (actor.kind !== "USER")
            throw new KnowledgeError("policy", "only the user can validate memory");
        const m = this.require(memoryId);
        const next = {
            ...m,
            freshness: "FRESH",
            updatedAt: this.iso(),
        };
        this.repos.memories.upsert(next);
        this.notify({ kind: "upsert", memory: next });
        this.record("memory.updated", actor, {
            projectId: m.projectId,
            memoryId,
            detail: { validatedFresh: true },
        });
        return next;
    }
    /** Expire TEMPORARY memories. Permanent decisions are never touched; audit is never deleted. */
    applyRetention(actor = "system") {
        const archived = [];
        const now = this.clock();
        for (const m of this.repos.memories.list()) {
            if (m.retention !== "TEMPORARY" || !m.expiresAt)
                continue;
            if (m.status !== "ACTIVE" && m.status !== "DRAFT")
                continue;
            if (Date.parse(m.expiresAt) > now)
                continue;
            const sys = typeof actor === "string" ? { id: actor, kind: "SYSTEM" } : actor;
            this.transition(m, "ARCHIVED", sys, "expired by retention policy");
            this.record("memory.archived", sys, {
                projectId: m.projectId,
                memoryId: m.memoryId,
                detail: { reason: "expired" },
            });
            archived.push(m.memoryId);
        }
        return { archived };
    }
    /* ---------------------------------------------------------------- */
    /* Graph                                                            */
    /* ---------------------------------------------------------------- */
    entity(projectId, label, kind) {
        const id = `ent:${projectId ?? "platform"}:${slug(label)}`;
        const existing = this.repos.entities.findById(id);
        if (existing)
            return existing;
        const created = {
            id,
            ...(projectId ? { projectId } : {}),
            label,
            kind,
            createdAt: this.iso(),
        };
        this.repos.entities.upsert(created);
        return created;
    }
    link(from, to, type, by, source = "USER", projectId) {
        if (!RELATION_TYPES.includes(type))
            throw new KnowledgeError("invalid_request", "unknown relation type");
        if (from === to)
            throw new KnowledgeError("invalid_request", "a node cannot relate to itself");
        const id = `edge:${slug(from)}:${type}:${slug(to)}`;
        const existing = this.repos.edges.findById(id);
        if (existing)
            return existing;
        const edge = {
            id,
            ...(projectId ? { projectId } : {}),
            from,
            to,
            type,
            createdAt: this.iso(),
            createdBy: by,
            source,
        };
        this.repos.edges.upsert(edge);
        this.conflictEdgeCache = undefined;
        this.notify({ kind: "graph" });
        return edge;
    }
    /* ---------------------------------------------------------------- */
    /* Conflicts                                                        */
    /* ---------------------------------------------------------------- */
    resolved(conflictId) {
        return this.repos.resolutions.findById(conflictId) !== undefined;
    }
    conflictsFor(memory) {
        if (!memory.projectId ||
            memory.status !== "ACTIVE" ||
            !DECISION_TYPES.includes(memory.type))
            return [];
        const out = [];
        for (const other of this.repos.memories.list()) {
            if (other.memoryId === memory.memoryId ||
                other.projectId !== memory.projectId)
                continue;
            if (other.status !== "ACTIVE" || !DECISION_TYPES.includes(other.type))
                continue;
            if (this.suppress.has(other.memoryId))
                continue;
            const pair = [memory, other].sort((a, b) => a.memoryId.localeCompare(b.memoryId));
            const conflictId = `${pair[0].memoryId}|${pair[1].memoryId}`;
            if (this.resolved(conflictId))
                continue;
            for (const d of disagreements(pair[0].facets, pair[1].facets)) {
                out.push({
                    conflictId,
                    projectId: memory.projectId,
                    facet: d.facet,
                    memoryIds: [pair[0].memoryId, pair[1].memoryId],
                    values: [d.a, d.b],
                    titles: [pair[0].title, pair[1].title],
                    suggestion: this.suggest(pair[0], pair[1]),
                });
            }
        }
        // Explicit CONFLICTS_WITH edges.
        for (const edge of this.conflictEdges()) {
            const a = edge.from.startsWith("mem:")
                ? this.get(edge.from.slice(4))
                : undefined;
            const b = edge.to.startsWith("mem:")
                ? this.get(edge.to.slice(4))
                : undefined;
            if (!a || !b || a.status !== "ACTIVE" || b.status !== "ACTIVE")
                continue;
            if (a.memoryId !== memory.memoryId && b.memoryId !== memory.memoryId)
                continue;
            const pair = [a, b].sort((x, y) => x.memoryId.localeCompare(y.memoryId));
            const conflictId = `${pair[0].memoryId}|${pair[1].memoryId}`;
            if (this.resolved(conflictId) ||
                out.some((c) => c.conflictId === conflictId))
                continue;
            out.push({
                conflictId,
                projectId: a.projectId ?? "",
                facet: "explicit",
                memoryIds: [pair[0].memoryId, pair[1].memoryId],
                values: ["declared", "conflict"],
                titles: [pair[0].title, pair[1].title],
                suggestion: "These memories were explicitly marked as conflicting; resolve them.",
            });
        }
        return out;
    }
    conflictEdgeCache;
    conflictEdges() {
        return (this.conflictEdgeCache ??= this.repos.edges
            .list()
            .filter((e) => e.type === "CONFLICTS_WITH"));
    }
    listConflicts(projectId) {
        const seen = new Set();
        const out = [];
        for (const m of this.repos.memories.list()) {
            if (projectId && m.projectId !== projectId)
                continue;
            for (const c of this.conflictsFor(m)) {
                const key = `${c.conflictId}:${c.facet}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                out.push(c);
            }
        }
        return out;
    }
    suggest(a, b) {
        const ra = confidenceRank(a.confidence);
        const rb = confidenceRank(b.confidence);
        if (ra !== rb) {
            const [hi, lo] = ra > rb ? [a, b] : [b, a];
            return `"${hi.title}" is ${hi.confidence} and "${lo.title}" is ${lo.confidence}; if the stronger one is current, supersede the other.`;
        }
        const [newer, older] = a.updatedAt >= b.updatedAt ? [a, b] : [b, a];
        return `Both are ${a.confidence}. "${newer.title}" is more recent than "${older.title}", but only you can decide which stands.`;
    }
    resolveConflict(conflictId, resolution, actor, winner, note) {
        if (actor.kind !== "USER")
            throw new KnowledgeError("policy", "only the user can resolve a conflict");
        const [idA, idB] = conflictId.split("|");
        const a = idA ? this.get(idA) : undefined;
        const b = idB ? this.get(idB) : undefined;
        if (!a || !b || !a.projectId)
            throw new KnowledgeError("not_found", "conflict not found");
        if (resolution !== "KEPT_BOTH") {
            if (winner !== a.memoryId && winner !== b.memoryId)
                throw new KnowledgeError("invalid_request", "name the memory that stands");
            const loser = winner === a.memoryId ? b : a;
            const winnerMemory = winner === a.memoryId ? a : b;
            if (resolution === "SUPERSEDED_OTHER") {
                const next = this.transition(loser, "SUPERSEDED", actor, `conflict resolved in favour of ${winnerMemory.memoryId}`);
                next.supersededBy = winnerMemory.memoryId;
                this.repos.memories.upsert(next);
                const w = { ...winnerMemory, supersedes: loser.memoryId };
                this.repos.memories.upsert(w);
                this.link(`mem:${w.memoryId}`, `mem:${loser.memoryId}`, "SUPERSEDES", actor.id, "USER", a.projectId);
                this.notify({ kind: "upsert", memory: next });
                this.notify({ kind: "upsert", memory: w });
                this.record("memory.superseded", actor, {
                    projectId: a.projectId,
                    memoryId: loser.memoryId,
                    detail: { supersededBy: w.memoryId },
                });
            }
            else {
                this.transition(loser, "ARCHIVED", actor, `conflict resolved in favour of ${winnerMemory.memoryId}`);
                this.record("memory.archived", actor, {
                    projectId: a.projectId,
                    memoryId: loser.memoryId,
                });
            }
        }
        const record = {
            id: conflictId,
            conflictId,
            projectId: a.projectId,
            resolution,
            ...(winner ? { winner } : {}),
            by: actor.id,
            at: this.iso(),
            ...(note ? { note: clip(note, 300) } : {}),
        };
        this.repos.resolutions.upsert(record);
        this.record("memory.conflict_resolved", actor, {
            projectId: a.projectId,
            detail: { conflictId, resolution, winner },
        });
        return record;
    }
}
