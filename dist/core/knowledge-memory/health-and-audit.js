/**
 * Knowledge health metrics and the rule-based Knowledge Auditor.
 *
 * Findings are recomputed on demand from the stored records and the retrieval
 * log (nothing cached) and are raised once through the platform AuditLog
 * as `knowledge_event` (operation `audit.finding`).
 */
import { MEMORY_STATUSES, MEMORY_TYPES, } from "../../contracts/knowledge-memory.js";
const DAY = 86_400_000;
export function computeHealth(memory, now, projectId) {
    const byStatus = Object.fromEntries(MEMORY_STATUSES.map((s) => [s, 0]));
    const byType = Object.fromEntries(MEMORY_TYPES.map((t) => [t, 0]));
    let stale = 0;
    let unverified = 0;
    let drafts = 0;
    let expiring = 0;
    let documents = 0;
    let total = 0;
    for (const m of memory.all()) {
        if (projectId && m.projectId !== projectId)
            continue;
        total++;
        byStatus[m.status]++;
        byType[m.type]++;
        if (m.type === "DOCUMENT")
            documents++;
        if (m.status === "ACTIVE" || m.status === "DRAFT") {
            if (m.freshness === "POTENTIALLY_STALE")
                stale++;
            if (m.confidence === "UNVERIFIED" || m.confidence === "INFERRED")
                unverified++;
            if (m.expiresAt && Date.parse(m.expiresAt) - now < 14 * DAY)
                expiring++;
        }
        if (m.status === "DRAFT")
            drafts++;
    }
    return {
        ...(projectId ? { projectId } : {}),
        total,
        byStatus,
        byType,
        potentiallyStale: stale,
        conflicts: memory.listConflicts(projectId).length,
        unverified,
        drafts,
        expiringSoon: expiring,
        documents,
        edges: memory.repos.edges
            .list()
            .filter((e) => !projectId || e.projectId === projectId).length,
        generatedAt: new Date(now).toISOString(),
    };
}
export const DEFAULT_AUDITOR_LIMITS = {
    windowMs: 5 * 60_000,
    maxRetrievalsPerWindow: 120,
    maxDeniedPerWindow: 2,
    maxVersionsPerDay: 6,
    maxAgentDraftsPerWindow: 10,
};
export class KnowledgeAuditor {
    memory;
    retrieval;
    clock;
    limits;
    raised = new Set();
    constructor(memory, retrieval, clock = Date.now, limits = DEFAULT_AUDITOR_LIMITS) {
        this.memory = memory;
        this.retrieval = retrieval;
        this.clock = clock;
        this.limits = limits;
    }
    run(projectId) {
        const now = this.clock();
        const findings = [];
        const add = (f) => {
            const { key, ...rest } = f;
            findings.push({ findingId: `knowledge:${rest.ruleId}:${key}`, ...rest });
        };
        const recent = this.retrieval.log.filter((l) => now - l.at <= this.limits.windowMs &&
            (!projectId || l.projectId === projectId));
        // Retrieval behaviour per actor.
        const byActor = new Map();
        for (const l of recent) {
            const cur = byActor.get(l.actor) ?? { n: 0, denied: 0 };
            cur.n++;
            if (l.denied)
                cur.denied++;
            if (l.projectId)
                cur.projectId = l.projectId;
            byActor.set(l.actor, cur);
        }
        for (const [actor, v] of byActor) {
            if (v.denied > this.limits.maxDeniedPerWindow - 1)
                add({
                    key: actor,
                    ruleId: "knowledge.unauthorized_retrieval",
                    severity: v.denied >= 5 ? "high" : "medium",
                    subjectId: actor,
                    ...(v.projectId ? { projectId: v.projectId } : {}),
                    detail: `${actor} was denied access to restricted knowledge ${v.denied} time(s) in the last ${Math.round(this.limits.windowMs / 60000)} minutes.`,
                });
            if (v.n > this.limits.maxRetrievalsPerWindow)
                add({
                    key: actor,
                    ruleId: "knowledge.excessive_retrieval",
                    severity: "medium",
                    subjectId: actor,
                    detail: `${actor} made ${v.n} retrievals in ${Math.round(this.limits.windowMs / 60000)} minutes.`,
                });
        }
        const memories = this.memory
            .all()
            .filter((m) => !projectId || m.projectId === projectId);
        // Suspicious creation: agent-authored protected memory that is already active, or a burst of agent drafts.
        const agentDrafts = new Map();
        for (const m of memories) {
            const agentMade = m.confidence === "AGENT_GENERATED" || m.source === "AGENT";
            if (agentMade &&
                m.status === "ACTIVE" &&
                ["SYSTEM", "ARCHITECTURAL", "PROJECT", "USER_PREFERENCE"].includes(m.type))
                add({
                    key: m.memoryId,
                    ruleId: "knowledge.suspicious_creation",
                    severity: "high",
                    subjectId: m.memoryId,
                    ...(m.projectId ? { projectId: m.projectId } : {}),
                    detail: `An agent-generated ${m.type} memory ("${m.title}") is ACTIVE without user confirmation.`,
                });
            if (agentMade && now - Date.parse(m.createdAt) <= this.limits.windowMs)
                agentDrafts.set(m.createdBy, (agentDrafts.get(m.createdBy) ?? 0) + 1);
        }
        for (const [who, n] of agentDrafts)
            if (n > this.limits.maxAgentDraftsPerWindow)
                add({
                    key: who,
                    ruleId: "knowledge.suspicious_creation",
                    severity: "medium",
                    subjectId: who,
                    detail: `${who} created ${n} memories in a few minutes.`,
                });
        // Conflicts.
        for (const c of this.memory.listConflicts(projectId))
            add({
                key: `${c.conflictId}:${c.facet}`,
                ruleId: "knowledge.conflicting_memory",
                severity: "medium",
                subjectId: c.conflictId,
                projectId: c.projectId,
                detail: `Conflicting ${c.facet}: "${c.titles[0]}" (${c.values[0]}) vs "${c.titles[1]}" (${c.values[1]}).`,
            });
        // Low-confidence memory used by agents.
        const lowUse = new Map();
        for (const u of this.memory.repos.usage.list()) {
            if (projectId && u.projectId !== projectId)
                continue;
            if (u.confidenceAtUse === "INFERRED" ||
                u.confidenceAtUse === "UNVERIFIED")
                lowUse.set(u.memoryId, (lowUse.get(u.memoryId) ?? 0) + 1);
        }
        for (const [id, n] of lowUse)
            add({
                key: id,
                ruleId: "knowledge.low_confidence_usage",
                severity: "low",
                subjectId: id,
                detail: `A low-confidence memory was used by agents ${n} time(s).`,
            });
        // Unusual modification: many versions in a day, or a critical memory that changed state.
        for (const m of memories) {
            const recentVersions = this.memory
                .history(m.memoryId)
                .filter((v) => now - Date.parse(v.at) <= DAY).length;
            if (recentVersions > this.limits.maxVersionsPerDay)
                add({
                    key: m.memoryId,
                    ruleId: "knowledge.unusual_modification",
                    severity: "medium",
                    subjectId: m.memoryId,
                    ...(m.projectId ? { projectId: m.projectId } : {}),
                    detail: `"${m.title}" changed ${recentVersions} times in 24 hours.`,
                });
            if (m.importance === "CRITICAL" &&
                (m.status === "REVOKED" || m.status === "SUPERSEDED") &&
                now - Date.parse(m.updatedAt) <= DAY)
                add({
                    key: `${m.memoryId}:${m.status}`,
                    ruleId: "knowledge.unusual_modification",
                    severity: "high",
                    subjectId: m.memoryId,
                    ...(m.projectId ? { projectId: m.projectId } : {}),
                    detail: `Critical memory "${m.title}" was ${m.status.toLowerCase()} in the last 24 hours.`,
                });
        }
        // Raise each finding once through the platform audit log.
        for (const f of findings) {
            if (this.raised.has(f.findingId))
                continue;
            this.raised.add(f.findingId);
            this.memory.record("audit.finding", "knowledge-auditor", {
                ...(f.projectId ? { projectId: f.projectId } : {}),
                result: f.severity,
                detail: { ruleId: f.ruleId, subjectId: f.subjectId },
            });
        }
        return findings;
    }
}
