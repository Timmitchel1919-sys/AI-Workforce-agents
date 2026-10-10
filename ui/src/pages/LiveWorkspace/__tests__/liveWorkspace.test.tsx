import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeEvent, makeSession, summaryOf } from "../../../features/liveWorkspace/__tests__/fixtures";
import type { RuntimeSession } from "../../../features/liveWorkspace/types";
import { eventsBatch, json, renderAt, stubApi, type Call } from "./harness";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const eventCalls = (calls: Call[]) => calls.filter((c) => /\/events\?/.test(c.url));
const commandCalls = (calls: Call[], name: string) => calls.filter((c) => c.url.endsWith(`/api/commands/${name}`));
const ROOT_TREE = {
  entries: [
    { path: "src", type: "dir" as const },
    { path: "README.md", type: "file" as const },
    { path: ".env.local", type: "file" as const },
  ],
  truncated: false,
};
const SRC_TREE = { entries: [{ path: "src/app.ts", type: "file" as const }], truncated: false };

async function openDetail(session: RuntimeSession, extra: Parameters<typeof stubApi>[0] = {}, options: Parameters<typeof renderAt>[1] = {}) {
  const calls = stubApi({ session, trees: { "": ROOT_TREE, src: SRC_TREE }, ...extra });
  renderAt("/workspace/ex-1", options);
  await screen.findByRole("heading", { name: "Execution inspector" });
  return calls;
}

describe("overview and session list", () => {
  it("shows the real overview numbers", async () => {
    stubApi({ overview: { active: 2, queued: 5, waitingApproval: 1, failed: 3, completedToday: 7 } });
    const { container } = renderAt("/workspace");
    await screen.findByText("Active executions");
    const value = (key: string) => container.querySelector(`[data-overview="${key}"] strong`)?.textContent;
    expect([value("active"), value("queued"), value("waitingApproval"), value("failed"), value("completedToday")]).toEqual(["2", "5", "1", "3", "7"]);
  });

  it("lists sessions with status, agent, changed count and a flagged badge as text", async () => {
    const a = makeSession();
    const b = makeSession({ executionId: "ex-2", id: "ex-2", taskId: "task-api", status: "FAILED" });
    stubApi({ sessions: [summaryOf(a, { changedFiles: 4, flagged: true }), summaryOf(b)] });
    renderAt("/workspace");
    const link = await screen.findByRole("link", { name: /task-login/ });
    expect(link).toHaveAttribute("href", "/workspace/ex-1");
    expect(within(link).getByText("4 changed files")).toBeInTheDocument();
    expect(within(link).getByText("Flagged for review")).toBeInTheDocument();
    expect(within(link).getByText("frontend-agent")).toBeInTheDocument();
    const other = screen.getByRole("link", { name: /task-api/ });
    expect(within(other).queryByText("Flagged for review")).not.toBeInTheDocument();
    expect(within(other).getByText("Failed")).toBeInTheDocument();
  });

  it("explains the empty state", async () => {
    stubApi({ sessions: [] });
    renderAt("/workspace");
    expect(await screen.findByText("No executions yet")).toBeInTheDocument();
    expect(screen.getByText(/no workspace registered/)).toBeInTheDocument();
  });

  it("shows an error with retry for the list", async () => {
    const calls = stubApi({ sessionsStatus: 500 });
    renderAt("/workspace");
    await screen.findByText("The Control Plane is degraded");
    const before = calls.filter((c) => /sessions\?/.test(c.url)).length;
    await userEvent.click(screen.getAllByRole("button", { name: "Retry" })[0] as HTMLElement);
    await waitFor(() => expect(calls.filter((c) => /sessions\?/.test(c.url)).length).toBeGreaterThan(before));
  });
});

describe("execution detail", () => {
  it("renders header, inspector, tools, error and approval", async () => {
    const session = makeSession({
      status: "WAITING_APPROVAL",
      approval: { reason: "Needs review of the migration" },
      error: { kind: "BUILD_FAILURE", message: "Build exploded", at: "x" },
      tools: [
        { executionId: "ex-1", taskId: "t", agentId: "a", tool: "fs", operation: "write", at: "1", result: "ok", durationMs: 1 },
        { executionId: "ex-1", taskId: "t", agentId: "a", tool: "shell", operation: "rm", at: "2", result: "denied", error: "blocked by policy", durationMs: 1 },
      ],
      gitState: { branch: "feature/x", head: "abc123", dirty: true, changedFiles: ["a", "b"] },
    });
    await openDetail(session);
    expect(screen.getByText("money-mind")).toBeInTheDocument();
    expect(screen.getByText("run-9")).toBeInTheDocument();
    expect(screen.getAllByText("task-login").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waiting for approval").length).toBeGreaterThan(0);
    expect(screen.getByText("model-x")).toBeInTheDocument();
    expect(screen.getByText("1234 (estimate)")).toBeInTheDocument();
    expect(screen.getByText("Needs review of the migration")).toBeInTheDocument();
    expect(screen.getByText("Error: Build failure")).toBeInTheDocument();
    expect(screen.getByText("Build exploded")).toBeInTheDocument();
    expect(screen.getByText("shell · rm")).toBeInTheDocument();
    expect(screen.getByText("denied")).toBeInTheDocument();
    expect(screen.getByText("blocked by policy")).toBeInTheDocument();
    expect(screen.getByText("feature/x")).toBeInTheDocument();
  });

  it("says Unavailable when there is no model or token estimate", async () => {
    const session = makeSession();
    delete (session as { modelId?: string }).modelId;
    delete (session as { estimatedInputTokens?: number }).estimatedInputTokens;
    await openDetail(session);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2);
  });

  it("exposes accessible roles: tree, tablist, log, status line", async () => {
    await openDetail(makeSession());
    expect(screen.getByRole("tree", { name: "Project file tree" })).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Files", "Diff", "Preview", "Tests"]);
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "off");
    expect(screen.getByTestId("status-line")).toHaveTextContent("Execution status: Running");
  });
});

describe("file tree and viewer", () => {
  it("lazy-loads directories on expand and badges changed files", async () => {
    const session = makeSession({
      changes: [{ path: "README.md", operation: "update", at: "x", taskId: "t", agentId: "a" }, { path: "src/app.ts", operation: "create", at: "x", taskId: "t", agentId: "a" }],
    });
    const calls = await openDetail(session);
    await screen.findByText("README.md");
    expect(calls.some((c) => /\/tree\?dir=src/.test(c.url))).toBe(false);
    const tree = screen.getByRole("tree");
    expect(within(tree).getByText("modified")).toBeInTheDocument();
    await userEvent.click(within(tree).getByText("src"));
    await within(tree).findByText("app.ts");
    expect(calls.filter((c) => /\/tree\?dir=src/.test(c.url))).toHaveLength(1);
    expect(within(tree).getByText("created")).toBeInTheDocument();
  });

  it("supports the keyboard: arrows move and expand, Enter opens a file", async () => {
    await openDetail(makeSession(), { files: { "src/app.ts": { path: "src/app.ts", content: "export const x = 1;", size: 19, hash: "h", truncated: false } } });
    const tree = await screen.findByRole("tree");
    await within(tree).findByText("README.md");
    const item = (path: string) => tree.querySelector<HTMLElement>(`[data-path="${path}"]`) as HTMLElement;
    expect(item("src")).toHaveAttribute("tabindex", "0");
    act(() => item("src").focus());
    await userEvent.keyboard("{ArrowRight}");
    await within(tree).findByText("app.ts");
    expect(item("src")).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(item("src/app.ts")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("export const x = 1;")).toBeInTheDocument();
    expect(screen.getByText("Size: 19 B")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(item("src")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(item("src")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a truncated notice and refuses protected files with a clear message", async () => {
    await openDetail(makeSession(), {
      files: {
        "README.md": { path: "README.md", content: "# Hi <b>not html</b>", size: 300_000, hash: "h", truncated: true },
        ".env.local": 403,
      },
    });
    const tree = await screen.findByRole("tree");
    await userEvent.click(await within(tree).findByText("README.md"));
    expect(await screen.findByText("# Hi <b>not html</b>")).toBeInTheDocument();
    expect(screen.getByText(/only the first part is shown/)).toBeInTheDocument();
    await userEvent.click(within(tree).getByText(".env.local"));
    expect(await screen.findByText("This file cannot be shown")).toBeInTheDocument();
    expect(screen.getByText(/refused to show \.env\.local/)).toBeInTheDocument();
  });
});

describe("diff, preview and tests tabs", () => {
  const changed = makeSession({
    changes: [{
      path: "src/app.ts", operation: "update", at: "2026-05-01T10:01:00.000Z", taskId: "task-login", agentId: "frontend-agent",
      diff: "@@ -1 +1 @@\n-old line\n+new line\n context",
    }],
    scope: { status: "FLAGGED_FOR_REVIEW", expected: ["src/"], unexpected: ["infra/db.ts"], sensitive: ["auth/rules.ts"] },
  });

  it("lists changes with collapsible text-prefixed diff lines and the flagged scope report", async () => {
    await openDetail(changed);
    await userEvent.click(screen.getByRole("tab", { name: "Diff" }));
    const panel = screen.getByRole("tabpanel");
    const scope = panel.querySelector('[data-scope="FLAGGED_FOR_REVIEW"]') as HTMLElement;
    expect(within(scope).getByText("Flagged for review")).toBeInTheDocument();
    expect(within(scope).getByText("infra/db.ts")).toBeInTheDocument();
    expect(within(scope).getByText("auth/rules.ts")).toBeInTheDocument();
    expect(within(panel).getByText("src/app.ts")).toBeInTheDocument();
    expect(within(panel).getByText(/agent frontend-agent/)).toBeInTheDocument();
    expect(panel.querySelector(".lw-diff__line--add")?.textContent).toContain("+new line");
    expect(panel.querySelector(".lw-diff__line--del")?.textContent).toContain("-old line");
    await userEvent.click(within(panel).getByRole("button", { name: "Hide diff" }));
    expect(panel.querySelector(".lw-diff")).toBeNull();
    await userEvent.click(within(panel).getByRole("button", { name: "Show diff" }));
    expect(panel.querySelector(".lw-diff")).not.toBeNull();
  });

  it("shows IN_SCOPE as in scope", async () => {
    await openDetail(makeSession({ scope: { status: "IN_SCOPE", expected: [], unexpected: [], sensitive: [] } }));
    await userEvent.click(screen.getByRole("tab", { name: "Diff" }));
    expect(screen.getByText("In scope")).toBeInTheDocument();
  });

  it("is honest that there is no preview", async () => {
    await openDetail(makeSession());
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByText("A live preview is not available: no preview runtime is configured.")).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("renders validation stages with status, command, counts and errors", async () => {
    await openDetail(makeSession({
      validation: [
        { stage: "typecheck", status: "passed", command: "npx tsc -b", durationMs: 2500, errors: [], warnings: 0 },
        { stage: "test", status: "failed", command: "npm test", durationMs: 4000, counts: { total: 10, passed: 8, failed: 2, skipped: 0 }, errors: ["expected 1 to be 2"], warnings: 3 },
        { stage: "lint", status: "skipped", note: "No lint script", errors: [], warnings: 0 },
        { stage: "build", status: "unavailable", note: "No build script", errors: [], warnings: 0 },
      ],
    }));
    await userEvent.click(screen.getByRole("tab", { name: "Tests" }));
    const stage = (name: string) => screen.getByRole("tabpanel").querySelector(`[data-stage="${name}"]`) as HTMLElement;
    expect(within(stage("typecheck")).getByText("Passed")).toBeInTheDocument();
    expect(within(stage("typecheck")).getByText("npx tsc -b")).toBeInTheDocument();
    expect(within(stage("test")).getByText("10 total, 8 passed, 2 failed, 0 skipped")).toBeInTheDocument();
    expect(within(stage("test")).getByText("expected 1 to be 2")).toBeInTheDocument();
    expect(within(stage("lint")).getByText("No lint script")).toBeInTheDocument();
    expect(within(stage("build")).getByText("Unavailable")).toBeInTheDocument();
  });

  it("moves between tabs with the arrow keys", async () => {
    await openDetail(makeSession());
    act(() => screen.getByRole("tab", { name: "Files" }).focus());
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveFocus();
  });
});

describe("terminal and live events", () => {
  const initial = makeSession({
    events: [
      makeEvent(1, "execution.command.started", { commandId: "c1", command: "npm run build" }),
      makeEvent(2, "execution.command.output", { commandId: "c1", chunk: "building...\n" }),
    ],
  });

  it("shows the commands and output already recorded, read-only", async () => {
    await openDetail(initial);
    const log = screen.getByRole("log");
    expect(within(log).getByText("$ npm run build")).toBeInTheDocument();
    expect(within(log).getByText(/building\.\.\./)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/cannot run commands/)).toBeInTheDocument();
  });

  it("appends live events via long-poll from the cursor and stops when done", async () => {
    const calls = await openDetail(initial, {
      events: [
        eventsBatch([makeEvent(3, "execution.command.output", { commandId: "c1", chunk: "compiled ok\n" })]),
        eventsBatch([makeEvent(4, "execution.command.completed", { commandId: "c1", exitCode: 0, durationMs: 1200, timedOut: false, cancelled: false })], "SUCCEEDED", true),
      ],
    });
    const log = screen.getByRole("log");
    await within(log).findByText(/compiled ok/);
    await within(log).findByText(/exit code 0/);
    await waitFor(() => expect(screen.getByText(/This execution has ended/)).toBeInTheDocument());
    const urls = eventCalls(calls).map((c) => c.url);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("after=2&wait=20000");
    expect(urls[1]).toContain("after=3&wait=20000");
    await new Promise((r) => setTimeout(r, 400));
    expect(eventCalls(calls)).toHaveLength(2);
    expect(screen.getByTestId("status-line")).toHaveTextContent("Execution status: Succeeded");
  });

  it("does not poll a finished session and does not poll on a timer while the long-poll is open", async () => {
    const done = makeSession({ status: "SUCCEEDED" });
    const calls = await openDetail(done);
    await new Promise((r) => setTimeout(r, 300));
    expect(eventCalls(calls)).toHaveLength(0);
    const hanging = stubApi({ session: initial, trees: { "": ROOT_TREE } });
    renderAt("/workspace/ex-1");
    await screen.findAllByRole("heading", { name: "Execution inspector" });
    await new Promise((r) => setTimeout(r, 600));
    expect(eventCalls(hanging)).toHaveLength(1);
    expect(hanging.filter((c) => /\/api\/runtime\/sessions\/ex-1$/.test(c.url))).toHaveLength(1);
  });

  it("shows a reconnecting banner and resumes from the same cursor after an error", async () => {
    const calls = await openDetail(initial, {
      events: [
        () => { throw new TypeError("Failed to fetch"); },
        eventsBatch([makeEvent(3, "execution.command.output", { commandId: "c1", chunk: "resumed output\n" })], "SUCCEEDED", true),
      ],
    });
    expect(await screen.findByText("The live connection dropped. Reconnecting from event 2.")).toBeInTheDocument();
    await within(screen.getByRole("log")).findByText(/resumed output/);
    expect(screen.queryByText(/live connection dropped/)).not.toBeInTheDocument();
    const urls = eventCalls(calls).map((c) => c.url);
    expect(urls[0]).toContain("after=2");
    expect(urls[1]).toContain("after=2");
  });

  it("pauses and resumes autoscroll via a toggle", async () => {
    await openDetail(initial);
    const toggle = screen.getByRole("button", { name: "Pause autoscroll" });
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Resume autoscroll" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders timed-out and cancelled markers and never as HTML", async () => {
    await openDetail(makeSession({
      events: [
        makeEvent(1, "execution.command.started", { commandId: "c1", command: "npm test" }),
        makeEvent(2, "execution.command.output", { commandId: "c1", chunk: "<img src=x onerror=alert(1)>" }),
        makeEvent(3, "execution.command.completed", { commandId: "c1", exitCode: null, durationMs: 5, timedOut: true, cancelled: true }),
      ],
    }));
    const log = screen.getByRole("log");
    expect(within(log).getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(log.querySelector("img")).toBeNull();
    expect(within(log).getByText("[timed out]")).toBeInTheDocument();
    expect(within(log).getByText("[cancelled]")).toBeInTheDocument();
  });
});

describe("controls", () => {
  it("cancels only after confirmation, with exactly one call", async () => {
    const calls = await openDetail(makeSession(), { commands: { runtime_cancel_session: () => json(200, { ok: true }) } });
    await userEvent.click(screen.getByRole("button", { name: "Cancel execution" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/logs are preserved and work that was already completed is not undone/)).toBeInTheDocument();
    expect(commandCalls(calls, "runtime_cancel_session")).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Yes, cancel execution" }));
    await waitFor(() => expect(commandCalls(calls, "runtime_cancel_session")).toHaveLength(1));
    expect(commandCalls(calls, "runtime_cancel_session")[0]?.body).toEqual({ executionId: "ex-1" });
  });

  it("keeps running when the confirmation is declined", async () => {
    const calls = await openDetail(makeSession());
    await userEvent.click(screen.getByRole("button", { name: "Cancel execution" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep running" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(commandCalls(calls, "runtime_cancel_session")).toHaveLength(0);
  });

  it("pauses a running execution", async () => {
    const calls = await openDetail(makeSession(), { commands: { runtime_pause_session: () => json(200, { ok: true }) } });
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(commandCalls(calls, "runtime_pause_session")).toHaveLength(1));
  });

  it("resumes a paused execution", async () => {
    const calls = await openDetail(makeSession({ status: "PAUSED", paused: true }), { commands: { runtime_resume_session: () => json(200, { ok: true }) } });
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(commandCalls(calls, "runtime_resume_session")).toHaveLength(1));
  });

  it("surfaces a rejected command (409 conflict) with its reason", async () => {
    await openDetail(makeSession(), { commands: { runtime_pause_session: () => json(200, { ok: false, errorKind: "invalid_state", reason: "Already finished" }) } });
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Not possible in the current state")).toBeInTheDocument();
    expect(screen.getByText("Already finished")).toBeInTheDocument();
  });

  it("hides every control without the orchestrate_execution capability", async () => {
    await openDetail(makeSession(), {}, { capabilities: ["view"] });
    expect(screen.queryByRole("button", { name: "Cancel execution" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByText("Controls")).not.toBeInTheDocument();
  });

  it("hides controls on a finished execution", async () => {
    await openDetail(makeSession({ status: "FAILED" }));
    expect(screen.queryByRole("button", { name: "Cancel execution" })).not.toBeInTheDocument();
  });
});

describe("error states", () => {
  it.each([
    [401, "You are signed out"],
    [403, "Access denied"],
    [404, "Not found"],
    [400, "Request not accepted"],
    [409, "Not possible in the current state"],
    [500, "The Control Plane is degraded"],
  ])("shows a clear state for HTTP %i and retries", async (status, title) => {
    const calls = stubApi({ sessionStatus: status, sessionBody: { message: "boom", reason: "because" } });
    renderAt("/workspace/ex-1");
    expect(await screen.findByText(title)).toBeInTheDocument();
    const before = calls.filter((c) => /sessions\/ex-1$/.test(c.url)).length;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls.filter((c) => /sessions\/ex-1$/.test(c.url)).length).toBeGreaterThan(before));
  });

  it("shows the reason for an invalid request", async () => {
    stubApi({ sessionStatus: 400, sessionBody: { message: "bad", errorKind: "invalid_request", reason: "executionId is malformed" } });
    renderAt("/workspace/ex-1");
    expect(await screen.findByText("executionId is malformed")).toBeInTheDocument();
  });

  it("shows a network state", async () => {
    stubApi({ networkFailure: true });
    renderAt("/workspace/ex-1");
    expect(await screen.findByText("Cannot reach the Control Plane")).toBeInTheDocument();
  });
});

describe("Dutch", () => {
  it("renders the page in Dutch", async () => {
    stubApi({ sessions: [], overview: { active: 1, queued: 0, waitingApproval: 0, failed: 0, completedToday: 0 } });
    renderAt("/workspace", { language: "nl" });
    expect(await screen.findByText("Nog geen uitvoeringen")).toBeInTheDocument();
    expect(screen.getByText("Actieve uitvoeringen")).toBeInTheDocument();
  });
});
