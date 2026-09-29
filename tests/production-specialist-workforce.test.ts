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
import type { Handoff, TaskRequirements } from "../contracts/index.js";
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

test("PRODUCTION: the assignment-history route is reachable, and reports failed attempts too", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const first = rt.specialist.assignments.assign(req(), {
    taskId: "hist-1",
    assignedBy: "system:test",
  });
  assert.equal(first.status, "assigned");
  if (first.status !== "assigned") return;
  // A second attempt on the same task, so history has more than one entry.
  rt.specialist.assignments.transition(first.assignment.assignmentId, "reassigned");
  const second = rt.specialist.assignments.assign(req(), {
    taskId: "hist-1",
    assignedBy: "system:test",
  });
  assert.equal(second.status, "assigned");

  await withServer(rt, async (call) => {
    const res = await call("GET", "/api/workforce/assignments/hist-1/history");
    // The route shape is /workforce/assignments/:taskId/history — four segments.
    // An earlier matcher expected three, so this route 404d for every task and
    // the history was simply unreachable in production.
    assert.equal(res.status, 200);
    const rows = res.body as { taskId: string; status: string }[];
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.taskId === "hist-1"));
    assert.ok(
      rows.some((row) => row.status === "reassigned"),
      "history must include the superseded attempt, not only the current holder",
    );
  });
});

test("PRODUCTION: a malformed tasks field is rejected instead of planned as 'fully staffed'", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    // Each of these describes no work at all. Defaulting them to `[]` returned
    // 200 with status "fully_staffed" — a staffing claim about a request that
    // never named a task.
    for (const tasks of [undefined, null, "t1", 42, { t1: true }]) {
      const res = await call("POST", "/api/workforce/plan", {
        projectId: "money-mind",
        tasks,
      });
      assert.equal(res.status, 400, `tasks=${JSON.stringify(tasks)} must be rejected`);
    }
    // A genuinely empty task list is a real statement: the caller asked about
    // zero tasks, so there is nothing to staff and nothing to fail.
    const empty = await call("POST", "/api/workforce/plan", {
      projectId: "money-mind",
      tasks: [],
    });
    assert.equal(empty.status, 200);
  });
});

test("PRODUCTION: a plan task entry without requirements is rejected", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  await withServer(rt, async (call) => {
    for (const entry of [
      { taskId: "t1" },
      { taskId: "t1", requirements: "everything" },
      { taskId: "t1", requirements: [] },
      { requirements: req() },
      "not-an-object",
      ["t1"],
    ]) {
      const res = await call("POST", "/api/workforce/plan", {
        projectId: "money-mind",
        tasks: [entry],
      });
      assert.equal(res.status, 400, `${JSON.stringify(entry)} must be rejected`);
    }
  });
});

test("PRODUCTION: a handoff with no project scope is withheld, not shown to every operator", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  // A LEGACY-shaped handoff: no projectId, and free-text task content in the
  // body. Its scope is unknown, so it cannot be authorised for an operator who
  // may only see one project.
  //
  // The specialist `propose` REQUIRES a projectId, so the only way an unscoped
  // record can exist is the generic pre-specialist path. That is exactly why the
  // read has to fail closed on it rather than treating "no scope" as "public".
  const generic: Handoff = {
    id: "handoff_unscoped_1",
    taskId: "unscoped-1",
    sourceAgentId: "research-agent",
    destinationAgentId: "reviewer-v1",
    status: "proposed",
    context: {},
    completedWork: "confidential findings from another project",
    remainingWork: "do not disclose",
    acceptanceCriteria: [],
    artifacts: [],
    risks: [],
    createdAt: "2026-09-27T00:00:00.000Z",
  };
  rt.repositories.repository<Handoff>("handoffs").upsert(generic);

  await withServer(rt, async (call) => {
    const res = await call("GET", "/api/workforce/handoffs");
    assert.equal(res.status, 200);
    const rows = res.body as { id: string; completedWork: string }[];
    assert.equal(
      rows.some((row) => row.id === generic.id),
      false,
      "an unscoped handoff must not be listed to an operator who cannot be authorised for it",
    );
    assert.equal(
      rows.some((row) => row.completedWork.includes("confidential findings")),
      false,
      "unscoped handoff content must not leak",
    );
  });
});

test("PRODUCTION: a project-scoped handoff is listed to an operator who may see that project", async () => {
  const rt = await createProductionControlPlaneRuntime({ services: services() });
  const handoff = rt.specialist.handoffs.propose({
    draft: {
      taskId: "scoped-1",
      projectId: "money-mind",
      sourceAgentId: "backend-dev-v1",
      destinationAgentId: "reviewer-v1",
      requiredCapabilities: ["software.review"],
      completedWork: "implemented the ledger endpoint",
      remainingWork: "review it",
      acceptanceCriteria: ["reviewer approves"],
    }
  });
  assert.ok(handoff);

  await withServer(rt, async (call) => {
    const res = await call("GET", "/api/workforce/handoffs");
    assert.equal(res.status, 200);
    const rows = res.body as { id: string; projectId?: string }[];
    const found = rows.find((row) => row.id === handoff.id);
    assert.ok(found, "a project-scoped handoff must be visible to an authorised operator");
    assert.equal(found!.projectId, "money-mind");
  });
});
