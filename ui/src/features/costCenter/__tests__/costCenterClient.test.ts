import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CostCenterError,
  getProjectAuditFindings,
  getProjectCostReport,
  getProjectGovernancePolicy,
} from "../costCenterClient";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("costCenterClient — read-only Control Plane calls", () => {
  it("GET /api/projects/:id/cost with the ID token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { configured: false }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getProjectCostReport("alpha", "tok-1");

    expect(result).toEqual({ configured: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/projects/alpha/cost");
    expect((init as RequestInit).method).toBe("GET");
    expect(((init as RequestInit).headers as Headers).get("Authorization")).toBe("Bearer tok-1");
  });

  it("passes through a configured cost report unchanged (never fabricates the shape)", async () => {
    const body = {
      configured: true,
      budgetPolicy: null,
      evaluation: { status: "not_configured", currency: "USD", detail: "no budget policy is configured for this project" },
      usage: [],
      capabilities: { enforcement: false, providerIds: [] },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, body)));
    const result = await getProjectCostReport("alpha", "tok-1");
    expect(result).toEqual(body);
  });

  it("GET /api/projects/:id/audit-findings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { configured: false }));
    vi.stubGlobal("fetch", fetchMock);

    await getProjectAuditFindings("alpha", "tok-1");

    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/alpha/audit-findings");
  });

  it("GET /api/projects/:id/governance-policy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { configured: false }));
    vi.stubGlobal("fetch", fetchMock);

    await getProjectGovernancePolicy("alpha", "tok-1");

    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/alpha/governance-policy");
  });

  it("maps a 403 onto CostCenterError('forbidden')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { error: { message: "no access" } })));
    await expect(getProjectCostReport("alpha", "tok-1")).rejects.toMatchObject({
      failure: "forbidden",
      message: "no access",
    });
    await expect(getProjectCostReport("alpha", "tok-1")).rejects.toBeInstanceOf(CostCenterError);
  });

  it("maps a network failure onto CostCenterError('unavailable')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(getProjectCostReport("alpha", "tok-1")).rejects.toMatchObject({ failure: "unavailable" });
  });
});
