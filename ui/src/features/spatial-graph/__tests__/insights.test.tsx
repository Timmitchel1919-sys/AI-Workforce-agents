import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/SpatialGraphView", () => ({
  SpatialGraphView: (props: SpatialGraphViewProps) => {
    viewHarness.props = props;
    return <div data-testid="mock-canvas" />;
  },
}));
let failWith: unknown = null;
const replies: Array<() => Promise<unknown>> = [];
const calls: Array<{ path: string; init: Record<string, unknown> }> = [];
vi.mock("../../../api/client", () => ({
  apiRequest: (path: string, init: Record<string, unknown>) => {
    calls.push({ path, init });
    if (failWith) return Promise.reject(failWith);
    return (replies.shift() ?? (() => new Promise(() => {})))();
  },
}));
let token: string | null = "tok";
vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ accessToken: token }) }));

import { I18nProvider } from "../../../i18n";
import { en } from "../../../i18n/locales/en";
import { nl } from "../../../i18n/locales/nl";
import { assertInsights, readFinding } from "../api/spatialInsightsClient";
import { InsightsPanel } from "../components/InsightsPanel";
import { SpatialGraphWorkspace } from "../components/SpatialGraphWorkspace";
import type { SpatialGraphViewProps } from "../components/SpatialGraphView";
import { useSpatialInsights } from "../hooks/useSpatialInsights";
import { INSIGHT_KINDS, INSIGHT_LIMITATIONS, INSIGHT_RECOMMENDATIONS, INSIGHT_SEVERITIES, type SpatialInsight, type SpatialInsightsReport } from "../../../../../contracts/graph";
import { makeProjection, viewHarness } from "./fixtures";

const ev = (nodeId: string, label = nodeId, state = "blocked") => ({ nodeId, nodeType: "TASK", label, state, status: "blocked" });
const finding = (over: Record<string, unknown> = {}) => ({
  id: "BLOCKED_TASK:dependency:task-t2",
  kind: "BLOCKED_TASK",
  variant: "dependency",
  severity: "warning",
  subjectNodeId: "task-t2",
  params: { task: "Write UI", dependency: "Write API", dependencyStatus: "running", count: 1 },
  evidence: [ev("task-t2", "Write UI"), ev("task-t1", "Write API", "running")],
  recommendations: [{ kind: "review_dependency", targetNodeId: "task-t1" }],
  limitations: ["as_of_revision"],
  ...over,
});
const report = (over: Record<string, unknown> = {}) => ({ projectId: "p1", graphRevision: 7, generatedAt: "t", findings: [finding()], truncated: false, basis: "observed_state", ...over });
const wrap = (ui: React.ReactElement, lang: "en" | "nl" = "en") => <I18nProvider initialLanguage={lang}>{ui}</I18nProvider>;

beforeEach(() => {
  failWith = null;
  replies.length = 0;
  calls.length = 0;
  token = "tok";
});

describe("client: a finding the UI does not fully understand is dropped, never half-trusted", () => {
  it("keeps a well-formed finding and strips anything unknown", () => {
    const f = readFinding({ ...finding(), extra: "x", recommendations: [{ kind: "consider_retry", targetNodeId: "t", relatedCommand: "retry-task", payload: { drop: "table" } }] })!;
    expect(f.recommendations).toEqual([{ kind: "consider_retry", targetNodeId: "t", relatedCommand: "retry-task" }]); // no payload survives
    expect("extra" in f).toBe(false);
  });
  it.each([
    ["unknown kind", { kind: "PREDICTED_OUTAGE" }],
    ["unknown severity", { severity: "apocalyptic" }],
    ["unknown variant", { variant: "soon" }],
    ["no evidence (not a grounded finding)", { evidence: [] }],
    ["malformed evidence only", { evidence: [{ nodeId: 5 }] }],
    ["non-object params", { params: "x" }],
  ])("drops a finding with %s", (_n, over) => {
    expect(readFinding(finding(over))).toBeNull();
  });
  it("drops an unknown related command (only labels of existing commands are kept)", () => {
    const f = readFinding(finding({ recommendations: [{ kind: "inspect", targetNodeId: "x", relatedCommand: "rm -rf /" }] }))!;
    expect(f.recommendations).toEqual([{ kind: "inspect", targetNodeId: "x" }]);
  });
  it("rejects a reply for another project, another basis, or without a revision", () => {
    expect(() => assertInsights(report({ projectId: "other" }), "p1")).toThrow();
    expect(() => assertInsights(report({ basis: "prediction" }), "p1")).toThrow();
    expect(() => assertInsights(report({ graphRevision: undefined }), "p1")).toThrow();
    expect(() => assertInsights("<html>", "p1")).toThrow();
    expect(assertInsights(report({ findings: [finding(), { junk: 1 }] }), "p1").findings).toHaveLength(1);
  });
});

describe("hook: follows the graph revision, honest on failure", () => {
  it("fetches once per (project, revision) with the token, and refetches when the revision moves", async () => {
    replies.push(() => Promise.resolve(report({ graphRevision: 1 })), () => Promise.resolve(report({ graphRevision: 2, findings: [] })));
    const { result, rerender } = renderHook(({ rev }) => useSpatialInsights("p1", rev), { initialProps: { rev: 1 } });
    await waitFor(() => expect(result.current.report?.graphRevision).toBe(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/projects/p1/insights");
    expect(calls[0]!.init).toMatchObject({ method: "GET", accessToken: "tok" });
    rerender({ rev: 1 });
    expect(calls).toHaveLength(1); // same revision: no refetch
    rerender({ rev: 2 });
    await waitFor(() => expect(result.current.report?.graphRevision).toBe(2));
    expect(calls).toHaveLength(2);
  });
  it("a failure is 'failed', never an empty report (unknown != nothing)", async () => {
    failWith = new Error("boom");
    const { result } = renderHook(() => useSpatialInsights("p1", 1));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.report).toBeNull();
  });
  it("a late reply for an earlier revision cannot overwrite a newer one; another project's report is never shown", async () => {
    let late!: (v: unknown) => void;
    replies.push(() => new Promise((r) => (late = r)), () => Promise.resolve(report({ graphRevision: 2 })));
    const { result, rerender } = renderHook(({ rev, p }) => useSpatialInsights(p, rev), { initialProps: { rev: 1, p: "p1" } });
    rerender({ rev: 2, p: "p1" });
    await waitFor(() => expect(result.current.report?.graphRevision).toBe(2));
    await act(async () => late(report({ graphRevision: 1 })));
    expect(result.current.report?.graphRevision).toBe(2);
    replies.push(() => new Promise(() => {}));
    rerender({ rev: 2, p: "p2" });
    expect(result.current.report).toBeNull(); // p1's report is not p2's
  });
  it("does nothing until signed in", () => {
    token = null;
    renderHook(() => useSpatialInsights("p1", 1));
    expect(calls).toHaveLength(0);
  });
});

describe("panel", () => {
  const render1 = (r: SpatialInsightsReport | null, extra: Partial<React.ComponentProps<typeof InsightsPanel>> = {}, lang: "en" | "nl" = "en") =>
    render(wrap(<InsightsPanel report={r} loading={false} failed={false} isInView={() => true} onSelectNode={() => {}} {...extra} />, lang));

  it("explains from the recorded facts, with evidence, a suggestion labelled NOT an action, and its limits", () => {
    render1(assertInsights(report(), "p1"));
    const item = screen.getByTestId("sg-insight");
    expect(item).toHaveTextContent("Task “Write UI” cannot proceed until “Write API” (currently running) completes. Dependencies still open: 1.");
    expect(within(item).getByText("Warning")).toBeInTheDocument(); // text, not colour alone
    expect(within(item).getByRole("button", { name: /Write API · Running/ })).toBeInTheDocument();
    expect(item).toHaveTextContent("Suggestion (not an action)");
    expect(item).toHaveTextContent("True as of the state shown");
    expect(screen.getByText(/Derived from the state at revision 7/)).toBeInTheDocument();
    expect(screen.getByText(/not predictions and not actions/)).toBeInTheDocument();
  });

  it("SUGGESTION != COMMAND: the panel contains no command control and mentions the related action only as text", async () => {
    const f = finding({ kind: "FAILED_EXECUTION", variant: "failed", severity: "critical", params: { session: "Session build", status: "timed_out" }, recommendations: [{ kind: "consider_retry", targetNodeId: "task-t1", relatedCommand: "retry-task" }], limitations: ["cause_not_recorded", "as_of_revision"] });
    render1(assertInsights(report({ findings: [f] }), "p1"));
    const item = screen.getByTestId("sg-insight");
    expect(item).toHaveTextContent("Retrying may be appropriate. Look at the failure first: the recorded state does not say why it failed.");
    expect(item).toHaveTextContent("the related action is “Retry task…” in the inspector; it asks for confirmation");
    expect(item).toHaveTextContent("shows that this happened, not why");
    // The only buttons are navigation to evidence nodes — none says retry/cancel/approve/reject.
    for (const b of within(item).getAllByRole("button")) expect(b.textContent).not.toMatch(/retry|cancel|approve|reject/i);
  });

  it("never issues a request or a write by itself", async () => {
    render1(assertInsights(report(), "p1"));
    await userEvent.click(screen.getByRole("button", { name: /Write API/ }));
    expect(calls).toHaveLength(0);
  });

  it("evidence outside the current view is plain text, not a dead button", () => {
    render1(assertInsights(report(), "p1"), { isInView: (id) => id === "task-t2" });
    expect(screen.getByRole("button", { name: /Write UI/ })).toBeInTheDocument();
    expect(screen.getByText(/Write API · Running \(not in this view\)/)).toBeInTheDocument();
  });

  it("empty is honest: 'nothing needs attention' only when every source was readable; otherwise 'incomplete'", () => {
    const { unmount } = render1(assertInsights(report({ findings: [] }), "p1"));
    expect(screen.getByTestId("sg-insights-none")).toHaveTextContent("Nothing in the recorded state needs attention.");
    unmount();
    render1(assertInsights(report({ findings: [], unavailableSources: ["releases"] }), "p1"));
    expect(screen.getByTestId("sg-insights-partial")).toHaveTextContent("deployments"); // readable, not the raw id "releases"
    expect(screen.getByTestId("sg-insights-none")).toHaveTextContent(/picture is incomplete/);
    expect(screen.getByTestId("sg-insights-none")).not.toHaveTextContent(/needs attention/);
  });

  it("NOT CONFIGURED is its own message: a source this deployment lacks can never read as 'no findings'", () => {
    render1(assertInsights(report({ findings: [], notConfiguredSources: ["verifications", "sourceControl", "releases"] }), "p1"));
    const note = screen.getByTestId("sg-insights-not-configured");
    expect(note).toHaveTextContent("Not connected in this deployment: verification, reviews and commits, deployments");
    expect(note).toHaveTextContent(/not the same as there being none/);
    expect(screen.getByTestId("sg-insights-none")).toHaveTextContent(/picture is incomplete/);
    expect(screen.getByTestId("sg-insights-none")).not.toHaveTextContent(/needs attention/);
    expect(screen.queryByTestId("sg-insights-partial")).toBeNull(); // not a failed read
  });

  it("templates read as words: node types are translated and statuses are de-underscored; no plural clashes", () => {
    const f = finding({ kind: "FAILED_EXECUTION", variant: "failed", severity: "critical", params: { session: "Session build", status: "timed_out" }, limitations: ["cause_not_recorded"] });
    const w = finding({ kind: "WAITING_APPROVAL", variant: "waiting", params: { subject: "Commit abc", subjectType: "COMMIT", approval: "Approval: commit" }, recommendations: [], evidence: [ev("approval-a", "Approval: commit", "awaiting_approval")] });
    render1(assertInsights(report({ findings: [f, w] }), "p1"));
    const text = screen.getByTestId("sg-insights").textContent ?? "";
    expect(text).toContain("ended as timed out");
    expect(text).not.toMatch(/timed_out|COMMIT|EXECUTION_SESSION/);
    expect(text).toContain("Commit “Commit abc” is waiting for approval");
    expect(text).toContain("Findings: 2");
  });

  it("a failed read says insights are unavailable (and is not an 'all clear')", () => {
    render1(null, { failed: true });
    expect(screen.getByTestId("sg-insights-failed")).toHaveTextContent(/unavailable right now/);
    expect(screen.queryByTestId("sg-insights-none")).toBeNull();
  });

  it("renders in Dutch with no raw keys", () => {
    render1(assertInsights(report(), "p1"), {}, "nl");
    const text = screen.getByTestId("sg-insights").textContent ?? "";
    expect(text).toContain("Taak “Write UI” kan pas verder");
    expect(text).not.toMatch(/spatial\.insights\./);
  });

  it("every possible finding (kind x variant, recommendation, limitation, severity) has a real EN and NL string", () => {
    type Strings = Record<string, string>;
    type Catalogue = { spatial: { insights: { kind: Strings; explain: Record<string, Strings>; rec: Strings; limitation: Strings; severity: Strings } } };
    const get = (cat: unknown) => (cat as Catalogue).spatial.insights;
    const variants: Record<string, string[]> = {
      BLOCKED_TASK: ["dependency", "approval", "unspecified"],
      FAILED_EXECUTION: ["failed"],
      WAITING_APPROVAL: ["waiting", "waitingNoSubject"],
      ENVIRONMENT_UNAVAILABLE: ["unspecified"],
      REVIEW_WAITING: ["waiting", "queue"],
      DEPLOYMENT_PROBLEM: ["failed", "degraded", "rolled_back", "unverified"],
      DEPENDENCY_BOTTLENECK: ["waiting"],
    };
    expect(Object.keys(variants).sort()).toEqual([...INSIGHT_KINDS].sort());
    for (const cat of [en, nl]) {
      const s = get(cat);
      for (const kind of INSIGHT_KINDS) {
        expect(s.kind[kind], kind).toBeTruthy();
        for (const v of variants[kind]!) expect(s.explain[kind][v], `${kind}.${v}`).toBeTruthy();
      }
      for (const r of INSIGHT_RECOMMENDATIONS) expect(s.rec[r], r).toBeTruthy();
      for (const l of INSIGHT_LIMITATIONS) expect(s.limitation[l], l).toBeTruthy();
      for (const sev of INSIGHT_SEVERITIES) expect(s.severity[sev], sev).toBeTruthy();
    }
  });
});

describe("workspace integration", () => {
  const f: SpatialInsight = readFinding(finding())!;
  const rep: SpatialInsightsReport = { projectId: "p1", graphRevision: 7, generatedAt: "t", findings: [f], truncated: false, basis: "observed_state" };
  it("selecting evidence selects the node in the graph (navigation only); an absent node is not selectable", async () => {
    render(wrap(<SpatialGraphWorkspace graph={makeProjection()} mode="WORKFORCE" insights={{ report: rep, loading: false, failed: false }} />));
    await userEvent.click(screen.getByRole("button", { name: /Write API · Running/ }));
    expect(viewHarness.props.selectedId).toBe("task-t1");
    expect(calls).toHaveLength(0); // no request of any kind
  });
  it("without insights props the panel is not shown", () => {
    render(wrap(<SpatialGraphWorkspace graph={makeProjection()} mode="WORKFORCE" />));
    expect(screen.queryByTestId("sg-insights")).toBeNull();
  });
});
