import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authContext } from "../../../auth/authContext";
import type { AuthContextValue } from "../../../auth/auth.types";
import { I18nProvider } from "../../../i18n";
import { ThemeProvider } from "../../../themes/ThemeProvider";
import {
  agentPerformance,
  modelUsage,
  rate,
  recommendations,
  routingSummary,
} from "../../../features/intelligence/intelligenceAnalytics";
import type { AgentListItem } from "../../../features/agents";
import type { UsageRecord } from "../../../features/costCenter";
import type { RoutingDecision } from "../../../features/modelRouting/modelRoutingClient";
import IntelligencePage from "../IntelligencePage";

const agent = (id: string, completed: number, failed: number): AgentListItem =>
  ({
    id,
    name: id,
    status: "idle",
    capabilities: ["code"],
    enabled: true,
    allowedProjects: ["alpha"],
    taskCount: completed + failed,
    completed,
    failed,
  }) as unknown as AgentListItem;

const usage = (model: string, priced: boolean, tokens?: number): UsageRecord => ({
  usageId: `${model}-${Math.random()}`,
  projectId: "alpha",
  provider: "openai",
  model,
  totalTokens: tokens,
  cost: priced ? { priced: true, amountUsd: 0.5, pricingVersion: "v1" } : { priced: false, reason: "no price" },
  createdAt: "2026-10-15T10:00:00.000Z",
});

describe("intelligence analytics", () => {
  it("never turns 'no data' into zero", () => {
    expect(rate(0, 0)).toEqual({ value: null, sample: 0, lowSample: false });
    expect(rate(1, 2).lowSample).toBe(true);
    expect(agentPerformance([agent("idle-agent", 0, 0)])[0]!.success.value).toBeNull();
    expect(modelUsage([usage("gpt", false)])[0]!.totalTokens).toBeNull();
  });

  it("sums only ACTUAL priced cost and counts unpriced calls separately", () => {
    const [m] = modelUsage([usage("gpt", true, 10), usage("gpt", false, 5), usage("gpt", true)]);
    expect(m).toMatchObject({ calls: 3, pricedCalls: 2, pricedUsd: 1, unpricedCalls: 1, totalTokens: 15 });
  });

  it("summarizes recorded routing decisions, including no-model outcomes", () => {
    const decisions = [
      { selectedProvider: "openai", selectedModel: undefined, fallbackUsed: false, rejectedCandidates: [] },
      { selectedProvider: undefined, fallbackUsed: true, rejectedCandidates: [{ reasonCode: "not_allowed_by_governance" }] },
    ] as unknown as RoutingDecision[];
    const s = routingSummary(decisions);
    expect(s).toMatchObject({ decisions: 2, selected: 1, noModel: 1, fallbacks: 1 });
    expect(s.rejectionReasons).toEqual([{ reason: "not_allowed_by_governance", count: 1 }]);
  });

  it("recommends only with evidence and enough sample", () => {
    const perf = agentPerformance([agent("flaky", 1, 5), agent("tiny", 0, 2)]);
    const recs = recommendations({ performance: perf, usage: [] });
    expect(recs.map((r) => r.subject)).toEqual(["flaky"]);
    expect(recs[0]!.evidence).toEqual({ failed: 5, sample: 6 });
  });
});

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const auth = {
  user: { id: "op-1", email: "op@example.test", displayName: "Op" },
  loading: false,
  accessToken: "token",
  configured: true,
  access: "granted",
  accessDetails: { role: "viewer", capabilities: ["view"] },
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendPasswordReset: vi.fn(),
  refreshAccess: vi.fn(),
  getPasswordPolicy: vi.fn(),
  signOut: vi.fn(),
} as unknown as AuthContextValue;

afterEach(() => vi.unstubAllGlobals());

describe("IntelligencePage", () => {
  it("shows declared model profiles without inventing pricing or benchmarks, and no fabricated drift data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/projects") return respond(200, [{ projectId: "alpha", displayName: "Alpha", status: "active" }]);
        if (url === "/api/intelligence/models")
          return respond(200, {
            configured: true,
            profiles: [{ profileId: "openai-default", providerId: "openai", model: null, capabilities: ["reasoning"], providerRegistered: true }],
            credentialStatus: "not_reported",
            pricing: "not_declared",
            benchmarks: "not_measured",
          });
        if (url.endsWith("/routing-decisions")) return respond(200, { configured: true, decisions: [] });
        return respond(404, { error: { message: "not found" } });
      }),
    );
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider>
        <I18nProvider initialLanguage="en">
          <authContext.Provider value={auth}>
            <QueryClientProvider client={client}>
              <MemoryRouter initialEntries={["/intelligence?project=alpha"]}>
                <Routes>
                  <Route path="/intelligence" element={<IntelligencePage />} />
                </Routes>
              </MemoryRouter>
            </QueryClientProvider>
          </authContext.Provider>
        </I18nProvider>
      </ThemeProvider>,
    );
    expect(screen.queryByText(/ChurnPredictor/)).not.toBeInTheDocument();
    expect(screen.queryByText(/95%/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Models" }));
    expect(await screen.findByText("openai-default")).toBeInTheDocument();
    expect(screen.getByText("Pricing: not declared")).toBeInTheDocument();
    expect(screen.getByText("Benchmarks: not measured")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Routing" }));
    expect(await screen.findByText("No routing decisions recorded for this project yet.")).toBeInTheDocument();
  });
});
