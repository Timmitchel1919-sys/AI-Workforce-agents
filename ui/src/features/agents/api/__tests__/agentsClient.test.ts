/**
 * The client must never invent a roster.
 *
 * Each case below corresponds to a DIFFERENT fact about the deployment, and
 * the previous implementation collapsed all of them into twelve fabricated
 * agents whenever the route was unconfigured, missing, empty, or broken. These
 * tests exist to make that substitution impossible to reintroduce quietly: a
 * change that starts returning sample data for any of these states fails here.
 */
import { describe, expect, it, vi } from "vitest";
import { AgentsClientError, getAgentsSnapshot } from "../agentsClient";
import { ApiError } from "../../../../api/errors";

const AGENTS_ROUTE = "/api/agents";

function apiError(status: number, message = "failure"): ApiError {
  return new ApiError(message, { status });
}

function specialistView(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "backend-dev-v1",
    name: "Backend Engineer",
    status: "offline",
    capabilities: ["software.backend"],
    enabled: true,
    allowedProjects: ["money-mind"],
    specialist: {
      descriptorVersion: 1,
      displayName: "Backend Engineer",
      department: "Engineering",
      description: "API implementation and backend services.",
      limitations: ["Cannot approve its own authorization changes."],
      administrativeStatus: "suspended",
      operationalState: "offline",
      supportedTaskTypes: ["backend_implementation"],
      projectPolicy: { mode: "allow_list", projects: ["money-mind"] },
      toolPolicy: {
        maxExecutionCapabilities: ["filesystem.read", "repository.write"],
        deniedExecutionCapabilities: ["process.invoke.bounded"],
        allowsUnrestrictedShell: false,
      },
      riskCeiling: "high",
      reviewPolicy: {
        requiresIndependentReview: true,
        minimumReviewers: 1,
        selfReviewAllowed: false,
      },
      modelPolicy: { provider: "openai" },
      instanceCount: 0,
      ...overrides,
    },
  };
}

const configured = (payload: unknown) => ({
  path: AGENTS_ROUTE,
  request: vi.fn().mockResolvedValue(payload),
});

describe("agents client", () => {
  it("parses the authoritative payload and keeps both status axes distinct", async () => {
    const snapshot = await getAgentsSnapshot("token", configured({ data: { agents: [specialistView()] } }));

    expect(snapshot.authoritative).toBe(true);
    expect(snapshot.source).toBe("control-plane");
    const agent = snapshot.agents[0];
    expect(agent.id).toBe("backend-dev-v1");
    // The two axes must not collapse into one another.
    expect(agent.specialist?.administrativeStatus).toBe("suspended");
    expect(agent.specialist?.operationalState).toBe("offline");
    expect(agent.taskCount).toBe(0);
  });

  it("counts a suspended agent as NOT accepting work", async () => {
    const snapshot = await getAgentsSnapshot(null, configured({ data: { agents: [specialistView()] } }));

    // Administrative status decides whether new work is permitted at all.
    expect(snapshot.summary.acceptingWork).toBe(0);
    expect(snapshot.summary.specialists).toBe(1);
    expect(snapshot.summary.total).toBe(1);
  });

  it("counts an operationally disabled agent as not accepting work", async () => {
    const snapshot = await getAgentsSnapshot(
      null,
      configured({
        data: {
          agents: [{ ...specialistView(), enabled: false, specialist: { ...specialistView().specialist, administrativeStatus: "active" } }],
        },
      }),
    );

    expect(snapshot.summary.acceptingWork).toBe(0);
  });

  it("reports an empty roster as an empty roster rather than an error or sample data", async () => {
    const snapshot = await getAgentsSnapshot(null, configured({ data: { agents: [] } }));

    expect(snapshot.agents).toEqual([]);
    expect(snapshot.summary.total).toBe(0);
    expect(snapshot.authoritative).toBe(true);
  });

  it("distinguishes 'not composed' (404) from 'empty'", async () => {
    const deps = { path: AGENTS_ROUTE, request: vi.fn().mockRejectedValue(apiError(404)) };

    await expect(getAgentsSnapshot(null, deps)).rejects.toMatchObject({ code: "NOT_COMPOSED" });
  });

  it("refuses when the route is not configured instead of showing a sample roster", async () => {
    const request = vi.fn();

    await expect(getAgentsSnapshot(null, { path: "", request })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    // Nothing was called, and nothing was invented.
    expect(request).not.toHaveBeenCalled();
  });

  it("surfaces a server failure as degraded and retryable, without sample data", async () => {
    const deps = { path: AGENTS_ROUTE, request: vi.fn().mockRejectedValue(apiError(500)) };

    const error = await getAgentsSnapshot(null, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentsClientError);
    expect(error).toMatchObject({ code: "DEGRADED", retryable: true });
  });

  it("does not present a forbidden registry as an empty one", async () => {
    const deps = { path: AGENTS_ROUTE, request: vi.fn().mockRejectedValue(apiError(403)) };

    await expect(getAgentsSnapshot(null, deps)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("treats an unrecognised status as unknown rather than defaulting to active", async () => {
    const snapshot = await getAgentsSnapshot(
      null,
      configured({ data: { agents: [{ ...specialistView(), status: "totally-new-status" }] } }),
    );

    // Defaulting an unknown status to "active" would be a fabricated claim that
    // the agent is available.
    expect(snapshot.agents[0].status).toBe("unknown");
  });

  it("drops an agent with no id instead of rendering an unaddressable row", async () => {
    const snapshot = await getAgentsSnapshot(
      null,
      configured({ data: { agents: [{ name: "No Id" }, specialistView()] } }),
    );

    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0].id).toBe("backend-dev-v1");
  });

  it("fails closed on an unconfirmed shell grant", async () => {
    const snapshot = await getAgentsSnapshot(
      null,
      configured({
        data: {
          agents: [
            specialistView({
              toolPolicy: {
                maxExecutionCapabilities: [],
                deniedExecutionCapabilities: [],
                // deliberately absent
              },
            }),
          ],
        },
      }),
    );

    expect(snapshot.agents[0].specialist?.toolPolicy.allowsUnrestrictedShell).toBe(false);
  });

  it("omits the specialist block for a legacy flat agent rather than defaulting its policies", async () => {
    const snapshot = await getAgentsSnapshot(
      null,
      configured({
        data: {
          agents: [
            {
              agentId: "research-agent",
              name: "Research Agent",
              status: "active",
              capabilities: ["research"],
              enabled: true,
              allowedProjects: ["research-ops"],
            },
          ],
        },
      }),
    );

    // Absence is meaningful: a legacy agent has no policies at all.
    expect(snapshot.agents[0].specialist).toBeUndefined();
    expect(snapshot.summary.specialists).toBe(0);
  });

  it("accepts a bare array payload as well as an envelope", async () => {
    const snapshot = await getAgentsSnapshot(null, configured([specialistView()]));

    expect(snapshot.agents).toHaveLength(1);
  });
});
