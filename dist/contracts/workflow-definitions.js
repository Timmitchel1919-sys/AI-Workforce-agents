/**
 * Workflow Studio contracts (UI Layer 4 — visual workflow authoring).
 *
 * A `WorkflowDefinition` is an AUTHORED, versioned graph that compiles to the
 * existing `WorkflowDraft` (contracts/workflow.ts) executed by the existing
 * `WorkflowEngine`. It is not a second orchestration engine: the graph only
 * references capabilities that already exist (registered agents, registered
 * tools, the approval system).
 *
 * Lifecycle: DRAFT → (validated at a draft revision) → PUBLISHED (immutable
 * version) → ARCHIVED. Publishing never mutates an earlier version; restoring
 * copies an old version into a NEW draft revision.
 *
 * Validation here is pure and AUTHORITATIVE on the server. The UI may run a
 * cheaper copy for feedback, but the Control Plane re-validates every save,
 * publish and simulation.
 */
import { findCycle } from "./workflow.js";
/* ------------------------------------------------------------------ */
/* Node kinds                                                         */
/* ------------------------------------------------------------------ */
/** Node kinds that map onto a real backend capability in this platform. */
export const WORKFLOW_NODE_KINDS = [
    "trigger",
    "agent_task",
    "approval",
    "terminal",
];
/**
 * Node kinds the Studio knows about but that have NO authorized backing
 * capability yet. They are listed (disabled) so the owner can see what is
 * missing — never accepted in a saved graph.
 */
export const UNAVAILABLE_WORKFLOW_NODE_KINDS = [
    "model",
    "tool",
    "condition",
    "data",
    "review",
    "notification",
];
/* ------------------------------------------------------------------ */
/* Records                                                            */
/* ------------------------------------------------------------------ */
export const WORKFLOW_DEFINITION_STATUSES = [
    "draft",
    "published",
    "archived",
];
/** Whether the draft currently reads as VALIDATED (valid at its current revision). */
export function isDraftValidated(def) {
    return (def.lastValidation?.valid === true &&
        def.lastValidation.draftRevision === def.draftRevision);
}
export const WORKFLOW_GRAPH_LIMITS = {
    maxNodes: 100,
    maxEdges: 300,
    maxLabel: 120,
    maxDescription: 1000,
    maxListItems: 20,
    maxListItemLength: 200,
};
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CREDENTIAL_KEY_RE = /(pass(word)?|secret|token|api[-_]?key|private[-_]?key|credential)/i;
const CREDENTIAL_VALUE_RES = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/,
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /\bAIza[0-9A-Za-z_-]{30,}/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringList(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        return undefined;
    if (value.length > WORKFLOW_GRAPH_LIMITS.maxListItems)
        return undefined;
    const out = [];
    for (const item of value) {
        if (typeof item !== "string" ||
            item.trim() === "" ||
            item.length > WORKFLOW_GRAPH_LIMITS.maxListItemLength)
            return undefined;
        out.push(item.trim());
    }
    return out;
}
function optText(value, max) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (typeof value !== "string" || value.length > max)
        return false;
    return value.trim() === "" ? undefined : value.trim();
}
/**
 * Parse untrusted input into a canonical graph. Unknown keys are DROPPED (never
 * persisted), so arbitrary payloads cannot ride along inside a definition.
 * Returns issues for anything structurally invalid.
 */
export function normalizeWorkflowGraph(input) {
    const issues = [];
    const shape = (message, ids = {}) => issues.push({ code: "INVALID_SHAPE", severity: "error", message, ...ids });
    if (!isRecord(input) ||
        !Array.isArray(input.nodes) ||
        !Array.isArray(input.edges)) {
        shape("graph must be an object with `nodes` and `edges` arrays");
        return { graph: { nodes: [], edges: [] }, issues };
    }
    if (input.nodes.length > WORKFLOW_GRAPH_LIMITS.maxNodes ||
        input.edges.length > WORKFLOW_GRAPH_LIMITS.maxEdges) {
        issues.push({
            code: "LIMIT_EXCEEDED",
            severity: "error",
            message: `a workflow may have at most ${WORKFLOW_GRAPH_LIMITS.maxNodes} nodes and ${WORKFLOW_GRAPH_LIMITS.maxEdges} connections`,
        });
        return { graph: { nodes: [], edges: [] }, issues };
    }
    const nodes = [];
    const seen = new Set();
    for (const raw of input.nodes) {
        if (!isRecord(raw) || typeof raw.id !== "string" || !ID_RE.test(raw.id)) {
            shape("every node needs an id of 1-64 letters, digits, '_' or '-'");
            continue;
        }
        const id = raw.id;
        if (seen.has(id)) {
            issues.push({
                code: "DUPLICATE_ID",
                severity: "error",
                message: `node id "${id}" is used more than once`,
                nodeId: id,
            });
            continue;
        }
        seen.add(id);
        if (!WORKFLOW_NODE_KINDS.includes(raw.kind)) {
            issues.push({
                code: "UNSUPPORTED_NODE_KIND",
                severity: "error",
                message: `node kind "${String(raw.kind)}" has no authorized backing capability`,
                nodeId: id,
            });
            continue;
        }
        const label = optText(raw.label, WORKFLOW_GRAPH_LIMITS.maxLabel);
        if (!label) {
            shape(`node "${id}" needs a label of 1-${WORKFLOW_GRAPH_LIMITS.maxLabel} characters`, {
                nodeId: id,
            });
            continue;
        }
        const description = optText(raw.description, WORKFLOW_GRAPH_LIMITS.maxDescription);
        if (description === false) {
            shape(`node "${id}" description is too long`, { nodeId: id });
            continue;
        }
        const rawConfig = isRecord(raw.config) ? raw.config : {};
        const config = {};
        for (const key of [
            "taskType",
            "agentId",
            "capability",
            "approvalAction",
        ]) {
            const v = optText(rawConfig[key], WORKFLOW_GRAPH_LIMITS.maxListItemLength);
            if (v === false) {
                shape(`node "${id}" config.${key} must be a short string`, {
                    nodeId: id,
                });
            }
            else if (v !== undefined) {
                config[key] = v;
            }
        }
        for (const key of ["expectedTools", "acceptanceCriteria"]) {
            const list = stringList(rawConfig[key]);
            if (list === undefined) {
                shape(`node "${id}" config.${key} must be a list of up to ${WORKFLOW_GRAPH_LIMITS.maxListItems} short strings`, {
                    nodeId: id,
                });
            }
            else if (list.length > 0) {
                config[key] = list;
            }
        }
        const pos = isRecord(raw.position) ? raw.position : {};
        const coord = (v) => typeof v === "number" && Number.isFinite(v)
            ? Math.max(-100_000, Math.min(100_000, Math.round(v)))
            : 0;
        nodes.push({
            id,
            kind: raw.kind,
            label,
            ...(description ? { description } : {}),
            config,
            position: { x: coord(pos.x), y: coord(pos.y) },
        });
    }
    const edges = [];
    const edgeIds = new Set();
    for (const raw of input.edges) {
        if (!isRecord(raw) ||
            typeof raw.id !== "string" ||
            !ID_RE.test(raw.id) ||
            typeof raw.from !== "string" ||
            typeof raw.to !== "string") {
            shape("every connection needs an id, `from` and `to`");
            continue;
        }
        if (edgeIds.has(raw.id)) {
            issues.push({
                code: "DUPLICATE_ID",
                severity: "error",
                message: `connection id "${raw.id}" is used more than once`,
                edgeId: raw.id,
            });
            continue;
        }
        edgeIds.add(raw.id);
        edges.push({ id: raw.id, from: raw.from, to: raw.to });
    }
    return { graph: { nodes, edges }, issues };
}
function containsCredential(graph) {
    const issues = [];
    for (const node of graph.nodes) {
        const texts = [
            node.label,
            node.description ?? "",
            ...Object.values(node.config).flatMap((v) => Array.isArray(v) ? v : [v]),
        ];
        const keyHit = texts.some((t) => /[:=]/.test(t) && CREDENTIAL_KEY_RE.test(t.split(/[:=]/)[0] ?? ""));
        const valueHit = texts.some((t) => CREDENTIAL_VALUE_RES.some((re) => re.test(t)));
        if (keyHit || valueHit) {
            issues.push({
                code: "CREDENTIAL_IN_GRAPH",
                severity: "error",
                message: "this node appears to contain a credential; credentials are never stored in workflow graphs",
                nodeId: node.id,
            });
        }
    }
    return issues;
}
/** Agents that could take an agent_task node, from real registry data. */
export function candidateAgents(node, ctx) {
    const taskType = node.config.taskType;
    const out = [];
    for (const [agentId, agent] of ctx.agents) {
        if (!agent.enabled)
            continue;
        if (node.config.agentId && node.config.agentId !== agentId)
            continue;
        if (node.config.capability &&
            !agent.capabilities.includes(node.config.capability))
            continue;
        if (taskType && !agent.supportedTaskTypes.includes(taskType))
            continue;
        out.push(agentId);
    }
    return out.sort();
}
/** Full structural + capability validation of an already-normalized graph. */
export function validateWorkflowGraph(graph, ctx) {
    const issues = [];
    const err = (code, message, ids = {}) => issues.push({ code, severity: "error", message, ...ids });
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const triggers = graph.nodes.filter((n) => n.kind === "trigger");
    const terminals = graph.nodes.filter((n) => n.kind === "terminal");
    if (triggers.length === 0)
        err("MISSING_TRIGGER", "a workflow needs exactly one trigger");
    if (triggers.length > 1)
        for (const t of triggers.slice(1))
            err("MULTIPLE_TRIGGERS", "only one trigger is supported", {
                nodeId: t.id,
            });
    if (terminals.length === 0)
        err("MISSING_TERMINAL", "a workflow needs at least one terminal node");
    const incoming = new Map();
    const outgoing = new Map();
    const pairs = new Set();
    for (const edge of graph.edges) {
        if (!byId.has(edge.from) || !byId.has(edge.to)) {
            err("DANGLING_EDGE", "this connection references a node that does not exist", {
                edgeId: edge.id,
            });
            continue;
        }
        if (edge.from === edge.to) {
            err("SELF_LOOP", "a node cannot connect to itself", {
                edgeId: edge.id,
                nodeId: edge.from,
            });
            continue;
        }
        const key = `${edge.from}->${edge.to}`;
        if (pairs.has(key)) {
            err("DUPLICATE_EDGE", "these nodes are already connected", {
                edgeId: edge.id,
            });
            continue;
        }
        pairs.add(key);
        outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
        incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
    }
    for (const node of graph.nodes) {
        if (node.kind === "trigger" && (incoming.get(node.id)?.length ?? 0) > 0)
            err("TRIGGER_HAS_INPUT", "a trigger cannot have incoming connections", {
                nodeId: node.id,
            });
        if (node.kind === "terminal" && (outgoing.get(node.id)?.length ?? 0) > 0)
            err("TERMINAL_HAS_OUTPUT", "a terminal node cannot have outgoing connections", {
                nodeId: node.id,
            });
    }
    const cycle = findCycle(graph.nodes.map((n) => ({ id: n.id, dependsOn: incoming.get(n.id) ?? [] })));
    if (cycle)
        err("CYCLE", `cycles are not supported: ${cycle.join(" → ")}`, {
            nodeId: cycle[0],
        });
    // Reachability from the trigger, and a path to some terminal.
    const start = triggers[0];
    if (start) {
        const reached = new Set([start.id]);
        const queue = [start.id];
        while (queue.length) {
            for (const next of outgoing.get(queue.shift()) ?? [])
                if (!reached.has(next)) {
                    reached.add(next);
                    queue.push(next);
                }
        }
        for (const node of graph.nodes)
            if (!reached.has(node.id))
                err("UNREACHABLE", "this node cannot be reached from the trigger", {
                    nodeId: node.id,
                });
    }
    const reachesEnd = new Set(terminals.map((t) => t.id));
    const back = [...reachesEnd];
    while (back.length) {
        for (const prev of incoming.get(back.shift()) ?? [])
            if (!reachesEnd.has(prev)) {
                reachesEnd.add(prev);
                back.push(prev);
            }
    }
    if (terminals.length > 0)
        for (const node of graph.nodes)
            if (!reachesEnd.has(node.id))
                err("NO_PATH_TO_TERMINAL", "no path leads from this node to a terminal node", {
                    nodeId: node.id,
                });
    for (const node of graph.nodes) {
        if (node.kind === "agent_task") {
            const { taskType, agentId, capability, expectedTools = [] } = node.config;
            if (!taskType)
                err("MISSING_TASK_TYPE", "an agent task needs a task type", {
                    nodeId: node.id,
                });
            if (!agentId && !capability)
                err("MISSING_AGENT_OR_CAPABILITY", "choose a registered agent or a capability", {
                    nodeId: node.id,
                });
            if (agentId && !ctx.agents.has(agentId))
                err("UNKNOWN_AGENT", `agent "${agentId}" is not registered`, {
                    nodeId: node.id,
                });
            else if ((agentId || capability) &&
                taskType &&
                candidateAgents(node, ctx).length === 0)
                err(agentId ? "AGENT_UNQUALIFIED" : "NO_AGENT_FOR_CAPABILITY", agentId
                    ? `agent "${agentId}" is disabled or does not support this task type/capability`
                    : `no enabled registered agent offers "${capability}" for task type "${taskType}"`, { nodeId: node.id });
            for (const tool of expectedTools)
                if (!ctx.tools.has(tool))
                    err("UNKNOWN_TOOL", `tool "${tool}" is not registered`, {
                        nodeId: node.id,
                    });
        }
        if (node.kind === "approval") {
            if (!node.config.approvalAction)
                err("INVALID_APPROVAL", "an approval node must say what is being approved", {
                    nodeId: node.id,
                });
            if ((outgoing.get(node.id)?.length ?? 0) === 0)
                err("INVALID_APPROVAL", "an approval node must lead somewhere", {
                    nodeId: node.id,
                });
        }
    }
    issues.push(...containsCredential(graph));
    return { valid: issues.every((i) => i.severity !== "error"), issues };
}
/** Deterministic topological order (ties broken by node id). Assumes acyclic. */
export function topologicalOrder(graph) {
    const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
    const out = new Map();
    for (const e of graph.edges) {
        if (!indeg.has(e.from) || !indeg.has(e.to) || e.from === e.to)
            continue;
        indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
        out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    }
    const ready = [...indeg]
        .filter(([, d]) => d === 0)
        .map(([id]) => id)
        .sort();
    const order = [];
    while (ready.length) {
        const id = ready.shift();
        order.push(id);
        for (const next of out.get(id) ?? []) {
            const d = (indeg.get(next) ?? 0) - 1;
            indeg.set(next, d);
            if (d === 0) {
                ready.push(next);
                ready.sort();
            }
        }
    }
    return order;
}
/** Canonical JSON (sorted keys) used for the immutable version hash. */
export function canonicalGraphJson(graph) {
    const sort = (value) => Array.isArray(value)
        ? value.map(sort)
        : isRecord(value)
            ? Object.fromEntries(Object.keys(value)
                .sort()
                .map((k) => [k, sort(value[k])]))
            : value;
    return JSON.stringify(sort(graph));
}
