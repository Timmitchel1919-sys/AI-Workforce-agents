import type {
  GraphOperationalState,
  WorkforceGraphEdge,
  WorkforceGraphEdgeType,
  WorkforceGraphNode,
  WorkforceGraphNodeType,
} from "../../../../../contracts/graph";
import type { GraphData } from "./graphModel";

/** Keys under `spatial.inspector.*` in the locale catalogues. */
export type InspectorFieldId =
  | "type"
  | "state"
  | "status"
  | "project"
  | "reference"
  | "description"
  | "role"
  | "assignedAgent"
  | "assignedTasks"
  | "dependencies"
  | "dependents"
  | "tasks"
  | "agents"
  | "programs"
  | "workflows"
  | "environments"
  | "priority"
  | "environmentClass"
  | "kind"
  | "capabilities"
  | "model"
  | "provider"
  | "version"
  | "taskType"
  | "riskClass"
  | "environmentRequirements"
  | "upstreamDependencies"
  | "downstreamDependents"
  | "progressPercent"
  | "createdAt"
  | "updatedAt"
  | "code"
  | "environmentType"
  | "availability";

export interface NodeRef {
  id: string;
  label: string;
  type: WorkforceGraphNodeType;
  state: GraphOperationalState;
}

export type FieldValue =
  | { kind: "type"; type: WorkforceGraphNodeType }
  | { kind: "state"; state: GraphOperationalState }
  /** null text renders as the localized "Unavailable". */
  | { kind: "text"; text: string | null }
  /** Related nodes. An empty list renders as `empty`. */
  | { kind: "nodes"; nodes: NodeRef[]; empty: "unavailable" | "none" };

export interface InspectorField {
  id: InspectorFieldId;
  value: FieldValue;
}

export interface InspectorRelation {
  edgeId: string;
  edgeType: WorkforceGraphEdgeType;
  direction: "incoming" | "outgoing";
  /** Edge status (e.g. blocking / satisfied for DEPENDS_ON), when the backend provides one. */
  status?: string;
  other: NodeRef;
}

export interface InspectorExtra {
  key: string;
  label: string;
  value: string;
}

export interface InspectorModel {
  node: WorkforceGraphNode;
  fields: InspectorField[];
  relations: InspectorRelation[];
  extras: InspectorExtra[];
}

const SENSITIVE_KEY = /secret|token|password|credential|api_?key|path|host|url|email/i;
const MAX_EXTRAS = 8;
const MAX_VALUE_LENGTH = 120;

/** Metadata keys consumed by dedicated fields (excluded from the "other details" list). */
const CONSUMED_KEYS = new Set([
  "description",
  "role",
  "priority",
  "environmentClass",
  "kind",
  "capabilities",
  "model",
  "provider",
  "version",
  "taskType",
  "riskClass",
  "environmentRequirements",
  "upstreamDependencies",
  "downstreamDependents",
  "progressPercent",
  "createdAt",
  "updatedAt",
  "code",
  "environmentType",
  "availability",
  "assignedTasks",
]);

export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function metaString(node: WorkforceGraphNode, key: string): string | null {
  const v = node.metadata?.[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s.length > MAX_VALUE_LENGTH ? `${s.slice(0, MAX_VALUE_LENGTH)}…` : s;
}

function toRef(node: WorkforceGraphNode): NodeRef {
  return { id: node.id, label: node.label, type: node.type, state: node.state };
}

const byLabel = (a: NodeRef, b: NodeRef) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

export function buildInspectorModel(node: WorkforceGraphNode, graph: GraphData): InspectorModel {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incident = graph.edges.filter((e) => e.source === node.id || e.target === node.id);

  const relations: InspectorRelation[] = [];
  for (const e of incident) {
    const outgoing = e.source === node.id;
    const other = byId.get(outgoing ? e.target : e.source);
    if (!other) continue;
    relations.push({
      edgeId: e.id,
      edgeType: e.type,
      direction: outgoing ? "outgoing" : "incoming",
      status: e.status || undefined,
      other: toRef(other),
    });
  }
  relations.sort(
    (a, b) =>
      a.edgeType.localeCompare(b.edgeType) ||
      a.direction.localeCompare(b.direction) ||
      byLabel(a.other, b.other),
  );

  const related = (
    dir: "incoming" | "outgoing" | "any",
    edgeTypes: readonly WorkforceGraphEdgeType[] | null,
    nodeTypes: readonly WorkforceGraphNodeType[] | null,
  ): NodeRef[] => {
    const seen = new Set<string>();
    const out: NodeRef[] = [];
    for (const r of relations) {
      if (dir !== "any" && r.direction !== dir) continue;
      if (edgeTypes && !edgeTypes.includes(r.edgeType)) continue;
      if (nodeTypes && !nodeTypes.includes(r.other.type)) continue;
      if (seen.has(r.other.id)) continue;
      seen.add(r.other.id);
      out.push(r.other);
    }
    return out.sort(byLabel);
  };
  const ofType = (...types: WorkforceGraphNodeType[]) => related("any", null, types);

  const fields: InspectorField[] = [
    { id: "type", value: { kind: "type", type: node.type } },
    { id: "state", value: { kind: "state", state: node.state } },
    { id: "status", value: { kind: "text", text: node.status?.trim() ? node.status : null } },
  ];
  const text = (id: InspectorFieldId, key: string, always: boolean) => {
    const v = metaString(node, key);
    if (v !== null || always) fields.push({ id, value: { kind: "text", text: v } });
  };
  const nodes = (
    id: InspectorFieldId,
    list: NodeRef[],
    empty: "unavailable" | "none",
    always: boolean,
  ) => {
    if (list.length > 0 || always) fields.push({ id, value: { kind: "nodes", nodes: list, empty } });
  };

  switch (node.type) {
    case "PROJECT":
      text("description", "description", false);
      nodes("agents", ofType("AGENT"), "none", false);
      nodes("tasks", ofType("TASK"), "none", false);
      nodes("programs", ofType("PROGRAM"), "none", false);
      nodes("workflows", ofType("WORKFLOW"), "none", false);
      nodes("environments", ofType("ENVIRONMENT"), "none", false);
      break;
    case "AGENT":
      text("role", "role", true);
      nodes("assignedTasks", related("outgoing", ["ASSIGNED_TO"], ["TASK"]), "none", true);
      break;
    case "TASK":
      nodes("assignedAgent", related("incoming", ["ASSIGNED_TO"], ["AGENT"]), "unavailable", true);
      nodes("dependencies", related("outgoing", ["DEPENDS_ON"], null), "none", true);
      nodes("dependents", related("incoming", ["DEPENDS_ON"], null), "none", true);
      text("priority", "priority", false);
      break;
    case "PROGRAM":
    case "WORKSTREAM":
    case "WORKFLOW":
    case "WORKFLOW_STEP":
      text("description", "description", false);
      nodes("tasks", ofType("TASK"), "none", false);
      nodes("agents", ofType("AGENT"), "none", false);
      nodes("environments", ofType("ENVIRONMENT", "ENVIRONMENT_ROUTER"), "none", false);
      break;
    case "ENVIRONMENT":
    case "ENVIRONMENT_ROUTER":
      text("environmentClass", "environmentClass", true);
      nodes("agents", ofType("AGENT"), "none", false);
      nodes("tasks", ofType("TASK"), "none", false);
      break;
    default:
      text("kind", "kind", false);
      text("description", "description", false);
      break;
  }

  // Whitelisted backend metadata, shown only when present (never fabricated).
  const metaSpecs: Partial<Record<WorkforceGraphNodeType, readonly InspectorFieldId[]>> = {
    AGENT: ["capabilities", "model", "provider", "version"],
    TASK: ["taskType", "riskClass", "environmentRequirements", "upstreamDependencies", "downstreamDependents", "createdAt", "updatedAt"],
    ENVIRONMENT: ["environmentType", "availability", "version"],
    ENVIRONMENT_ROUTER: ["environmentType", "availability"],
    KNOWLEDGE_SOURCE: ["kind", "code", "version"],
    CONTROL_PLANE: ["kind", "version"],
    WORKFLOW_STEP: ["kind", "code"],
    WORKFLOW: ["version"],
  };
  for (const id of metaSpecs[node.type] ?? []) {
    if (!fields.some((f) => f.id === id)) text(id, id, false);
  }
  const progress = metaString(node, "progressPercent");
  if (progress !== null) {
    fields.push({ id: "progressPercent", value: { kind: "text", text: /^\d+(\.\d+)?$/.test(progress) ? `${progress}%` : progress } });
  }

  fields.push({ id: "project", value: { kind: "text", text: node.projectId || null } });
  fields.push({ id: "reference", value: { kind: "text", text: node.referenceId || null } });

  const extras: InspectorExtra[] = [];
  for (const key of Object.keys(node.metadata ?? {}).sort()) {
    if (CONSUMED_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    const v = metaString(node, key);
    if (v === null) continue;
    extras.push({ key, label: humanizeKey(key), value: v });
    if (extras.length >= MAX_EXTRAS) break;
  }

  return { node, fields, relations, extras };
}

export function edgeCounts(edges: readonly WorkforceGraphEdge[]): Map<WorkforceGraphEdgeType, number> {
  const m = new Map<WorkforceGraphEdgeType, number>();
  for (const e of edges) m.set(e.type, (m.get(e.type) ?? 0) + 1);
  return m;
}
