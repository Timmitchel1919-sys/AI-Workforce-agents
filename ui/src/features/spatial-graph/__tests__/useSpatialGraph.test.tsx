import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
// A plain function (not a vi.fn) for the failing case: vitest's call tracking would otherwise
// attach its own un-handled derived promise to a rejected result.
let failWith: Error | null = null;
let token: string | null = "tok";
vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ accessToken: token }) }));
vi.mock("../api/spatialGraphClient", () => ({
  fetchWorkforceGraph: (...a: unknown[]) => (failWith ? Promise.reject(failWith) : fetchMock(...a)),
}));

import { useSpatialGraph } from "../hooks/useSpatialGraph";
import { makeProjection } from "./fixtures";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useSpatialGraph", () => {
  beforeEach(() => {
    failWith = null;
    token = "tok";
    fetchMock.mockReset();
  });

  it("ignores an out-of-order (stale) response", async () => {
    const first = deferred<ReturnType<typeof makeProjection>>();
    const second = deferred<ReturnType<typeof makeProjection>>();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ id }) => useSpatialGraph(id), { initialProps: { id: "p1" } });
    rerender({ id: "p2" });

    second.resolve(makeProjection({ projectId: "p2", revision: 2 }));
    await waitFor(() => expect(result.current.graph?.projectId).toBe("p2"));
    first.resolve(makeProjection({ projectId: "p1", revision: 1 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.graph?.projectId).toBe("p2");
    expect(result.current.loading).toBe(false);
  });

  it("passes only provided options through to the client", async () => {
    fetchMock.mockResolvedValue(makeProjection());
    renderHook(() => useSpatialGraph("p1", { mode: "AGENT", depth: 2 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("p1", { mode: "AGENT", depth: 2, maxNodes: undefined, rootNodeId: undefined }, "tok");
  });

  it("surfaces errors", async () => {
    failWith = new Error("boom");
    const { result } = renderHook(() => useSpatialGraph("p1"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.graph).toBeNull();
    failWith = null;
  });

  it("sends the signed-in access token with the request", async () => {
    fetchMock.mockResolvedValue(makeProjection());
    renderHook(() => useSpatialGraph("p1", { mode: "WORKFORCE" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][2]).toBe("tok");
  });

  it("does not request the graph until the operator is signed in", async () => {
    token = null;
    const { result } = renderHook(() => useSpatialGraph("p1", { mode: "WORKFORCE" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });
});
