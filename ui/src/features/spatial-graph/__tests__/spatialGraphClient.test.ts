import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("../../../api/client", () => ({ apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { fetchWorkforceGraph } from "../api/spatialGraphClient";

describe("fetchWorkforceGraph", () => {
  beforeEach(() => apiRequest.mockReset().mockResolvedValue({}));

  it("sends a plain GET with no query when no options are given", async () => {
    await fetchWorkforceGraph("p1");
    expect(apiRequest).toHaveBeenCalledWith("/projects/p1/graph");
  });

  it("passes mode/depth/maxNodes/rootNodeId only when provided", async () => {
    await fetchWorkforceGraph("p1", { mode: "AGENT", depth: 2, rootNodeId: "agent-a1" });
    expect(apiRequest).toHaveBeenCalledWith("/projects/p1/graph?mode=AGENT&depth=2&rootNodeId=agent-a1");
  });
});
