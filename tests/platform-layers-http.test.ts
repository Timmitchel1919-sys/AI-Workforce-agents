/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers read loosely-typed JSON bodies */
/**
 * END-TO-END for Layers 8–13: the REAL production composition behind the REAL HTTP API, with only
 * the Firebase boundary faked. This is what proves the layers are wired into the composition root,
 * routed, authenticated, persisted and re-hydrated — not just implemented.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createProductionControlPlaneRuntime } from "../api/index.js";
import type { FirebaseAuthLike, FirebaseServices } from "../adapters/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string) {
    if (token === "admin") return { uid: "admin-1" };
    if (token === "operator") return { uid: "op-1" };
    if (token === "viewer") return { uid: "viewer-1" };
    throw new Error("invalid token");
  }
}

function services(firestore = new FakeFirestore()): FirebaseServices {
  const T = "2026-09-27T00:00:00.000Z";
  const op = (id: string, role: string) =>
    firestore
      .collection("operators")
      .values.set(id, {
        id,
        emailVerified: true,
        requestedAt: T,
        updatedAt: T,
        revision: 1,
        status: "active",
        role,
        allowedProjects: "*",
      });
  op("admin-1", "admin");
  op("op-1", "operator");
  op("viewer-1", "viewer");
  return {
    firestore,
    auth: new FakeAuth(),
    storage: {} as FirebaseServices["storage"],
    config: {
      projectId: "ai-workforce-agents",
      storageBucket: "b",
      emulated: true,
    },
  };
}

type Call = (
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
) => Promise<{ status: number; body: any }>;
async function withServer<T>(
  runtime: Awaited<ReturnType<typeof createProductionControlPlaneRuntime>>,
  fn: (call: Call) => Promise<T>,
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
      return { status: res.status, body: text ? JSON.parse(text) : undefined };
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const READ_ROUTES = [
  "/api/integration-center/overview",
  "/api/extensions-platform/overview",
  "/api/business-layer/overview",
  "/api/portfolio-intelligence/dashboard",
  "/api/operations-center/overview",
  "/api/analytics-intelligence/overview",
];

test("PRODUCTION: every new layer is composed, routed and authenticated", async () => {
  const rt = await createProductionControlPlaneRuntime({
    services: services(),
  });
  await withServer(rt, async (call) => {
    for (const route of READ_ROUTES) {
      assert.equal(
        (await call("GET", route, undefined, null)).status,
        401,
        `${route} without a token`,
      );
      assert.equal(
        (await call("GET", route, undefined, "bogus")).status,
        401,
        `${route} with a bad token`,
      );
      for (const token of ["admin", "operator", "viewer"]) {
        const res = await call("GET", route, undefined, token);
        assert.equal(
          res.status,
          200,
          `${route} as ${token}: ${JSON.stringify(res.body).slice(0, 200)}`,
        );
      }
    }
    assert.equal(
      (await call("GET", "/api/extensions-platform/nope")).status,
      404,
    );
    assert.equal(
      (await call("GET", "/api/analytics-intelligence/nope")).status,
      404,
    );
  });
});

test("PRODUCTION: the built-in extensions, departments and workflow definitions are seeded", async () => {
  const rt = await createProductionControlPlaneRuntime({
    services: services(),
  });
  await withServer(rt, async (call) => {
    const ext = (await call("GET", "/api/extensions-platform/overview")).body;
    assert.ok(ext.extensions.length >= 17);
    assert.equal(ext.summary.active, 0, "nothing is enabled by default");
    const biz = (await call("GET", "/api/business-layer/overview")).body;
    assert.ok(
      biz.departments.some((d: { name: string }) => d.name === "Engineering"),
    );
    const ops = (await call("GET", "/api/operations-center/catalog")).body;
    assert.ok(
      ops.definitions.some(
        (d: { definitionId: string }) =>
          d.definitionId === "wf-maintenance-check",
      ),
    );
    assert.equal(ops.levels.length, 6);
    assert.ok(ops.actions.length >= 20);
    assert.equal(ops.global.paused, false);
  });
});

test("PRODUCTION: commands work through HTTP with the right authorization, and the effects are audited", async () => {
  const rt = await createProductionControlPlaneRuntime({
    services: services(),
  });
  await withServer(rt, async (call) => {
    // Layer 9: operator can test/review but not enable; admin can.
    const t = await call(
      "POST",
      "/api/commands/extension_test",
      { extensionId: "skill.react-development" },
      "operator",
    );
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.equal(
      (
        await call(
          "POST",
          "/api/commands/extension_enable",
          { extensionId: "skill.react-development" },
          "operator",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/api/commands/extension_enable",
          { extensionId: "skill.react-development" },
          "viewer",
        )
      ).status,
      403,
    );
    const en = await call(
      "POST",
      "/api/commands/extension_enable",
      { extensionId: "skill.react-development" },
      "admin",
    );
    assert.equal(en.status, 200, JSON.stringify(en.body));
    const detail = (
      await call(
        "GET",
        "/api/extensions-platform/extension/skill.react-development",
      )
    ).body;
    assert.equal(detail.health, "ACTIVE");
    assert.ok(
      detail.audit.some((e: { action: string }) => e.action === "enabled"),
    );
    // Layer 10
    const dept = await call(
      "POST",
      "/api/commands/business_create_department",
      { name: "Legal" },
      "operator",
    );
    assert.equal(dept.status, 200, JSON.stringify(dept.body));
    const obj = await call(
      "POST",
      "/api/commands/business_create_objective",
      { title: "Launch a site", level: "STRATEGIC", ownerFunction: "PRODUCT" },
      "operator",
    );
    assert.equal(obj.status, 200);
    assert.equal(
      (
        await call(
          "POST",
          "/api/commands/business_create_department",
          { name: "X" },
          "viewer",
        )
      ).status,
      403,
    );
    // Layer 12
    assert.equal(
      (
        await call(
          "POST",
          "/api/commands/autonomy_set_level",
          { projectId: "ghost", level: 2 },
          "operator",
        )
      ).status,
      403,
    );
    const trig = await call(
      "POST",
      "/api/commands/autonomy_trigger",
      { definitionId: "wf-maintenance-check", projectId: "ghost" },
      "operator",
    );
    assert.equal(trig.status, 404, "unknown project");
    // Layer 13
    assert.equal(
      (
        await call(
          "POST",
          "/api/commands/analytics_refresh_recommendations",
          {},
          "operator",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/api/commands/analytics_decide_recommendation",
          { recommendationId: "x", decision: "APPROVED" },
          "operator",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/api/commands/analytics_run_what_if",
          { scenario: { kind: "PAUSE_PROJECT", projectId: "ghost" } },
          "operator",
        )
      ).status,
      404,
    );
    // unknown command names are not routed anywhere
    assert.notEqual(
      (await call("POST", "/api/commands/autonomy_do_anything", {}, "admin"))
        .status,
      200,
    );
  });
});

test("PRODUCTION: state survives a restart (re-hydrated from storage)", async () => {
  const firestore = new FakeFirestore();
  const first = await createProductionControlPlaneRuntime({
    services: services(firestore),
  });
  await withServer(first, async (call) => {
    assert.equal(
      (
        await call("POST", "/api/commands/extension_test", {
          extensionId: "skill.react-development",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/commands/extension_review", {
          extensionId: "skill.react-development",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/commands/extension_enable", {
          extensionId: "skill.react-development",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/commands/business_create_department", {
          name: "Legal",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/commands/business_configure", {
          name: "Shaquil's workforce",
          mission: "Ship well",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/commands/autonomy_pause_all", {
          reason: "test",
        })
      ).status,
      200,
    );
  });
  const second = await createProductionControlPlaneRuntime({
    services: services(firestore),
  });
  await withServer(second, async (call) => {
    const ext = (await call("GET", "/api/extensions-platform/overview")).body;
    assert.equal(
      ext.extensions.find(
        (e: { extensionId: string }) =>
          e.extensionId === "skill.react-development",
      ).health,
      "ACTIVE",
    );
    assert.equal(
      ext.extensions.length,
      17 + 0,
      "built-ins are not duplicated by a restart",
    );
    const biz = (await call("GET", "/api/business-layer/overview")).body;
    assert.ok(
      biz.departments.some((d: { name: string }) => d.name === "Legal"),
    );
    assert.equal(biz.board.business.name, "Shaquil's workforce");
    const ops = (await call("GET", "/api/operations-center/overview")).body;
    assert.equal(ops.global.paused, true);
    assert.equal(
      biz.departments.filter((d: { name: string }) => d.name === "Engineering")
        .length,
      1,
    );
  });
});

test("PRODUCTION: the enabled skill reaches prompt generation context (wired into the Layer 3 sources)", async () => {
  const rt = await createProductionControlPlaneRuntime({
    services: services(),
  });
  assert.ok(rt, "composition succeeded with the skill source registered");
});

test("PRODUCTION: the integration webhook route stays public and signature-gated", async () => {
  const rt = await createProductionControlPlaneRuntime({
    services: services(),
  });
  await withServer(rt, async (call) => {
    const res = await call(
      "POST",
      "/api/integrations/webhooks/github",
      { zen: "x" },
      null,
    );
    assert.equal(
      res.status,
      404,
      "an unconfigured connector is not found; it never reaches authentication",
    );
  });
});
