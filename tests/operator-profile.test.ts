/**
 * Operator profile photo — self-service, validated, audited, isolated.
 * Drives the real ProfileService + Control Plane HTTP API with in-memory and
 * fake-Firestore stores.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import { FirestoreOperatorProfileStore } from "../adapters/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  InMemoryOperatorAccountStore,
  InMemoryOperatorProfileStore,
  PermissionSystem,
  ProfileService,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  ValidationError,
  WorkflowSystem,
  validateAvatarDataUrl,
  type OperatorPrincipal,
} from "../core/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64")}`;
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString("base64")}`;

const PRINCIPALS: Record<string, OperatorPrincipal> = {
  "tok-alice": { id: "alice", role: "operator", allowedProjects: ["alpha"] },
  "tok-bob": { id: "bob", role: "viewer", allowedProjects: [] },
};

async function harness() {
  const audit = new AuditLog();
  const accounts = new InMemoryOperatorAccountStore();
  await accounts.commit({
    kind: "create_pending",
    account: {
      id: "alice",
      status: "pending",
      allowedProjects: [],
      email: "alice@example.test",
      displayName: "Alice",
      emailVerified: true,
      requestedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      revision: 1,
    },
  });
  const profile = new ProfileService({
    profiles: new InMemoryOperatorProfileStore(),
    accounts,
    audit,
  });
  const ctx: ControlPlaneContext = {
    agents: new AgentRegistry(),
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: new ApprovalSystem(),
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(audit),
    projects: new ProjectRegistry(),
    audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
  };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: { resolve: async (t) => PRINCIPALS[t] ?? null },
      profile,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const call = async (
    method: string,
    path: string,
    token?: string,
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
    audit,
    call,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("profile: GET returns identity from the account and the principal's role", async () => {
  const h = await harness();
  try {
    const res = await h.call("GET", "/me/profile", "tok-alice");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      operatorId: "alice",
      displayName: "Alice",
      email: "alice@example.test",
      emailVerified: true,
      role: "operator",
      allowedProjects: ["alpha"],
    });
    assert.equal((await h.call("GET", "/me/profile")).status, 401);
  } finally {
    await h.close();
  }
});

test("profile: upload and remove a photo, only for the caller, audited without image data", async () => {
  const h = await harness();
  try {
    const put = await h.call("PUT", "/me/profile/photo", "tok-alice", {
      dataUrl: PNG,
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.avatarDataUrl, PNG);
    // Another operator never sees Alice's photo, and cannot target her.
    const bob = await h.call("PUT", "/me/profile/photo", "tok-bob", {
      dataUrl: JPEG,
      operatorId: "alice",
    });
    assert.equal(bob.body.operatorId, "bob");
    assert.equal(
      (await h.call("GET", "/me/profile", "tok-alice")).body.avatarDataUrl,
      PNG,
    );

    const del = await h.call("DELETE", "/me/profile/photo", "tok-alice");
    assert.equal(del.status, 200);
    assert.equal(del.body.avatarDataUrl, undefined);

    const events = h.audit.query({ type: "access_event" });
    assert.deepEqual(
      events.map((e) => [e.data.action, e.data.operatorId]),
      [
        ["profile_photo_updated", "alice"],
        ["profile_photo_updated", "bob"],
        ["profile_photo_removed", "alice"],
      ],
    );
    assert.ok(!JSON.stringify(events).includes("base64"));
  } finally {
    await h.close();
  }
});

test("profile: rejects non-images, spoofed types, SVG and oversize payloads", async () => {
  const h = await harness();
  try {
    for (const dataUrl of [
      undefined,
      "https://example.test/me.png",
      "data:image/svg+xml;base64,PHN2Zy8+",
      `data:image/png;base64,${Buffer.from("not a png").toString("base64")}`,
      `data:image/jpeg;base64,${Buffer.alloc(300 * 1024, 0xff).toString("base64")}`,
    ]) {
      const res = await h.call("PUT", "/me/profile/photo", "tok-alice", {
        dataUrl,
      });
      assert.equal(res.status, 400, String(dataUrl).slice(0, 40));
    }
    assert.equal(
      (await h.call("POST", "/me/profile/photo", "tok-alice", {})).status,
      405,
    );
  } finally {
    await h.close();
  }
  assert.equal(validateAvatarDataUrl(JPEG), JPEG);
  assert.throws(() => validateAvatarDataUrl(42), ValidationError);
});

test("profile: Firestore store round-trips and deletes operator_profiles docs", async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreOperatorProfileStore(firestore);
  await store.save({ id: "alice", avatarDataUrl: PNG, updatedAt: "t1" });
  assert.deepEqual(await store.get("alice"), {
    id: "alice",
    avatarDataUrl: PNG,
    updatedAt: "t1",
  });
  await store.remove("alice");
  assert.equal(await store.get("alice"), undefined);
});
