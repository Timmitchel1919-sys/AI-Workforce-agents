/**
 * Regression for the first real production run: the graph client requested
 * /projects/:id/graph (no /api prefix, no token). Hosting's SPA rewrite answered with
 * index.html and a 200, the client handed that HTML string to the page as the "graph", and
 * the renderer crashed with "Cannot read properties of undefined (reading 'some')".
 *
 * This uses the REAL client + hook + apiRequest with only fetch faked at the network edge.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ accessToken: "tok-abc" }) }));
vi.mock("../../../features/executionPlans", () => ({
  useProjects: () => ({ status: "ready", projects: [{ projectId: "money-mind" }], refetch: vi.fn() }),
}));
vi.mock("../components/SpatialGraphView", () => ({
  SpatialGraphView: () => <div data-testid="mock-canvas" />,
}));

import SpatialGraphPage from "../../../pages/SpatialGraph/SpatialGraphPage";
import { I18nProvider } from "../../../i18n";
import { makeProjection } from "./fixtures";

const realFetch = globalThis.fetch;

function renderPage() {
  return render(
    <I18nProvider initialLanguage="en">
      <MemoryRouter initialEntries={["/graph"]}>
        <Routes>
          <Route path="/graph" element={<SpatialGraphPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe("Spatial Graph against the real network client", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("requests /api/projects/:id/graph with the bearer token", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(makeProjection({ projectId: "money-mind" })), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    renderPage();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^\/api\/projects\/money-mind\/graph/);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok-abc");
    expect(await screen.findByTestId("mock-canvas")).toBeInTheDocument();
  });

  it("shows an error state (no crash) when the SPA index.html comes back with a 200", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;
    renderPage();
    expect(await screen.findByText(/unexpected response/i)).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("shows an error state for a 401 rather than crashing", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: "authentication required" } }), { status: 401, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    renderPage();
    expect(await screen.findByText(/authentication required/i)).toBeInTheDocument();
  });
});
