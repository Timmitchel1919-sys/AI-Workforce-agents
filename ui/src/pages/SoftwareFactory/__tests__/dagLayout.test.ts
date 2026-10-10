import { describe, expect, it } from "vitest";
import { DAG_GAP_X, DAG_NODE_HEIGHT, DAG_NODE_WIDTH, DAG_PADDING, layoutGraph } from "../dagLayout";
import type { GraphEdge } from "../../../features/softwareFactory/api/softwareFactoryTypes";

describe("layoutGraph", () => {
  it("lays a linear chain out left to right on one row", () => {
    const nodes = [{ id: "t-1" }, { id: "t-2" }, { id: "t-3" }];
    const edges: GraphEdge[] = [
      { from: "t-1", to: "t-2", type: "blocking" },
      { from: "t-2", to: "t-3", type: "blocking" },
    ];

    const layout = layoutGraph(nodes, edges);

    const t1 = layout.nodes.find((n) => n.id === "t-1")!;
    const t2 = layout.nodes.find((n) => n.id === "t-2")!;
    const t3 = layout.nodes.find((n) => n.id === "t-3")!;
    expect(t1.x).toBe(DAG_PADDING);
    expect(t2.x).toBe(DAG_PADDING + DAG_NODE_WIDTH + DAG_GAP_X);
    expect(t3.x).toBe(DAG_PADDING + 2 * (DAG_NODE_WIDTH + DAG_GAP_X));
    expect(t1.x).toBeLessThan(t2.x);
    expect(t2.x).toBeLessThan(t3.x);
    expect(t1.y).toBe(DAG_PADDING);
    expect(t2.y).toBe(DAG_PADDING);
    expect(t3.y).toBe(DAG_PADDING);
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges[0]!.from).toBe("t-1");
    expect(layout.edges[0]!.to).toBe("t-2");
    expect(layout.edges[0]!.fromX).toBe(t1.x + DAG_NODE_WIDTH);
    expect(layout.height).toBe(DAG_PADDING * 2 + DAG_NODE_HEIGHT);
  });

  it("puts independent sources in the same layer and sinks one column later", () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const edges: GraphEdge[] = [
      { from: "a", to: "c", type: "blocking" },
      { from: "b", to: "c", type: "blocking" },
    ];

    const layout = layoutGraph(nodes, edges);

    const a = layout.nodes.find((n) => n.id === "a")!;
    const b = layout.nodes.find((n) => n.id === "b")!;
    const c = layout.nodes.find((n) => n.id === "c")!;
    expect(a.x).toBe(b.x);
    expect(a.y).not.toBe(b.y);
    expect(c.x).toBeGreaterThan(a.x);
  });

  it("returns an empty layout for an empty graph", () => {
    expect(layoutGraph([], [])).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });

  it("drops edges that reference unknown nodes", () => {
    const layout = layoutGraph([{ id: "a" }, { id: "b" }], [{ from: "a", to: "ghost", type: "blocking" }]);
    expect(layout.edges).toHaveLength(0);
    expect(new Set(layout.nodes.map((n) => n.id))).toEqual(new Set(["a", "b"]));
  });

  it("still places every node when the graph contains a cycle", () => {
    const layout = layoutGraph(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { from: "a", to: "b", type: "blocking" },
        { from: "b", to: "c", type: "blocking" },
        { from: "c", to: "a", type: "blocking" },
      ],
    );
    expect(layout.nodes.length).toBe(3);
    expect(new Set(layout.nodes.map((n) => n.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("sizes the canvas to the widest and tallest layer", () => {
    const layout = layoutGraph(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [
        { from: "a", to: "c", type: "blocking" },
        { from: "a", to: "d", type: "blocking" },
        { from: "b", to: "d", type: "blocking" },
      ],
    );
    expect(layout.width).toBeGreaterThan(DAG_NODE_WIDTH);
    expect(layout.height).toBeGreaterThanOrEqual(DAG_PADDING * 2 + DAG_NODE_HEIGHT);
  });
});