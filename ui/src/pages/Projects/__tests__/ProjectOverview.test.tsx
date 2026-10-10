import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AccessState, AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider, type Language } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import ProjectDetailPage from "../ProjectDetailPage";
import ProjectsPage from "../ProjectsPage";
import { safeRepositoryLink } from "../repositoryLink";

const BASE = { projectId: "ai-workforce", displayName: "AI Workforce", status: "available", adapterStatus: "healthy", capabilities: [], connectedAgents: [], activeWorkflows: 0 };

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function authValue(): AuthContextValue {
  return {
    user: { id: "u1", email: "op@example.test", displayName: "Op" },
    loading: false,
    accessToken: "token",
    configured: true,
    access: "granted" as AccessState,
    accessDetails: { role: "viewer", capabilities: ["view"] },
    signIn: vi.fn(),
    signUp: vi.fn(),
    sendPasswordReset: vi.fn(),
    refreshAccess: vi.fn(),
    getPasswordPolicy: vi.fn(),
    signOut: vi.fn(),
  };
}

function mock(handler: (url: string) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => handler(String(input))));
}

function renderAt(path: string, language: Language = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <I18nProvider initialLanguage={language}>
        <authContext.Provider value={authValue()}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
              </Routes>
            </MemoryRouter>
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
});

describe("safeRepositoryLink", () => {
  it("accepts plain https and derives host/path text", () => {
    expect(safeRepositoryLink({ url: "https://github.com/acme/repo/", defaultBranch: "main" })).toEqual({
      href: "https://github.com/acme/repo/",
      text: "github.com/acme/repo",
      defaultBranch: "main",
    });
  });

  it.each([
    ["http scheme", "http://github.com/acme/repo"],
    ["javascript scheme", "javascript:alert(1)"],
    ["user:pass", "https://user:secret@github.com/acme/repo"],
    ["token only", "https://ghp_abcdef@github.com/acme/repo"],
    ["ssh", "git@github.com:acme/repo.git"],
    ["garbage", "https://"],
    ["port", "https://github.com:8443/acme/repo"],
    ["query", "https://github.com/acme/repo?token=abc"],
    ["fragment", "https://github.com/acme/repo#x"],
    ["localhost", "https://localhost/acme/repo"],
  ])("rejects %s", (_name, url) => {
    expect(safeRepositoryLink({ url, defaultBranch: "main" })).toBeNull();
  });

  it("rejects a missing or empty branch and absent repositories", () => {
    expect(safeRepositoryLink({ url: "https://github.com/a/b", defaultBranch: " " })).toBeNull();
    expect(safeRepositoryLink(undefined)).toBeNull();
    expect(safeRepositoryLink({ url: 5, defaultBranch: "main" })).toBeNull();
  });
});

describe("Project detail overview", () => {
  it("shows the repository as an external link and the Spatial Graph link", async () => {
    mock(() => respond(200, { ...BASE, repository: { url: "https://github.com/acme/ai-workforce", defaultBranch: "main" } }));
    renderAt("/projects/ai-workforce");
    const repo = await screen.findByRole("link", { name: /github\.com\/acme\/ai-workforce/ });
    expect(repo).toHaveAttribute("href", "https://github.com/acme/ai-workforce");
    expect(repo).toHaveAttribute("target", "_blank");
    expect(repo).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("main")).toBeInTheDocument();
    const graph = screen.getByRole("link", { name: "Open in Spatial Graph" });
    expect(graph).toHaveAttribute("href", "/graph?project=ai-workforce");
  });

  it("encodes the project id in the graph link", async () => {
    mock(() => respond(200, { ...BASE, projectId: "a b&c" }));
    renderAt("/projects/a%20b%26c");
    expect(await screen.findByRole("link", { name: "Open in Spatial Graph" })).toHaveAttribute("href", "/graph?project=a%20b%26c");
  });

  it("omits the repository entirely when absent (no placeholder)", async () => {
    mock(() => respond(200, BASE));
    renderAt("/projects/ai-workforce");
    await screen.findByRole("link", { name: "Open in Spatial Graph" });
    expect(screen.queryByText(/Repository/)).not.toBeInTheDocument();
    expect(screen.queryByText(/default branch/)).not.toBeInTheDocument();
  });

  it("does not render a credentialed or non-https repository as a link", async () => {
    mock(() => respond(200, { ...BASE, repository: { url: "https://bot:hunter2@github.com/acme/x", defaultBranch: "main" } }));
    const { unmount } = renderAt("/projects/ai-workforce");
    await screen.findByRole("link", { name: "Open in Spatial Graph" });
    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="hunter2"]')).toBeNull();
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
    unmount();
    mock(() => respond(200, { ...BASE, repository: { url: "http://github.com/acme/x", defaultBranch: "main" } }));
    renderAt("/projects/ai-workforce");
    await screen.findByRole("link", { name: "Open in Spatial Graph" });
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
  });

  it("shows honest zero counts and an empty capabilities note for an empty project, in Dutch too", async () => {
    mock(() => respond(200, BASE));
    renderAt("/projects/ai-workforce", "nl");
    expect(await screen.findByRole("link", { name: "Openen in Ruimtelijke graaf" })).toBeInTheDocument();
    const metrics = document.querySelector(".plan-metrics") as HTMLElement;
    expect(within(metrics).getAllByText("0")).toHaveLength(2); // real values: 0 agents, 0 workflows
    expect(document.querySelector(".plan-muted")).not.toBeNull();
  });

  it("keeps forbidden, not-found and error apart", async () => {
    mock(() => respond(403, { error: { message: "no" } }));
    const a = renderAt("/projects/x");
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    a.unmount();
    mock(() => respond(404, { error: { message: "no" } }));
    const b = renderAt("/projects/x");
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
    b.unmount();
    mock(() => respond(500, { error: { message: "boom" } }));
    renderAt("/projects/x");
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Access denied")).not.toBeInTheDocument();
  });
});

describe("Projects list", () => {
  it("lists both real projects, links to details", async () => {
    mock(() =>
      respond(200, [
        { projectId: "ai-workforce", displayName: "AI Workforce", status: "available" },
        { projectId: "money-mind", displayName: "Money Mind", status: "available" },
      ]),
    );
    renderAt("/projects");
    const links = await screen.findAllByRole("link", { name: /Open project|AI Workforce|Money Mind/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/projects/ai-workforce", "/projects/money-mind"]);
  });

  it("403 is access denied, not an empty list; an empty list is empty; 500 is an error with retry", async () => {
    mock(() => respond(403, { error: { message: "no" } }));
    const a = renderAt("/projects");
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText(/no projects/i)).not.toBeInTheDocument();
    a.unmount();
    mock(() => respond(200, []));
    const b = renderAt("/projects");
    expect(await screen.findByText(/no projects/i)).toBeInTheDocument();
    b.unmount();
    mock(() => respond(500, { error: { message: "boom" } }));
    renderAt("/projects");
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
