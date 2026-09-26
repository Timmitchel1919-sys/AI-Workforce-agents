import type {
  GraphMode,
  WorkforceGraphEdge,
  WorkforceGraphNode,
  WorkforceGraphNodeType,
} from "../../contracts/graph.js";

/**
 * One projection architecture, multiple logical views. A mode is a pure
 * selection over the SAME authorised base graph: which node types are visible,
 * where traversal starts, and which nodes are pruned as irrelevant. Adding a
 * future mode (COST, SECURITY, DEPLOYMENT, AUDIT) means adding one entry to
 * {@link MODE_DEFINITIONS} — never a second graph engine.
 */
export interface ModeSelection {
  nodes: WorkforceGraphNode[];
  edges: WorkforceGraphEdge[];
  /** Traversal roots, sorted. Empty → nothing reachable (empty view). */
  rootIds: string[];
  /** Human note surfaced in projection.metadata when the view is empty/limited. */
  note?: string;
}

interface ModeContext {
  nodes: readonly WorkforceGraphNode[];
  edges: readonly WorkforceGraphEdge[];
  projectNodeId: string;
  /** Caller-requested root, already verified to exist in the base graph. */
  requestedRoot?: string;
}

interface ModeDefinition {
  /** Node types visible in this mode. */
  types: ReadonlySet<WorkforceGraphNodeType>;
  select(ctx: ModeContext, visible: WorkforceGraphNode[]): ModeSelection;
}

const set = (
  ...t: WorkforceGraphNodeType[]
): ReadonlySet<WorkforceGraphNodeType> => new Set(t);

const ENVIRONMENT_TYPES = ["ENVIRONMENT", "ENVIRONMENT_ROUTER"] as const;
const CONTROL_PLANE_ID = "control-plane";

function rootOfType(
  ctx: ModeContext,
  visible: readonly WorkforceGraphNode[],
  type: WorkforceGraphNodeType,
): string | undefined {
  const requested = visible.find((n) => n.id === ctx.requestedRoot);
  return requested?.type === type ? requested.id : undefined;
}

/** Keep only `keep`-typed nodes that have at least one edge to another visible node. */
function pruneUnlinked(
  visible: readonly WorkforceGraphNode[],
  edges: readonly WorkforceGraphEdge[],
  prune: ReadonlySet<WorkforceGraphNodeType>,
  anchors: ReadonlySet<WorkforceGraphNodeType>,
): WorkforceGraphNode[] {
  const type = new Map(visible.map((n) => [n.id, n.type]));
  const linked = new Set<string>();
  for (const e of edges) {
    const s = type.get(e.source);
    const t = type.get(e.target);
    if (!s || !t) continue;
    if (anchors.has(s)) linked.add(e.target);
    if (anchors.has(t)) linked.add(e.source);
  }
  return visible.filter((n) => !prune.has(n.type) || linked.has(n.id));
}

export const MODE_DEFINITIONS: Readonly<Record<GraphMode, ModeDefinition>> = {
  WORKFORCE: {
    types: set(
      "CONTROL_PLANE",
      "PROJECT",
      "PROGRAM",
      "AGENT",
      "TASK",
      "WORKFLOW",
      ...ENVIRONMENT_TYPES,
    ),
    select: (ctx, visible) => ({
      nodes: visible,
      edges: [],
      rootIds: [
        ctx.requestedRoot ??
          (visible.some((n) => n.id === CONTROL_PLANE_ID)
            ? CONTROL_PLANE_ID
            : ctx.projectNodeId),
      ],
    }),
  },
  PROJECT: {
    types: set(
      "PROJECT",
      "PROGRAM",
      "AGENT",
      "TASK",
      "WORKFLOW",
      ...ENVIRONMENT_TYPES,
    ),
    select: (ctx, visible) => ({
      nodes: visible,
      edges: [],
      rootIds: [ctx.requestedRoot ?? ctx.projectNodeId],
    }),
  },
  AGENT: {
    types: set("PROJECT", "AGENT", "TASK", "WORKFLOW", ...ENVIRONMENT_TYPES),
    select: (ctx, visible) => {
      const agentRoot = rootOfType(ctx, visible, "AGENT");
      if (agentRoot) {
        return { nodes: visible, edges: [], rootIds: [agentRoot] };
      }
      return {
        nodes: visible.filter(
          (n) => n.type === "PROJECT" || n.type === "AGENT",
        ),
        edges: [],
        rootIds: [ctx.projectNodeId],
        note: "Select an agent to see its tasks, workflows and environments.",
      };
    },
  },
  WORKFLOW: {
    types: set("PROJECT", "WORKFLOW", "WORKFLOW_STEP", "AGENT"),
    select: (ctx, visible) => {
      const root = rootOfType(ctx, visible, "WORKFLOW");
      return {
        nodes: visible,
        edges: [],
        rootIds: [root ?? ctx.projectNodeId],
        ...(visible.some((n) => n.type === "WORKFLOW")
          ? {}
          : { note: "No workflows are registered for this project." }),
      };
    },
  },
  DEPENDENCY: {
    types: set("TASK"),
    select: (ctx, visible) => {
      const dependencyEdges = ctx.edges.filter((e) => e.type === "DEPENDS_ON");
      const involved = new Set<string>();
      for (const e of dependencyEdges) {
        involved.add(e.source);
        involved.add(e.target);
      }
      const nodes = visible.filter((n) => involved.has(n.id));
      const root = rootOfType(ctx, nodes, "TASK");
      return {
        nodes,
        edges: dependencyEdges,
        rootIds: root ? [root] : nodes.map((n) => n.id).sort(),
        ...(nodes.length === 0
          ? { note: "No task dependencies exist for this project." }
          : {}),
      };
    },
  },
  ENVIRONMENT: {
    types: set("PROJECT", "TASK", ...ENVIRONMENT_TYPES),
    select: (ctx, visible) => {
      const nodes = pruneUnlinked(
        visible,
        ctx.edges,
        set("TASK"),
        set("ENVIRONMENT_ROUTER"),
      );
      return {
        nodes,
        edges: [],
        rootIds: [ctx.requestedRoot ?? ctx.projectNodeId],
        ...(nodes.some((n) => n.type === "ENVIRONMENT")
          ? {}
          : {
              note: "No registered environments are routed for this project.",
            }),
      };
    },
  },
  KNOWLEDGE: {
    types: set("PROJECT", "KNOWLEDGE_SOURCE", "AGENT", "TASK"),
    select: (ctx, visible) => {
      const nodes = pruneUnlinked(
        visible,
        ctx.edges,
        set("AGENT", "TASK"),
        set("KNOWLEDGE_SOURCE"),
      );
      return {
        nodes,
        edges: [],
        rootIds: [ctx.requestedRoot ?? ctx.projectNodeId],
        ...(nodes.some((n) => n.type === "KNOWLEDGE_SOURCE")
          ? {}
          : { note: "No knowledge sources are registered for this project." }),
      };
    },
  },
};

/** Select the mode's visible slice of the authorised base graph. */
export function selectMode(mode: GraphMode, ctx: ModeContext): ModeSelection {
  const def = MODE_DEFINITIONS[mode];
  const visible = ctx.nodes.filter((n) => def.types.has(n.type));
  const selection = def.select(ctx, visible);
  const ids = new Set(selection.nodes.map((n) => n.id));
  return {
    ...selection,
    edges: (selection.edges.length > 0 ? selection.edges : ctx.edges).filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    ),
  };
}

export { CONTROL_PLANE_ID };
