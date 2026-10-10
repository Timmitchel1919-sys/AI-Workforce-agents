import type {
  GraphFragment,
  KnowledgeSource,
  KnowledgeSourceProvider,
  WorkforceGraphEdge,
  WorkforceGraphNode,
} from "../../contracts/graph.js";
import { KNOWLEDGE_SOURCE_KINDS } from "../../contracts/graph.js";
import { safeMetadata, truncate } from "./graph-util.js";
import { toGraphState } from "./graph-state.js";

const MAX_SOURCES = 100;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

/**
 * In-memory registry of authoritative knowledge sources. Nothing is scraped
 * from repositories: a source exists only if something registered it.
 */
export class KnowledgeSourceRegistry implements KnowledgeSourceProvider {
  private readonly sources = new Map<string, KnowledgeSource>();

  register(source: KnowledgeSource): KnowledgeSource {
    if (!ID_PATTERN.test(source.id)) {
      throw new Error("knowledge source id is malformed");
    }
    if (!(KNOWLEDGE_SOURCE_KINDS as readonly string[]).includes(source.kind)) {
      throw new Error(`unsupported knowledge source kind: ${source.kind}`);
    }
    if (!source.title.trim()) throw new Error("knowledge source needs a title");
    this.sources.set(source.id, source);
    return source;
  }

  list(): readonly KnowledgeSource[] {
    return [...this.sources.values()];
  }
}

export interface KnowledgeFragmentInput {
  projectId: string;
  projectNodeId: string;
  provider?: KnowledgeSourceProvider;
  agentIds: ReadonlySet<string>;
  taskIds: ReadonlySet<string>;
}

/**
 * Project-scoped knowledge slice. A source is visible only when it lists this
 * project (or "*"); references to sources outside that visible set are dropped
 * so a source's links can never reveal another project's knowledge.
 */
export function buildKnowledgeFragment(
  input: KnowledgeFragmentInput,
): GraphFragment {
  const visible = (input.provider?.list() ?? [])
    .filter(
      (s) =>
        s.projectIds.includes(input.projectId) || s.projectIds.includes("*"),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_SOURCES);
  const visibleIds = new Set(visible.map((s) => s.id));

  const nodes: WorkforceGraphNode[] = [];
  const edges: WorkforceGraphEdge[] = [];
  for (const s of visible) {
    const nodeId = `knowledge-${s.id}`;
    nodes.push({
      id: nodeId,
      type: "KNOWLEDGE_SOURCE",
      label: truncate(s.title, 120),
      status: "active",
      state: toGraphState("active"),
      projectId: input.projectId,
      referenceId: s.id,
      metadata: safeMetadata({ kind: s.kind }),
    });
    edges.push({
      id: `knowledge-belongs-${s.id}`,
      type: "BELONGS_TO",
      source: nodeId,
      target: input.projectNodeId,
    });
    for (const agentId of s.usedByAgentIds ?? []) {
      if (!input.agentIds.has(agentId)) continue;
      edges.push({
        id: `knowledge-used-by-${s.id}-${agentId}`,
        type: "USED_BY",
        source: nodeId,
        target: `agent-${agentId}`,
      });
    }
    for (const ref of s.referencesSourceIds ?? []) {
      if (!visibleIds.has(ref) || ref === s.id) continue;
      edges.push({
        id: `knowledge-ref-${s.id}-${ref}`,
        type: "REFERENCES",
        source: nodeId,
        target: `knowledge-${ref}`,
      });
    }
    for (const taskId of s.describesTaskIds ?? []) {
      if (!input.taskIds.has(taskId)) continue;
      edges.push({
        id: `knowledge-describes-${s.id}-${taskId}`,
        type: s.kind === "documentation" ? "DOCUMENTS" : "DESCRIBES",
        source: nodeId,
        target: `task-${taskId}`,
      });
    }
  }
  return { nodes, edges };
}
