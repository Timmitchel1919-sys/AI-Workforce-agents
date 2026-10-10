import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/SpatialGraphView", () => ({
  SpatialGraphView: (props: SpatialGraphViewProps) => {
    viewHarness.props = props;
    return <div data-testid="mock-canvas" />;
  },
}));
type Step = () => Promise<unknown>;
let fetchSteps: Step[] = [];
let pollSteps: Step[] = [];
let pollCalls = 0;
const never: Step = () => new Promise(() => {});
vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ accessToken: "tok" }) }));
vi.mock("../api/spatialGraphClient", () => ({
  fetchWorkforceGraph: () => (fetchSteps.shift() ?? never)(),
  pollWorkforceGraph: () => {
    pollCalls += 1;
    return (pollSteps.shift() ?? never)();
  },
}));

import { I18nProvider } from "../../../i18n";
import { SpatialGraphWorkspace } from "../components/SpatialGraphWorkspace";
import type { SpatialGraphViewProps } from "../components/SpatialGraphView";
import { useSpatialGraph } from "../hooks/useSpatialGraph";
import { diffGraphs, type GraphTransition } from "../lib/graphDiff";
import { traceExecutionPath } from "../lib/executionPath";
import type { LiveStatus } from "../lib/liveStatus";
import { edge, makeProjection, node, viewHarness } from "./fixtures";

const ok = (v: unknown): Step => () => Promise.resolve(v);
const failWith = (status: number): Step => () => Promise.reject(Object.assign(new Error("denied"), { status }));
const INTERVAL = 1000;
const tick = (ms = INTERVAL) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const wrap = (ui: React.ReactElement) => <I18nProvider initialLanguage="en">{ui}</I18nProvider>;

describe("diffGraphs: unknown is not absent", () => {
  const full = makeProjection();
  const cut = makeProjection({ nodes: full.nodes.slice(0, 3), edges: [] });

  it("never reports 'removed' when the later snapshot is truncated or a source was unreadable", () => {
    expect(diffGraphs(full, { ...cut, truncated: true })).toEqual([]);
    expect(diffGraphs(full, { ...cut, metadata: { unavailableSources: "releases" } })).toEqual([]);
  });
  it("never reports 'added' on recovery from an unreadable source", () => {
    expect(diffGraphs({ ...cut, metadata: { unavailableSources: "releases" } }, full)).toEqual([]);
  });
  it("still reports genuine state changes of nodes present in both, even in a partial view", () => {
    const changed = { ...full, truncated: true, nodes: full.nodes.map((n) => (n.id === "task-t1" ? { ...n, state: "completed" as const, status: "completed" } : n)) };
    expect(diffGraphs(full, changed).map((t) => `${t.kind}:${t.nodeId}`)).toEqual(["state:task-t1"]);
  });
  it("reports operational states (translatable), with the raw status kept separately", () => {
    const next = { ...full, nodes: full.nodes.map((n) => (n.id === "task-t1" ? { ...n, state: "failed" as const, status: "timed_out" } : n)) };
    const [t] = diffGraphs(full, next);
    expect(t).toMatchObject({ fromState: "running", toState: "failed", toStatus: "timed_out" });
  });
});

describe("traceExecutionPath", () => {
  const edges = [
    edge("agent-a", "session-s", "EXECUTES"),
    edge("task-t", "session-s", "EXECUTES"),
    edge("session-s", "changeset-c", "PRODUCES"),
    edge("changeset-c", "commit-k", "COMMITTED_AS"),
    edge("commit-k", "deployment-d", "DEPLOYED_TO"),
    edge("project-p", "task-t", "HAS_TASK"), // not a lifecycle edge: must not be followed
    edge("task-x", "task-y", "DEPENDS_ON"),
  ];
  it("from any node on a linear chain: its ancestors and descendants, nothing else", () => {
    expect([...traceExecutionPath(edges, "changeset-c")!].sort()).toEqual(["agent-a", "changeset-c", "commit-k", "deployment-d", "session-s", "task-t"]);
    expect([...traceExecutionPath(edges, "commit-k")!].sort()).toEqual(["agent-a", "changeset-c", "commit-k", "deployment-d", "session-s", "task-t"]);
    // Selecting the deployment: only what led to it.
    expect([...traceExecutionPath(edges, "deployment-d")!].sort()).toEqual(["agent-a", "changeset-c", "commit-k", "deployment-d", "session-s", "task-t"]);
    // Selecting the agent: all the work it started.
    expect([...traceExecutionPath(edges, "agent-a")!].sort()).toEqual(["agent-a", "changeset-c", "commit-k", "deployment-d", "session-s"]);
  });
  it("a shared agent or environment is NOT a hub: sibling sessions are not on the path", () => {
    const two = [
      edge("agent-a", "session-1", "EXECUTES"),
      edge("agent-a", "session-2", "EXECUTES"),
      edge("session-1", "env-e", "RUNS_ON"),
      edge("session-2", "env-e", "RUNS_ON"),
      edge("session-1", "changeset-1", "PRODUCES"),
      edge("session-2", "changeset-2", "PRODUCES"),
      edge("changeset-1", "commit-1", "COMMITTED_AS"),
      edge("changeset-2", "commit-2", "COMMITTED_AS"),
    ];
    expect([...traceExecutionPath(two, "changeset-1")!].sort()).toEqual(["agent-a", "changeset-1", "commit-1", "session-1"]);
    expect([...traceExecutionPath(two, "commit-2")!].sort()).toEqual(["agent-a", "changeset-2", "commit-2", "session-2"]);
    // The session's own environment IS part of its path; the other session is not.
    expect([...traceExecutionPath(two, "session-1")!].sort()).toEqual(["agent-a", "changeset-1", "commit-1", "env-e", "session-1"]);
    expect([...traceExecutionPath(two, "env-e")!].sort()).toEqual(["agent-a", "env-e", "session-1", "session-2"]);
  });
  it("does not walk non-lifecycle edges (no invented path through the project)", () => {
    expect(traceExecutionPath(edges, "project-p")).toBeNull();
    expect(traceExecutionPath(edges, "task-x")).toBeNull();
  });
  it("is null for no selection / unknown node, and terminates on cycles", () => {
    expect(traceExecutionPath(edges, null)).toBeNull();
    expect(traceExecutionPath(edges, "nope")).toBeNull();
    const cyc = [edge("a", "b", "EXECUTES"), edge("b", "a", "PRODUCES")];
    expect([...traceExecutionPath(cyc, "a")!].sort()).toEqual(["a", "b"]);
  });
});

type Live = NonNullable<React.ComponentProps<typeof SpatialGraphWorkspace>["live"]>;
const tr = (i: number): GraphTransition => ({ kind: "state", nodeId: `n${i}`, nodeType: "TASK", label: `Task ${i}`, fromState: "queued", toState: "running", at: "t" });
const liveOf = (status: LiveStatus, extra: Partial<Live> = {}): Live => ({ status, lastConfirmedAt: null, transitions: [], ...extra });

describe("workspace announcements", () => {
  it("keeps announcing after the capped history is full (counts by the uncapped total)", () => {
    const g = makeProjection();
    const full = Array.from({ length: 100 }, (_, i) => tr(i));
    const { rerender } = render(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("live", { transitions: full, transitionCount: 100 })} />));
    // History is capped at 100: a new batch drops the oldest, so the LIST LENGTH stays 100.
    const after = [...full.slice(1), tr(100)];
    rerender(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("live", { transitions: after, transitionCount: 101 })} />));
    expect(screen.getByTestId("sg-announcement")).toHaveTextContent("Task 100 is now running.");
  });

  it("announces recovery even though the status passes through 'refreshing'", () => {
    const g = makeProjection();
    const { rerender } = render(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("live")} />));
    for (const s of ["offline", "refreshing"] as const) {
      rerender(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf(s)} />));
    }
    expect(screen.getByTestId("sg-announcement")).toHaveTextContent("Offline");
    rerender(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("live")} />));
    expect(screen.getByTestId("sg-announcement")).toHaveTextContent("Live");
  });

  it("does not lose a recovery when a transition arrives in the same update", () => {
    const g = makeProjection();
    const { rerender } = render(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("degraded")} />));
    rerender(wrap(<SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={liveOf("live", { transitions: [tr(1)], transitionCount: 1 })} />));
    const text = screen.getByTestId("sg-announcement").textContent ?? "";
    expect(text).toMatch(/Live/);
    expect(text).toMatch(/Task 1 is now running/);
  });
});

describe("workspace camera + path tracing", () => {
  it("refits when a sparse view first fills in, but not for routine growth of a populated view", () => {
    const sparse = makeProjection({ mode: "EXECUTION", nodes: [node("project-p1", "PROJECT", "Apollo")], edges: [] });
    const { rerender } = render(wrap(<SpatialGraphWorkspace graph={sparse} mode="EXECUTION" />));
    const seq0 = viewHarness.props.cameraCommand?.seq;
    const filled = makeProjection({ mode: "EXECUTION" });
    rerender(wrap(<SpatialGraphWorkspace graph={filled} mode="EXECUTION" />));
    expect(viewHarness.props.cameraCommand?.seq).not.toBe(seq0);
    const seq1 = viewHarness.props.cameraCommand?.seq;
    rerender(wrap(<SpatialGraphWorkspace graph={{ ...filled, nodes: [...filled.nodes, node("task-t9", "TASK", "New", "queued")] }} mode="EXECUTION" />));
    expect(viewHarness.props.cameraCommand?.seq).toBe(seq1);
  });

  it("emphasises the real lifecycle chain of a selected node and says so", () => {
    const g = makeProjection({
      mode: "EXECUTION",
      nodes: [
        node("project-p1", "PROJECT", "Apollo"),
        node("session-s1", "EXECUTION_SESSION", "Session build", "running"),
        node("changeset-c1", "CHANGESET", "ChangeSet", "active"),
        node("commit-k1", "COMMIT", "Commit abc", "completed"),
        node("task-t1", "TASK", "Unrelated", "queued"),
      ],
      edges: [edge("session-s1", "changeset-c1", "PRODUCES"), edge("changeset-c1", "commit-k1", "COMMITTED_AS"), edge("project-p1", "task-t1", "HAS_TASK")],
    });
    render(wrap(<SpatialGraphWorkspace graph={g} mode="EXECUTION" />));
    act(() => viewHarness.props.onSelect("changeset-c1"));
    expect([...(viewHarness.props.emphasisIds ?? [])].sort()).toEqual(["changeset-c1", "commit-k1", "session-s1"]);
    expect(screen.getByTestId("sg-path-status")).toHaveTextContent("3 connected nodes");
  });
});

describe("useSpatialGraph hardening", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSteps = [];
    pollSteps = [];
    pollCalls = 0;
  });
  afterEach(() => vi.useRealTimers());
  const mount = () => renderHook(() => useSpatialGraph("p1", { pollIntervalMs: INTERVAL }));

  it("discards ONE older reply as stale but accepts a persistent one (server clock behind), never freezing", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7, generatedAt: "2026-09-26T00:05:00.000Z" }))];
    const older = (revision: number) => ok(makeProjection({ revision, generatedAt: "2026-09-26T00:01:00.000Z", nodes: [node("project-p1", "PROJECT", "Apollo")], edges: [] }));
    pollSteps = [older(8), older(8)];
    const { result } = mount();
    await tick(0);
    await tick();
    expect(result.current.graph?.revision).toBe(7); // first older reply: discarded
    await tick();
    expect(result.current.graph?.revision).toBe(8); // still older next time: it is the server's clock
  });

  it("stops polling on 401/403 (retrying cannot help), shows degraded, and resumes on manual refresh", async () => {
    fetchSteps = [ok(makeProjection({ revision: 7 }))];
    pollSteps = [failWith(403), ok({ projectId: "p1", mode: "WORKFORCE", revision: 7, generatedAt: "2026-09-26T00:00:10.000Z", unchanged: true })];
    const { result } = mount();
    await tick(0);
    await tick();
    expect(result.current.live).toBe("degraded");
    expect(result.current.graph?.revision).toBe(7);
    await tick(60_000);
    expect(pollCalls).toBe(1); // no retry storm
    act(() => result.current.refresh());
    await tick(0);
    expect(pollCalls).toBe(2);
    expect(result.current.live).toBe("live");
  });

  it("counts every transition ever seen even though the visible history is capped", async () => {
    const many = (state: "running" | "queued") =>
      makeProjection({
        revision: state === "running" ? 2 : 1,
        generatedAt: state === "running" ? "2026-09-26T00:01:00.000Z" : "2026-09-26T00:00:00.000Z",
        nodes: Array.from({ length: 80 }, (_, i) => node(`task-${i}`, "TASK", `T${i}`, state)),
        edges: [],
      });
    fetchSteps = [ok(many("queued"))];
    pollSteps = [ok(many("running"))];
    const { result } = mount();
    await tick(0);
    await tick();
    expect(result.current.transitionCount).toBe(80);
    pollSteps = [ok(many("queued"))];
    await tick();
    // 80 + 80 back again... but the second flip is OLDER by timestamp, so it is discarded once
    expect(result.current.transitionCount).toBe(80);
  });
});
