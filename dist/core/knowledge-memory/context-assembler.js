/**
 * Context Assembler — a compact, budgeted, cited context package for one task,
 * built from authorized retrieval. Never a dump of the memory store.
 *
 * Priority under the budget: mandatory security requirements → active
 * architectural decisions → directly relevant knowledge → recent execution
 * history → supporting documentation. Conflicting memories are BOTH shown and
 * flagged; the assembler never silently picks one.
 *
 * `MemoryContextSource` plugs the same retrieval into the Layer 3 Context
 * Engine so the Prompt Engineer receives memory through the existing seam.
 */
import { CONTEXT_SECTIONS, KNOWLEDGE_LIMITS, } from "../../contracts/knowledge-memory.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";
import { clip } from "./text.js";
function sectionOf(m) {
    if (m.tags.includes("security"))
        return "security";
    if (m.type === "EXECUTION")
        return "previousAttempts";
    if (m.type === "ARCHITECTURAL")
        return m.tags.includes("architecture") ? "architecture" : "decisions";
    if (m.type === "DOCUMENT") {
        if (m.tags.includes("code") || m.references.some((r) => r.kind === "file"))
            return "files";
        return m.tags.includes("architecture") ? "architecture" : "projectContext";
    }
    if (m.tags.includes("constraint") || m.tags.includes("rule"))
        return "constraints";
    return "projectContext";
}
function priorityOf(m, section, mandatory) {
    if (mandatory)
        return 0;
    if (m.type === "ARCHITECTURAL" &&
        (m.confidence === "USER_CONFIRMED" || m.confidence === "VERIFIED"))
        return 1;
    if (section === "previousAttempts")
        return 3;
    if (section === "files" || m.type === "DOCUMENT")
        return 4;
    return 2;
}
export function citationOf(m) {
    const where = m.sourceRef ? `${m.source}:${m.sourceRef}` : m.source;
    return `${m.title} (${where}; ${m.memoryId})`;
}
export class ContextAssembler {
    memory;
    retrieval;
    clock;
    constructor(memory, retrieval, clock = Date.now) {
        this.memory = memory;
        this.retrieval = retrieval;
        this.clock = clock;
    }
    assemble(req) {
        this.retrieval.authorize(req.scope, req.projectId);
        const scope = { ...req.scope, agent: req.agent };
        const taskTags = req.query.toLowerCase().includes("secur")
            ? ["security"]
            : [];
        const found = this.retrieval.search({ text: req.query, projectId: req.projectId, limit: 30, taskTags }, scope);
        // Mandatory: high-importance security requirements are always in scope.
        const mandatoryHits = this.retrieval
            .search({
            text: "security",
            projectId: req.projectId,
            limit: 20,
            browse: true,
            importances: ["HIGH", "CRITICAL"],
        }, scope)
            .filter((h) => h.memory.tags.includes("security"));
        const byId = new Map();
        for (const h of found)
            byId.set(h.memory.memoryId, { hit: h, mandatory: false });
        for (const h of mandatoryHits)
            byId.set(h.memory.memoryId, { hit: h, mandatory: true });
        const ranked = [...byId.values()]
            .map(({ hit, mandatory }) => {
            const section = sectionOf(hit.memory);
            return {
                hit,
                mandatory,
                section,
                priority: priorityOf(hit.memory, section, mandatory),
            };
        })
            .sort((a, b) => a.priority - b.priority || b.hit.score - a.hit.score);
        const limit = req.budgetChars ?? KNOWLEDGE_LIMITS.defaultBudgetChars;
        // The task framing is part of the package but is small; reserve space for it.
        const framing = [
            req.task?.title ?? "",
            req.task?.description ?? "",
            ...(req.acceptanceCriteria ?? []),
            ...(req.constraints ?? []),
            ...(req.relevantFiles ?? []),
        ].join(" ").length;
        let used = Math.min(framing, limit);
        const items = [];
        const excluded = [];
        const conflicts = new Map();
        for (const r of ranked) {
            const m = r.hit.memory;
            const text = maskSecrets(clip(m.content, KNOWLEDGE_LIMITS.maxItemChars));
            const cost = text.length + m.title.length + 60;
            if (used + cost > limit && !(r.mandatory && items.length < 3)) {
                excluded.push({ memoryId: m.memoryId, reason: "over_budget" });
                continue;
            }
            used += cost;
            for (const c of this.memory.conflictsFor(m))
                conflicts.set(`${c.conflictId}:${c.facet}`, c);
            items.push({
                memoryId: m.memoryId,
                section: r.section,
                title: m.title,
                text,
                citation: citationOf(m),
                why: r.hit.reasons.join("; "),
                confidence: m.confidence,
                importance: m.importance,
                stale: r.hit.stale,
                conflict: r.hit.conflictWith.length > 0,
                score: r.hit.score,
            });
        }
        // A conflicting counterpart that was dropped for budget is still surfaced by id.
        const includedIds = new Set(items.map((i) => i.memoryId));
        for (const c of conflicts.values()) {
            for (const id of c.memoryIds) {
                if (!includedIds.has(id) && !excluded.some((e) => e.memoryId === id))
                    excluded.push({ memoryId: id, reason: "over_budget" });
            }
        }
        const sections = Object.fromEntries(CONTEXT_SECTIONS.map((s) => [s, []]));
        if (req.task)
            sections.currentTask.push(`${req.task.title}${req.task.description ? ` — ${req.task.description}` : ""}`);
        sections.currentTask.push(`Request: ${clip(req.query, 300)}`);
        sections.acceptance.push(...(req.acceptanceCriteria ?? []));
        sections.constraints.push(...(req.constraints ?? []));
        sections.files.push(...(req.relevantFiles ?? []).map((f) => `file: ${f}`));
        for (const item of items) {
            const flags = `${item.conflict ? " [CONFLICT]" : ""}${item.stale ? " [POTENTIALLY STALE]" : ""} [${item.confidence}]`;
            sections[item.section].push(`${item.title}: ${item.text}${flags} — source: ${item.citation}`);
        }
        const status = conflicts.size > 0 ? "KNOWLEDGE_CONFLICT_DETECTED" : "OK";
        const rendered = maskSecrets(this.render(sections, [...conflicts.values()], status));
        if (req.taskId) {
            for (const item of items) {
                this.retrieval.recordUsage({
                    memoryId: item.memoryId,
                    projectId: req.projectId,
                    taskId: req.taskId,
                    agentId: req.agent.id,
                    ...(req.executionId ? { executionId: req.executionId } : {}),
                    reason: item.why.slice(0, 300),
                });
            }
        }
        return {
            projectId: req.projectId,
            ...(req.taskId ? { taskId: req.taskId } : {}),
            status,
            sections,
            items,
            conflicts: [...conflicts.values()],
            excluded,
            budget: { limitChars: limit, usedChars: used },
            rendered,
            assembledAt: new Date(this.clock()).toISOString(),
        };
    }
    render(sections, conflicts, status) {
        const titles = {
            currentTask: "CURRENT TASK",
            projectContext: "PROJECT CONTEXT",
            architecture: "ARCHITECTURE",
            decisions: "RELEVANT DECISIONS",
            files: "RELEVANT FILES",
            previousAttempts: "PREVIOUS ATTEMPTS",
            constraints: "KNOWN CONSTRAINTS",
            security: "SECURITY REQUIREMENTS",
            acceptance: "ACCEPTANCE CRITERIA",
        };
        const out = [];
        if (status === "KNOWLEDGE_CONFLICT_DETECTED") {
            out.push("KNOWLEDGE CONFLICT DETECTED — unresolved, do not assume either side:");
            for (const c of conflicts)
                out.push(`- ${c.facet}: "${c.titles[0]}" (${c.values[0]}) vs "${c.titles[1]}" (${c.values[1]})`);
            out.push("");
        }
        for (const name of CONTEXT_SECTIONS) {
            if (sections[name].length === 0)
                continue;
            out.push(`${titles[name]}:`, ...sections[name].map((s) => `- ${s}`), "");
        }
        return out.join("\n").trim();
    }
}
/* ------------------------------------------------------------------ */
/* Layer 3 integration                                                 */
/* ------------------------------------------------------------------ */
function categoryOf(m) {
    if (m.tags.includes("security"))
        return "security";
    if (m.tags.some((t) => ["ui", "design", "theme", "styling"].includes(t)) ||
        m.facets["theme"])
        return "ui";
    if (m.type === "ARCHITECTURAL")
        return "architecture";
    if (m.type === "PROJECT")
        return "project";
    if (m.type === "EXECUTION")
        return "knowledge";
    return "knowledge";
}
export class MemoryContextSource {
    memory;
    retrieval;
    id = "memory";
    categories = [
        "project",
        "architecture",
        "ui",
        "security",
        "knowledge",
    ];
    constructor(memory, retrieval) {
        this.memory = memory;
        this.retrieval = retrieval;
    }
    fetch(request) {
        const intent = request.intent;
        const query = [
            intent.objective,
            intent.target ?? "",
            intent.scope ?? "",
            ...intent.keywords,
        ].join(" ");
        const role = request.audience.capabilities.some((c) => c.startsWith("security"))
            ? "security"
            : request.audience.capabilities.some((c) => c.startsWith("software"))
                ? "developer"
                : "analyst";
        // Layer 3 has already authorized the principal for this project; the audience
        // (the eventual agent) is what narrows visibility here.
        const scope = {
            projectIds: [request.projectId],
            actor: "prompt-intelligence",
            agent: { id: "prompt-audience", role },
        };
        const hits = this.retrieval.search({ text: query, projectId: request.projectId, limit: 12 }, scope);
        const mandatory = this.retrieval
            .search({
            text: "security",
            projectId: request.projectId,
            limit: 10,
            browse: true,
            importances: ["HIGH", "CRITICAL"],
        }, scope)
            .filter((h) => h.memory.tags.includes("security"));
        const seen = new Set();
        const out = [];
        for (const hit of [...mandatory, ...hits]) {
            const m = hit.memory;
            if (seen.has(m.memoryId))
                continue;
            seen.add(m.memoryId);
            const confirmed = m.confidence === "USER_CONFIRMED" || m.confidence === "VERIFIED";
            const flags = `${hit.conflictWith.length > 0 ? "[UNRESOLVED CONFLICT] " : ""}${hit.stale ? "[POTENTIALLY STALE] " : ""}`;
            out.push({
                category: categoryOf(m),
                key: `mem.${m.memoryId}`,
                value: maskSecrets(`${flags}${m.title}: ${clip(m.content, 500)} [${m.confidence}] (source: ${citationOf(m)})`),
                source: this.id,
                origin: `Memory: ${m.title}`,
                authority: confirmed
                    ? "curated"
                    : m.confidence === "SYSTEM_GENERATED"
                        ? "derived"
                        : "advisory",
                precedence: m.tags.includes("security") && confirmed
                    ? "project_security_policy"
                    : m.type === "ARCHITECTURAL" && confirmed
                        ? "approved_project_decision"
                        : m.type === "PROJECT" && confirmed
                            ? "project_architecture_rule"
                            : m.type === "DOCUMENT"
                                ? "project_documentation"
                                : "general_default",
                sensitivity: "internal",
                ...(m.projectId ? { projectId: m.projectId } : {}),
                ...(m.importance === "CRITICAL" && m.tags.includes("security")
                    ? { mandatory: true }
                    : {}),
                ...(m.references.some((r) => r.kind === "file")
                    ? {
                        files: m.references
                            .filter((r) => r.kind === "file")
                            .map((r) => r.ref)
                            .slice(0, 5),
                    }
                    : {}),
            });
        }
        return out;
    }
}
