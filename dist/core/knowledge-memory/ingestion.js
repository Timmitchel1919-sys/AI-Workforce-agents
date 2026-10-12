import { KNOWLEDGE_LIMITS } from "../../contracts/knowledge-memory.js";
import { analyzeRepositoryEvidence, isContentAllowlisted, } from "../onboarding/discovery.js";
import { clip, hashOf, slug } from "./text.js";
import { KnowledgeError } from "./write-policy.js";
/** In-memory source (tests, pasted documents). */
export class StaticFileSource {
    files;
    history;
    kind = "memory";
    constructor(files, history = []) {
        this.files = files;
        this.history = history;
    }
    async list() {
        return { paths: Object.keys(this.files), truncated: false };
    }
    async read(path) {
        return this.files[path];
    }
    async commits(limit) {
        return this.history.slice(0, limit);
    }
}
const DENY_SEGMENTS = new Set([
    "node_modules",
    "dist",
    "build",
    ".git",
    "coverage",
    ".next",
    ".firebase",
    "vendor",
]);
const DENY_FILE = /(^|\/)(\.env(\..+)?|.*\.(pem|key|p12|pfx|lock|map|min\.js|png|jpe?g|gif|ico|woff2?|zip|gz)|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|id_rsa.*|.*serviceaccount.*\.json)$/i;
const ENV_EXAMPLE = /\.env\.example$/i;
// A .pdf is accepted only as already-extracted text (no PDF parser is bundled).
const TEXT_DOC = /\.(md|mdx|txt|rst|pdf)$/i;
const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/i;
export function isIngestablePath(path) {
    const p = path.replace(/\\/g, "/");
    if (p.startsWith("/") || p.includes(".."))
        return { ok: false, reason: "path is not repository-relative" };
    if (p.split("/").some((s) => DENY_SEGMENTS.has(s)))
        return { ok: false, reason: "generated or dependency directory" };
    if (DENY_FILE.test(p) && !ENV_EXAMPLE.test(p))
        return { ok: false, reason: "credential, binary or generated file" };
    if (TEXT_DOC.test(p))
        return { ok: true, kind: "doc" };
    if (CODE_FILE.test(p))
        return { ok: true, kind: "code" };
    if (isContentAllowlisted(p))
        return { ok: true, kind: "config" };
    return { ok: false, reason: "file type is not ingested" };
}
/* ------------------------------------------------------------------ */
/* Classification & chunking                                           */
/* ------------------------------------------------------------------ */
const TAG_RULES = [
    ["adr", /(^|\/)(adr|decisions?)\b|(^|\/)\d{3,4}-/i],
    ["architecture", /architect|design\b|overview|system/i],
    ["security", /secur|auth|permission|rbac|secret|threat/i],
    ["deployment", /deploy|hosting|release|ci\b|pipeline/i],
    ["ui", /\bui\b|ux|theme|design system|style|css|component/i],
    ["api", /\bapi\b|endpoint|route/i],
    ["testing", /\btest|vitest|coverage|qa\b/i],
    ["readme", /readme/i],
];
export function classifyDocument(path, text) {
    const probe = `${path} ${text.slice(0, 400)}`;
    const tags = TAG_RULES.filter(([, re]) => re.test(probe)).map(([t]) => t);
    const important = tags.includes("adr") ||
        tags.includes("security") ||
        /(^|\/)architecture/i.test(path);
    return {
        tags: [...new Set(tags)],
        importance: important ? "HIGH" : "NORMAL",
    };
}
export function chunkMarkdown(text, max = KNOWLEDGE_LIMITS.chunkChars) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const sections = [];
    let path = [];
    let body = [];
    const flush = () => {
        if (body.join("\n").trim() !== "")
            sections.push({ path: [...path], body });
        body = [];
    };
    let inFence = false;
    for (const line of lines) {
        if (/^\s*```/.test(line))
            inFence = !inFence;
        const h = !inFence ? /^(#{1,4})\s+(.+?)\s*#*$/.exec(line) : null;
        if (h) {
            flush();
            const level = h[1].length;
            path = [...path.slice(0, level - 1), h[2]];
        }
        body.push(line);
    }
    flush();
    const chunks = [];
    for (const s of sections) {
        const heading = s.path.join(" › ") || "Introduction";
        const joined = s.body.join("\n").trim();
        if (joined.length <= max) {
            chunks.push({ heading, text: joined });
            continue;
        }
        let cur = "";
        for (const para of joined.split(/\n{2,}/)) {
            if (cur.length + para.length + 2 > max && cur !== "") {
                chunks.push({ heading, text: cur.trim() });
                cur = "";
            }
            cur += `${para}\n\n`;
            while (cur.length > max * 1.5) {
                chunks.push({ heading, text: cur.slice(0, max).trim() });
                cur = cur.slice(max);
            }
        }
        if (cur.trim() !== "")
            chunks.push({ heading, text: cur.trim() });
    }
    return chunks.filter((c) => c.text.length >= 20);
}
const AREAS = [
    "auth",
    "login",
    "inventory",
    "dashboard",
    "admin",
    "settings",
    "billing",
    "reports",
    "api",
    "services",
    "pages",
    "hooks",
    "components",
];
export function extractCodeSymbols(path, text) {
    const uniq = (xs) => [...new Set(xs)].slice(0, 15);
    const all = (re, group = 1) => [...text.matchAll(re)].map((m) => m[group]).filter(Boolean);
    const isJsx = /\.(tsx|jsx)$/.test(path);
    const exported = all(/export\s+(?:default\s+)?(?:async\s+)?(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g);
    const integrations = all(/from\s+["'](firebase(?:\/[\w-]+)?|@firebase\/[\w-]+|stripe|axios|react-router(?:-dom)?|@tanstack\/react-query|zustand|redux)["']/g);
    return {
        components: uniq(isJsx ? exported.filter((n) => /^[A-Z]/.test(n)) : []),
        hooks: uniq(exported.filter((n) => /^use[A-Z]/.test(n))),
        types: uniq(all(/export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)),
        routes: uniq(all(/(?:path\s*[:=]\s*|<Route\s+path=)["'`{]*["'`]?(\/[\w/:*.-]*)/g)),
        apiCalls: uniq(all(/(?:fetch|apiRequest|axios\.\w+|request)\(\s*["'`](\/api\/[\w/:.${}-]*)/g)),
        integrations: uniq(integrations),
        services: uniq(/(^|\/)services?\//.test(path)
            ? exported.filter((n) => /^[A-Za-z]/.test(n) && !/^use[A-Z]/.test(n))
            : all(/export\s+class\s+(\w*Service)\b/g)),
    };
}
export function areaOf(path) {
    const segs = path.toLowerCase().split(/[/.]/);
    return AREAS.find((a) => segs.includes(a) || segs.some((s) => s.startsWith(a)));
}
export class KnowledgeIngestion {
    memory;
    clock;
    constructor(memory, clock = Date.now) {
        this.memory = memory;
        this.clock = clock;
    }
    system(requestedBy) {
        return { id: `ingest:${requestedBy}`, kind: "SYSTEM" };
    }
    ingestDocument(input) {
        const report = {
            ref: input.ref,
            status: "skipped",
            chunks: 0,
            created: [],
            reinforced: [],
            archived: [],
            staleMarked: [],
            redacted: 0,
            steps: ["identify"],
        };
        const verdict = isIngestablePath(input.ref);
        if (!verdict.ok)
            return { ...report, reason: verdict.reason };
        if (input.contentType === "application/pdf" && !input.text.trim())
            return {
                ...report,
                reason: "PDF text extraction is not available; supply the extracted text",
            };
        if (!input.text.trim())
            return { ...report, reason: "the document is empty" };
        if (Buffer.byteLength(input.text) > KNOWLEDGE_LIMITS.maxDocumentBytes)
            return { ...report, reason: "the document is too large" };
        if (input.text.slice(0, 8000).includes("\0"))
            return { ...report, reason: "binary content" };
        report.steps.push("extract");
        const hash = hashOf(input.text);
        const stateId = `${input.projectId}:${input.ref}`;
        const prior = this.memory.repos.sources.findById(stateId);
        if (prior && prior.hash === hash)
            return { ...report, status: "unchanged", reason: "source unchanged" };
        const source = input.source ?? "PROJECT_FILE";
        const actor = this.system(input.requestedBy);
        const { tags, importance } = classifyDocument(input.ref, input.text);
        report.steps.push("classify", "metadata");
        const isCode = verdict.kind === "code";
        const pieces = [];
        if (isCode) {
            const sym = extractCodeSymbols(input.ref, input.text);
            const parts = [
                sym.components.length ? `components: ${sym.components.join(", ")}` : "",
                sym.hooks.length ? `hooks: ${sym.hooks.join(", ")}` : "",
                sym.services.length ? `services: ${sym.services.join(", ")}` : "",
                sym.types.length ? `types: ${sym.types.join(", ")}` : "",
                sym.routes.length ? `routes: ${sym.routes.join(", ")}` : "",
                sym.apiCalls.length ? `API calls: ${sym.apiCalls.join(", ")}` : "",
                sym.integrations.length ? `uses: ${sym.integrations.join(", ")}` : "",
            ].filter(Boolean);
            if (parts.length === 0)
                return { ...report, reason: "no indexable symbols" };
            const kinds = [
                sym.components.length ? "component" : "",
                sym.hooks.length ? "hook" : "",
                sym.services.length ? "service" : "",
                sym.routes.length ? "route" : "",
                sym.apiCalls.length ? "api" : "",
            ].filter(Boolean);
            const area = areaOf(input.ref);
            pieces.push({
                title: `Code: ${input.ref}`,
                content: `File ${input.ref} — ${parts.join("; ")}.`,
                tags: ["code", ...kinds, ...(area ? [area] : [])],
                extra: { importance: "LOW" },
            });
        }
        else {
            const chunks = verdict.kind === "doc"
                ? chunkMarkdown(input.text)
                : [{ heading: input.ref, text: clip(input.text, 3000) }];
            report.steps.push("structure", "chunk");
            for (const c of chunks) {
                pieces.push({
                    title: `${input.ref.split("/").pop()} › ${c.heading}`,
                    content: c.text,
                    tags: [...tags, ...(input.tags ?? [])],
                    extra: { importance },
                });
            }
        }
        // Replace the previous version of this source: old chunks are archived, never silently kept active.
        if (prior) {
            for (const id of prior.memoryIds) {
                const m = this.memory.get(id);
                if (m && (m.status === "ACTIVE" || m.status === "DRAFT")) {
                    this.memory.archive(id, actor, "source changed");
                    report.archived.push(id);
                }
            }
        }
        const ids = [];
        for (const piece of pieces) {
            try {
                const res = this.memory.create({
                    type: "DOCUMENT",
                    title: piece.title,
                    content: piece.content,
                    projectId: input.projectId,
                    source,
                    sourceRef: input.ref,
                    sourceHash: hash,
                    tags: piece.tags,
                    references: [
                        { kind: isCode ? "file" : "document", ref: input.ref },
                    ],
                    retention: "PERMANENT",
                    ...piece.extra,
                }, actor);
                ids.push(res.memory.memoryId);
                (res.outcome === "CREATED" ? report.created : report.reinforced).push(res.memory.memoryId);
                if (res.memory.tags.includes("redacted"))
                    report.redacted++;
                if (isCode)
                    this.linkCode(res.memory.memoryId, input.projectId, input.ref);
            }
            catch (error) {
                if (!(error instanceof KnowledgeError))
                    throw error;
                // a chunk that is only a secret (or otherwise refused) is excluded, not ingested
                report.redacted += error.message.includes("secret") ? 1 : 0;
            }
        }
        report.steps.push("validate", "index", "connect", "provenance");
        report.chunks = pieces.length;
        // Document updates: knowledge that cites this source but is not owned by it may now be stale.
        if (prior) {
            const owned = new Set([...prior.memoryIds, ...ids]);
            for (const m of this.memory.all()) {
                if (m.projectId !== input.projectId ||
                    owned.has(m.memoryId) ||
                    m.freshness === "POTENTIALLY_STALE")
                    continue;
                if (m.status !== "ACTIVE")
                    continue;
                if (m.references.some((r) => r.ref === input.ref)) {
                    this.memory.markStale(m.memoryId, `source ${input.ref} changed`, actor);
                    report.staleMarked.push(m.memoryId);
                }
            }
        }
        this.memory.repos.sources.upsert({
            id: stateId,
            projectId: input.projectId,
            ref: input.ref,
            hash,
            ingestedAt: new Date(this.clock()).toISOString(),
            memoryIds: ids,
        });
        report.status = "ingested";
        this.memory.record("knowledge.ingested", actor, {
            projectId: input.projectId,
            source,
            detail: {
                ref: input.ref,
                chunks: pieces.length,
                created: report.created.length,
                archived: report.archived.length,
                staleMarked: report.staleMarked.length,
            },
        });
        this.memory.record("knowledge.indexed", actor, {
            projectId: input.projectId,
            detail: { ref: input.ref, documents: ids.length },
        });
        return report;
    }
    linkCode(memoryId, projectId, ref) {
        const file = this.memory.entity(projectId, ref.split("/").pop() ?? ref, "COMPONENT");
        this.memory.link(`mem:${memoryId}`, file.id, "RELATED_TO", "ingestion", "PROJECT_FILE", projectId);
        const area = areaOf(ref);
        if (area) {
            const a = this.memory.entity(projectId, area, "AREA");
            this.memory.link(file.id, a.id, "BELONGS_TO", "ingestion", "PROJECT_FILE", projectId);
        }
    }
    /** Git history as low-authority context: commit messages are never architecture. */
    async ingestCommits(input) {
        if (!input.source.commits)
            return { created: 0, skipped: 0 };
        const actor = this.system(input.requestedBy);
        const commits = await input.source.commits(Math.min(input.limit ?? 30, 50));
        let created = 0;
        let skipped = 0;
        for (const c of commits) {
            const ref = `commit:${c.sha}`;
            if (this.memory.repos.sources.findById(`${input.projectId}:${ref}`)) {
                skipped++;
                continue;
            }
            const first = c.message.split("\n")[0] ?? c.message;
            try {
                const res = this.memory.create({
                    type: "DOCUMENT",
                    title: `Commit ${c.sha.slice(0, 7)}: ${clip(first, 90)}`,
                    content: `${c.message}\nFiles: ${c.files.slice(0, 15).join(", ") || "n/a"}`,
                    projectId: input.projectId,
                    source: "GITHUB",
                    sourceRef: ref,
                    tags: ["commit", "history"],
                    references: [
                        { kind: "commit", ref: c.sha },
                        ...c.files
                            .slice(0, 5)
                            .map((f) => ({ kind: "file", ref: f })),
                    ],
                    importance: "LOW",
                    retention: "TEMPORARY",
                    expiresAt: new Date(this.clock() + 365 * 86_400_000).toISOString(),
                }, actor);
                this.memory.repos.sources.upsert({
                    id: `${input.projectId}:${ref}`,
                    projectId: input.projectId,
                    ref,
                    hash: hashOf(c.message),
                    ingestedAt: new Date(this.clock()).toISOString(),
                    memoryIds: [res.memory.memoryId],
                });
                created++;
            }
            catch (error) {
                if (!(error instanceof KnowledgeError))
                    throw error;
                skipped++;
            }
        }
        this.memory.record("knowledge.ingested", actor, {
            projectId: input.projectId,
            source: "GITHUB",
            detail: { commits: created },
        });
        return { created, skipped };
    }
}
export class ProjectDiscovery {
    memory;
    ingestion;
    clock;
    constructor(memory, ingestion, clock = Date.now) {
        this.memory = memory;
        this.ingestion = ingestion;
        this.clock = clock;
    }
    async run(input) {
        const mode = input.mode ?? "discover";
        const actor = {
            id: `discovery:${input.requestedBy}`,
            kind: "SYSTEM",
        };
        const listing = await input.source.list();
        const paths = listing.paths.map((p) => p.replace(/\\/g, "/"));
        // 1. Evidence → the existing onboarding analyzer (no second stack detector).
        const files = {};
        for (const p of paths) {
            if (!isContentAllowlisted(p) || files[p] !== undefined)
                continue;
            const text = await input.source.read(p);
            if (text !== undefined)
                files[p] = text;
        }
        const evidence = {
            provider: "github",
            url: "local-or-connected-source",
            visibility: "unknown",
            defaultBranch: "unknown",
            branch: "unknown",
            paths,
            truncated: listing.truncated,
            files,
        };
        const analysis = analyzeRepositoryEvidence(evidence, new Date(this.clock()).toISOString());
        // 2. Topic memories (SYSTEM_GENERATED, never USER_CONFIRMED).
        const names = (xs) => xs.map((x) => x.value);
        const stack = [
            ...names(analysis.languages).slice(0, 3),
            ...names(analysis.frameworks),
            ...names(analysis.buildSystems),
        ];
        const topics = [];
        const topic = (key, title, content, tags, importance = "NORMAL") => {
            topics.push({
                topic: key,
                outcome: this.upsertTopic(input.projectId, key, title, content, tags, importance, actor),
            });
        };
        if (stack.length > 0)
            topic("stack", `${input.projectId} technology stack`, `${input.projectId} uses ${stack.join(", ")}.${analysis.testFrameworks.length ? ` Tests: ${names(analysis.testFrameworks).join(", ")}.` : ""}`, ["stack", "architecture"]);
        if (analysis.deployment.length > 0)
            topic("deployment", `${input.projectId} deployment`, `${input.projectId} deploys to ${names(analysis.deployment).join(", ")}.`, ["deployment"]);
        if (analysis.commands.length > 0)
            topic("commands", `${input.projectId} commands`, analysis.commands
                .slice(0, 8)
                .map((c) => `${c.purpose}: ${c.command}`)
                .join("; "), ["development", "commands"]);
        const securityFindings = analysis.security.filter((s) => s.severity !== "info");
        if (securityFindings.length > 0)
            topic("security", `${input.projectId} security observations`, securityFindings
                .slice(0, 6)
                .map((s) => s.message)
                .join(" "), ["security"], "HIGH");
        // 3. Graph: project → technologies.
        const project = this.memory.entity(input.projectId, input.projectId, "PROJECT");
        const tech = [
            ...names(analysis.frameworks).map((n) => [n, "TECHNOLOGY"]),
            ...names(analysis.languages)
                .slice(0, 3)
                .map((n) => [n, "TECHNOLOGY"]),
            ...names(analysis.buildSystems).map((n) => [n, "TECHNOLOGY"]),
            ...names(analysis.deployment).map((n) => [n, "INTEGRATION"]),
        ];
        for (const [name, kind] of tech) {
            const e = this.memory.entity(input.projectId, name, kind);
            this.memory.link(project.id, e.id, "USES", actor.id, "PROJECT_FILE", input.projectId);
        }
        // 4. Documents and code (bounded, prioritised).
        const docs = paths.filter((p) => isIngestablePath(p).ok && TEXT_DOC.test(p));
        docs.sort((a, b) => Number(/readme/i.test(b)) - Number(/readme/i.test(a)) ||
            Number(/adr|architect/i.test(b)) - Number(/adr|architect/i.test(a)));
        const code = paths
            .filter((p) => CODE_FILE.test(p) &&
            isIngestablePath(p).ok &&
            !/\.(test|spec)\./.test(p) &&
            !/\.d\.ts$/.test(p))
            .sort((a, b) => Number(Boolean(areaOf(b))) - Number(Boolean(areaOf(a))) ||
            a.length - b.length);
        const reports = [];
        const staleMarked = [];
        for (const p of [
            ...docs.slice(0, input.maxDocuments ?? 25),
            ...code.slice(0, input.maxCode ?? 60),
        ]) {
            const text = await input.source.read(p);
            if (text === undefined)
                continue;
            const r = this.ingestion.ingestDocument({
                projectId: input.projectId,
                ref: p,
                text,
                source: input.source.kind === "github" ? "GITHUB" : "PROJECT_FILE",
                requestedBy: input.requestedBy,
            });
            reports.push(r);
            staleMarked.push(...r.staleMarked);
        }
        const commits = await this.ingestion.ingestCommits({
            projectId: input.projectId,
            source: input.source,
            requestedBy: input.requestedBy,
        });
        const conflicts = this.memory.listConflicts(input.projectId).length;
        this.memory.record(mode === "refresh" ? "knowledge.refreshed" : "knowledge.discovered", actor, {
            projectId: input.projectId,
            source: input.source.kind,
            detail: {
                topics: topics.length,
                documents: reports.length,
                staleMarked: staleMarked.length,
                conflicts,
            },
        });
        return {
            projectId: input.projectId,
            mode,
            source: input.source.kind,
            truncated: listing.truncated,
            topics,
            documents: reports,
            commits,
            staleMarked,
            conflicts,
            unavailable: analysis.unavailable,
        };
    }
    upsertTopic(projectId, key, title, content, tags, importance, actor) {
        const ref = `discovery:${key}`;
        const hash = hashOf(content);
        const existing = this.memory
            .all()
            .find((m) => m.projectId === projectId &&
            m.sourceRef === ref &&
            (m.status === "ACTIVE" || m.status === "DRAFT"));
        const proposal = {
            type: "PROJECT",
            title,
            content,
            projectId,
            source: "PROJECT_FILE",
            sourceRef: ref,
            sourceHash: hash,
            tags,
            importance,
            retention: "PERMANENT",
        };
        if (!existing) {
            const res = this.memory.create(proposal, actor);
            return res.outcome === "CREATED" ? "created" : "reinforced";
        }
        if (existing.sourceHash === hash)
            return "unchanged";
        // The repository changed. Confirmed knowledge is never overwritten.
        if (existing.confidence === "USER_CONFIRMED" ||
            existing.confidence === "VERIFIED") {
            this.memory.markStale(existing.memoryId, "the repository no longer matches this memory", actor);
            this.memory.create({ ...proposal, verified: false }, actor);
            return "candidate";
        }
        this.memory.supersede(existing.memoryId, proposal, actor);
        return "superseded";
    }
}
export { slug };
