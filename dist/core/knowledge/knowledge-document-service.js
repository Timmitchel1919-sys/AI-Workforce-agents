/**
 * UI Layer 13 — project-scoped knowledge documents.
 *
 * Durable in the execution record store (Firestore in production):
 *   - `knowledge_document` head (mutable: title, tags, status, latest version)
 *   - `knowledge_version` immutable body per version (create-only)
 *
 * Content is DATA: it is stored and searched, never executed or treated as an
 * instruction. Only plain text / Markdown is accepted (no binary parsers).
 * Search is keyword search over the project's own documents — there is no
 * vector index, and nothing here claims semantic retrieval.
 */
import { randomUUID, createHash } from "node:crypto";
import { NotFoundError, StateTransitionError, ValidationError, } from "../../contracts/index.js";
export const KNOWLEDGE_KINDS = [
    "architecture_decision",
    "documentation",
    "specification",
    "research",
    "procedure",
    "lesson_learned",
    "note",
];
export const MAX_KNOWLEDGE_BYTES = 200 * 1024;
const MAX_DOCS = 500;
const headKey = (id) => `kdoc_${id}`;
const versionKey = (id, v) => `kver_${id}_${v}`;
function text(value, field, max) {
    if (typeof value !== "string" || value.trim() === "" || value.length > max)
        throw new ValidationError(`${field} must be 1-${max} characters`);
    return value.trim();
}
function content(value) {
    if (typeof value !== "string" || value.trim() === "")
        throw new ValidationError("content is required");
    if (Buffer.byteLength(value, "utf8") > MAX_KNOWLEDGE_BYTES)
        throw new ValidationError(`content exceeds ${MAX_KNOWLEDGE_BYTES / 1024} KB`);
    // Text only: reject NUL / control bytes typical of binary uploads.
    const isBinary = [...value].some((ch) => {
        const c = ch.charCodeAt(0);
        return c <= 8 || (c >= 14 && c <= 31);
    });
    if (isBinary)
        throw new ValidationError("only plain text or Markdown content is accepted");
    return value;
}
function tags(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > 20)
        throw new ValidationError("tags must be a list of up to 20");
    return [...new Set(value.map((t) => text(t, "tag", 40).toLowerCase()))];
}
export class KnowledgeDocumentService {
    store;
    clock;
    newId;
    constructor(store, clock = Date.now, newId = () => `kd_${randomUUID().replace(/-/g, "").slice(0, 20)}`) {
        this.store = store;
        this.clock = clock;
        this.newId = newId;
    }
    iso() {
        return new Date(this.clock()).toISOString();
    }
    async list(projectId) {
        const docs = await this.store.listBy("projectId", projectId, {
            kind: "knowledge_document",
            limit: MAX_DOCS,
        });
        return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    async get(projectId, documentId) {
        const doc = await this.store.get(headKey(documentId));
        if (!doc || doc.projectId !== projectId)
            return undefined;
        const version = await this.store.get(versionKey(documentId, doc.latestVersion));
        return { document: doc, content: version?.content ?? null };
    }
    async versions(projectId, documentId) {
        const doc = await this.store.get(headKey(documentId));
        if (!doc || doc.projectId !== projectId)
            return [];
        const out = [];
        for (let v = doc.latestVersion; v >= 1 && out.length < 50; v -= 1) {
            const ver = await this.store.get(versionKey(documentId, v));
            if (ver)
                out.push({
                    documentId,
                    projectId,
                    version: v,
                    contentHash: ver.contentHash,
                    createdAt: ver.createdAt,
                    createdBy: ver.createdBy,
                });
        }
        return out;
    }
    /** Create a document, or add a new immutable version to an existing one. */
    async save(input, actor) {
        const title = text(input.title, "title", 200);
        if (!KNOWLEDGE_KINDS.includes(input.kind))
            throw new ValidationError(`kind must be one of ${KNOWLEDGE_KINDS.join(", ")}`);
        const body = content(input.content);
        const hash = createHash("sha256").update(body).digest("hex");
        const at = this.iso();
        let head;
        if (input.documentId === undefined) {
            if ((await this.list(input.projectId)).length >= MAX_DOCS)
                throw new ValidationError(`a project may hold at most ${MAX_DOCS} documents`);
            head = {
                documentId: this.newId(),
                projectId: input.projectId,
                title,
                kind: input.kind,
                tags: tags(input.tags),
                status: "active",
                source: typeof input.source === "string"
                    ? input.source.slice(0, 200)
                    : "manual",
                latestVersion: 1,
                contentHash: hash,
                bytes: Buffer.byteLength(body, "utf8"),
                createdAt: at,
                createdBy: actor,
                updatedAt: at,
                updatedBy: actor,
            };
        }
        else {
            const current = await this.store.get(headKey(String(input.documentId)));
            if (!current || current.projectId !== input.projectId)
                throw new NotFoundError("document not found");
            if (current.status === "archived")
                throw new StateTransitionError("an archived document cannot be edited");
            head = {
                ...current,
                title,
                kind: input.kind,
                tags: input.tags === undefined ? current.tags : tags(input.tags),
                latestVersion: current.latestVersion + 1,
                contentHash: hash,
                bytes: Buffer.byteLength(body, "utf8"),
                updatedAt: at,
                updatedBy: actor,
            };
        }
        const version = {
            documentId: head.documentId,
            projectId: head.projectId,
            version: head.latestVersion,
            content: body,
            contentHash: hash,
            createdAt: at,
            createdBy: actor,
        };
        // Version first (create-only), then the head that points at it.
        await this.store.create(versionKey(head.documentId, head.latestVersion), {
            projectId: head.projectId,
            kind: "knowledge_version",
            createdAt: at,
            sessionId: head.documentId,
        }, version);
        await this.store.put(headKey(head.documentId), { projectId: head.projectId, kind: "knowledge_document", createdAt: at }, head);
        return head;
    }
    async archive(projectId, documentId, actor) {
        const current = await this.store.get(headKey(String(documentId)));
        if (!current || current.projectId !== projectId)
            throw new NotFoundError("document not found");
        if (current.status === "archived")
            return current;
        const next = {
            ...current,
            status: "archived",
            updatedAt: this.iso(),
            updatedBy: actor,
        };
        await this.store.put(headKey(next.documentId), { projectId, kind: "knowledge_document", createdAt: next.updatedAt }, next);
        return next;
    }
    /**
     * Keyword search within ONE project: all query terms must appear (title or
     * body); score = term frequency, title hits weighted x3. Archived excluded.
     */
    async search(projectId, query, limit = 20) {
        const terms = query
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length >= 2)
            .slice(0, 8);
        if (terms.length === 0)
            return [];
        const hits = [];
        for (const doc of await this.list(projectId)) {
            if (doc.status !== "active")
                continue;
            const ver = await this.store.get(versionKey(doc.documentId, doc.latestVersion));
            const body = (ver?.content ?? "").toLowerCase();
            const title = doc.title.toLowerCase();
            let score = 0;
            let all = true;
            for (const t of terms) {
                const inBody = body.split(t).length - 1;
                const inTitle = title.split(t).length - 1;
                if (inBody + inTitle === 0)
                    all = false;
                score += inBody + 3 * inTitle;
            }
            if (!all)
                continue;
            const idx = body.indexOf(terms[0]);
            const raw = ver?.content ?? "";
            hits.push({
                documentId: doc.documentId,
                title: doc.title,
                kind: doc.kind,
                score,
                version: doc.latestVersion,
                snippet: idx >= 0
                    ? raw.slice(Math.max(0, idx - 80), idx + 160)
                    : raw.slice(0, 200),
            });
        }
        return hits
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
            .slice(0, Math.min(50, limit));
    }
}
