/**
 * KnowledgeControlService — the authorized read/write surface for the Knowledge
 * module (Phase 2 — Control Plane §17 & Layer 14 Knowledge Learning).
 *
 * Repository-backed, authorized server-side, audit-logged on every change.
 * Integrates the KnowledgeLearningEngine for conflict detection, ADR lifecycles,
 * quality analysis, lessons learned, and scoped context retrieval.
 */
import { NotFoundError, PermissionDeniedError, ValidationError, operatorCan, operatorCanAccessProject, } from "../../contracts/index.js";
import { KNOWLEDGE_ITEM_TYPES, } from "../../contracts/knowledge.js";
import { createId, now } from "../../core/index.js";
import { KnowledgeLearningEngine, } from "../../core/knowledge/knowledge-learning-engine.js";
const MAX_TITLE = 200;
const MAX_BODY = 20_000;
const MAX_TAGS = 20;
const MAX_TAG = 40;
const MAX_SOURCE = 300;
function isType(value) {
    return (typeof value === "string" &&
        KNOWLEDGE_ITEM_TYPES.includes(value));
}
function requireText(value, field, max) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new ValidationError(`${field} is required`);
    }
    if (value.length > max) {
        throw new ValidationError(`${field} must be at most ${max} characters`);
    }
    return value.trim();
}
function normalizeTags(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value)) {
        throw new ValidationError("tags must be an array of strings");
    }
    if (value.length > MAX_TAGS) {
        throw new ValidationError(`at most ${MAX_TAGS} tags are allowed`);
    }
    return value.map((tag) => {
        if (typeof tag !== "string" || tag.trim().length === 0) {
            throw new ValidationError("each tag must be a non-empty string");
        }
        if (tag.length > MAX_TAG) {
            throw new ValidationError(`each tag must be at most ${MAX_TAG} characters`);
        }
        return tag.trim();
    });
}
export class KnowledgeControlService {
    items;
    audit;
    engine;
    constructor(items, audit, engine) {
        this.items = items;
        this.audit = audit;
        this.engine = engine ?? new KnowledgeLearningEngine();
    }
    /** Reads require only the `view` capability (every role has it). */
    requireReader(principal) {
        if (!operatorCan(principal, "view")) {
            throw new PermissionDeniedError("insufficient capabilities to read knowledge");
        }
    }
    /**
     * Writes are administrator-only, consistent with the other Control Plane
     * domain services.
     */
    requireWriter(principal) {
        if (principal.role !== "admin") {
            throw new PermissionDeniedError("requires administrator role for knowledge operations");
        }
    }
    requireProjectAccess(principal, projectId) {
        if (projectId && !operatorCanAccessProject(principal, projectId)) {
            throw new PermissionDeniedError("no access to the requested project");
        }
    }
    list(principal, filter = {}) {
        this.requireReader(principal);
        this.requireProjectAccess(principal, filter.projectId);
        const search = filter.search?.trim().toLowerCase();
        return this.items
            .list()
            .filter((item) => {
            if (item.projectId &&
                !operatorCanAccessProject(principal, item.projectId)) {
                return false;
            }
            if (filter.projectId && item.projectId !== filter.projectId)
                return false;
            if (filter.type && item.type !== filter.type)
                return false;
            if (filter.scope && item.scope !== filter.scope)
                return false;
            if (filter.confidence && item.confidence !== filter.confidence)
                return false;
            if (filter.lifecycleState && item.lifecycleState !== filter.lifecycleState)
                return false;
            if (search) {
                const haystack = `${item.title}\n${item.body}\n${item.tags.join(" ")}`.toLowerCase();
                if (!haystack.includes(search))
                    return false;
            }
            return true;
        })
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    get(principal, id) {
        this.requireReader(principal);
        const item = this.items.findById(id);
        if (!item)
            return undefined;
        if (item.projectId &&
            !operatorCanAccessProject(principal, item.projectId)) {
            return undefined;
        }
        return item;
    }
    create(principal, input) {
        this.requireWriter(principal);
        if (!isType(input?.type)) {
            throw new ValidationError(`type must be one of ${KNOWLEDGE_ITEM_TYPES.join(", ")}`);
        }
        const projectId = typeof input.projectId === "string" && input.projectId.trim()
            ? input.projectId.trim()
            : undefined;
        this.requireProjectAccess(principal, projectId);
        const timestamp = now();
        const id = createId("knowledge");
        const item = {
            id,
            knowledgeId: id,
            ...(projectId ? { projectId } : {}),
            type: input.type,
            title: requireText(input.title, "title", MAX_TITLE),
            body: requireText(input.body, "body", MAX_BODY),
            tags: normalizeTags(input.tags),
            ...(input.source
                ? { source: requireText(input.source, "source", MAX_SOURCE) }
                : {}),
            provenance: input.provenance ?? {
                sourceType: "user_input",
                extractedBy: principal.id,
            },
            confidence: input.confidence ?? "unverified",
            scope: input.scope ?? (projectId ? "project" : "global"),
            lifecycleState: "active",
            version: 1,
            relatedEntityIds: input.relatedEntityIds ?? [],
            adr: input.adr,
            lesson: input.lesson,
            createdBy: principal.id,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        this.items.upsert(item);
        this.audit?.record("knowledge_created", {
            projectId,
            data: { knowledgeId: id, type: item.type, title: item.title },
        });
        return item;
    }
    update(principal, id, patch) {
        this.requireWriter(principal);
        const existing = this.items.findById(id);
        if (!existing)
            throw new NotFoundError("knowledge item not found");
        this.requireProjectAccess(principal, existing.projectId);
        if (patch.type !== undefined && !isType(patch.type)) {
            throw new ValidationError(`type must be one of ${KNOWLEDGE_ITEM_TYPES.join(", ")}`);
        }
        const updated = {
            ...existing,
            ...(patch.type !== undefined ? { type: patch.type } : {}),
            ...(patch.title !== undefined
                ? { title: requireText(patch.title, "title", MAX_TITLE) }
                : {}),
            ...(patch.body !== undefined
                ? { body: requireText(patch.body, "body", MAX_BODY) }
                : {}),
            ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
            ...(patch.source !== undefined
                ? { source: requireText(patch.source, "source", MAX_SOURCE) }
                : {}),
            ...(patch.provenance !== undefined ? { provenance: patch.provenance } : {}),
            ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
            ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
            ...(patch.lifecycleState !== undefined ? { lifecycleState: patch.lifecycleState } : {}),
            ...(patch.relatedEntityIds !== undefined ? { relatedEntityIds: patch.relatedEntityIds } : {}),
            ...(patch.adr !== undefined ? { adr: patch.adr } : {}),
            ...(patch.lesson !== undefined ? { lesson: patch.lesson } : {}),
            ...(patch.supersededById !== undefined ? { supersededById: patch.supersededById } : {}),
            version: existing.version + 1,
            updatedAt: now(),
        };
        this.items.upsert(updated);
        this.audit?.record("knowledge_updated", {
            projectId: updated.projectId,
            data: { knowledgeId: id, type: updated.type, title: updated.title, version: updated.version },
        });
        return updated;
    }
    /* ------------------------------------------------------------------ */
    /* Layer 14 Extensions: ADRs, Lessons, Conflicts, Quality, Retrieval   */
    /* ------------------------------------------------------------------ */
    /** Proposes a new Architecture Decision Record. */
    proposeADR(principal, input) {
        const adr = {
            decision: input.decision,
            context: input.context,
            alternatives: input.alternatives,
            rationale: input.rationale,
            consequences: input.consequences,
            status: "proposed",
        };
        return this.create(principal, {
            projectId: input.projectId,
            type: "architecture_decision",
            title: input.title,
            body: `### Decision\n${input.decision}\n\n### Context\n${input.context}\n\n### Rationale\n${input.rationale}`,
            tags: ["adr", "architecture", ...(input.projectId ? [input.projectId] : [])],
            confidence: "verified",
            scope: input.projectId ? "project" : "global",
            adr,
        });
    }
    /** Transitions the lifecycle of an Architecture Decision Record. */
    updateADRStatus(principal, knowledgeId, status, notes) {
        this.requireWriter(principal);
        const item = this.get(principal, knowledgeId);
        if (!item)
            throw new NotFoundError("ADR not found");
        if (item.type !== "architecture_decision" || !item.adr) {
            throw new ValidationError("target item is not an Architecture Decision Record");
        }
        const nowTimestamp = now();
        const updatedAdr = {
            ...item.adr,
            status,
            decidedAt: nowTimestamp,
            decidedBy: principal.id,
        };
        const lifecycleState = status === "accepted" ? "validated" : status === "superseded" ? "superseded" : "active";
        const updated = this.update(principal, knowledgeId, {
            adr: updatedAdr,
            lifecycleState,
            confidence: status === "accepted" ? "verified" : item.confidence,
        });
        this.audit?.record("knowledge_adr_status_changed", {
            projectId: item.projectId,
            data: { knowledgeId, status, notes },
        });
        return updated;
    }
    /** Records a verified lesson learned from significant operational successes or failures. */
    recordLesson(principal, input) {
        const lesson = {
            whatHappened: input.whatHappened,
            why: input.why,
            whatWorked: input.whatWorked,
            whatFailed: input.whatFailed,
            whatShouldChange: input.whatShouldChange,
            whatShouldBeRepeated: input.whatShouldBeRepeated,
        };
        const body = `### What Happened\n${input.whatHappened}\n\n### Why\n${input.why}\n\n### What Worked\n${input.whatWorked}\n\n### What Failed\n${input.whatFailed}\n\n### What Should Change\n${input.whatShouldChange}\n\n### What Should Be Repeated\n${input.whatShouldBeRepeated}`;
        return this.create(principal, {
            projectId: input.projectId,
            type: "lesson",
            title: input.title,
            body,
            tags: ["lesson_learned", ...(input.tags ?? [])],
            confidence: "verified",
            scope: input.projectId ? "project" : "global",
            lesson,
        });
    }
    /** Scans knowledge base for contradictory assertions and returns active conflicts. */
    getConflicts(principal, projectId) {
        this.requireReader(principal);
        this.requireProjectAccess(principal, projectId);
        const visibleItems = this.list(principal, { projectId });
        return this.engine.detectConflicts(visibleItems);
    }
    /** Resolves an active knowledge conflict between two items. */
    resolveConflict(principal, conflictId, winnerId, resolutionNotes) {
        this.requireWriter(principal);
        const itemA = this.items.findById(winnerId);
        if (!itemA)
            throw new NotFoundError("winner knowledge item not found");
        this.requireProjectAccess(principal, itemA.projectId);
        const conflicts = this.getConflicts(principal, itemA.projectId);
        const targetConflict = conflicts.find((c) => c.conflictId === conflictId);
        if (!targetConflict)
            throw new NotFoundError("conflict record not found");
        const loserId = targetConflict.itemAId === winnerId ? targetConflict.itemBId : targetConflict.itemAId;
        const itemB = this.items.findById(loserId);
        if (!itemB)
            throw new NotFoundError("loser knowledge item not found");
        const { updatedWinner, updatedLoser, resolvedConflict } = this.engine.resolveConflict(conflictId, itemA, itemB, resolutionNotes, principal.id);
        this.items.upsert(updatedWinner);
        this.items.upsert(updatedLoser);
        this.audit?.record("knowledge_conflict_resolved", {
            projectId: itemA.projectId,
            data: { conflictId, winnerId, loserId, resolutionNotes },
        });
        return { winner: updatedWinner, loser: updatedLoser, conflict: resolvedConflict };
    }
    /** Generates an organizational memory quality & staleness audit report. */
    getQualityReport(principal, projectId) {
        this.requireReader(principal);
        this.requireProjectAccess(principal, projectId);
        const items = this.list(principal, { projectId });
        return this.engine.analyzeQuality(items);
    }
    /**
     * Scoped context retrieval for Context Engine / Prompt Intelligence.
     * Strictly enforces project isolation (e.g. AIMS vs Money Mind).
     */
    retrieveContextKnowledge(principal, query) {
        this.requireReader(principal);
        this.requireProjectAccess(principal, query.projectId);
        const allItems = this.items.list();
        return this.engine.retrieveScopedContext(allItems, query);
    }
}
