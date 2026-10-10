import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRoutingError, getProjectRoutingDecision, getProjectRoutingDecisions } from "../modelRoutingClient";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("modelRoutingClient — read-only Control Plane calls", () => {
  it("GET /api/projects/:id/routing-decisions with the ID token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { configured: false }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getProjectRoutingDecisions("alpha", "tok-1");

    expect(result).toEqual({ configured: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/projects/alpha/routing-decisions");
    expect((init as RequestInit).method).toBe("GET");
    expect(((init as RequestInit).headers as Headers).get("Authorization")).toBe("Bearer tok-1");
  });

  it("passes through a configured decision list unchanged (never fabricates the shape)", async () => {
    const decision = {
      routingDecisionId: "dec-1",
      projectId: "alpha",
      agentId: "agent-1",
      requirements: { requiredCapabilities: ["reasoning"] },
      candidateModels: [{ profileId: "p1", providerId: "anthropic", model: "claude-sonnet-5", status: "available" }],
      rejectedCandidates: [],
      selectedProvider: "anthropic",
      selectedModel: "claude-sonnet-5",
      reasonCodes: [],
      costEstimate: { priced: true, amountUsd: 0.01 },
      fallbackPolicy: "none",
      fallbackUsed: false,
      createdAt: "2026-09-27T10:00:00.000Z",
    };
    const body = { configured: true, decisions: [decision] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, body)));
    const result = await getProjectRoutingDecisions("alpha", "tok-1");
    expect(result).toEqual(body);
  });

  it("GET /api/projects/:id/routing-decisions/:decisionId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        configured: true,
        decision: {
          routingDecisionId: "dec-1",
          projectId: "alpha",
          agentId: "agent-1",
          requirements: { requiredCapabilities: ["coding"] },
          candidateModels: [],
          rejectedCandidates: [],
          reasonCodes: ["MODEL_UNAVAILABLE"],
          fallbackPolicy: "none",
          fallbackUsed: false,
          createdAt: "2026-09-27T10:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getProjectRoutingDecision("alpha", "dec-1", "tok-1");

    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/alpha/routing-decisions/dec-1");
    expect(result.configured).toBe(true);
    expect(result.decision.selectedProvider).toBeUndefined();
    expect(result.decision.selectedModel).toBeUndefined();
  });

  it("maps a 404 (decision not found) onto ModelRoutingError('not_found')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { message: "not found" } })));
    await expect(getProjectRoutingDecision("alpha", "missing", "tok-1")).rejects.toMatchObject({
      failure: "not_found",
    });
    await expect(getProjectRoutingDecision("alpha", "missing", "tok-1")).rejects.toBeInstanceOf(ModelRoutingError);
  });

  it("maps a 403 onto ModelRoutingError('forbidden')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { error: { message: "no access" } })));
    await expect(getProjectRoutingDecisions("alpha", "tok-1")).rejects.toMatchObject({
      failure: "forbidden",
      message: "no access",
    });
  });

  it("maps a network failure onto ModelRoutingError('unavailable')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(getProjectRoutingDecisions("alpha", "tok-1")).rejects.toMatchObject({ failure: "unavailable" });
  });
});
