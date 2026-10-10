import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeTask, makeView, preparedRequest, summaryOf } from "../../../features/executionOrchestration/__tests__/fixtures";
import { commandOk, json, renderAt, stubApi, type Call } from "./harness";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const commandCalls = (calls: Call[], name: string) => calls.filter((c) => c.url.endsWith(`/api/commands/${name}`));
const detailCalls = (calls: Call[]) => calls.filter((c) => /\/api\/execution-runs\/run-1$/.test(c.url));

describe("run list", () => {
  it("shows a loading skeleton, then runs newest first with real progress", async () => {
    const older = makeView({ status: "COMPLETED", completed: 2, total: 2, percent: 100, run: { runId: "run-0", id: "run-0", objective: "Older run", createdAt: "2026-04-01T10:00:00.000Z" } });
    const newer = makeView({ status: "EXECUTING", completed: 3, total: 7, percent: 43 });
    stubApi({ runs: [summaryOf(older), summaryOf(newer)] });
    renderAt("/execution-center");
    expect(screen.getByRole("status", { name: "Loading execution runs" })).toBeInTheDocument();
    await screen.findByText("Older run");
    const links = screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/execution-center/"));
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("Shorten the login card");
    expect(links[1]).toHaveTextContent("Older run");
    expect(within(links[0] as HTMLElement).getByText("3/7 tasks · 43%")).toBeInTheDocument();
    const bar = within(links[0] as HTMLElement).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "43");
    expect(within(links[0] as HTMLElement).getByText("Executing")).toBeInTheDocument();
    expect(links[0]).toHaveAttribute("href", "/execution-center/run-1");
  });

  it("shows an empty state", async () => {
    stubApi({ runs: [] });
    renderAt("/execution-center");
    expect(await screen.findByText("No execution runs yet")).toBeInTheDocument();
  });

  it("shows an error with retry that reloads the list", async () => {
    const calls = stubApi({ runsStatus: 500 });
    renderAt("/execution-center");
    const alert = await screen.findByText("The Control Plane is degraded");
    expect(alert).toBeInTheDocument();
    const before = calls.filter((c) => c.url.includes("/api/execution-runs?")).length;
    await userEvent.click(screen.getAllByRole("button", { name: "Retry" })[0] as HTMLElement);
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/api/execution-runs?")).length).toBeGreaterThan(before));
  });
});

describe("plan from a prepared request", () => {
  it("offers only PASS, WARN and APPROVAL_REQUIRED requests", async () => {
    stubApi({
      prepared: [
        preparedRequest({ requestId: "a", request: "Pass request", validation: "PASS" }),
        preparedRequest({ requestId: "b", request: "Warn request", validation: "WARN" }),
        preparedRequest({ requestId: "c", request: "Approval request", validation: "APPROVAL_REQUIRED" }),
        preparedRequest({ requestId: "d", request: "Blocked request", validation: "BLOCKED" }),
        preparedRequest({ requestId: "e", request: "Clarify request", validation: "CLARIFY" }),
      ],
    });
    renderAt("/execution-center");
    const select = await screen.findByLabelText("Prepared request");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(4));
    expect(within(select).queryByRole("option", { name: /Blocked/ })).not.toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: /Clarify/ })).not.toBeInTheDocument();
  });

  it("creates the plan with one call and navigates to the new run", async () => {
    const view = makeView();
    const calls = stubApi({
      prepared: [preparedRequest()],
      views: { "run-1": view },
      commands: { orchestration_create: () => commandOk(view) },
    });
    renderAt("/execution-center");
    const select = await screen.findByLabelText("Prepared request");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(2));
    await userEvent.selectOptions(select, "req-1");
    await userEvent.dblClick(screen.getByRole("button", { name: /Create plan/ }));
    expect(await screen.findByRole("heading", { name: "Execution run" })).toBeInTheDocument();
    expect(commandCalls(calls, "orchestration_create")).toHaveLength(1);
    expect(commandCalls(calls, "orchestration_create")[0]?.body).toEqual({ requestId: "req-1" });
  });

  it("asks for a selection before calling the backend", async () => {
    const calls = stubApi({ prepared: [preparedRequest()] });
    renderAt("/execution-center");
    await userEvent.click(await screen.findByRole("button", { name: /Create plan/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a prepared request before creating a plan.");
    expect(commandCalls(calls, "orchestration_create")).toHaveLength(0);
  });

  it("shows the server reason when planning is refused", async () => {
    stubApi({
      prepared: [preparedRequest()],
      commands: { orchestration_create: () => json(200, { ok: false, errorKind: "invalid_request", reason: "Request is not execution-ready" }) },
    });
    renderAt("/execution-center");
    const select = await screen.findByLabelText("Prepared request");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(2));
    await userEvent.selectOptions(select, "req-1");
    await userEvent.click(screen.getByRole("button", { name: /Create plan/ }));
    expect(await screen.findByTestId("error-reason")).toHaveTextContent("Request is not execution-ready");
  });
});

describe("run detail", () => {
  const agent = { agentId: "ag1", agentName: "Frontend Agent", coveredCapabilities: ["frontend_development"], reasons: ["Covers frontend_development", "Lowest workload"], workload: 0 };

  function richView() {
    const t1 = makeTask({
      taskId: "t1", title: "Plan the change", type: "ANALYSIS", status: "COMPLETED", assignedAgent: agent,
      assignedModel: { reason: "no model router is configured" }, gate: "review",
      result: { claimed: "success", summary: "Plan written", evidence: [], checks: [{ name: "lint", passed: true }], verified: true, verification: "Tests re-run by the runtime" },
    });
    const t2 = makeTask({
      taskId: "t2", title: "Implement login card", dependencies: ["t1"], status: "WAITING_APPROVAL",
      assignedModel: { provider: "anthropic", model: "claude-x", reason: "cheapest qualified" },
      approval: { approvalId: "ap1", state: "requested", requestedAt: "2026-05-01T10:00:00.000Z" },
    });
    const t3 = makeTask({
      taskId: "t3", title: "Verify the change", dependencies: ["t2"], status: "FAILED", type: "TEST",
      failures: [{ at: "2026-05-01T10:00:00.000Z", taskId: "t3", error: "Check failed: 2 tests", classification: "LOGICAL", retryCount: 1, recovery: "CORRECT" }],
      result: { claimed: "success", summary: "All good", evidence: [], checks: [], verified: false },
    });
    // listed out of order on purpose: dependents before their dependencies
    return makeView({ status: "WAITING_APPROVAL", tasks: [t3, t2, t1], completed: 1, total: 3, percent: 33, activeTaskIds: ["t1"], cost: { estimatedInputTokens: 4200, note: "tokens only" } });
  }

  it("renders header, real progress, plan notes, cost and dependency-ordered task cards", async () => {
    stubApi({ views: { "run-1": richView() } });
    renderAt("/execution-center/run-1");
    expect(await screen.findByText("Shorten the login card")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progress" })).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByText("1/3 tasks · 33%")).toBeInTheDocument();
    expect(screen.getByText("Security review omitted: no security-relevant change.")).toBeInTheDocument();
    expect(screen.getByText("4200")).toBeInTheDocument();
    expect(screen.getByText("Spent (USD)").nextSibling).toHaveTextContent("Unavailable");
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(["Plan the change", "Implement login card", "Verify the change"]);
    expect(screen.getByTestId("run-announcer")).toHaveTextContent("Run status: Waiting for approval. 1 of 3 tasks completed.");
  });

  it("shows routing evidence, model reason, gate, approval link, failures and claimed-vs-verified", async () => {
    stubApi({ views: { "run-1": richView() } });
    renderAt("/execution-center/run-1");
    await screen.findAllByText("Frontend Agent");
    expect(screen.getAllByText("Frontend Agent")).toHaveLength(2); // active agents + assigned agent
    expect(screen.getByText("Lowest workload")).toBeInTheDocument();
    expect(screen.getByText("no model router is configured")).toBeInTheDocument();
    expect(screen.getByText("claude-x (anthropic)")).toBeInTheDocument();
    expect(screen.getByText("Review gate")).toBeInTheDocument();
    const approval = screen.getByTestId("task-approval");
    expect(within(approval).getByText("Approval requested")).toBeInTheDocument();
    expect(within(approval).getByRole("link", { name: "Open approvals" })).toHaveAttribute("href", "/approvals");
    expect(within(approval).getByText(/Decide it on the Approvals page|decision/)).toBeInTheDocument();
    const failures = screen.getByTestId("task-failures");
    expect(within(failures).getByText("Check failed: 2 tests")).toBeInTheDocument();
    expect(within(failures).getByText(/Logical, recovery correct/)).toBeInTheDocument();
    expect(screen.getByText("Agent claimed success — verified: yes")).toBeInTheDocument();
    expect(screen.getByText("Agent claimed success — verified: no")).toBeInTheDocument();
    expect(screen.getByText(/Tests re-run by the runtime/)).toBeInTheDocument();
    expect(screen.getByText(/Not verified yet/)).toBeInTheDocument();
    // dependencies are shown by title, not id
    expect(screen.getAllByText("Plan the change").length).toBeGreaterThan(1);
  });

  it("renders text as plain text, never as markup", async () => {
    const task = makeTask({ title: "<img src=x onerror=alert(1)>", status: "BLOCKED", blockKind: "routing", blockedReason: "<b>bold</b>" });
    stubApi({ views: { "run-1": makeView({ tasks: [task], status: "BLOCKED" }) } });
    const { container } = renderAt("/execution-center/run-1");
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("controls", () => {
  it("offers Start only when NOT_STARTED and sends a single orchestration_start on double click", async () => {
    const started = makeView({ status: "EXECUTING", run: { started: true } });
    const calls = stubApi({
      views: { "run-1": makeView() },
      commands: { orchestration_start: () => commandOk(started) },
    });
    renderAt("/execution-center/run-1");
    const start = await screen.findByRole("button", { name: /Start execution/ });
    expect(screen.queryByRole("button", { name: /Advance/ })).not.toBeInTheDocument();
    await userEvent.dblClick(start);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Start execution/ })).not.toBeInTheDocument());
    expect(commandCalls(calls, "orchestration_start")).toHaveLength(1);
    expect(commandCalls(calls, "orchestration_start")[0]?.body).toEqual({ runId: "run-1" });
    expect(screen.getByRole("button", { name: /Advance/ })).toBeInTheDocument();
  });

  it("advances an executing run", async () => {
    const view = makeView({ status: "EXECUTING", run: { started: true } });
    const calls = stubApi({ views: { "run-1": view }, commands: { orchestration_advance: () => commandOk(view) } });
    renderAt("/execution-center/run-1");
    expect(screen.queryByRole("button", { name: /Start execution/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Advance/ }));
    await waitFor(() => expect(commandCalls(calls, "orchestration_advance")).toHaveLength(1));
  });

  it("pauses and resumes", async () => {
    const running = makeView({ status: "EXECUTING", run: { started: true } });
    const paused = makeView({ status: "EXECUTING", run: { started: true, paused: true } });
    const calls = stubApi({
      views: { "run-1": running },
      commands: { orchestration_pause: () => commandOk(paused), orchestration_resume: () => commandOk(running) },
    });
    renderAt("/execution-center/run-1");
    await userEvent.click(await screen.findByRole("button", { name: /^Pause/ }));
    const resume = await screen.findByRole("button", { name: /Resume/ });
    expect(screen.getByText(/This run is paused/)).toBeInTheDocument();
    await userEvent.click(resume);
    await screen.findByRole("button", { name: /^Pause/ });
    expect(commandCalls(calls, "orchestration_pause")).toHaveLength(1);
    expect(commandCalls(calls, "orchestration_resume")).toHaveLength(1);
  });

  it("cancels only after confirming, and says completed work is not undone", async () => {
    const view = makeView({ status: "EXECUTING", run: { started: true } });
    const cancelled = makeView({ status: "CANCELLED", run: { started: true, cancelled: true } });
    const calls = stubApi({ views: { "run-1": view }, commands: { orchestration_cancel: () => commandOk(cancelled) } });
    renderAt("/execution-center/run-1");
    await userEvent.click(await screen.findByRole("button", { name: /Cancel run/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Work that was already completed is not undone");
    expect(commandCalls(calls, "orchestration_cancel")).toHaveLength(0);
    // keeping the run closes the dialog without a call
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep running" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(commandCalls(calls, "orchestration_cancel")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: /Cancel run/ }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Yes, cancel the run" }));
    await waitFor(() => expect(commandCalls(calls, "orchestration_cancel")).toHaveLength(1));
    expect(await screen.findByTestId("run-announcer")).toHaveTextContent("Run status: Cancelled");
    expect(screen.queryByRole("button", { name: /Cancel run/ })).not.toBeInTheDocument();
  });

  it("retries a failed task and hides Retry for security blocks", async () => {
    const failed = makeTask({ taskId: "t1", title: "Failed task", status: "FAILED" });
    const security = makeTask({ taskId: "t2", title: "Secure task", status: "BLOCKED", blockKind: "security", blockedReason: "Policy" });
    const routing = makeTask({ taskId: "t3", title: "Routing task", status: "BLOCKED", blockKind: "routing", blockedReason: "No agent" });
    const view = makeView({ status: "BLOCKED", tasks: [failed, security, routing], run: { started: true } });
    const calls = stubApi({ views: { "run-1": view }, commands: { orchestration_retry_task: () => commandOk(view) } });
    renderAt("/execution-center/run-1");
    await screen.findByText("Failed task");
    expect(screen.getByRole("button", { name: "Retry task Failed task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry task Routing task" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry task Secure task" })).not.toBeInTheDocument();
    expect(screen.getByText(/security block/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry task Failed task" }));
    await waitFor(() => expect(commandCalls(calls, "orchestration_retry_task")).toHaveLength(1));
    expect(commandCalls(calls, "orchestration_retry_task")[0]?.body).toEqual({ runId: "run-1", taskId: "t1" });
  });

  it("hides mutating controls without orchestrate_execution and shows a read-only notice", async () => {
    const failed = makeTask({ status: "FAILED" });
    stubApi({ views: { "run-1": makeView({ status: "FAILED", tasks: [failed], run: { started: true } }) } });
    renderAt("/execution-center/run-1", { capabilities: ["view"] });
    expect(await screen.findByText("Read-only access")).toBeInTheDocument();
    for (const name of [/Start execution/, /Advance/, /^Pause/, /Resume/, /Cancel run/, /Retry task/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("hides the plan form on the list without orchestrate_execution", async () => {
    stubApi({ runs: [] });
    renderAt("/execution-center", { capabilities: ["view"] });
    expect(await screen.findByText("Read-only access")).toBeInTheDocument();
    expect(screen.queryByLabelText("Prepared request")).not.toBeInTheDocument();
  });

  it("shows the server reason on a 409 conflict and keeps controls available", async () => {
    const view = makeView({ status: "EXECUTING", run: { started: true } });
    stubApi({
      views: { "run-1": view },
      commands: { orchestration_advance: () => json(409, { message: "Run is paused", errorKind: "invalid_state", reason: "Run is paused" }) },
    });
    renderAt("/execution-center/run-1");
    await userEvent.click(await screen.findByRole("button", { name: /Advance/ }));
    const alert = await screen.findByText("The run is not in a state that allows this");
    expect(alert).toBeInTheDocument();
    expect(screen.getByTestId("error-reason")).toHaveTextContent("Run is paused");
    expect(screen.getByRole("button", { name: /Advance/ })).toBeEnabled();
  });
});

describe("polling", () => {
  it("polls every 3 s only while EXECUTING", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const executing = makeView({ status: "EXECUTING", run: { started: true } });
    const done = makeView({ status: "COMPLETED", completed: 1, total: 1, percent: 100, run: { started: true } });
    const views = { "run-1": executing };
    const calls = stubApi({ views });
    renderAt("/execution-center/run-1");
    await screen.findByText("Shorten the login card");
    expect(detailCalls(calls)).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    await waitFor(() => expect(detailCalls(calls).length).toBeGreaterThanOrEqual(2));
    views["run-1"] = done;
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    await waitFor(() => expect(screen.getByTestId("run-announcer")).toHaveTextContent("Run status: Completed"));
    const settled = detailCalls(calls).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(detailCalls(calls)).toHaveLength(settled);
  });

  it("does not poll a run that is not executing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = stubApi({ views: { "run-1": makeView({ status: "WAITING_APPROVAL" }) } });
    renderAt("/execution-center/run-1");
    await screen.findByText("Shorten the login card");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(detailCalls(calls)).toHaveLength(1);
  });
});

describe("error states", () => {
  it.each([
    [401, { message: "no session" }, "You are signed out"],
    [403, { message: "nope" }, "You do not have access"],
    [404, { message: "gone" }, "Not found"],
    [400, { message: "bad id", errorKind: "invalid_request", reason: "runId is malformed" }, "The request was not accepted"],
    [409, { message: "conflict", errorKind: "invalid_state", reason: "stale" }, "The run is not in a state that allows this"],
    [500, { message: "boom" }, "The Control Plane is degraded"],
  ])("maps HTTP %i on the run detail to a retryable error", async (status, body, title) => {
    const calls = stubApi({ detailStatus: status, detailBody: body });
    renderAt("/execution-center/run-1");
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    const before = detailCalls(calls).length;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(detailCalls(calls).length).toBeGreaterThan(before));
  });

  it("shows the network error state with retry", async () => {
    stubApi({ networkFailure: true });
    renderAt("/execution-center/run-1");
    expect(await screen.findByText("Control Plane unreachable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("Dutch", () => {
  it("renders the page in Dutch", async () => {
    stubApi({ views: { "run-1": makeView() } });
    renderAt("/execution-center/run-1", { language: "nl" });
    expect(await screen.findByRole("button", { name: /Uitvoering starten/ })).toBeInTheDocument();
    expect(screen.getByText("Niet gestart")).toBeInTheDocument();
    expect(screen.getByText("0/1 taken · 0%")).toBeInTheDocument();
  });
});
