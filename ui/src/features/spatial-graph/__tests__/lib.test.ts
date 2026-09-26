import { describe, expect, it } from "vitest";
import {
  ALL_FILTER,
  availableFilters,
  filterGraph,
  isolate,
  neighbourIds,
} from "../lib/graphModel";
import { computeLayout } from "../lib/layout";
import { ALL_STATES, normaliseState, readStateColors, stateCssVar, STATE_STYLES } from "../lib/stateStyle";
import { commandForKey, fitPose, orbitPose, panPose, resolveCommand, zoomPose, length, sub } from "../lib/camera";
import { deriveView, INITIAL_VIEW_STATE, viewReducer } from "../lib/viewState";
import { buildInspectorModel } from "../lib/inspectorModel";
import { edge, makeProjection, node } from "./fixtures";

const g = makeProjection();

describe("filters", () => {
  it("offers All, the five fixed groups and other present types", () => {
    const ids = availableFilters(g.nodes).map((f) => f.id);
    expect(ids).toEqual(["ALL", "PROJECT", "AGENT", "TASK", "WORKFLOW", "ENVIRONMENT", "PROGRAM"]);
    expect(availableFilters(g.nodes).find((f) => f.id === "TASK")?.count).toBe(3);
  });

  it("keeps only matching nodes and edges whose endpoints are both visible", () => {
    const tasks = filterGraph(g, "TASK");
    expect(tasks.nodes.map((n) => n.id)).toEqual(["task-t1", "task-t2", "task-t3"]);
    expect(tasks.edges.map((e) => e.type)).toEqual(["DEPENDS_ON"]);
    expect(filterGraph(g, "ENVIRONMENT").edges).toEqual([]);
    expect(filterGraph(g, ALL_FILTER).edges).toHaveLength(g.edges.length);
  });

  it("groups workflow steps under Workflows", () => {
    const wf = { nodes: [node("w", "WORKFLOW", "W"), node("s", "WORKFLOW_STEP", "S"), node("t", "TASK", "T")], edges: [] };
    expect(filterGraph(wf, "WORKFLOW").nodes.map((n) => n.id)).toEqual(["w", "s"]);
  });

  it("drops dangling edges", () => {
    const dangling = { nodes: [node("a", "TASK", "A")], edges: [edge("a", "missing", "DEPENDS_ON")] };
    expect(filterGraph(dangling, ALL_FILTER).edges).toEqual([]);
  });
});

describe("neighbours and isolation", () => {
  it("finds neighbours in both directions, excluding self", () => {
    expect([...neighbourIds(g, "task-t1")].sort()).toEqual(["agent-a1", "project-p1", "task-t2"]);
  });

  it("isolates a node with its direct neighbours only", () => {
    const iso = isolate(g, "task-t1");
    expect(iso.nodes.map((n) => n.id).sort()).toEqual(["agent-a1", "project-p1", "task-t1", "task-t2"]);
    // edges among the kept nodes are retained, others dropped
    expect(iso.edges.every((e) => iso.nodes.some((n) => n.id === e.source) && iso.nodes.some((n) => n.id === e.target))).toBe(true);
    expect(iso.edges.some((e) => e.type === "ASSIGNED_TO")).toBe(true);
  });

  it("expanding a neighbour inside isolation adds its neighbours", () => {
    const iso = isolate(g, "task-t1", ["agent-a1"]);
    expect(iso.nodes.some((n) => n.id === "task-t1")).toBe(true);
    const more = isolate(g, "agent-a1", ["project-p1"]);
    expect(more.nodes.some((n) => n.id === "task-t3")).toBe(true);
  });

  it("returns the graph unchanged for an unknown id", () => {
    expect(isolate(g, "nope")).toBe(g);
  });
});

describe("deterministic layout", () => {
  it("is independent of input order and has no randomness", () => {
    const a = computeLayout(g.nodes);
    const b = computeLayout([...g.nodes].reverse());
    const c = computeLayout(g.nodes);
    for (const n of g.nodes) {
      expect(b.get(n.id)).toEqual(a.get(n.id));
      expect(c.get(n.id)).toEqual(a.get(n.id));
    }
  });

  it("puts a single project at the origin and does not overlap big rings", () => {
    const many = Array.from({ length: 200 }, (_, i) => node(`task-${i}`, "TASK", `T${i}`));
    const pos = computeLayout([node("project-p1", "PROJECT", "P"), ...many]);
    expect(pos.get("project-p1")).toEqual([0, 0, 0]);
    const p0 = pos.get("task-0")!;
    const p1 = pos.get("task-1")!;
    expect(Math.hypot(p0[0] - p1[0], p0[2] - p1[2])).toBeGreaterThan(2.5);
  });

  it("gives unknown types a stable ring", () => {
    const pos1 = computeLayout([node("x1", "COMMIT", "c")]);
    const pos2 = computeLayout([node("x1", "COMMIT", "c")]);
    expect(pos1.get("x1")).toEqual(pos2.get("x1"));
  });
});

describe("state mapping", () => {
  it("covers all eight states with distinct tokens and redundant encodings", () => {
    expect(ALL_STATES).toHaveLength(8);
    const tokens = new Set(ALL_STATES.map((s) => STATE_STYLES[s].token));
    expect(tokens.size).toBe(8);
    const glyphs = new Set(ALL_STATES.map((s) => STATE_STYLES[s].glyph));
    expect(glyphs.size).toBe(8);
    for (const s of ALL_STATES) expect(stateCssVar(s)).toMatch(/^var\(--/);
  });

  it("treats unknown states as unavailable and resolves colours", () => {
    expect(normaliseState("weird")).toBe("unavailable");
    expect(normaliseState(undefined)).toBe("unavailable");
    const colors = readStateColors();
    for (const s of ALL_STATES) expect(colors[s]).toMatch(/^#|rgb/);
  });

  it("reads token values from CSS custom properties at runtime", () => {
    document.documentElement.style.setProperty("--color-danger", "#123456");
    expect(readStateColors().failed).toBe("#123456");
    document.documentElement.style.removeProperty("--color-danger");
  });
});

describe("camera math", () => {
  it("fits all points and keeps distance within limits", () => {
    const pose = fitPose([[0, 0, 0], [50, 0, 0], [0, 0, 50]]);
    expect(pose.target[0]).toBeCloseTo(25);
    expect(length(sub(pose.position, pose.target))).toBeGreaterThan(30);
  });

  it("zoom changes distance; orbit preserves it; pan moves target and camera together", () => {
    const pose = { target: [0, 0, 0] as [number, number, number], position: [0, 30, 40] as [number, number, number] };
    const d = length(pose.position);
    expect(length(zoomPose(pose, 0.8).position)).toBeCloseTo(d * 0.8);
    expect(length(orbitPose(pose, 0.5, 0.2).position)).toBeCloseTo(d);
    const panned = panPose(pose, 5, 0);
    expect(panned.target).not.toEqual(pose.target);
    expect(sub(panned.position, panned.target)).toEqual(sub(pose.position, pose.target));
  });

  it("maps keys to commands and focuses a node", () => {
    expect(commandForKey("ArrowLeft", false)).toBe("orbitLeft");
    expect(commandForKey("ArrowLeft", true)).toBe("panLeft");
    expect(commandForKey("+", false)).toBe("zoomIn");
    expect(commandForKey("x", false)).toBeNull();
    const pose = { target: [0, 0, 0] as [number, number, number], position: [0, 30, 40] as [number, number, number] };
    const next = resolveCommand({ seq: 1, kind: "focus", nodeId: "n" }, pose, pose, () => [10, 0, 0]);
    expect(next.target).toEqual([10, 0, 0]);
  });
});

describe("view state", () => {
  it("selects, deselects, isolates, expands and resets", () => {
    let s = viewReducer(INITIAL_VIEW_STATE, { type: "select", id: "task-t1" });
    expect(s.selectedId).toBe("task-t1");
    s = viewReducer(s, { type: "isolate", id: "task-t1" });
    s = viewReducer(s, { type: "toggleExpand", id: "task-t1" });
    expect(s.expandedIds).toEqual(["task-t1"]);
    s = viewReducer(s, { type: "toggleExpand", id: "task-t1" });
    expect(s.expandedIds).toEqual([]);
    s = viewReducer(s, { type: "deselect" });
    expect(s.selectedId).toBeNull();
    expect(viewReducer(s, { type: "reset" })).toEqual(INITIAL_VIEW_STATE);
  });

  it("derives the visible graph from filter and isolation, ignoring hidden selections", () => {
    const state = { ...INITIAL_VIEW_STATE, filter: "TASK", selectedId: "agent-a1" };
    expect(deriveView(g, state).selectedId).toBeNull(); // hidden by filter
    const iso = deriveView(g, { ...INITIAL_VIEW_STATE, isolatedId: "task-t1", selectedId: "task-t1" });
    expect(iso.visible.nodes).toHaveLength(4);
    const exp = deriveView(g, { ...INITIAL_VIEW_STATE, selectedId: "task-t1", expandedIds: ["task-t1"] });
    expect(exp.emphasisIds?.has("agent-a1")).toBe(true);
    expect(exp.emphasisIds?.has("task-t3")).toBe(false);
  });
});

describe("inspector model", () => {
  it("derives task assignee and dependencies from edges", () => {
    const t1 = buildInspectorModel(g.nodes.find((n) => n.id === "task-t1")!, g);
    const assigned = t1.fields.find((f) => f.id === "assignedAgent")!.value;
    expect(assigned.kind === "nodes" && assigned.nodes.map((n) => n.label)).toEqual(["Builder"]);
    const dependents = t1.fields.find((f) => f.id === "dependents")!.value;
    expect(dependents.kind === "nodes" && dependents.nodes.map((n) => n.label)).toEqual(["Write UI"]);
  });

  it("marks missing data as unavailable instead of inventing it", () => {
    const t3 = buildInspectorModel(g.nodes.find((n) => n.id === "task-t3")!, g);
    const agent = t3.fields.find((f) => f.id === "assignedAgent")!.value;
    expect(agent).toEqual({ kind: "nodes", nodes: [], empty: "unavailable" });
    expect(t3.fields.find((f) => f.id === "priority")).toBeUndefined();
    const a2 = buildInspectorModel(g.nodes.find((n) => n.id === "agent-a2")!, g);
    expect(a2.fields.find((f) => f.id === "role")!.value).toEqual({ kind: "text", text: null });
  });

  it("filters sensitive metadata keys and caps extras", () => {
    const n = node("x", "COMMIT", "c", "active", { sha: "abc", apiToken: "s3cr3t", workPath: "/tmp", description: "d" });
    const m = buildInspectorModel(n, { nodes: [n], edges: [] });
    expect(m.extras.map((e) => e.key)).toEqual(["sha"]);
  });
});
