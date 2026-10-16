import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import OperationsPage from "../OperationsPage";
import SecurityCenterPage from "../../SecurityCenter/SecurityCenterPage";

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const auth = (role: string) =>
  ({
    user: { id: "u", email: "u@example.test" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted",
    accessDetails: { role, capabilities: ["view"] },
    signOut: vi.fn(),
  }) as unknown as AuthContextValue;

function renderPage(node: React.ReactNode, role = "admin") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage="en">
        <authContext.Provider value={auth(role)}>
          <QueryClientProvider client={client}>
            <MemoryRouter>{node}</MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("OperationsPage", () => {
  it("renders server health and shows unknown (not 0) for counts the server omits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/dashboard")
          return respond(200, {
            generatedAt: "2026-10-16T10:00:00.000Z",
            status: { counts: { runningTasks: 2 } },
            health: { status: "unknown", components: [{ name: "model-provider", status: "unknown", detail: "no live probe" }] },
            agents: [],
            approvals: [{ approvalId: "a", status: "pending" }],
            recentAudit: [{ id: "e1", timestamp: "2026-10-16T10:00:00.000Z", type: "control_command", outcome: "denied", data: {} }],
          });
        if (url === "/api/execution/environments") return respond(200, { configured: true, families: [] });
        if (url.startsWith("/api/audit")) return respond(200, { items: [], total: 0, nextCursor: null });
        return respond(404, {});
      }),
    );
    renderPage(<OperationsPage />);
    expect(await screen.findByText("model-provider")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(1);
    expect(screen.getByText("1 pending")).toBeInTheDocument();
    expect(screen.getByText(/needs a registered cloud runner/i)).toBeInTheDocument();
    expect(screen.getByText(/denied/)).toBeInTheDocument();
  });

  it("shows a permission message on 403 instead of empty data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(403, { error: { message: "forbidden" } })));
    renderPage(<OperationsPage />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});

describe("SecurityCenterPage lockdown", () => {
  it("activates through the server and never claims a 'secure' state", async () => {
    let active = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/platform/lockdown" && (init?.method ?? "GET") === "POST") {
        active = true;
        return respond(200, { active: true, revision: 1 });
      }
      if (url === "/api/platform/lockdown")
        return respond(200, active ? { active: true, reason: "lost phone", activatedBy: "u", activatedAt: "2026-10-16T10:00:00.000Z", revision: 1 } : { active: false, revision: 0 });
      return respond(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPage(<SecurityCenterPage />);
    expect(await screen.findByText("Not active.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason"), "lost phone");
    await user.click(screen.getByRole("button", { name: "Activate lockdown" }));
    expect(await screen.findByText(/LOCKDOWN ACTIVE/)).toBeInTheDocument();
    expect(screen.getByText(/recovery readiness is UNKNOWN/i)).toBeInTheDocument();
  });

  it("hides lockdown controls from non-administrators", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { active: false, revision: 0 })));
    renderPage(<SecurityCenterPage />, "viewer");
    expect(await screen.findByText("Not active.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate lockdown" })).not.toBeInTheDocument();
  });
});
