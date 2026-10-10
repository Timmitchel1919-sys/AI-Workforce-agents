/**
 * Specialist workforce — the Model Router PREREQUISITE, proven.
 *
 * Before this layer the twelve V1 specialist descriptors were registered in the
 * production composition and bound to a `RoutedModelProvider`, but carried NO
 * `modelPolicy`. `ModelCapabilityRegistry.eligibility` scopes in profiles by the
 * agent's declared provider, so an agent with no policy scoped in ZERO
 * profiles, every candidate was rejected, and all twelve agents failed
 * permanently with `model_unavailable` regardless of whether a key was
 * configured. The single existing composition test only executed the three
 * agents that *did* declare a model policy, so the defect was invisible.
 *
 * These tests execute every V1 specialist through the real production
 * composition and assert that routing SELECTS a model. The subsequent
 * transport failure (no `OPENAI_API_KEY` in CI) is expected and is asserted to
 * be a *different, later* failure — that is the whole point: selection is a
 * precondition, and it must now be reachable.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createProductionControlPlaneRuntime } from "../api/index.js";
import { V1_SPECIALIST_WORKFORCE } from "../agents/specialists/v1-specialist-workforce.js";
import type { FirebaseAuthLike, FirebaseServices } from "../adapters/index.js";
import { AgentExecutionError, type Task } from "../contracts/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string) {
    if (token === "admin") return { uid: `${token}-1` };
    throw new Error("invalid token");
  }
}

function services(): FirebaseServices {
  const firestore = new FakeFirestore();
  const T = "2026-09-27T00:00:00.000Z";
  firestore.collection("operators").values.set("admin-1", {
    id: "admin-1",
    emailVerified: true,
    requestedAt: T,
    updatedAt: T,
    revision: 1,
    status: "active",
    role: "admin",
    allowedProjects: "*",
  });
  return {
    firestore,
    auth: new FakeAuth(),
    storage: {} as FirebaseServices["storage"],
    config: {
      projectId: "ai-workforce-agents",
      storageBucket: "ai-workforce-agents.appspot.com",
      emulated: true,
    },
  };
}

function task(agentId: string): Task {
  return {
    id: `task_route_${agentId}`,
    type: "coordination",
    description: "prove the V1 specialist can reach the Model Router",
    projectId: "money-mind",
    priority: "normal",
    status: "running",
    input: { objective: "x", instructions: "y" },
    errors: [],
    requiredPermissions: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("PREREQUISITE: all 12 V1 specialists declare a routable model policy", () => {
  assert.equal(V1_SPECIALIST_WORKFORCE.length, 12);
  for (const descriptor of V1_SPECIALIST_WORKFORCE) {
    assert.equal(
      descriptor.modelPolicy.provider,
      "openai",
      `${descriptor.id} must name the one provider this deployment actually has`,
    );
  }
});

for (const descriptor of V1_SPECIALIST_WORKFORCE) {
  test(`PREREQUISITE: the ${descriptor.id} specialist REACHES model routing in production and selects a model`, async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const rt = await createProductionControlPlaneRuntime({
        services: services(),
      });
      const agent = rt.context.agents.get(descriptor.id);
      assert.ok(agent, `${descriptor.id} must be registered in production`);
      assert.ok(rt.bootstrap.agentExecutors.has(descriptor.id));

      // Transport fails (no key) — that is expected and is a LATER, different
      // failure. What must not happen is a routing rejection.
      await assert.rejects(
        () => rt.bootstrap.agentExecutors.execute(agent!, task(descriptor.id)),
        (error: unknown) => error instanceof AgentExecutionError,
      );

      const history = await rt.routing.router.listByProject("money-mind");
      const decision = history.find((d) => d.agentId === descriptor.id);
      assert.ok(
        decision,
        `a routing decision must be persisted for ${descriptor.id}`,
      );
      assert.equal(
        decision!.selectedProvider,
        "openai",
        `${descriptor.id} must SELECT a model — the pre-layer defect rejected every candidate`,
      );
      assert.deepEqual(decision!.rejectedCandidates, []);
      await rt.flush();
    } finally {
      if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    }
  });
}

test("F-2: an agent whose modelPolicy scopes in no profile is diagnosed as a POLICY defect, not a capability shortfall", async () => {
  const { ModelCapabilityRegistry } =
    await import("../core/planning/model-capability-registry.js");
  const { ModelRouter } = await import("../core/routing/model-router.js");
  const { ModelProviderRegistry } =
    await import("../core/providers/model-provider-registry.js");

  const profiles = new ModelCapabilityRegistry([
    {
      id: "openai-default",
      providerId: "openai",
      capabilities: ["reasoning", "structured_output"],
    },
  ]);

  // A descriptor with NO model policy: the exact pre-layer shape.
  const scopeless = {
    id: "scopeless-agent",
    name: "Scopeless",
    description: "declares no model policy",
    capabilities: ["software.general"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: [],
    permissions: [],
  };
  const eligibility = profiles.eligibility(scopeless, ["reasoning"]);
  assert.equal(eligibility.policyScopeEmpty, true);
  assert.equal(eligibility.policyProvider, undefined);

  const router = new ModelRouter(
    profiles,
    new ModelProviderRegistry(),
    {
      evaluate: async () => ({
        decision: "allow" as const,
        detail: "",
      }),
    },
    () => "2026-09-27T00:00:00.000Z",
  );
  const request = {
    projectId: "money-mind",
    agentId: scopeless.id,
    agent: scopeless,
    requirement: { requiredCapabilities: ["reasoning" as const] },
    requestId: "req_scopeless",
    requestedBy: "admin-1",
  };
  const decision = await router.route(
    { id: "admin-1", role: "admin", allowedProjects: "*" },
    request,
  );
  assert.equal(decision.selectedProvider, undefined);
  assert.deepEqual(
    decision.rejectedCandidates.map((c) => c.reasonCode),
    ["AGENT_MODEL_POLICY_UNSCOPED"],
    "the reason must name the real cause",
  );
  assert.match(
    decision.rejectedCandidates[0]!.detail,
    /declares no modelPolicy\.provider/,
  );

  // A provider-scoped agent with no declared profile is likewise diagnosed as
  // a policy/config mismatch rather than a missing capability.
  const unprofiled = {
    ...scopeless,
    agentId: "unprofiled-agent",
    agent: { ...scopeless, modelPolicy: { provider: "anthropic" } },
  };
  const second = await router.route(
    { id: "admin-1", role: "admin", allowedProjects: "*" },
    { ...request, agentId: unprofiled.agentId, agent: unprofiled.agent },
  );
  assert.equal(
    second.rejectedCandidates[0]!.reasonCode,
    "AGENT_MODEL_POLICY_UNSCOPED",
  );
  assert.match(
    second.rejectedCandidates[0]!.detail,
    /no declared model capability profile/,
  );
});
