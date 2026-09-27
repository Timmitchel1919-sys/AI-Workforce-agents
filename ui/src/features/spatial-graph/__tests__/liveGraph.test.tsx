import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Scripted transport: each call takes the next step. Rejections are produced lazily by plain
// functions (not vi.fn) so vitest never attaches its own unhandled derived promise to them.
type Step = () => Promise<unknown>;
const calls = { fetch: [] as unknown[][], poll: [] as unknown[][] };
let fetchSteps: Step[] = [];
let pollSteps: Step[] = [];
const never: Step = () => new Promise(() => {});
let token: string | null = "tok";
vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ accessToken: token }) }));
vi.mock("../api/spatialGraphClient", () => ({
  fetchWorkforceGraph: (...a: unknown[]) => {
    calls.fetch.push(a);
    return (fetchSteps.shift() ?? never)();
  },
  pollWorkforceGraph: (...a: unknown[]) => {
    calls.poll.push(a);
    return (pollSteps.shift() ?? never)();
  },
}));

import { useSpatialGraph } from "../hooks/useSpatialGraph";
import { appendBounded, diffGraphs } from "../lib/graphDiff";
import { deriveLiveStatus, LIVE_LIMITS, nextDelayMs } from "../lib/liveStatus";
import { makeProjection, node } from "./fixtures";

const ok = (v: unknown): Step => () => Promise.resolve(v);
const fail = (msg = "boom"): Step => () => Promise.reject(new Error(msg));
const unchanged = (revision: number, generatedAt = "2026-09-26T00:00:10.000Z") => ({
  projectId: "p1",
  mode: "WORKFORCE",
  revision,
  generatedAt,
  unchanged: true as const,
});
const INTERVAL = 1000;
const tick = (ms = INTERVAL) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};
const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

function mount(projectId = "p1", extra: Record<string, unknown> = {}) {
  return renderHook(({ id }) => useSpatialGraph(id, { pollIntervalMs: INTERVAL, ...extra }), {
    initialProps: { id: projectId },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  calls.fetch = [];
  calls.poll = [];
  fetchSteps = [];
  pollSteps = [];
  token = "tok";
  setVisibility("visible");
  setOnline(true);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("live status derivation (pure)", () => {
  const base = { enabled: true, online: true, hidden: false, busy: false, consecutiveFailures: 0, hasConfirmed: true };
  it("is live only when polling is enabled and a snapshot has been confirmed", () => {
    expect(deriveLiveStatus(base)).toBe("live");
    expect(deriveLiveStatus({ ...base, hasConfirmed: false })).toBe("refreshing");
    expect(deriveLiveStatus({ ...base, busy: true })).toBe("refreshing");
    expect(deriveLiveStatus({ ...base, enabled: false })).toBe("offline");
  });
  it("degrades honestly with failures, offline and hidden", () => {
    expect(deriveLiveStatus({ ...base, consecutiveFailures: 1 })).toBe("reconnecting");
    expect(deriveLiveStatus({ ...base, consecutiveFailures: LIVE_LIMITS.degradedAfterFailures })).toBe("degraded");
    expect(deriveLiveStatus({ ...base, online: false })).toBe("offline");
    expect(deriveLiveStatus({ ...base, hidden: true })).toBe("paused");
  });
  it("backs off exponentially but is capped", () => {
    expect(nextDelayMs(0, 1000)).toBe(1000);
    expect(nextDelayMs(2, 1000)).toBe(4000);
    expect(nextDelayMs(50, 1000)).toBe(LIVE_LIMITS.maxBackoffMs);
  });
});

describe("graph diff (pure)", () => {
  it("reports added, removed and state changes deterministically, and nothing for identical graphs", () => {
    const a = makeProjection();
    expect(diffGraphs(a, makeProjection())).toEqual([]);
    const b = makeProjection({
      generatedAt: "2026-09-26T00:01:00.000Z",
      nodes: [
        ...a.nodes.filter((n) => n.id !== "task-t3").map((n) => (n.id === "task-t1" ? { ...n, state: "completed" as const, status: "completed" } : n)),
        node("session-s1", "EXECUTION_SESSION", "Session build", "running"),
      ],
    });
    const d = diffGraphs(a, b);
    expect(d.map((x) => `${x.kind}:${x.nodeId}`)).toEqual(["added:session-s1", "state:task-t1", "removed:task-t3"]);
    expect(d.every((x) => x.at === "2026-09-26T00:01:00.000Z")).toBe(true);
  });
  it("keeps history bounded", () => {
    const many = Array.from({ length: 500 }, (_, i) => i);
    const out = appendBounded([], many);
    expect(out).toHaveLength(LIVE_LIMITS.maxTransitions);
    expect(out[out.length - 1]).toBe(499);
  });
});

describe("useSpatialGraph live behaviour", () => {
  it("starts from an authoritative snapshot, then confirms it with conditional polls", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    pollSteps = [ok(unchanged(7))];
    const { result } = mount();
    expect(result.current.live).toBe("refreshing"); // nothing confirmed yet: never "live"
    await tick(0);
    expect(result.current.graph?.revision).toBe(7);
    expect(result.current.live).toBe("live");
    const first = result.current.graph;
    await tick();
    expect(calls.poll[0].slice(0, 1)).toEqual(["p1"]);
    expect(calls.poll[0][3]).toBe(7); // asks "has 7 changed?"
    expect(result.current.graph).toBe(first); // unchanged => same object, no re-render churn
    expect(result.current.lastConfirmedAt).toBe("2026-09-26T00:00:10.000Z");
    expect(result.current.transitions).toEqual([]);
  });

  it("applies a live change and records the real transition", async () => {
    const changed = makeProjection({
      revision: 8,
      generatedAt: "2026-09-26T00:00:20.000Z",
      nodes: makeProjection().nodes.map((n) => (n.id === "task-t1" ? { ...n, state: "completed" as const, status: "completed" } : n)),
    });
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    pollSteps = [ok(changed)];
    const { result } = mount();
    await tick(0);
    await tick();
    expect(result.current.graph?.revision).toBe(8);
    expect(result.current.transitions.map((t) => `${t.kind}:${t.nodeId}:${t.toState}`)).toEqual(["state:task-t1:completed"]);
  });

  it("is idempotent: a duplicate snapshot with identical content adds no transitions", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    pollSteps = [ok(makeProjection({ revision: 7, generatedAt: "2026-09-26T00:00:30.000Z" }))];
    const { result } = mount();
    await tick(0);
    await tick();
    expect(result.current.transitions).toEqual([]);
  });

  it("never lets an older snapshot overwrite a newer one (STALE != CURRENT)", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7, generatedAt: "2026-09-26T00:05:00.000Z" }))];
    const older = makeProjection({
      revision: 3,
      generatedAt: "2026-09-26T00:01:00.000Z",
      nodes: [node("project-p1", "PROJECT", "Apollo")],
    });
    pollSteps = [ok(older)];
    const { result } = mount();
    await tick(0);
    await tick();
    expect(result.current.graph?.revision).toBe(7);
    expect(result.current.graph?.nodes.length).toBeGreaterThan(1);
    expect(result.current.transitions).toEqual([]);
  });

  it("degrades while keeping last-known state, then recovers", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    pollSteps = [fail(), fail(), fail(), ok(unchanged(7))];
    const { result } = mount();
    await tick(0);
    await tick(); // failure 1
    expect(result.current.live).toBe("reconnecting");
    expect(result.current.graph?.revision).toBe(7); // last-known graph stays visible
    expect(result.current.error).toBeNull();
    await tick(2000); // failure 2 (backoff)
    await tick(4000); // failure 3
    expect(result.current.live).toBe("degraded");
    await tick(8000); // recovery
    expect(result.current.live).toBe("live");
  });

  it("surfaces an initial failure as an error (no graph) and keeps retrying", async () => {
    fetchSteps = [fail("nope"), ok(makeProjection({ revision: 2 }))];
    const { result } = mount();
    await tick(0);
    expect(result.current.error?.message).toBe("nope");
    expect(result.current.graph).toBeNull();
    await tick(2000);
    expect(result.current.graph?.revision).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it("serializes requests: a slow poll is never overlapped", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    pollSteps = [never];
    mount();
    await tick(0);
    await tick(10_000);
    expect(calls.poll).toHaveLength(1);
  });

  it("project switch stops the old loop and never shows the old project's graph", async () => {
    fetchSteps = [ok(makeProjection({ projectId: "p1", revision: 1 })), never];
    const { result, rerender } = mount("p1");
    await tick(0);
    expect(result.current.graph?.projectId).toBe("p1");
    rerender({ id: "p2" });
    expect(result.current.graph).toBeNull();
    expect(result.current.loading).toBe(true);
    const pollsBefore = calls.poll.length;
    await tick(10_000);
    expect(calls.poll.filter((c) => c[0] === "p1").length).toBe(pollsBefore); // p1 loop is dead
  });

  it("cleans up on unmount: no requests after", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    pollSteps = [ok(unchanged(7)), ok(unchanged(7))];
    const { unmount } = mount();
    await tick(0);
    unmount();
    await tick(20_000);
    expect(calls.poll).toHaveLength(0);
  });

  it("pauses while the tab is hidden and re-asks immediately on return", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    pollSteps = [ok(unchanged(7))];
    const { result } = mount();
    await tick(0);
    act(() => setVisibility("hidden"));
    await tick(20_000);
    expect(calls.poll).toHaveLength(0);
    expect(result.current.live).toBe("paused");
    act(() => setVisibility("visible"));
    await tick(0);
    expect(calls.poll).toHaveLength(1);
  });

  it("reports offline from the browser and never claims live", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    const { result } = mount();
    await tick(0);
    act(() => setOnline(false));
    expect(result.current.live).toBe("offline");
  });

  it("a manual-only view (live=false) is never labelled live and never polls", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    const { result } = mount("p1", { live: false });
    await tick(0);
    await tick(20_000);
    expect(result.current.graph?.revision).toBe(7);
    expect(result.current.live).toBe("paused");
    expect(calls.poll).toHaveLength(0);
  });

  it("does nothing until signed in", async () => {
    token = null;
    const { result } = mount();
    await tick(10_000);
    expect(calls.fetch).toHaveLength(0);
    expect(result.current.live).toBe("offline");
  });
});
