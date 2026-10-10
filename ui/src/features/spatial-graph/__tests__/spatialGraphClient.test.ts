import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("../../../api/client", () => ({ apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { fetchWorkforceGraph, pollWorkforceGraph } from "../api/spatialGraphClient";

describe("fetchWorkforceGraph", () => {
  const valid = { projectId: "p1", mode: "WORKFORCE", revision: 1, generatedAt: "2026-09-26T00:00:00.000Z", nodes: [], edges: [] };
  beforeEach(() => apiRequest.mockReset().mockResolvedValue(valid));

  it("sends a plain GET with no query when no options are given", async () => {
    await fetchWorkforceGraph("p1");
    expect(apiRequest).toHaveBeenCalledWith("/api/projects/p1/graph", { method: "GET", accessToken: undefined });
  });

  it("passes mode/depth/maxNodes/rootNodeId only when provided", async () => {
    apiRequest.mockResolvedValue({ ...valid, mode: "AGENT" });
    await fetchWorkforceGraph("p1", { mode: "AGENT", depth: 2, rootNodeId: "agent-a1" });
    expect(apiRequest).toHaveBeenCalledWith("/api/projects/p1/graph?mode=AGENT&depth=2&rootNodeId=agent-a1", { method: "GET", accessToken: undefined });
  });

  it("uses the /api prefix and sends the caller's access token", async () => {
    apiRequest.mockResolvedValue({ ...valid, projectId: "p 1" });
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

  it("rejects a reply for another project or another mode than the one requested", async () => {
    apiRequest.mockResolvedValue({ ...valid, projectId: "other" });
    await expect(fetchWorkforceGraph("p1", {}, "t")).rejects.toThrow(/unexpected response/i);
    apiRequest.mockResolvedValue({ ...valid, mode: "AGENT" });
    await expect(fetchWorkforceGraph("p1", { mode: "WORKFORCE" }, "t")).rejects.toThrow(/unexpected response/i);
  });

  it("rejects a snapshot without a numeric revision and a generatedAt (it cannot be ordered)", async () => {
    apiRequest.mockResolvedValue({ ...valid, revision: undefined });
    await expect(fetchWorkforceGraph("p1", {}, "t")).rejects.toThrow(/unexpected response/i);
    apiRequest.mockResolvedValue({ ...valid, generatedAt: 5 });
    await expect(fetchWorkforceGraph("p1", {}, "t")).rejects.toThrow(/unexpected response/i);
  });
});

describe("pollWorkforceGraph", () => {
  const unchanged = { projectId: "p1", mode: "EXECUTION", revision: 9, generatedAt: "2026-09-26T00:00:00.000Z", unchanged: true };
  beforeEach(() => apiRequest.mockReset());

  it("sends since=<revision> and accepts a matching 'unchanged' proof", async () => {
    apiRequest.mockResolvedValue(unchanged);
    const r = await pollWorkforceGraph("p1", { mode: "EXECUTION" }, "tok", 9);
    expect(apiRequest).toHaveBeenCalledWith("/api/projects/p1/graph?mode=EXECUTION&since=9", { method: "GET", accessToken: "tok" });
    expect("unchanged" in r && r.unchanged).toBe(true);
  });

  it.each([
    ["another project", { projectId: "other" }],
    ["another mode", { mode: "AGENT" }],
    ["another revision", { revision: 10 }],
    ["no timestamp", { generatedAt: undefined }],
    ["unchanged !== true", { unchanged: "yes" }],
  ])("rejects an 'unchanged' proof for %s (a proof about anything else proves nothing)", async (_n, override) => {
    apiRequest.mockResolvedValue({ ...unchanged, ...override });
    await expect(pollWorkforceGraph("p1", { mode: "EXECUTION" }, "tok", 9)).rejects.toThrow(/unexpected response/i);
  });

  it("returns a full validated projection when the revision moved", async () => {
    apiRequest.mockResolvedValue({ projectId: "p1", mode: "EXECUTION", revision: 10, generatedAt: "t", nodes: [], edges: [] });
    const r = await pollWorkforceGraph("p1", { mode: "EXECUTION" }, "tok", 9);
    expect("nodes" in r && r.revision).toBe(10);
  });
});
