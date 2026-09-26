import { describe, expect, it } from "vitest";
import { computeLayout, dependencyDepths } from "../lib/layout";
import { isGraphMode, MODE_LIST, parseMode, rootNodeFor, stepMode } from "../lib/modes";
import { buildInspectorModel } from "../lib/inspectorModel";
import { availableFilters } from "../lib/graphModel";
import { edge, node } from "./fixtures";

describe("modes", () => {
  it("has the 7 modes and falls back to WORKFORCE for invalid values", () => {
    expect(MODE_LIST).toHaveLength(7);
    expect(parseMode("AGENT")).toBe("AGENT");
    expect(parseMode("agent")).toBe("WORKFORCE");
    expect(parseMode("<script>")).toBe("WORKFORCE");
    expect(parseMode(null)).toBe("WORKFORCE");
    expect(isGraphMode("COST")).toBe(false);
  });

  it("keeps the selection as rootNodeId only when valid for the target mode", () => {
    const agent = node("agent-a", "AGENT", "A");
    const wf = node("wf-1", "WORKFLOW", "W");
    const task = node("task-1", "TASK", "T");
    expect(rootNodeFor("AGENT", agent)).toBe("agent-a");
    expect(rootNodeFor("AGENT", task)).toBeUndefined();
    expect(rootNodeFor("WORKFLOW", wf)).toBe("wf-1");
    expect(rootNodeFor("DEPENDENCY", task)).toBe("task-1");
    expect(rootNodeFor("DEPENDENCY", agent)).toBeUndefined();
    expect(rootNodeFor("WORKFORCE", agent)).toBeUndefined();
    expect(rootNodeFor("AGENT", null)).toBeUndefined();
  });

  it("wraps when stepping through modes", () => {
    expect(stepMode("KNOWLEDGE", 1)).toBe("WORKFORCE");
    expect(stepMode("WORKFORCE", -1)).toBe("KNOWLEDGE");
  });
});

describe("layered and hub layout", () => {
  const steps = [node("s3", "WORKFLOW_STEP", "3"), node("s1", "WORKFLOW_STEP", "1"), node("s2", "WORKFLOW_STEP", "2")];
  const deps = [edge("s2", "s1", "DEPENDS_ON"), edge("s3", "s2", "DEPENDS_ON")];

  it("layers workflow steps by dependency depth, deterministically", () => {
    const a = computeLayout(steps, deps);
    const b = computeLayout([...steps].reverse(), [...deps].reverse());
    for (const s of steps) expect(b.get(s.id)).toEqual(a.get(s.id));
    expect(a.get("s1")![0]).toBeLessThan(a.get("s2")![0]);
    expect(a.get("s2")![0]).toBeLessThan(a.get("s3")![0]);
  });

  it("is cycle-safe", () => {
    const cyc = [edge("s1", "s2", "DEPENDS_ON"), edge("s2", "s3", "DEPENDS_ON"), edge("s3", "s1", "DEPENDS_ON"), edge("s1", "s1", "DEPENDS_ON")];
    const a = dependencyDepths(["s1", "s2", "s3"], cyc);
    const b = dependencyDepths(["s3", "s2", "s1"], cyc);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    const pos = computeLayout(steps, cyc);
    expect(pos.size).toBe(3);
    for (const p of pos.values()) expect(p.every(Number.isFinite)).toBe(true);
  });

  it("layers tasks in DEPENDENCY mode only", () => {
    const tasks = [node("t1", "TASK", "1"), node("t2", "TASK", "2")];
    const es = [edge("t2", "t1", "DEPENDS_ON")];
    const dep = computeLayout(tasks, es, { mode: "DEPENDENCY" });
    expect(dep.get("t1")![0]).toBeLessThan(dep.get("t2")![0]);
    const ring = computeLayout(tasks, es);
    expect(ring.get("t1")).not.toEqual(dep.get("t1"));
  });

  it("puts CONTROL_PLANE at the origin and moves PROJECT off it", () => {
    const pos = computeLayout([node("cp", "CONTROL_PLANE", "CP"), node("project-p1", "PROJECT", "P")]);
    expect(pos.get("cp")).toEqual([0, 0, 0]);
    expect(pos.get("project-p1")).not.toEqual([0, 0, 0]);
  });
});

describe("new node types and edge statuses in the model", () => {
  it("offers filters for new types present", () => {
    const ids = availableFilters([node("cp", "CONTROL_PLANE", "CP"), node("k", "KNOWLEDGE_SOURCE", "K")]).map((f) => f.id);
    expect(ids).toContain("CONTROL_PLANE");
    expect(ids).toContain("KNOWLEDGE_SOURCE");
  });

  it("shows backend metadata fields only when present and carries edge status", () => {
    const t = node("task-1", "TASK", "T", "blocked", { taskType: "code", riskClass: "low", progressPercent: 40 });
    const u = node("task-2", "TASK", "U");
    const e = { ...edge("task-1", "task-2", "DEPENDS_ON"), status: "blocking" };
    const m = buildInspectorModel(t, { nodes: [t, u], edges: [e] });
    expect(m.fields.find((f) => f.id === "taskType")?.value).toEqual({ kind: "text", text: "code" });
    expect(m.fields.find((f) => f.id === "progressPercent")?.value).toEqual({ kind: "text", text: "40%" });
    expect(m.fields.find((f) => f.id === "updatedAt")).toBeUndefined();
    expect(m.relations[0].status).toBe("blocking");
    expect(m.extras).toEqual([]);
  });
});
