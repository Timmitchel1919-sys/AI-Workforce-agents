import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import AuditLogPage from "../../AuditLog/AuditLogPage";
import ApprovalsPage from "../ApprovalsPage";

const PLAN_APPROVAL = {
  approvalId: "approval_7",
  status: "requested",
  action: "execution_plan.approve",
  risk: "high",
  requestedBy: "op-1",
  reason: "Execution plan plan_1 v2 requires approval: production_deployment",
  projectId: "alpha",
  executionPlanId: "plan_1@v2",
  planVersion: 2,
  requestedAt: "2026-09-24T10:00:00.000Z",
};
const TASK_APPROVAL = {
  approvalId: "approval_3",
  status: "approved",
  action: "tool:crm.read",
  risk: "low",
  requestedBy: "orchestrator",
  reason: "Tool read",
  projectId: "alpha",
  taskId: "task_9",
  requestedAt: "2026-09-23T10:00:00.000Z",
  decidedBy: "admin-1",
  decidedAt: "2026-09-23T11:00:00.000Z",
};
const AUDIT = [
  {
    id: "audit_2",
    timestamp: "2026-09-24T10:01:00.000Z",
    type: "control_command",
    actor: "admin-1",
    projectId: "alpha",
    correlationId: "corr-1",
    outcome: "executed",
    data: { command: "approve", apiKey: "[redacted]" },
  },
  { id: "audit_1", timestamp: "2026-09-24T09:00:00.000Z", type: "execution_plan_event", projectId: "alpha", data: {} },
];

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(overrides: { approvals?: unknown[]; approvalsStatus?: number; commandStatus?: number } = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "POST") return respond(overrides.commandStatus ?? 200, { ok: true });
      if (url === "/api/projects") return respond(200, [{ projectId: "alpha", displayName: "Alpha Portal", status: "available" }]);
      if (url.startsWith("/api/approvals")) {
        if (overrides.approvalsStatus) return respond(overrides.approvalsStatus, { error: { message: "x" } });
        const items = overrides.approvals ?? [PLAN_APPROVAL, TASK_APPROVAL];
        return respond(200, { items, total: items.length, nextCursor: null });
      }
      if (url.startsWith("/api/audit")) return respond(200, { items: AUDIT, total: 2, nextCursor: null });
      return respond(404, { error: { message: "not found" } });
    }),
  );
  return calls;
}

function authValue(capabilities: readonly string[]): AuthContextValue {
  return {
    user: { id: "admin-1", email: "a@example.test", displayName: "Admin" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted" as AccessState,
    accessDetails: { role: "admin", capabilities },
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendPasswordReset: vi.fn(),
    refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderWith(node: React.ReactNode, capabilities: readonly string[] = ["view", "approve", "reject"], language: Language = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={authValue(capabilities)}>
          <QueryClientProvider client={client}>
            <MemoryRouter>{node}</MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("Approvals", () => {
  it("lists the server-filtered queue with risk, status and the exact plan revision", async () => {
    const calls = mockApi();
    renderWith(<ApprovalsPage />);

    const card = (await screen.findByText("execution_plan.approve")).closest("li") as HTMLElement;
    expect(within(card).getByText("High risk")).toBeInTheDocument();
    expect(within(card).getByText("Pending")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Execution plan · version 2" })).toHaveAttribute(
      "href",
      "/projects/alpha/execution-plan?plan=plan_1&version=2",
    );
    expect(within(card).getByText("Project: Alpha Portal")).toBeInTheDocument();
    // Decided approvals offer no actions.
    const decided = screen.getByText("tool:crm.read").closest("li") as HTMLElement;
    expect(within(decided).queryByRole("button")).toBeNull();
    expect(within(decided).getByRole("link", { name: "Task task_9" })).toBeInTheDocument();
    // Default filter: pending, server-side.
    expect(calls.find((c) => c.url.startsWith("/api/approvals"))?.url).toContain("status=requested");
  });

  it("approving a plan approval states the version and sends only the approval id", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderWith(<ApprovalsPage />);

    await user.click(await screen.findByRole("button", { name: /Approve/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/decides version 2 of the execution plan only/)).toBeInTheDocument();
    expect(within(dialog).getByText(/High-risk action/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Decision recorded.")).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/commands/approve");
    expect(post?.body).toEqual({ approvalId: "approval_7" });
  });

  it("rejecting requires a reason; a 409 (already decided / superseded) is reported", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ commandStatus: 409 });
    renderWith(<ApprovalsPage />);

    await user.click(await screen.findByRole("button", { name: /Reject/ }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason"), "Not now");
    await user.click(confirm);

    expect(await screen.findByText(/already decided, expired or superseded/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ approvalId: "approval_7", reason: "Not now" });
  });

  it("viewers see the queue but no decision controls", async () => {
    mockApi();
    renderWith(<ApprovalsPage />, ["view"]);
    expect(await screen.findByText("execution_plan.approve")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve|Reject/ })).toBeNull();
  });

  it.each([
    [403, "Access denied"],
    [401, "Sign-in required"],
    [500, "Unable to load approvals"],
  ])("distinguishes HTTP %s from an empty queue", async (status, title) => {
    mockApi({ approvalsStatus: status });
    renderWith(<ApprovalsPage />);
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByText("No approvals")).toBeNull();
  });

  it("shows an honest empty state", async () => {
    mockApi({ approvals: [] });
    renderWith(<ApprovalsPage />);
    expect(await screen.findByText("Nothing is waiting for a decision.")).toBeInTheDocument();
  });

  it("works in Dutch and the dark theme", async () => {
    window.localStorage.setItem("ai-workforce-theme", "dark");
    mockApi();
    renderWith(<ApprovalsPage />, ["view", "approve", "reject"], "nl");
    expect(await screen.findByRole("heading", { name: "Goedkeuringen" })).toBeInTheDocument();
    expect(await screen.findByText("Hoog risico")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Goedkeuren/ })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.body.textContent).not.toMatch(/\bapprovalQueue\.[a-zA-Z]+/);
  });
});

describe("Audit log", () => {
  it("renders redacted events with context and sends filters to the server", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderWith(<AuditLogPage />);

    expect(await screen.findByText("by admin-1")).toBeInTheDocument();
    expect(screen.getByText(/Alpha Portal · corr-1/)).toBeInTheDocument();
    await user.click(screen.getAllByText("Details")[0]!);
    expect(screen.getByText(/"apiKey": "\[redacted\]"/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Event type"), "execution_plan_event");
    await user.type(screen.getByLabelText("Correlation ID"), "corr-1");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.includes("type=execution_plan_event") && c.url.includes("correlationId=corr-1"))).toBe(true),
    );
    for (const call of calls) expect(call.url).toMatch(/^\/api\//);
  });

  it("works in Dutch and the light theme", async () => {
    window.localStorage.setItem("ai-workforce-theme", "light");
    mockApi();
    renderWith(<AuditLogPage />, ["view"], "nl");
    expect(await screen.findByRole("heading", { name: "Auditlog" })).toBeInTheDocument();
    expect(await screen.findByText("door admin-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters toepassen" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.body.textContent).not.toMatch(/\bauditLog\.[a-zA-Z]+/);
  });
});
