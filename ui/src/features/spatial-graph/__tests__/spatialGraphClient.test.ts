import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("../../../api/client", () => ({ apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { fetchWorkforceGraph } from "../api/spatialGraphClient";

describe("fetchWorkforceGraph", () => {
  const valid = { projectId: "p1", mode: "WORKFORCE", nodes: [], edges: [] };
  beforeEach(() => apiRequest.mockReset().mockResolvedValue(valid));

  it("sends a plain GET with no query when no options are given", async () => {
    await fetchWorkforceGraph("p1");
    expect(apiRequest).toHaveBeenCalledWith("/api/projects/p1/graph", { method: "GET", accessToken: undefined });
  });

  it("passes mode/depth/maxNodes/rootNodeId only when provided", async () => {
    await fetchWorkforceGraph("p1", { mode: "AGENT", depth: 2, rootNodeId: "agent-a1" });
    expect(apiRequest).toHaveBeenCalledWith("/api/projects/p1/graph?mode=AGENT&depth=2&rootNodeId=agent-a1", { method: "GET", accessToken: undefined });
  });

  it("uses the /api prefix and sends the caller's access token", async () => {
    await fetchWorkforceGraph("p 1", {}, "tok-123");
    expect(apiRequest).toHaveBeenCalledWith("/api/projects/p%201/graph", { method: "GET", accessToken: "tok-123" });
  });

  it("rejects a misrouted response (the SPA index.html returned with a 200) instead of crashing the UI", async () => {
    apiRequest.mockResolvedValue("<!doctype html><html></html>");
    await expect(fetchWorkforceGraph("p1", {}, "t")).rejects.toThrow(/unexpected response/i);
  });

  it.each([null, {}, { projectId: "p1" }, { projectId: "p1", nodes: {}, edges: [] }, { projectId: "p1", nodes: [{}], edges: [] }])(
    "rejects a malformed projection %#",
    async (bad) => {
      apiRequest.mockResolvedValue(bad);
      await expect(fetchWorkforceGraph("p1", {}, "t")).rejects.toThrow(/unexpected response/i);
    },
  );
});
