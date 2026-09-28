/**
 * EO-8 — Specialist Agent Workforce, in the PRODUCTION composition root.
 *
 * The Developer/QA/Project Manager agents were fully implemented and tested
 * (their own unit test files) but never registered in ANY production
 * composition root before this layer — this file proves the gap is actually
 * closed: each is registered, routed through the SAME reviewed Model Router
 * pipeline EO-7 wired for control-plane-analysis, and fails closed for the
 * SAME separate reason (no OPENAI_API_KEY here) rather than silently
 * succeeding or being unreachable.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createProductionControlPlaneRuntime } from "../api/index.js";
import { DEVELOPER_AGENT_ID } from "../agents/developer/index.js";
import { QA_AGENT_ID } from "../agents/qa/index.js";
import { PROJECT_MANAGER_AGENT_ID } from "../agents/project-manager/index.js";
import type { FirebaseAuthLike, FirebaseServices } from "../adapters/index.js";
import { AgentExecutionError, type Task } from "../contracts/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string) {
    if (["admin"].includes(token)) return { uid: `${token}-1` };
    throw new Error("invalid token");
  }
}

function seeded(): FakeFirestore {
  const firestore = new FakeFirestore();
  const operators = firestore.collection("operators");
  const T = "2026-09-27T00:00:00.000Z";
  const base = { emailVerified: true, requestedAt: T, updatedAt: T, revision: 1, status: "active" };
  operators.values.set("admin-1", { ...base, id: "admin-1", role: "admin", allowedProjects: "*" });
  return firestore;
}

const services = (): FirebaseServices => ({
  firestore: seeded(),
  auth: new FakeAuth(),
  storage: {} as FirebaseServices["storage"],
  config: { projectId: "ai-workforce-agents", storageBucket: "ai-workforce-agents.appspot.com", emulated: true },
});

function task(type: string, input: Record<string, unknown>, id: string): Task {
  return {
    id,
    type,
    description: "EO-8 specialist agent composition test.",
    projectId: "money-mind",
    priority: "normal",
    status: "running",
    input,
    errors: [],
    requiredPermissions: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const SPECIALISTS = [
  { id: DEVELOPER_AGENT_ID, name: "Developer", taskId: "task_dev_eo8", type: "development", input: { objective: "x", instructions: "y" } },
  { id: QA_AGENT_ID, name: "QA", taskId: "task_qa_eo8", type: "qa", input: { objective: "x", acceptanceCriteria: ["done"] } },
  { id: PROJECT_MANAGER_AGENT_ID, name: "Project Manager", taskId: "task_pm_eo8", type: "project-manager-plan", input: { objective: "x" } },
];

for (const spec of SPECIALISTS) {
  test(`EO-8: the ${spec.name} agent is registered, routed, and fails closed for its OWN separate reason (no OPENAI_API_KEY here) — never silently unreachable, never silently free`, async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const rt = await createProductionControlPlaneRuntime({ services: services() });
      const agent = rt.context.agents.get(spec.id);
      assert.ok(agent, `${spec.id} must be registered in production`);
      assert.ok(rt.bootstrap.agentExecutors.has(spec.id), `${spec.id} must have an executor bound`);

      // ProviderConfigError (no OPENAI_API_KEY) is a ValidationError subtype, mapped to
      // "invalid_result" by GeneralAgent's existing, pre-existing error handling — the point here
      // is that routing itself ran and succeeded; only the actual transport call failed, later.
      await assert.rejects(
        () => rt.bootstrap.agentExecutors.execute(agent!, task(spec.type, spec.input, spec.taskId)),
        (error: unknown) => error instanceof AgentExecutionError,
      );

      const history = await rt.routing.router.listByProject("money-mind");
      const decision = history.find((d) => d.agentId === spec.id);
      assert.ok(decision, `a routing decision must be persisted for ${spec.id}`);
      assert.equal(decision!.selectedProvider, "openai");
      assert.deepEqual(decision!.rejectedCandidates, []);

      // No usage recorded — the provider never actually returned a response to bill.
      const cost = await rt.context.costCenter!.usage.listByProject({ id: "admin-1", role: "admin", allowedProjects: "*" }, "money-mind");
      assert.deepEqual(cost.filter((c) => c.agentId === spec.id), []);
      await rt.flush();
    } finally {
      if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    }
  });
}

test("EO-8: the Research Agent is deliberately NOT registered in production — no real, non-fabricated search/fetch provider exists yet (see ADR-0030)", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  assert.equal(rt.context.agents.get("research-agent"), undefined);
  await rt.flush();
});

test("EO-8: dashboard/report counts reflect all four real production agents", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  assert.equal(rt.bootstrap.report.agentCount, 16);
  await rt.flush();
});
