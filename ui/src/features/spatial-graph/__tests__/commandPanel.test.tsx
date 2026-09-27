import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/SpatialGraphView", () => ({
  SpatialGraphView: (props: SpatialGraphViewProps) => {
    viewHarness.props = props;
    return <div data-testid="mock-canvas" />;
  },
}));

// Only the HTTP layer is replaced; the real client, hook, panel and dialog run.
type Reply = () => Promise<unknown>;
const requests: { path: string; body: Record<string, unknown>; headers: Record<string, string>; token: unknown }[] = [];
let reply: Reply = () => Promise.resolve({});
vi.mock("../../../api/client", () => ({
  apiRequest: (path: string, init: { body?: string; headers?: Record<string, string>; accessToken?: unknown }) => {
    requests.push({ path, body: init.body ? JSON.parse(init.body) : {}, headers: init.headers ?? {}, token: init.accessToken });
    return reply();
  },
}));

import { ApiError } from "../../../api/errors";
import { authContext } from "../../../auth/authContext";
import type { AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider } from "../../../i18n";
import { SpatialGraphWorkspace } from "../components/SpatialGraphWorkspace";
import type { SpatialGraphViewProps } from "../components/SpatialGraphView";
import { useNodeCommand } from "../hooks/useNodeCommand";
import { actionsFor } from "../lib/nodeActions";
import { edge, makeProjection, node, viewHarness } from "./fixtures";

const executed = (over: Record<string, unknown> = {}) => ({ command: "cancel_task", outcome: "executed", ok: true, reason: "task cancelled", correlationId: "c", details: {}, auditEventId: "e1", timestamp: "t", ...over });
const rejected = (status: number, errorKind: string, reason: string) => () => Promise.reject(new ApiError("generic", { status, errorKind, reason }));
const deferred = () => {
  let resolve!: (v: unknown) => void;
  const promise = new Promise<unknown>((r) => (resolve = r));
  return { promise, resolve };
};

const auth = (capabilities: string[] | undefined): AuthContextValue =>
  ({ accessToken: "tok", accessDetails: { role: "operator", capabilities: capabilities ?? [] } }) as unknown as AuthContextValue;
const OPERATOR = ["view", "cancel_task", "retry_task", "cancel_execution", "approve", "reject"];

const graph = () =>
  makeProjection({
    nodes: [
      node("project-p1", "PROJECT", "Apollo"),
      node("task-t1", "TASK", "Write API", "running"),
      node("task-t9", "TASK", "Broken job", "failed"),
      node("task-t3", "TASK", "Docs", "completed"),
      node("session-s1", "EXECUTION_SESSION", "Session build", "running", undefined, "running"),
      node("approval-a1", "APPROVAL", "Approval", "awaiting_approval", undefined, "requested"),
      node("deployment-d1", "DEPLOYMENT", "Deployment hosting", "deployed"),
    ],
    edges: [],
  });

function mount(caps: string[] | undefined = OPERATOR, onRefresh = vi.fn(), initial?: ReturnType<typeof graph>) {
  const tree = (g: ReturnType<typeof graph>) => (
    <MemoryRouter>
      <authContext.Provider value={auth(caps)}>
        <I18nProvider initialLanguage="en">
          <SpatialGraphWorkspace graph={g} mode="WORKFORCE" live={{ status: "live", lastConfirmedAt: null, transitions: [], onRefresh }} />
        </I18nProvider>
      </authContext.Provider>
    </MemoryRouter>
  );
  const view = render(tree(initial ?? graph()));
  /** A live refresh delivers a new projection (e.g. the selected node is gone). */
  const refreshTo = (g: ReturnType<typeof graph>) => view.rerender(tree(g));
  return { ...view, onRefresh, refreshTo };
}
const without = (id: string) => {
  const g = graph();
  return { ...g, nodes: g.nodes.filter((n) => n.id !== id) };
};
const select = async (label: RegExp) => {
  await userEvent.click(screen.getByRole("button", { name: label }));
  return screen.getByRole("region", { name: "Node inspector" });
};

beforeEach(() => {
  requests.length = 0;
  reply = () => Promise.resolve(executed());
});

describe("authorization is the server's; the UI only hints", () => {
  it("a viewer (no command capabilities) sees no state-changing action", async () => {
    mount(["view"]);
    const inspector = await select(/Task: Write API/i);
    expect(within(inspector).queryByRole("button", { name: /Cancel task/i })).toBeNull();
    expect(within(inspector).queryByText("Change state")).toBeNull();
  });

  it("an operator sees only actions that apply to the node's state", async () => {
    mount();
    let inspector = await select(/Task: Write API/i);
    expect(within(inspector).getByRole("button", { name: "Cancel task…" })).toBeInTheDocument();
    expect(within(inspector).queryByRole("button", { name: /Retry/i })).toBeNull();
    inspector = await select(/Task: Broken job/i);
    expect(within(inspector).getByRole("button", { name: "Retry task…" })).toBeInTheDocument();
    inspector = await select(/Task: Docs/i);
    expect(within(inspector).queryByRole("button", { name: /task…/i })).toBeNull(); // finished: nothing
    inspector = await select(/Deployment: Deployment hosting/i);
    expect(within(inspector).queryByText("Change state")).toBeNull(); // inspect-only type
  });

  it("selecting or opening a node never sends a request", async () => {
    mount();
    await select(/Task: Write API/i);
    expect(requests).toHaveLength(0);
  });

  it("read-only inspection is separate from state-changing actions, and approvals link to the Approvals module", async () => {
    mount();
    const inspector = await select(/Approval: Approval/i);
    expect(within(inspector).getByText("Inspect (read-only)")).toBeInTheDocument();
    expect(within(inspector).getByRole("link", { name: "Open Approvals" })).toHaveAttribute("href", "/approvals");
    expect(within(inspector).getByText("Change state")).toBeInTheDocument();
  });
});

describe("confirmation is explicit and cancellable", () => {
  it("opens a modal confirmation with focus on the SAFE choice, and sends nothing yet", async () => {
    mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { name: "Cancel this task?" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep as is" })).toHaveFocus();
    expect(requests).toHaveLength(0);
  });

  it("'Keep as is' and Escape cancel without sending anything, and focus returns to the trigger", async () => {
    mount();
    const inspector = await select(/Task: Write API/i);
    const trigger = within(inspector).getByRole("button", { name: "Cancel task…" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "Keep as is" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("traps Tab inside the dialog (keyboard-only operation)", async () => {
    mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    const dialog = screen.getByRole("alertdialog");
    const inside = (el: Element | null) => !!el && dialog.contains(el);
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      expect(inside(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab({ shift: true });
      expect(inside(document.activeElement)).toBe(true);
    }
  });

  it("a required reason must be typed before the destructive confirm is enabled, and is sent", async () => {
    mount();
    const inspector = await select(/Session: Session build/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel execution…" }));
    const confirm = screen.getByRole("button", { name: "Cancel execution" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: /Reason \(required\)/ }), "runaway build");
    expect(confirm).toBeEnabled();
    reply = () => Promise.resolve(executed({ command: "cancel_execution", details: { outcome: "cancelling" }, reason: "execution cancelling" }));
    await userEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId("sg-command-result")).toBeInTheDocument());
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe("/api/commands/cancel-execution");
    expect(requests[0].body).toEqual({ sessionId: "s1", reason: "runaway build" });
  });

  it("sends the DOMAIN id, the token, and a spatial-tagged correlation id", async () => {
    mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ path: "/api/commands/cancel-task", body: { taskId: "t1" }, token: "tok" });
    expect(requests[0].headers["x-correlation-id"]).toMatch(/^sg-/);
  });
});

describe("no optimistic success; results are authoritative", () => {
  it("shows Requesting… (never success) while in flight, blocks duplicates, then reports the server's result and refreshes", async () => {
    const d = deferred();
    reply = () => d.promise;
    const { onRefresh } = mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    const confirm = screen.getByRole("button", { name: "Cancel task" });
    await userEvent.dblClick(confirm); // double click
    await userEvent.click(confirm);
    expect(screen.getByTestId("sg-command-requesting")).toHaveTextContent("Requesting…");
    expect(screen.queryByTestId("sg-command-result")).toBeNull();
    expect(requests).toHaveLength(1); // one click = one request
    expect(onRefresh).not.toHaveBeenCalled();
    // While in flight the dialog cannot be dismissed either.
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await act(async () => d.resolve(executed()));
    await waitFor(() => expect(screen.getByTestId("sg-command-result")).toHaveAttribute("data-outcome", "ok"));
    expect(screen.getByTestId("sg-command-result")).toHaveTextContent("Done: task cancelled");
    expect(onRefresh).toHaveBeenCalledTimes(1); // re-read authoritative state
    // The node still shows its LAST CONFIRMED state: the graph is never changed optimistically.
    expect(viewHarness.props.nodes.find((n) => n.id === "task-t1")?.state).toBe("running");
    // The result also names the reference for the audit trail.
    expect(screen.getByTestId("sg-command-result")).toHaveTextContent(/Reference: sg-/);
  });

  it("a cancel of a running session says it is requested, NOT finished", async () => {
    reply = () => Promise.resolve(executed({ command: "cancel_execution", details: { outcome: "cancelling" }, reason: "execution cancelling" }));
    mount();
    const inspector = await select(/Session: Session build/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel execution…" }));
    await userEvent.type(screen.getByRole("textbox"), "stop");
    await userEvent.click(screen.getByRole("button", { name: "Cancel execution" }));
    await waitFor(() => expect(screen.getByTestId("sg-command-result")).toBeInTheDocument());
    expect(screen.getByTestId("sg-command-result")).toHaveTextContent(/Requested:.*not finished/);
    expect(screen.getByTestId("sg-command-result")).not.toHaveTextContent(/^Done/);
  });

  it.each([
    [403, "forbidden", "Not authorized", "role viewer may not cancel task"],
    [409, "invalid_state", "Not possible in the current state", "task is already completed"],
    [404, "not_found", "Target not found or no longer current", "unknown task"],
    [400, "invalid_request", "Invalid request", "reason is required"],
    [422, "approval_failure", "Approval could not be recorded", "could not record the decision"],
    [500, "command_failure", "The command failed", "internal"],
  ])("HTTP %i %s is reported as '%s' with the server's reason, and the graph is re-read", async (status, errorKind, title, why) => {
    reply = rejected(status, errorKind, why);
    const { onRefresh } = mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    await waitFor(() => expect(screen.getByTestId("sg-command-result")).toBeInTheDocument());
    const result = screen.getByTestId("sg-command-result");
    expect(result).toHaveTextContent(title);
    expect(result).toHaveTextContent(why);
    expect(result).not.toHaveTextContent(/^Done/);
    expect(onRefresh).toHaveBeenCalledTimes(1); // e.g. a stale target is corrected by the re-read
  });

  it("a timeout says the outcome is UNKNOWN and warns to check before retrying (no auto-retry)", async () => {
    reply = () => Promise.reject(new ApiError("The request timed out.", { code: "timeout" }));
    mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    await waitFor(() => expect(screen.getByTestId("sg-command-result")).toHaveAttribute("data-outcome", "unknown_outcome"));
    expect(screen.getByTestId("sg-command-result")).toHaveTextContent(/Check the graph or the audit log/);
    await new Promise((r) => setTimeout(r, 50));
    expect(requests).toHaveLength(1);
  });

  it("approve is a distinct, non-destructive confirmation; reject needs a reason", async () => {
    mount();
    const inspector = await select(/Approval: Approval/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Reject…" }));
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Keep as is" }));
    await userEvent.click(within(inspector).getByRole("button", { name: "Approve…" }));
    expect(screen.getByRole("heading", { name: "Approve this request?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ path: "/api/commands/approve", body: { approvalId: "a1" } });
  });
});

describe("project switch safety + Focus Mode", () => {
  it("useNodeCommand: a pending confirmation or late reply from project A never reaches project B", async () => {
    const d = deferred();
    reply = () => d.promise;
    const settled = vi.fn();
    const [action] = actionsFor(node("task-t1", "TASK", "T", "running"), OPERATOR);
    const { result, rerender } = renderHook(({ p }) => useNodeCommand(p, "tok", settled), { initialProps: { p: "A" } });
    act(() => result.current.begin(action, "T"));
    expect(result.current.state.phase).toBe("confirming");
    rerender({ p: "B" });
    expect(result.current.state.phase).toBe("idle"); // A's confirmation is invisible in B
    rerender({ p: "A" });
    act(() => result.current.begin(action, "T"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.confirm("");
    });
    rerender({ p: "B" });
    await act(async () => {
      d.resolve(executed());
      await pending;
    });
    expect(result.current.state.phase).toBe("idle");
    expect(settled).not.toHaveBeenCalled(); // the late reply is dropped
  });

  it("useNodeCommand: two confirm() calls in the same tick (repeated Enter / retry) send ONE request", async () => {
    const d = deferred();
    reply = () => d.promise;
    const [action] = actionsFor(node("task-t1", "TASK", "T", "running"), OPERATOR);
    const { result } = renderHook(() => useNodeCommand("A", "tok"));
    act(() => result.current.begin(action, "T"));
    const confirm = result.current.confirm; // the same (stale) closure a double-fired handler holds
    let both!: Promise<unknown>;
    act(() => {
      both = Promise.all([confirm(""), confirm("")]);
    });
    expect(requests).toHaveLength(1);
    await act(async () => {
      d.resolve(executed());
      await both;
    });
    expect(requests).toHaveLength(1);
  });

  it("useNodeCommand: a second, different command cannot start while one is in flight", async () => {
    const d = deferred();
    reply = () => d.promise;
    const [cancel, retry] = actionsFor(node("task-t9", "TASK", "T", "failed"), OPERATOR);
    const { result } = renderHook(() => useNodeCommand("A", "tok"));
    act(() => result.current.begin(cancel, "T"));
    let p!: Promise<void>;
    act(() => {
      p = result.current.confirm("");
    });
    act(() => result.current.begin(retry, "T")); // ignored: something is already in flight
    expect(result.current.state.phase).toBe("requesting");
    await act(async () => {
      d.resolve(executed());
      await p;
    });
    expect(requests).toHaveLength(1);
  });

  it("the dialog lives INSIDE the workspace, is not inert in Focus Mode, and Escape closes it without exiting Focus Mode", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Focus Mode" }));
    expect(screen.getByRole("button", { name: "Exit Focus Mode" })).toBeInTheDocument();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.closest("[inert]")).toBeNull(); // Focus Mode must not hide a confirmation
    expect(dialog.closest(".sg-canvas-frame")).toBeNull(); // never over the 3D canvas
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Exit Focus Mode" })).toBeInTheDocument(); // still in Focus Mode
  });

  it("command controls live in the inspector, not over the 3D canvas", async () => {
    mount();
    const inspector = await select(/Task: Write API/i);
    const button = within(inspector).getByRole("button", { name: "Cancel task…" });
    expect(button.closest(".sg-canvas-frame")).toBeNull();
    expect(button.closest("aside,section")).toBe(inspector.querySelector(".sg-cmd") ?? button.closest("section"));
  });
});

describe("review findings: containment, persistence, focus", () => {
  it("F1: the confirmation is a child of the WORKSPACE root, outside the inspector panel/drawer that would clip it", async () => {
    mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    const overlay = screen.getByTestId("sg-command-dialog");
    // .sg-panel has backdrop-filter and .sg-drawer/.sg-side have overflow: any of them as an
    // ancestor would confine and clip a `position: fixed` overlay in a real browser.
    for (const cls of [".sg-panel", ".sg-drawer", ".sg-side", ".sg-stage", ".sg-layout", ".sg-canvas-frame"]) {
      expect(overlay.closest(cls), cls).toBeNull();
    }
    expect(overlay.parentElement).toBe(screen.getByRole("region", { name: "Spatial graph explorer" }));
  });

  it("F2: a request in flight survives the inspector closing, and its result is still shown", async () => {
    const d = deferred();
    reply = () => d.promise;
    const { onRefresh } = mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    expect(screen.getByTestId("sg-command-requesting")).toBeInTheDocument();
    // The operator deselects (closes the inspector) while the request is in flight.
    await userEvent.click(within(inspector).getByRole("button", { name: "Close inspector" }));
    expect(screen.queryByRole("region", { name: "Node inspector" })).toBeNull();
    expect(screen.getByTestId("sg-command-requesting")).toBeInTheDocument(); // still there
    await act(async () => d.resolve(executed()));
    await waitFor(() => expect(screen.getByTestId("sg-command-result")).toHaveTextContent("Done: task cancelled"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("F2: the node vanishing from a live refresh mid-request does not lose the result", async () => {
    const d = deferred();
    reply = () => d.promise;
    const { refreshTo } = mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    act(() => refreshTo(without("task-t1")));
    expect(screen.queryByRole("region", { name: "Node inspector" })?.textContent ?? "").not.toMatch(/Write API/);
    await act(async () => d.resolve(executed()));
    await waitFor(() => expect(screen.getByTestId("sg-command-result")).toBeInTheDocument());
  });

  it("F2: an open confirmation keeps its own target when the node disappears, and still acts on THAT target", async () => {
    const { refreshTo } = mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    act(() => refreshTo(without("task-t1")));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Write API");
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({ taskId: "t1" }); // exactly what the operator confirmed
  });

  it("F3: focus stays INSIDE the dialog while requesting; Tab and Escape cannot leave or exit Focus Mode", async () => {
    const d = deferred();
    reply = () => d.promise;
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Focus Mode" }));
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    const dialog = screen.getByRole("alertdialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true)); // not <body>
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit Focus Mode" })).toBeInTheDocument();
    await act(async () => d.resolve(executed()));
  });

  it("F3: closing a result whose opener is gone restores focus to the workspace, never <body>", async () => {
    const { refreshTo } = mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    await waitFor(() => expect(screen.getByTestId("sg-command-result")).toBeInTheDocument());
    act(() => refreshTo(without("task-t1"))); // the opener button is gone with the node
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Spatial graph explorer" }));
  });

  it("F3: an opener that never took focus (body) is not treated as an opener: focus goes to the workspace", async () => {
    mount();
    const inspector = await select(/Task: Write API/i);
    (document.activeElement as HTMLElement | null)?.blur();
    // Activated programmatically, so the trigger button does not take focus (activeElement stays <body>).
    act(() => within(inspector).getByRole("button", { name: "Cancel task…" }).click());
    expect(document.activeElement).not.toBe(document.body); // dialog took focus
    await userEvent.click(screen.getByRole("button", { name: "Keep as is" }));
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Spatial graph explorer" }));
  });

  it("clicking the dimmed backdrop keeps focus inside the dialog (Tab/Escape cannot reach the page behind)", async () => {
    mount();
    const inspector = await select(/Task: Write API/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel task…" }));
    const dialog = screen.getByRole("alertdialog");
    await userEvent.click(screen.getByTestId("sg-command-dialog")); // the backdrop, not the dialog
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("F5: a late reply from project A cannot clear the in-flight guard of project B's request", async () => {
    const dA = deferred();
    const dB = deferred();
    const replies = [dA.promise, dB.promise];
    reply = () => replies.shift()!;
    const [action] = actionsFor(node("task-t1", "TASK", "T", "running"), OPERATOR);
    const { result, rerender } = renderHook(({ p }) => useNodeCommand(p, "tok"), { initialProps: { p: "A" } });
    act(() => result.current.begin(action, "T"));
    let pa!: Promise<void>;
    act(() => { pa = result.current.confirm(""); });
    rerender({ p: "B" });
    act(() => result.current.begin(action, "T"));
    let pb!: Promise<void>;
    act(() => { pb = result.current.confirm(""); });
    expect(requests).toHaveLength(2);
    await act(async () => { dA.resolve(executed()); await pa; }); // A's late reply
    act(() => result.current.begin(action, "T")); // B is still in flight: must be ignored
    expect(result.current.state.phase).toBe("requesting");
    await act(async () => { dB.resolve(executed()); await pb; });
    expect(result.current.state.phase).toBe("done");
    expect(requests).toHaveLength(2);
  });

  it("F6: a recorded approval whose follow-up failed is NOT presented as plain success", async () => {
    reply = () => Promise.resolve(executed({ command: "approve", reason: "approval approved", details: { taskResumeError: "boom" } }));
    mount();
    const inspector = await select(/Approval: Approval/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Approve…" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByTestId("sg-command-followup")).toBeInTheDocument());
    expect(screen.getByTestId("sg-command-followup")).toHaveTextContent(/follow-up step did not complete \(task resume\)/);
  });

  it("an 'already terminal' cancel says No change, not Done", async () => {
    reply = () => Promise.resolve(executed({ command: "cancel_execution", reason: "execution already terminal", details: { outcome: "already_terminal" } }));
    mount();
    const inspector = await select(/Session: Session build/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Cancel execution…" }));
    await userEvent.type(screen.getByRole("textbox"), "stop");
    await userEvent.click(screen.getByRole("button", { name: "Cancel execution" }));
    await waitFor(() => expect(screen.getByTestId("sg-command-result")).toBeInTheDocument());
    expect(screen.getByTestId("sg-command-result")).toHaveTextContent("No change: execution already terminal");
    expect(screen.getByTestId("sg-command-result")).not.toHaveTextContent(/^Done/);
  });
});

describe("MAJ-3: a decision names what it decides", () => {
  const withSubject = () =>
    makeProjection({
      nodes: [
        node("project-p1", "PROJECT", "Apollo"),
        node("commit-k1", "COMMIT", "Commit abcdef1", "completed"),
        node("deployment-d1", "DEPLOYMENT", "Deployment production", "queued"),
        node("approval-a1", "APPROVAL", "Approval: commit", "awaiting_approval", undefined, "requested"),
        node("approval-a2", "APPROVAL", "Approval: deployment", "awaiting_approval", undefined, "requested"),
      ],
      edges: [edge("commit-k1", "approval-a1", "REQUIRES_APPROVAL"), edge("deployment-d1", "approval-a2", "REQUIRES_APPROVAL")],
    });

  it("the confirmation names the approval's action AND the subject it gates, so a commit and a deployment approval are distinguishable", async () => {
    mount(OPERATOR, vi.fn(), withSubject());
    let inspector = await select(/Approval: Approval: commit/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Approve…" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Approval: commit → Commit abcdef1");
    await userEvent.click(screen.getByRole("button", { name: "Keep as is" }));
    inspector = await select(/Approval: Approval: deployment/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Reject…" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Approval: deployment → Deployment production");
  });

  it("an approval with no known subject still shows its action", async () => {
    const g = makeProjection({ nodes: [node("project-p1", "PROJECT", "Apollo"), node("approval-a3", "APPROVAL", "Approval: tool:x:read", "awaiting_approval", undefined, "requested")], edges: [] });
    mount(OPERATOR, vi.fn(), g);
    const inspector = await select(/Approval: Approval: tool:x:read/i);
    await userEvent.click(within(inspector).getByRole("button", { name: "Approve…" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Approval: tool:x:read");
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("→");
  });
});
