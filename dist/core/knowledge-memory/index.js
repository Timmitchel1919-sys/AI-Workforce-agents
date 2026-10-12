import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import { ContextAssembler, MemoryContextSource } from "./context-assembler.js";
import { KnowledgeAuditor, computeHealth } from "./health-and-audit.js";
import { KnowledgeIngestion, ProjectDiscovery, } from "./ingestion.js";
import { ExecutionLearner } from "./learning.js";
import { MemoryService } from "./memory-service.js";
import { KnowledgeIndex, RetrievalEngine, } from "./retrieval.js";
export * from "./text.js";
export * from "./facets.js";
export * from "./write-policy.js";
export * from "./memory-service.js";
export * from "./retrieval.js";
export * from "./context-assembler.js";
export * from "./ingestion.js";
export * from "./learning.js";
export * from "./health-and-audit.js";
export function inMemoryKnowledgeRepos() {
    return {
        memories: new InMemoryRepository(),
        versions: new InMemoryRepository(),
        entities: new InMemoryRepository(),
        edges: new InMemoryRepository(),
        usage: new InMemoryRepository(),
        resolutions: new InMemoryRepository(),
        sources: new InMemoryRepository(),
    };
}
export class KnowledgeSystem {
    memory;
    index;
    retrieval;
    assembler;
    ingestion;
    discovery;
    learner;
    auditor;
    contextSource;
    constructor(options) {
        const clock = options.clock ?? Date.now;
        this.memory = new MemoryService(options.repos, options.audit, clock);
        this.index = new KnowledgeIndex(this.memory);
        this.retrieval = new RetrievalEngine(this.memory, this.index, clock, options.scorer);
        this.assembler = new ContextAssembler(this.memory, this.retrieval, clock);
        this.ingestion = new KnowledgeIngestion(this.memory, clock);
        this.discovery = new ProjectDiscovery(this.memory, this.ingestion, clock);
        this.learner = new ExecutionLearner(this.memory, this.retrieval);
        this.auditor = new KnowledgeAuditor(this.memory, this.retrieval, clock);
        this.contextSource = new MemoryContextSource(this.memory, this.retrieval);
        this.clock = clock;
    }
    clock;
    health(projectId) {
        return computeHealth(this.memory, this.clock(), projectId);
    }
}
/* ------------------------------------------------------------------ */
/* Source adapters                                                      */
/* ------------------------------------------------------------------ */
/** A registered local workspace, read through the governed (read-only) file system. */
export function workspaceFileSource(fs, git) {
    return {
        kind: "workspace",
        async list() {
            const tree = await fs.tree(".", 8, 1500);
            return {
                paths: tree.entries.filter((e) => e.type === "file").map((e) => e.path),
                truncated: tree.truncated,
            };
        },
        async read(path) {
            try {
                return (await fs.read(path)).content;
            }
            catch {
                return undefined;
            }
        },
        ...(git ? { commits: (limit) => git.log(limit) } : {}),
    };
}
/** A remote repository read through the onboarding GitHub reader (allow-listed files only). */
export function githubFileSource(reader, target) {
    let cached;
    const load = () => (cached ??= reader
        .read({
        provider: "github",
        url: target.url,
        ...(target.branch ? { branch: target.branch } : {}),
    })
        .then((r) => r.ok
        ? {
            paths: [...r.evidence.paths],
            files: r.evidence.files,
            truncated: r.evidence.truncated,
        }
        : undefined));
    return {
        kind: "github",
        async list() {
            const data = await load();
            if (!data)
                throw new Error("the repository could not be read");
            return { paths: data.paths, truncated: data.truncated };
        },
        async read(path) {
            return (await load())?.files[path];
        },
    };
}
