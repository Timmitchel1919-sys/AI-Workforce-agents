/**
 * EO-3.3 — operator review support in the Control Plane.
 *
 * Stale-plan protection: commands carry the version the operator reviewed;
 * once a newer revision exists the command is refused (409) instead of
 * silently acting on the newer version. An approval requested for V1 can
 * never approve V2. Plus the series history filter and the read-only
 * technology catalog used by the "create plan" form.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  type OperatorPrincipal,
  type ProjectAdapter,
} from "../core/index.js";
import {
  MAC_HOST,
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  XCODE_INSTANCE,
  IOS_AGENT,
  agent,
  iosRequest,
  planningFixture,
  webRequest,
} from "./fixtures/planning.js";

const PRINCIPALS: Record<string, OperatorPrincipal> = {
  admin: { id: "admin-1", role: "admin", allowedProjects: "*" },
  viewer: { id: "viewer-1", role: "viewer", allowedProjects: "*" },
};

function stubAdapter(projectId: string): ProjectAdapter {
  return {
    projectId,
    async describe() {
      return { name: projectId, capabilities: [] };
    },
    async execute() {
      return {};
    },
  };
}

async function harness() {
  const fixture = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, IOS_AGENT, agent("sec-agent", ["security_review"])],
  });
  const projects = new ProjectRegistry();
  projects.register(stubAdapter("alpha"));
  projects.register(stubAdapter("beta"));
  const ctx: ControlPlaneContext = {
    agents: fixture.agents,
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: fixture.approvals,
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(fixture.audit),
    projects,
    audit: fixture.audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
    environments: fixture.registry,
    planning: fixture.planning,
  };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: { resolve: async (t) => PRINCIPALS[t] ?? null },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const call = async (
    method: "GET" | "POST",
    path: string,
    token: string | undefined = "admin",
    body?: unknown,
  ) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  };
  return {
    fixture,
    call,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function productionRequest() {
  return {
    ...webRequest("alpha"),
    deployments: [
      {
        componentId: "web",
        targetType: "firebase_hosting",
        stage: "production",
      },
    ],
  };
}

test("stale replan: acting on V1 after V2 exists is refused (409), nothing created", async () => {
  const h = await harness();
  try {
    const created = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "admin",
      iosRequest("alpha"),
    );
    const planId = (created.body.details as { planId: string }).planId;
    h.fixture.registry.upsertHost(MAC_HOST);
    h.fixture.registry.upsertInstance(XCODE_INSTANCE);
    const v2 = await h.call(
      "POST",
      "/commands/replan-execution-plan",
      "admin",
      {
        planId,
        expectedVersion: 1,
      },
    );
    assert.equal(v2.status, 200);
    assert.equal((v2.body.details as { version: number }).version, 2);

    // Someone still looking at V1 tries again.
    h.fixture.disabled.add("ios-agent");
    const stale = await h.call(
      "POST",
      "/commands/replan-execution-plan",
      "admin",
      {
        planId,
        expectedVersion: 1,
      },
    );
    assert.equal(stale.status, 409);
    assert.match(String(stale.body.reason), /version 2/);
    assert.equal(h.fixture.planning.versions(planId).length, 2);

    const bad = await h.call(
      "POST",
      "/commands/replan-execution-plan",
      "admin",
      {
        planId,
        expectedVersion: "2",
      },
    );
    assert.equal(bad.status, 400);
  } finally {
    await h.close();
  }
});

test("stale submit: an approval request is only created for the version the operator saw", async () => {
  const h = await harness();
  try {
    const created = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "admin",
      productionRequest(),
    );
    const planId = (created.body.details as { planId: string }).planId;
    h.fixture.agents.register(agent("web-agent-2", ["web_development"]));
    await h.call("POST", "/commands/replan-execution-plan", "admin", {
      planId,
      expectedVersion: 1,
    });

    const stale = await h.call(
      "POST",
      "/commands/submit-execution-plan",
      "admin",
      {
        planId,
        expectedVersion: 1,
      },
    );
    assert.equal(stale.status, 409);
    assert.equal(h.fixture.approvals.list().length, 0);

    const fresh = await h.call(
      "POST",
      "/commands/submit-execution-plan",
      "admin",
      {
        planId,
        expectedVersion: 2,
      },
    );
    assert.equal(fresh.status, 200);
    assert.equal(
      h.fixture.planning.latest(planId)?.status,
      "awaiting_approval",
    );
  } finally {
    await h.close();
  }
});

test("an approval requested for V1 can never approve V2", async () => {
  const h = await harness();
  try {
    const created = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "admin",
      productionRequest(),
    );
    const planId = (created.body.details as { planId: string }).planId;
    const submitted = await h.call(
      "POST",
      "/commands/submit-execution-plan",
      "admin",
      {
        planId,
        expectedVersion: 1,
      },
    );
    const approvalId = (submitted.body.details as { approvalId: string })
      .approvalId;

    h.fixture.agents.register(agent("web-agent-2", ["web_development"]));
    await h.call("POST", "/commands/replan-execution-plan", "admin", {
      planId,
      expectedVersion: 1,
    });

    const approve = await h.call("POST", "/commands/approve", "admin", {
      approvalId,
    });
    assert.equal(approve.status, 409);
    const v2 = h.fixture.planning.latest(planId)!;
    assert.equal(v2.version, 2);
    assert.equal(v2.status, "ready");
    assert.equal(h.fixture.planning.get(`${planId}@v1`)?.status, "superseded");
  } finally {
    await h.close();
  }
});

test("history filter: ?planId= returns one series, newest first, server-side", async () => {
  const h = await harness();
  try {
    const a = await h.call(
      "POST",
      "/commands/create-execution-plan",
      "admin",
      iosRequest("alpha"),
    );
    await h.call(
      "POST",
      "/commands/create-execution-plan",
      "admin",
      webRequest("alpha"),
    );
    const planId = (a.body.details as { planId: string }).planId;
    h.fixture.registry.upsertHost(MAC_HOST);
    h.fixture.registry.upsertInstance(XCODE_INSTANCE);
    await h.call("POST", "/commands/replan-execution-plan", "admin", {
      planId,
      expectedVersion: 1,
    });

    const page = await h.call(
      "GET",
      `/projects/alpha/execution-plans?planId=${planId}&limit=10`,
    );
    const items = page.body.items as {
      planId: string;
      version: number;
      current: boolean;
    }[];
    assert.deepEqual(
      items.map((i) => [i.version, i.current]),
      [
        [2, true],
        [1, false],
      ],
    );
    assert.ok(items.every((i) => i.planId === planId));
    assert.equal(page.body.total, 2);
    // Another project's series id does not leak through the filter.
    const foreign = await h.call(
      "GET",
      `/projects/beta/execution-plans?planId=${planId}`,
    );
    assert.equal(foreign.body.total, 0);
  } finally {
    await h.close();
  }
});

test("technology catalog: read-only, requires authentication", async () => {
  const h = await harness();
  try {
    const res = await h.call("GET", "/planning/technologies", "viewer");
    assert.equal(res.status, 200);
    const catalog = res.body as unknown as {
      id: string;
      componentKinds: string[];
      platforms: string[];
    }[];
    const swiftui = catalog.find((t) => t.id === "swiftui");
    assert.deepEqual(swiftui?.platforms, ["ios", "macos"]);
    assert.ok(catalog.some((t) => t.id === "react_typescript"));
    assert.equal(
      (await h.call("GET", "/planning/technologies", "")).status,
      401,
    );
    assert.equal((await h.call("GET", "/planning/unknown")).status, 404);
  } finally {
    await h.close();
  }
});
