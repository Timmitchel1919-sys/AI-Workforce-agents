/**
 * Knowledge, Memory & Context Intelligence — composition.
 *
 * `KnowledgeSystem` wires the memory service, index, retrieval, assembler,
 * ingestion, discovery, learner and auditor over the platform repositories and
 * AuditLog. Source adapters reuse existing readers (the governed workspace file
 * system, the onboarding GitHub repository reader).
 */
import type { AuditLog } from "../index.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import type { GovernedFileSystem } from "../execution-runtime/workspace.js";
import type { LocalGitOps } from "../execution-runtime/git-ops.js";
import type { RepositorySourceReader } from "../onboarding/repository-source.js";
import { ContextAssembler, MemoryContextSource } from "./context-assembler.js";
import { KnowledgeAuditor, computeHealth } from "./health-and-audit.js";
import {
  KnowledgeIngestion,
  ProjectDiscovery,
  type ProjectFileSource,
} from "./ingestion.js";
import { ExecutionLearner } from "./learning.js";
import { MemoryService, type KnowledgeRepos } from "./memory-service.js";
import {
  KnowledgeIndex,
  RetrievalEngine,
  type SemanticScorer,
} from "./retrieval.js";

export * from "./text.js";
export * from "./facets.js";
export * from "./write-policy.js";
export * from "./memory-service.js";
export * from "./retrieval.js";
export * from "./context-assembler.js";
export * from "./ingestion.js";
export * from "./learning.js";
export * from "./health-and-audit.js";

export function inMemoryKnowledgeRepos(): KnowledgeRepos {
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
  readonly memory: MemoryService;
  readonly index: KnowledgeIndex;
  readonly retrieval: RetrievalEngine;
  readonly assembler: ContextAssembler;
  readonly ingestion: KnowledgeIngestion;
  readonly discovery: ProjectDiscovery;
  readonly learner: ExecutionLearner;
  readonly auditor: KnowledgeAuditor;
  readonly contextSource: MemoryContextSource;

  constructor(options: {
    repos: KnowledgeRepos;
    audit: AuditLog;
    clock?: () => number;
    scorer?: SemanticScorer;
  }) {
    const clock = options.clock ?? Date.now;
    this.memory = new MemoryService(options.repos, options.audit, clock);
    this.index = new KnowledgeIndex(this.memory);
    this.retrieval = new RetrievalEngine(
      this.memory,
      this.index,
      clock,
      options.scorer,
    );
    this.assembler = new ContextAssembler(this.memory, this.retrieval, clock);
    this.ingestion = new KnowledgeIngestion(this.memory, clock);
    this.discovery = new ProjectDiscovery(this.memory, this.ingestion, clock);
    this.learner = new ExecutionLearner(this.memory, this.retrieval);
    this.auditor = new KnowledgeAuditor(this.memory, this.retrieval, clock);
    this.contextSource = new MemoryContextSource(this.memory, this.retrieval);
    this.clock = clock;
  }

  private readonly clock: () => number;

  health(projectId?: string) {
    return computeHealth(this.memory, this.clock(), projectId);
  }
}

/* ------------------------------------------------------------------ */
/* Source adapters                                                      */
/* ------------------------------------------------------------------ */

/** A registered local workspace, read through the governed (read-only) file system. */
export function workspaceFileSource(
  fs: Pick<GovernedFileSystem, "tree" | "read">,
  git?: Pick<LocalGitOps, "log">,
): ProjectFileSource {
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
      } catch {
        return undefined;
      }
    },
    ...(git ? { commits: (limit: number) => git.log(limit) } : {}),
  };
}

/** A remote repository read through the onboarding GitHub reader (allow-listed files only). */
export function githubFileSource(
  reader: RepositorySourceReader,
  target: { url: string; branch?: string },
): ProjectFileSource {
  let cached:
    | Promise<
        | {
            paths: string[];
            files: Readonly<Record<string, string>>;
            truncated: boolean;
          }
        | undefined
      >
    | undefined;
  const load = () =>
    (cached ??= reader
      .read({
        provider: "github",
        url: target.url,
        ...(target.branch ? { branch: target.branch } : {}),
      })
      .then((r) =>
        r.ok
          ? {
              paths: [...r.evidence.paths],
              files: r.evidence.files,
              truncated: r.evidence.truncated,
            }
          : undefined,
      ));
  return {
    kind: "github",
    async list() {
      const data = await load();
      if (!data) throw new Error("the repository could not be read");
      return { paths: data.paths, truncated: data.truncated };
    },
    async read(path) {
      return (await load())?.files[path];
    },
  };
}
