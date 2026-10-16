import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import { interpretCommand } from "../../../features/commandCenter/commandIntents";
import KnowledgePage from "../KnowledgePage";
import IntegrationsPage from "../../Integrations/IntegrationsPage";
import AgentTeamsPage from "../../AgentTeams/AgentTeamsPage";

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const auth = (capabilities: string[]) =>
  ({
    user: { id: "u" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted",
    accessDetails: { role: "operator", capabilities },
  }) as unknown as AuthContextValue;

function renderPage(node: React.ReactNode, caps = ["view"], path = "/x?project=alpha") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage="en">
        <authContext.Provider value={auth(caps)}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
          </QueryClientProvider>
        </authContext.Provider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("command intents (layer 16)", () => {
  it("routes knowledge search, integrations, teams and failures; still refuses high-impact phrases", () => {
    expect(interpretCommand("find the architecture documentation", [])).toEqual({
      kind: "search_knowledge",
      query: "architecture",
      to: "/knowledge?q=architecture",
    });
    expect(interpretCommand("show integrations", [])).toMatchObject({ intent: "show_integrations" });
    expect(interpretCommand("show the team task board", [])).toMatchObject({ intent: "show_teams" });
    expect(interpretCommand("which workflows failed today?", [])).toMatchObject({ intent: "show_operations" });
    expect(interpretCommand("find and delete old docs", [])).toMatchObject({ kind: "requires_approval" });
  });
});

describe("KnowledgePage (layer 13)", () => {
  it("searches server-side, discloses keyword-only, and saves through an audited command", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === "/api/projects") return respond(200, [{ projectId: "alpha", displayName: "Alpha", status: "active" }]);
        if (url.endsWith("/knowledge")) return respond(200, { items: [] });
        if (url.includes("/knowledge-search")) return respond(200, { mode: "keyword", semantic: false, items: [{ documentId: "kd1", title: "Auth ADR", snippet: "tokens", score: 3 }] });
        if (url.startsWith("/api/commands/")) return respond(200, { ok: true, reason: "saved", details: { version: 1 } });
        return respond(404, {});
      }),
    );
    const user = userEvent.setup();
    renderPage(<KnowledgePage />, ["view", "author_knowledge"], "/knowledge?project=alpha&q=tokens");
    expect(await screen.findByText("Auth ADR")).toBeInTheDocument();
    expect(screen.getByText(/no vector index is configured/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New document" }));
    await user.type(screen.getByLabelText("Title"), "Runbook");
    await user.type(screen.getByLabelText(/^Content/), "Step 1");
    await user.click(screen.getByRole("button", { name: "Save version" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/commands/save-knowledge-document")).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.url === "/api/commands/save-knowledge-document")!.init!.body));
    expect(body).toMatchObject({ projectId: "alpha", title: "Runbook", kind: "note", content: "Step 1" });
  });

  it("is read-only without author_knowledge", async () => {
    vi.stubGlobal("fetch", vi.fn(async (i: RequestInfo | URL) => (String(i) === "/api/projects" ? respond(200, [{ projectId: "alpha", displayName: "A", status: "active" }]) : respond(200, { items: [] }))));
    renderPage(<KnowledgePage />);
    expect(await screen.findByText(/Read-only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New document" })).not.toBeInTheDocument();
  });
});

describe("IntegrationsPage (layer 14)", () => {
  it("never shows 'connected' for something the server has not verified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(200, {
          integrations: [
            { id: "model:openai", category: "ai_provider", name: "openai", registered: true, connection: "unverified" },
            { id: "github", category: "development", name: "github", registered: false, connection: "not_configured" },
          ],
          mcpServers: [],
          webhooks: [],
        }),
      ),
    );
    renderPage(<IntegrationsPage />);
    expect(await screen.findByText("Registered, connection not verified")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByText(/No MCP server registry/)).toBeInTheDocument();
  });
});

describe("AgentTeamsPage (layer 15)", () => {
  it("groups tasks by their real backend status and shows recorded handoffs only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/tasks"))
          return respond(200, {
            items: [
              { taskId: "t1", description: "Build login", projectId: "alpha", status: "running", assignedAgentId: "dev" },
              { taskId: "t2", description: "Review login", projectId: "alpha", status: "failed", failureReason: "tool_failure" },
            ],
          });
        if (url === "/api/workforce/handoffs") return respond(404, { error: { message: "specialist workforce is not composed" } });
        return respond(404, {});
      }),
    );
    renderPage(<AgentTeamsPage />);
    expect(await screen.findByText("Running (1)")).toBeInTheDocument();
    expect(screen.getByText("Failed (1)")).toBeInTheDocument();
    expect(await screen.findByText(/specialist workforce is not composed/i)).toBeInTheDocument();
  });
});
