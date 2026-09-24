import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createProductionControlPlaneRuntime } from "../api/index.js";
import type { FirebaseAuthLike, FirebaseServices } from "../adapters/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string) {
    if (token === "viewer") return { uid: "viewer-1" };
    if (token === "limited") return { uid: "limited-1" };
    if (token === "pending") return { uid: "pending-1", email_verified: true };
    throw new Error("invalid token");
  }
}

/** AUTHZ-1: authorization comes from operator accounts, not token claims. */
function seededFirestore(): FakeFirestore {
  const firestore = new FakeFirestore();
  const operators = firestore.collection("operators");
  const T = "2026-09-24T00:00:00.000Z";
  const base = {
    emailVerified: true,
    requestedAt: T,
    updatedAt: T,
    revision: 1,
  };
  operators.values.set("viewer-1", {
    ...base,
    id: "viewer-1",
    status: "active",
    role: "viewer",
    allowedProjects: "*",
  });
  operators.values.set("limited-1", {
    ...base,
    id: "limited-1",
    status: "active",
    role: "viewer",
    allowedProjects: [],
  });
  return firestore;
}

function services(): FirebaseServices {
  return {
    firestore: seededFirestore(),
    auth: new FakeAuth(),
    storage: {} as FirebaseServices["storage"],
    config: {
      projectId: "ai-workforce-agents",
      storageBucket: "ai-workforce-agents.appspot.com",
      emulated: true,
    },
  };
}

async function request(
  runtime: Awaited<ReturnType<typeof createProductionControlPlaneRuntime>>,
  path: string,
  token?: string,
  init: RequestInit = {},
) {
  const server = http.createServer(runtime.handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("production composition assembles Firebase-backed state and real executor routing", async () => {
  const runtime = await createProductionControlPlaneRuntime({
    services: services(),
  });
  assert.equal(runtime.bootstrap.report.operational, true);
  assert.equal(
    runtime.bootstrap.agentExecutors.has("control-plane-analysis-agent"),
    true,
  );
  assert.equal(runtime.context.tasks.list().length, 0);
  assert.equal(
    runtime.context.agentOps.isEnabled("control-plane-analysis-agent"),
    true,
  );
  await runtime.flush();
});

test("production composed handler serves dashboard, health, API not-found, and auth safely", async () => {
  const runtime = await createProductionControlPlaneRuntime({
    services: services(),
  });
  const health = await request(runtime, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(
    health.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.deepEqual(await health.json(), { status: "ok" });

  const dashboard = await request(runtime, "/api/dashboard", "viewer");
  assert.equal(dashboard.status, 200);
  assert.equal(
    dashboard.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  const snapshot = (await dashboard.json()) as {
    status: { counts: { registeredAgents: number } };
  };
  assert.equal(snapshot.status.counts.registeredAgents, 1);

  const unknown = await request(runtime, "/api/unknown-route", "viewer");
  assert.equal(unknown.status, 404);
  assert.equal(
    unknown.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.deepEqual(await unknown.json(), { error: { message: "not found" } });

  const unauthenticated = await request(runtime, "/api/dashboard");
  assert.equal(unauthenticated.status, 401);

  const unauthorized = await request(
    runtime,
    "/api/commands/disable-agent",
    "viewer",
    {
      method: "POST",
      body: JSON.stringify({ agentId: "control-plane-analysis-agent" }),
    },
  );
  assert.equal(unauthorized.status, 403);
});
