/**
 * END-TO-END: the specialist workforce layer, through the REAL production
 * composition and the REAL HTTP API.
 *
 * Every other specialist test composes the services directly. That proves the
 * units are correct; it does NOT prove the deployed system reports the truth.
 * The failures this suite exists to prevent are integration-shaped:
 *
 *   - the layer is implemented but never wired into the composition root, so
 *     production has no assignments at all;
 *   - the API answers 200 with an empty list where it should answer 404
 *     "not composed", turning "we do not know" into "nothing exists";
 *   - the Control Center shows an agent's name and role as if that were a
 *     qualification, because the descriptor is never projected;
 *   - a plan endpoint silently CREATES assignments as a side effect of a read.
 *
 * Nothing here is mocked except the Firebase boundary. Every specialist, every
 * policy and every route is the production one.
 */
import assert from "node:assert/strict";
import test from "node:test";

import http from "node:http";
import type { AddressInfo } from "node:net";

import { createProductionControlPlaneRuntime } from "../api/index.js";
import { V1_SPECIALIST_WORKFORCE } from "../agents/specialists/v1-specialist-workforce.js";
import type { FirebaseAuthLike, FirebaseServices } from "../adapters/index.js";
import type { TaskRequirements } from "../contracts/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string) {
    if (token === "admin") return { uid: "admin-1" };
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

/**
 * Driven through a REAL `http.Server` on an ephemeral port with `fetch`, so
 * the tests exercise the actual request path — including body parsing and
 * status codes — rather than a hand-rolled request/response pair that could
 * disagree with how Node really behaves.
 */
async function withServer<T>(
  runtime: Awaited<ReturnType<typeof createProductionControlPlaneRuntime>>,
  fn: (call: CallApi) => Promise<T>,
): Promise<T> {
  const server = http.createServer(runtime.handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(async (method, path, body, token = "admin") => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      return {
        status: res.status,
        body: text ? JSON.parse(text) : undefined,
      };
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

interface CallApi {
  (
    method: string,
    path: string,
    body?: unknown,
    token?: string | null,
  ): Promise<{ status: number; body: unknown }>;
}

function req(overrides: Partial<TaskRequirements> = {}): TaskRequirements {
  return {
    projectId: "money-mind",
    taskType: "implementation",
    requiredCapabilities: ["software.backend"],
    riskLevel: "low",
    ...overrides,
  };
}

test("PRODUCTION: the specialist layer is composed, not merely implemented", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  assert.ok(rt.specialist, "runtime.specialist must exist");
  assert.ok(rt.context.specialist, "context.specialist must exist");
  assert.equal(typeof rt.specialist.assignments.assign, "function");
  assert.equal(typeof rt.context.specialist!.plan, "function");
});

test("PRODUCTION: the Control Plane projects descriptor policies, not just a name and role", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    const res = await call("GET", "/api/agents/backend-dev-v1");
    assert.equal(res.status, 200);
    const agent = res.body as {
      agentId: string;
      role: string;
      specialist?: {
        descriptorVersion: number;
        administrativeStatus: string;
        operationalState: string;
        limitations: readonly string[];
        projectPolicy: { projects: readonly string[] };
        toolPolicy: { allowsUnrestrictedShell: boolean };
        riskCeiling: string;
        modelPolicy: { provider: string };
        reviewPolicy: { selfReviewAllowed: boolean };
      };
    };
    assert.equal(agent.agentId, "backend-dev-v1");
    assert.ok(agent.specialist, "a V1 specialist must project its descriptor");
    assert.equal(agent.specialist!.descriptorVersion, 1);
    assert.equal(agent.specialist!.administrativeStatus, "active");
    // No instance exists in a fresh deployment, so the agent is OFFLINE —
    // never "available". An agent with no instance cannot be doing anything.
    assert.equal(agent.specialist!.operationalState, "offline");
    assert.ok(agent.specialist!.limitations.length > 0);
    assert.deepEqual(agent.specialist!.projectPolicy.projects, ["money-mind"]);
    assert.equal(agent.specialist!.toolPolicy.allowsUnrestrictedShell, false);
    assert.equal(agent.specialist!.reviewPolicy.selfReviewAllowed, false);
    assert.equal(agent.specialist!.modelPolicy.provider, "openai");
  });
});

test("PRODUCTION: every one of the 12 V1 specialists is projected, with no model policy left unscoped", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    const res = await call("GET", "/api/agents");
    assert.equal(res.status, 200);
    const agents = res.body as {
      agentId: string;
      specialist?: { modelPolicy: { provider: string } };
    }[];
    const specialists = agents.filter((a) => a.specialist);
    for (const id of V1_SPECIALIST_WORKFORCE.map((d) => d.id)) {
      assert.ok(
        specialists.some((a) => a.agentId === id),
        `${id} must be projected with its descriptor in production`,
      );
    }
    for (const agent of specialists) {
      assert.notEqual(
        agent.specialist!.modelPolicy.provider,
        "unscoped",
        `${agent.agentId} has no routable model policy in production`,
      );
    }
  });
});

test("PRODUCTION: the plan endpoint reports staffing honestly and creates NOTHING", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    const before = await call("GET", "/api/workforce/assignments");
    assert.equal(before.status, 200);
    assert.deepEqual(before.body, [], "a fresh deployment has no assignments");

    const res = await call("POST", "/api/workforce/plan", {
      projectId: "money-mind",
      tasks: [
        { taskId: "t1", requirements: req() },
        { taskId: "t2", requirements: req({ requiredCapabilities: ["software.frontend"] }) },
      ],
    });
    assert.equal(res.status, 200);
    const workload = res.body as {
      plan: {
        status: string;
        usedAgentIds: readonly string[];
        tasks: { taskId: string; status: string; assignment?: unknown }[];
      };
    };
    assert.equal(workload.plan.status, "fully_staffed");
    assert.equal(workload.plan.tasks.length, 2);
    assert.equal(
      workload.plan.tasks.every((t) => t.assignment === undefined),
      true,
      "a plan must not carry an assignment: this endpoint is a dry run",
    );
    assert.ok(workload.plan.usedAgentIds.includes("backend-dev-v1"));

    const after = await call("GET", "/api/workforce/assignments");
    assert.deepEqual(
      after.body,
      [],
      "reading a plan must not have bound an agent to work",
    );
  });
});

test("PRODUCTION: planning a project no specialist is scoped to reports UNSTAFFABLE, not a fake roster", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    const res = await call("POST", "/api/workforce/plan", {
      projectId: "ai-workforce",
      tasks: [{ taskId: "t1", requirements: req({ projectId: "ai-workforce" }) }],
    });
    assert.equal(res.status, 200);
    const workload = res.body as {
      plan: {
        status: string;
        eligibleAgentIds: readonly string[];
        usedAgentIds: readonly string[];
      };
    };
    assert.equal(workload.plan.status, "unstaffable");
    assert.deepEqual(workload.plan.eligibleAgentIds, []);
    assert.deepEqual(workload.plan.usedAgentIds, []);
  });
});

test("PRODUCTION: a task nobody can do is reported blocked, with the reason attached", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    const res = await call("POST", "/api/workforce/plan", {
      projectId: "money-mind",
      tasks: [
        {
          taskId: "t1",
          requirements: req({
            requiredCapabilities: ["infrastructure.quantum_annealing"],
          }),
        },
      ],
    });
    assert.equal(res.status, 200);
    const workload = res.body as {
      plan: {
        status: string;
        blockedTaskIds: readonly string[];
        tasks: { taskId: string; status: string; reason?: string }[];
      };
    };
    assert.equal(workload.plan.status, "unstaffable");
    assert.deepEqual(workload.plan.blockedTaskIds, ["t1"]);
    assert.equal(workload.plan.tasks[0]!.status, "no_qualified_agent");
    assert.match(workload.plan.tasks[0]!.reason!, /no registered specialist covers/);
  });
});

test("PRODUCTION: a plan cannot quietly re-project a task into another project", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    const res = await call("POST", "/api/workforce/plan", {
      projectId: "money-mind",
      tasks: [{ taskId: "t1", requirements: req({ projectId: "somewhere-else" }) }],
    });
    // A 200 claiming the task is staffed under money-mind would be the
    // dishonest outcome; a 400 with the reason is the correct one.
    assert.notEqual(res.status, 200);
  });
});

test("PRODUCTION: a malformed plan request is rejected, not silently planned as empty", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    const noProject = await call("POST", "/api/workforce/plan", { tasks: [] });
    assert.equal(noProject.status, 400);
    const noTaskId = await call("POST", "/api/workforce/plan", {
      projectId: "money-mind",
      tasks: [{ requirements: req() }],
    });
    assert.equal(noTaskId.status, 400);
  });
});

test("PRODUCTION: specialist routes require authentication", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    for (const path of [
      "/api/workforce/assignments",
      "/api/workforce/handoffs",
    ]) {
      const res = await call("GET", path, undefined, null);
      assert.equal(res.status, 401, `${path} must require authentication`);
    }
  });
});

test("PRODUCTION: an unknown workforce sub-resource is 404, never an empty list", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    const res = await call("GET", "/api/workforce/nonsense");
    assert.equal(res.status, 404);
  });
});

test("PRODUCTION: an assignment created on the host is immediately visible through the API, with its evidence", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const outcome = rt.specialist.assignments.assign(req(), {
    taskId: "e2e-1",
    assignedBy: "system:test",
  });
  assert.equal(outcome.status, "assigned");
  if (outcome.status !== "assigned") return;

  await withServer(rt, async (call) => {
    const res = await call("GET", "/api/workforce/assignments?taskId=e2e-1");
    assert.equal(res.status, 200);
    const rows = res.body as {
      assignmentId: string;
      agentId: string;
      status: string;
      qualification: {
        qualified: boolean;
        matchedCapabilities: readonly string[];
        consideredLimitations: readonly string[];
      };
    }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.agentId, outcome.assignment.agentId);
    assert.equal(rows[0]!.status, "assigned");
    assert.equal(rows[0]!.qualification.qualified, true);
    assert.deepEqual(rows[0]!.qualification.matchedCapabilities, [
      "software.backend",
    ]);
    // The agent's stated limitations travel with the assignment, so a reader
    // can see what the agent was not supposed to be doing.
    assert.ok(rows[0]!.qualification.consideredLimitations.length > 0);
  });
});
