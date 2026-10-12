/**
 * Knowledge index + hybrid retrieval engine.
 *
 * Signals (never a single score): keyword (BM25 with synonym expansion),
 * lexical-semantic (character-trigram cosine — a real embedding provider can be
 * plugged in behind `SemanticScorer`), project, task/tag match, agent-role fit,
 * importance, confidence, recency, and relationship distance in the project
 * graph. Authorization is enforced HERE, independent of any UI.
 */
import { KNOWLEDGE_LIMITS, } from "../../contracts/knowledge-memory.js";
import { cosine, expandQuery, stem, synonymGroupsOf, tokenize, trigrams, } from "./text.js";
import { KnowledgeError } from "./write-policy.js";
const ROLE_AFFINITY = {
    developer: {
        ARCHITECTURAL: 1,
        PROJECT: 0.9,
        EXECUTION: 0.85,
        DOCUMENT: 0.75,
        AGENT: 0.8,
        SYSTEM: 0.6,
        USER_PREFERENCE: 0.5,
    },
    qa: {
        EXECUTION: 1,
        ARCHITECTURAL: 0.8,
        PROJECT: 0.8,
        DOCUMENT: 0.7,
        AGENT: 0.8,
        SYSTEM: 0.6,
        USER_PREFERENCE: 0.4,
    },
    reviewer: {
        ARCHITECTURAL: 1,
        SYSTEM: 0.9,
        PROJECT: 0.9,
        EXECUTION: 0.7,
        DOCUMENT: 0.7,
        USER_PREFERENCE: 0.5,
        AGENT: 0.3,
    },
    security: {
        SYSTEM: 1,
        ARCHITECTURAL: 0.9,
        PROJECT: 0.8,
        EXECUTION: 0.7,
        DOCUMENT: 0.6,
        USER_PREFERENCE: 0.3,
        AGENT: 0.3,
    },
    analyst: {
        DOCUMENT: 1,
        PROJECT: 0.9,
        ARCHITECTURAL: 0.8,
        EXECUTION: 0.7,
        SYSTEM: 0.6,
        USER_PREFERENCE: 0.4,
        AGENT: 0.3,
    },
};
const IMPORTANCE = {
    LOW: 0.25,
    NORMAL: 0.5,
    HIGH: 0.75,
    CRITICAL: 1,
};
const CONFIDENCE = {
    VERIFIED: 1,
    USER_CONFIRMED: 1,
    SYSTEM_GENERATED: 0.7,
    AGENT_GENERATED: 0.5,
    INFERRED: 0.35,
    UNVERIFIED: 0.25,
};
const WEIGHTS = {
    keyword: 0.3,
    semantic: 0.15,
    project: 0.1,
    task: 0.08,
    agent: 0.05,
    importance: 0.08,
    confidence: 0.08,
    recency: 0.06,
    relationship: 0.1,
};
const DAY = 86_400_000;
const MIN_SCORE = 0.18;
export class KnowledgeIndex {
    docs = new Map();
    df = new Map();
    totalLen = 0;
    constructor(memory) {
        for (const m of memory.all())
            this.upsert(m);
        memory.subscribe((c) => {
            if (c.kind === "upsert")
                this.upsert(c.memory);
            else if (c.kind === "remove")
                this.remove(c.id);
        });
    }
    get size() {
        return this.docs.size;
    }
    remove(id) {
        const old = this.docs.get(id);
        if (!old)
            return;
        for (const t of old.tf.keys())
            this.df.set(t, (this.df.get(t) ?? 1) - 1);
        this.totalLen -= old.len;
        this.docs.delete(id);
    }
    upsert(m) {
        this.remove(m.memoryId);
        const tokens = tokenize(`${m.title} ${m.title} ${m.tags.join(" ")} ${m.content}`);
        const tf = new Map();
        for (const t of tokens)
            tf.set(t, (tf.get(t) ?? 0) + 1);
        for (const t of tf.keys())
            this.df.set(t, (this.df.get(t) ?? 0) + 1);
        this.totalLen += tokens.length;
        this.docs.set(m.memoryId, {
            tf,
            len: tokens.length,
            tri: trigrams(`${m.title} ${m.summary}`),
            tags: new Set(m.tags.map((t) => stem(t))),
            groups: synonymGroupsOf(tokens),
        });
    }
    bm25(id, query) {
        const doc = this.docs.get(id);
        if (!doc || doc.len === 0)
            return { score: 0, matched: [] };
        const n = this.docs.size;
        const avg = this.totalLen / Math.max(1, n);
        let score = 0;
        const matched = [];
        for (const [term, weight] of query) {
            const f = doc.tf.get(term);
            if (!f)
                continue;
            const df = this.df.get(term) ?? 0;
            const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
            score +=
                weight *
                    idf *
                    ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (doc.len / avg))));
            if (weight >= 1)
                matched.push(term);
        }
        return { score, matched };
    }
    doc(id) {
        return this.docs.get(id);
    }
}
export class RetrievalEngine {
    memory;
    index;
    clock;
    scorer;
    cache = new Map();
    log = [];
    constructor(memory, index, clock = Date.now, scorer) {
        this.memory = memory;
        this.index = index;
        this.clock = clock;
        this.scorer = scorer;
    }
    /** Authorization check shared by search and the assembler. */
    authorize(scope, projectId) {
        if (projectId === undefined)
            return;
        if (scope.projectIds !== "*" && !scope.projectIds.includes(projectId)) {
            this.deny(scope, projectId);
        }
    }
    deny(scope, projectId) {
        this.log.push({
            at: this.clock(),
            actor: scope.actor,
            projectId,
            count: 0,
            denied: true,
        });
        this.memory.record("memory.retrieval_denied", scope.actor, {
            projectId,
            result: "denied",
            detail: { agent: scope.agent?.id },
        });
        throw new KnowledgeError("access_denied", "access to this project's knowledge is denied");
    }
    visible(m, scope) {
        if (m.projectId === undefined)
            return m.type === "SYSTEM";
        if (scope.projectIds !== "*" && !scope.projectIds.includes(m.projectId))
            return false;
        if (scope.agent) {
            // Agents get project knowledge, never personal preferences or other agents' memory.
            if (m.type === "AGENT")
                return m.agentId === scope.agent.id;
            if (m.type === "USER_PREFERENCE")
                return false;
        }
        return true;
    }
    search(query, scope) {
        this.authorize(scope, query.projectId);
        const limit = Math.min(Math.max(query.limit ?? 10, 1), KNOWLEDGE_LIMITS.maxSearchResults);
        const key = JSON.stringify([
            this.memory.version,
            query,
            scope.projectIds,
            scope.agent,
        ]);
        let hits = this.cache.get(key);
        if (!hits) {
            hits = this.compute(query, scope);
            if (this.cache.size > 100)
                this.cache.delete(this.cache.keys().next().value);
            this.cache.set(key, hits);
        }
        const result = hits.slice(0, limit);
        this.log.push({
            at: this.clock(),
            actor: scope.actor,
            ...(query.projectId ? { projectId: query.projectId } : {}),
            count: result.length,
            denied: false,
        });
        if (this.log.length > 2000)
            this.log.splice(0, this.log.length - 2000);
        this.memory.record("memory.retrieved", scope.actor, {
            ...(query.projectId ? { projectId: query.projectId } : {}),
            detail: {
                count: result.length,
                ids: result.slice(0, 10).map((h) => h.memory.memoryId),
                agent: scope.agent?.id,
            },
        });
        return result.map((h) => ({ ...h }));
    }
    compute(query, scope) {
        const statuses = query.statuses ?? ["ACTIVE"];
        const qTokens = tokenize(query.text);
        const expanded = expandQuery(qTokens);
        const qTri = trigrams(query.text);
        const qGroups = synonymGroupsOf(qTokens);
        const taskTags = new Set((query.taskTags ?? []).map((t) => stem(t.toLowerCase())));
        const role = scope.agent?.role.toLowerCase();
        const graph = query.projectId
            ? this.graphDistances(query.projectId, qTokens)
            : new Map();
        const now = this.clock();
        const candidates = this.memory.all().filter((m) => {
            if (!this.visible(m, scope))
                return false;
            if (query.projectId &&
                m.projectId !== query.projectId &&
                m.projectId !== undefined)
                return false;
            if (!statuses.includes(m.status))
                return false;
            if (m.expiresAt &&
                Date.parse(m.expiresAt) <= now &&
                m.status === "ACTIVE")
                return false;
            if (query.types && !query.types.includes(m.type))
                return false;
            if (query.sources && !query.sources.includes(m.source))
                return false;
            if (query.confidences && !query.confidences.includes(m.confidence))
                return false;
            if (query.importances && !query.importances.includes(m.importance))
                return false;
            if (query.since && m.updatedAt < query.since)
                return false;
            return true;
        });
        const raw = candidates.map((m) => ({
            m,
            bm: this.index.bm25(m.memoryId, expanded),
        }));
        const maxBm = Math.max(1e-9, ...raw.map((r) => r.bm.score));
        const hits = [];
        for (const { m, bm } of raw) {
            const doc = this.index.doc(m.memoryId);
            const keyword = bm.score / maxBm;
            const semantic = this.scorer
                ? this.scorer.score(query.text, m)
                : doc && qTokens.length > 0
                    ? Math.min(1, cosine(qTri, doc.tri) * 1.6)
                    : 0;
            const tagMatch = (doc ? [...taskTags].filter((t) => doc.tags.has(t)).length : 0) +
                (doc ? [...qGroups].filter((g) => doc.groups.has(g)).length * 0.5 : 0);
            const g = graph.get(`mem:${m.memoryId}`);
            const relationship = g ? 1 / (1 + g.d) : 0;
            const ageDays = Math.max(0, (now - Date.parse(m.updatedAt)) / DAY);
            const signals = {
                keyword: Math.min(1, keyword),
                semantic: Math.min(1, semantic),
                project: m.projectId === query.projectId
                    ? 1
                    : m.projectId === undefined
                        ? 0.5
                        : 0,
                task: Math.min(1, tagMatch / 2),
                agent: role ? (ROLE_AFFINITY[role]?.[m.type] ?? 0.5) : 0.5,
                importance: IMPORTANCE[m.importance],
                confidence: CONFIDENCE[m.confidence],
                recency: Math.pow(0.5, ageDays / 90),
                relationship,
            };
            const textual = signals.keyword > 0.05 ||
                signals.semantic >= 0.3 ||
                relationship > 0 ||
                signals.task > 0;
            if (!textual && !query.browse)
                continue;
            let score = 0;
            for (const k of Object.keys(WEIGHTS))
                score += WEIGHTS[k] * signals[k];
            const stale = m.freshness === "POTENTIALLY_STALE";
            if (stale)
                score *= 0.6;
            if (!query.browse && score < MIN_SCORE)
                continue;
            const conflicts = this.memory.conflictsFor(m);
            const reasons = [];
            if (m.projectId)
                reasons.push(`Project: ${m.projectId}`);
            reasons.push(`Type: ${m.type}`);
            if (bm.matched.length > 0)
                reasons.push(`Matched terms: ${bm.matched.slice(0, 6).join(", ")}`);
            else if (signals.semantic >= 0.3)
                reasons.push("Similar wording to the request");
            if (signals.task > 0)
                reasons.push("Related topic/tags");
            if (g)
                reasons.push(`Related via "${g.via}" (${g.d} hop${g.d === 1 ? "" : "s"} in the project graph)`);
            if (role && (ROLE_AFFINITY[role]?.[m.type] ?? 0) >= 0.85)
                reasons.push(`Relevant for the ${role} role`);
            reasons.push(`Importance: ${m.importance}`, `Confidence: ${m.confidence}`);
            if (signals.recency > 0.7)
                reasons.push("Recently updated");
            if (stale)
                reasons.push("Potentially stale — verify before relying on it");
            if (conflicts.length > 0)
                reasons.push(`Conflicts with another active memory (${conflicts[0].facet})`);
            hits.push({
                memory: m,
                score: Math.round(score * 1000) / 1000,
                signals,
                reasons,
                conflictWith: [
                    ...new Set(conflicts.flatMap((c) => c.memoryIds.filter((id) => id !== m.memoryId))),
                ],
                stale,
            });
        }
        return hits.sort((a, b) => b.score - a.score ||
            b.memory.updatedAt.localeCompare(a.memory.updatedAt));
    }
    /** Hop distance from query-mentioned entities to each node (≤ 2 hops, undirected). */
    graphDistances(projectId, qTokens) {
        const out = new Map();
        const q = new Set(qTokens);
        const entities = this.memory.repos.entities
            .list()
            .filter((e) => e.projectId === projectId && e.kind !== "MEMORY");
        const adjacency = new Map();
        for (const e of this.memory.repos.edges.list()) {
            if (e.projectId !== undefined && e.projectId !== projectId)
                continue;
            (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)).push(e.to);
            (adjacency.get(e.to) ?? adjacency.set(e.to, []).get(e.to)).push(e.from);
        }
        for (const ent of entities) {
            const labelTokens = tokenize(ent.label);
            if (labelTokens.length === 0 || !labelTokens.every((t) => q.has(t)))
                continue;
            // Skip the project itself: it is mentioned in almost every request.
            if (ent.kind === "PROJECT")
                continue;
            const seen = new Map([[ent.id, 0]]);
            let frontier = [ent.id];
            for (let hop = 1; hop <= 2; hop++) {
                const next = [];
                for (const node of frontier) {
                    for (const nb of adjacency.get(node) ?? []) {
                        if (seen.has(nb))
                            continue;
                        seen.set(nb, hop);
                        next.push(nb);
                    }
                }
                frontier = next;
            }
            for (const [node, d] of seen) {
                const cur = out.get(node);
                if (!cur || d < cur.d)
                    out.set(node, { d, via: ent.label });
            }
        }
        return out;
    }
    /* ---- usage feedback ---- */
    recordUsage(input) {
        const m = this.memory.get(input.memoryId);
        if (!m)
            return;
        const id = `use-${input.taskId}-${input.memoryId}`;
        if (this.memory.repos.usage.findById(id))
            return;
        this.memory.repos.usage.upsert({
            ...input,
            id,
            at: new Date(this.clock()).toISOString(),
            result: "PENDING",
            confidenceAtUse: m.confidence,
        });
    }
    recordOutcome(taskId, result, executionId) {
        let n = 0;
        for (const u of this.memory.repos.usage.list()) {
            if (u.taskId !== taskId || u.result !== "PENDING")
                continue;
            this.memory.repos.usage.upsert({
                ...u,
                result,
                ...(executionId ? { executionId } : {}),
            });
            n++;
        }
        return n;
    }
    usageFor(memoryId) {
        return this.memory.repos.usage
            .list()
            .filter((u) => u.memoryId === memoryId);
    }
}
