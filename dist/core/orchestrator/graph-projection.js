import { DEFAULT_GRAPH_MODE, GRAPH_LIMITS, } from "../../contracts/graph.js";
import { NotFoundError } from "../../contracts/index.js";
import { buildEnvironmentFragment } from "./graph-environment-fragment.js";
import { buildKnowledgeFragment } from "./graph-knowledge-fragment.js";
import { CONTROL_PLANE_ID, selectMode } from "./graph-modes.js";
import { toGraphState } from "./graph-state.js";
const MAX_LABEL_LENGTH = 120;
const MAX_META_STRING = 200;
const MAX_LIST_ITEMS = 10;
/**
 * Free text (task/step/agent descriptions) is user-authored, so obvious
 * credential shapes are scrubbed before it can appear on a graph node.
 */
const SECRET_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{8,}/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g,
    /\b(api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*\S+/gi,
];
export function redactSecrets(value) {
    let out = value;
    for (const pattern of SECRET_PATTERNS)
        out = out.replace(pattern, "[redacted]");
    return out;
}
export function truncate(value, max) {
    const clean = redactSecrets(value);
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
/** Only display-safe scalar metadata survives; undefined entries are dropped. */
export function safeMetadata(input) {
    const out = {};
    for (const key of Object.keys(input).sort()) {
        const value = input[key];
        if (value === undefined)
            continue;
        out[key] =
            typeof value === "string" ? truncate(value, MAX_META_STRING) : value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
export function joinList(values) {
    if (!values || values.length === 0)
        return undefined;
    const shown = values.slice(0, MAX_LIST_ITEMS).join(", ");
    return values.length > MAX_LIST_ITEMS
        ? `${shown} (+${values.length - MAX_LIST_ITEMS})`
        : shown;
}
/** Clamp caller-supplied bounds. Callers can only tighten, never loosen. */
export function resolveBounds(options) {
    const clamp = (raw, fallback, ceiling) => {
        if (raw === undefined || !Number.isFinite(raw))
            return fallback;
        return Math.min(Math.max(Math.floor(raw), 1), ceiling);
    };
    return {
        depth: clamp(options.depth, GRAPH_LIMITS.defaultDepth, GRAPH_LIMITS.maxDepth),
        maxNodes: clamp(options.maxNodes, GRAPH_LIMITS.defaultMaxNodes, GRAPH_LIMITS.maxNodes),
        maxEdges: clamp(options.maxEdges, GRAPH_LIMITS.maxEdges, GRAPH_LIMITS.maxEdges),
    };
}
/** Stable, content-derived revision: identical graphs have identical revisions. */
function contentRevision(nodes, edges) {
    let hash = 5381;
    const feed = (text) => {
        for (let i = 0; i < text.length; i += 1) {
            hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
        }
    };
    for (const n of nodes)
        feed(`${n.id}|${n.status}|${n.state};`);
    for (const e of edges)
        feed(`${e.id}|${e.source}|${e.target};`);
    return hash;
}
export const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export class GraphBuilder {
    nodes = new Map();
    edges = new Map();
    addNode(node) {
        if (!this.nodes.has(node.id))
            this.nodes.set(node.id, node);
    }
    addEdge(edge) {
        if (!this.edges.has(edge.id))
            this.edges.set(edge.id, edge);
    }
    merge(fragment) {
        for (const n of fragment.nodes)
            this.addNode(n);
        for (const e of fragment.edges)
            this.addEdge(e);
    }
}
/**
 * Deterministic, cycle-safe, bounded breadth-first view over an
 * already-authorised graph. Neighbours are visited in id order; visited-set
 * membership makes cycles harmless; the node cap makes traversal bounded.
 * Edges are only kept when both endpoints survive (no dangling edges).
 */
export function boundedView(nodes, edges, rootIds, bounds) {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const adjacency = new Map();
    const link = (from, to) => {
        const list = adjacency.get(from);
        if (list)
            list.push(to);
        else
            adjacency.set(from, [to]);
    };
    for (const e of edges) {
        if (!nodeById.has(e.source) || !nodeById.has(e.target))
            continue;
        link(e.source, e.target);
        link(e.target, e.source);
    }
    for (const list of adjacency.values())
        list.sort();
    const visited = new Set();
    let truncated = false;
    const roots = (typeof rootIds === "string" ? [rootIds] : [...rootIds])
        .filter((id) => nodeById.has(id))
        .sort();
    if (roots.length > 0) {
        for (const root of roots) {
            if (visited.size >= bounds.maxNodes) {
                truncated = true;
                break;
            }
            visited.add(root);
        }
        let frontier = [...visited];
        for (let level = 0; level < bounds.depth && frontier.length > 0; level += 1) {
            const next = [];
            for (const id of frontier) {
                for (const neighbour of adjacency.get(id) ?? []) {
                    if (visited.has(neighbour))
                        continue;
                    if (visited.size >= bounds.maxNodes) {
                        truncated = true;
                        continue;
                    }
                    visited.add(neighbour);
                    next.push(neighbour);
                }
            }
            frontier = next;
        }
        // Reachable-but-excluded neighbours (depth bound) also count as truncation.
        if (!truncated) {
            for (const id of visited) {
                for (const neighbour of adjacency.get(id) ?? []) {
                    if (!visited.has(neighbour))
                        truncated = true;
                }
            }
        }
    }
    const keptNodes = [...visited].map((id) => nodeById.get(id)).sort(byId);
    let keptEdges = edges
        .filter((e) => visited.has(e.source) && visited.has(e.target))
        .sort(byId);
    if (keptEdges.length > bounds.maxEdges) {
        keptEdges = keptEdges.slice(0, bounds.maxEdges);
        truncated = true;
    }
    return { nodes: keptNodes, edges: keptEdges, truncated };
}
export class WorkforceGraphProjectionService {
    projectRegistry;
    agentRegistry;
    taskSystem;
    sfOrchestrator;
    sources;
    clock;
    constructor(projectRegistry, agentRegistry, taskSystem, sfOrchestrator, sources = {}, clock = () => new Date()) {
        this.projectRegistry = projectRegistry;
        this.agentRegistry = agentRegistry;
        this.taskSystem = taskSystem;
        this.sfOrchestrator = sfOrchestrator;
        this.sources = sources;
        this.clock = clock;
    }
    getProjection(options) {
        const project = this.projectRegistry.get(options.projectId);
        if (!project) {
            throw new NotFoundError("project not found");
        }
        const bounds = resolveBounds(options);
        const mode = options.mode ?? DEFAULT_GRAPH_MODE;
        const projectNodeId = `project-${project.projectId}`;
        const builder = this.buildBaseGraph(options.projectId, projectNodeId);
        const baseNodes = [...builder.nodes.values()].sort(byId);
        const baseEdges = [...builder.edges.values()];
        const requestedRoot = options.rootNodeId && builder.nodes.has(options.rootNodeId)
            ? options.rootNodeId
            : undefined;
        const selection = selectMode(mode, {
            nodes: baseNodes,
            edges: baseEdges,
            projectNodeId,
            ...(requestedRoot ? { requestedRoot } : {}),
        });
        let nodes = selection.nodes;
        if (options.nodeTypes && options.nodeTypes.length > 0) {
            const allowed = new Set(options.nodeTypes);
            nodes = nodes.filter((n) => n.type === "PROJECT" || allowed.has(n.type));
        }
        const effectiveRoot = requestedRoot && nodes.some((n) => n.id === requestedRoot)
            ? requestedRoot
            : undefined;
        // Depth only narrows when a root or an explicit depth was requested;
        // otherwise the whole (node-capped) view is returned.
        const scoped = effectiveRoot !== undefined || options.depth !== undefined;
        const view = boundedView(nodes, selection.edges, selection.rootIds, scoped ? bounds : { ...bounds, depth: Number.POSITIVE_INFINITY });
        return {
            projectId: options.projectId,
            mode,
            revision: contentRevision(view.nodes, view.edges),
            generatedAt: this.clock().toISOString(),
            nodes: view.nodes,
            edges: view.edges,
            truncated: view.truncated,
            appliedLimits: { ...bounds },
            ...(effectiveRoot ? { rootNodeId: effectiveRoot } : {}),
            ...(selection.note ? { metadata: { note: selection.note } } : {}),
        };
    }
    buildBaseGraph(projectId, projectNodeId) {
        const b = new GraphBuilder();
        const project = this.projectRegistry.get(projectId);
        b.addNode({
            id: projectNodeId,
            type: "PROJECT",
            label: truncate(project.displayName || project.projectId, MAX_LABEL_LENGTH),
            status: "active",
            state: toGraphState("active"),
            projectId,
            referenceId: project.projectId,
        });
        b.addNode({
            id: CONTROL_PLANE_ID,
            type: "CONTROL_PLANE",
            label: "Control Plane",
            status: "active",
            state: toGraphState("active"),
            projectId,
            referenceId: CONTROL_PLANE_ID,
        });
        b.addEdge({
            id: `control-plane-has-project-${projectId}`,
            source: CONTROL_PLANE_ID,
            target: projectNodeId,
            type: "CONTAINS",
        });
        const tasks = this.taskSystem
            .list()
            .filter((t) => t.projectId === projectId)
            .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
        const taskIds = new Set(tasks.map((t) => t.id));
        const runningAgents = new Set(tasks
            .filter((t) => t.status === "running" && t.assignedAgentId)
            .map((t) => t.assignedAgentId));
        const tasksPerAgent = new Map();
        for (const t of tasks) {
            if (t.assignedAgentId) {
                tasksPerAgent.set(t.assignedAgentId, (tasksPerAgent.get(t.assignedAgentId) ?? 0) + 1);
            }
        }
        const agents = this.agentRegistry
            .list()
            .filter((a) => a.allowedProjects.includes(projectId) ||
            a.allowedProjects.includes("*"));
        const agentIds = new Set(agents.map((a) => a.id));
        for (const agent of agents) {
            const enabled = this.sources.agentOps?.isEnabled(agent.id) ?? true;
            const status = !enabled
                ? "disabled"
                : runningAgents.has(agent.id)
                    ? "running"
                    : "active";
            b.addNode({
                id: `agent-${agent.id}`,
                type: "AGENT",
                label: truncate(agent.name || agent.id, MAX_LABEL_LENGTH),
                status,
                state: toGraphState(status),
                projectId,
                referenceId: agent.id,
                metadata: safeMetadata({
                    role: agent.description,
                    capabilities: joinList(agent.capabilities),
                    model: agent.modelPolicy?.model,
                    provider: agent.modelPolicy?.provider,
                    assignedTasks: tasksPerAgent.get(agent.id) ?? 0,
                }),
            });
            b.addEdge({
                id: `project-has-agent-${agent.id}`,
                source: projectNodeId,
                target: `agent-${agent.id}`,
                type: "CONTAINS",
            });
        }
        const programNodeIds = new Set();
        for (const program of this.sfOrchestrator?.overview().programs ?? []) {
            if (program.projectId !== projectId)
                continue;
            programNodeIds.add(program.id);
            b.addNode({
                id: `program-${program.id}`,
                type: "PROGRAM",
                label: truncate(program.name || program.id, MAX_LABEL_LENGTH),
                status: program.status,
                state: toGraphState(program.status),
                projectId,
                referenceId: program.id,
                metadata: safeMetadata({
                    tasks: program.taskCount,
                    activeTasks: program.activeTaskCount,
                    updatedAt: program.updatedAt,
                }),
            });
            b.addEdge({
                id: `project-has-program-${program.id}`,
                source: projectNodeId,
                target: `program-${program.id}`,
                type: "CONTAINS",
            });
        }
        const statusById = new Map(tasks.map((t) => [t.id, t.status]));
        const downstream = new Map();
        for (const t of tasks) {
            for (const dep of t.dependencies ?? []) {
                if (statusById.has(dep)) {
                    downstream.set(dep, (downstream.get(dep) ?? 0) + 1);
                }
            }
        }
        for (const task of tasks) {
            const upstreamIds = (task.dependencies ?? []).filter((d) => statusById.has(d));
            b.addNode({
                id: `task-${task.id}`,
                type: "TASK",
                label: truncate(task.description || task.id, MAX_LABEL_LENGTH),
                status: task.status,
                state: toGraphState(task.status),
                projectId,
                referenceId: task.id,
                metadata: safeMetadata({
                    taskType: task.type,
                    priority: task.priority,
                    riskClass: task.riskClass,
                    environmentRequirements: joinList(task.environmentRequirements),
                    upstreamDependencies: upstreamIds.length,
                    downstreamDependents: downstream.get(task.id) ?? 0,
                    createdAt: task.createdAt,
                    updatedAt: task.updatedAt,
                }),
            });
            b.addEdge({
                id: `project-has-task-${task.id}`,
                source: projectNodeId,
                target: `task-${task.id}`,
                type: "HAS_TASK",
            });
            if (task.assignedAgentId && agentIds.has(task.assignedAgentId)) {
                b.addEdge({
                    id: `agent-assigned-${task.id}`,
                    source: `agent-${task.assignedAgentId}`,
                    target: `task-${task.id}`,
                    type: "ASSIGNED_TO",
                });
            }
            if (task.programId && programNodeIds.has(task.programId)) {
                b.addEdge({
                    id: `task-part-of-program-${task.id}`,
                    source: `task-${task.id}`,
                    target: `program-${task.programId}`,
                    type: "PART_OF",
                });
            }
            // Dependencies never leave the project: an id outside this project's
            // task set is dropped rather than leaked as a dangling edge.
            for (const depId of task.dependencies ?? []) {
                if (!taskIds.has(depId))
                    continue;
                b.addEdge({
                    id: `task-dep-${task.id}-${depId}`,
                    source: `task-${task.id}`,
                    target: `task-${depId}`,
                    type: "DEPENDS_ON",
                    // "blocking" while the dependency is unfinished and the dependent
                    // still needs it; otherwise the relationship is satisfied/moot.
                    status: statusById.get(depId) !== "completed" &&
                        task.status !== "completed" &&
                        task.status !== "cancelled"
                        ? "blocking"
                        : "satisfied",
                });
            }
        }
        this.addWorkflows(b, projectId, projectNodeId, agentIds, taskIds);
        b.merge(buildEnvironmentFragment({
            projectId,
            tasks,
            routes: this.routesForProject(projectId),
            ...(this.sources.environments
                ? { registry: this.sources.environments }
                : {}),
        }));
        b.merge(buildKnowledgeFragment({
            projectId,
            projectNodeId,
            ...(this.sources.knowledge ? { provider: this.sources.knowledge } : {}),
            agentIds,
            taskIds,
        }));
        return b;
    }
    /** Redacted routing verdicts for this project's programs only. */
    routesForProject(projectId) {
        const sf = this.sfOrchestrator;
        if (!sf)
            return [];
        const routes = [];
        for (const program of sf.overview().programs) {
            if (program.projectId !== projectId)
                continue;
            routes.push(...(sf.programDetail(program.id, projectId)?.routes ?? []));
        }
        return routes;
    }
    addWorkflows(b, projectId, projectNodeId, agentIds, taskIds) {
        const workflows = (this.sources.workflows?.list() ?? [])
            .filter((w) => w.projectId === projectId)
            .sort(byId);
        for (const wf of workflows) {
            const total = wf.taskRecords.length;
            const done = wf.taskRecords.filter((r) => r.status === "completed").length;
            b.addNode({
                id: `workflow-${wf.id}`,
                type: "WORKFLOW",
                label: truncate(wf.name || wf.id, MAX_LABEL_LENGTH),
                status: wf.status,
                state: toGraphState(wf.status),
                projectId,
                referenceId: wf.id,
                metadata: safeMetadata({
                    tasks: total,
                    completedTasks: done,
                    progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
                    createdAt: wf.createdAt,
                    updatedAt: wf.updatedAt,
                }),
            });
            b.addEdge({
                id: `workflow-belongs-${wf.id}`,
                source: `workflow-${wf.id}`,
                target: projectNodeId,
                type: "BELONGS_TO",
            });
            for (const agentId of wf.participatingAgents) {
                if (!agentIds.has(agentId))
                    continue;
                b.addEdge({
                    id: `agent-in-workflow-${agentId}-${wf.id}`,
                    source: `agent-${agentId}`,
                    target: `workflow-${wf.id}`,
                    type: "PARTICIPATES_IN",
                });
            }
            const records = new Map(wf.taskRecords.map((r) => [r.specId, r]));
            for (const spec of wf.tasks) {
                const record = records.get(spec.id);
                const status = record?.status ?? "pending";
                const stepId = `wfstep-${wf.id}-${spec.id}`;
                b.addNode({
                    id: stepId,
                    type: "WORKFLOW_STEP",
                    label: truncate(spec.description || spec.id, MAX_LABEL_LENGTH),
                    status,
                    state: toGraphState(status),
                    projectId,
                    referenceId: spec.id,
                    metadata: safeMetadata({
                        taskType: spec.type,
                        retries: record?.retryCount,
                        updatedAt: record?.updatedAt,
                    }),
                });
                b.addEdge({
                    id: `wfstep-part-of-${wf.id}-${spec.id}`,
                    source: stepId,
                    target: `workflow-${wf.id}`,
                    type: "PART_OF",
                });
                for (const dep of spec.dependsOn) {
                    b.addEdge({
                        id: `wfstep-dep-${wf.id}-${spec.id}-${dep}`,
                        source: stepId,
                        target: `wfstep-${wf.id}-${dep}`,
                        type: "DEPENDS_ON",
                    });
                }
                const assignee = record?.assignedAgentId ?? spec.agentId;
                if (assignee && agentIds.has(assignee)) {
                    b.addEdge({
                        id: `agent-assigned-wfstep-${wf.id}-${spec.id}`,
                        source: `agent-${assignee}`,
                        target: stepId,
                        type: "ASSIGNED_TO",
                    });
                }
            }
            for (const record of wf.taskRecords) {
                if (!record.taskId || !taskIds.has(record.taskId))
                    continue;
                b.addEdge({
                    id: `task-part-of-workflow-${record.taskId}-${wf.id}`,
                    source: `task-${record.taskId}`,
                    target: `workflow-${wf.id}`,
                    type: "PART_OF",
                });
            }
        }
    }
}
