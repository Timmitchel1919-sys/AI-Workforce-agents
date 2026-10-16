/**
 * UI Layer 7 — lost-device response ("sign out all devices").
 *
 * Revocation is server-enforced: every ID token issued before the cut-off is
 * refused on the very next request (protected routes AND /me/access), the
 * identity provider's refresh tokens are revoked, the action is audited, and
 * only an active operator with a still-valid token can trigger it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON response bodies are asserted field by field */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createControlPlaneApi } from "../api/index.js";
import {
  FirebaseOperatorDirectory,
  type DecodedTokenLike,
  type FirebaseAuthLike,
} from "../adapters/index.js";
import {
  AgentOperationalStore,
  WorkflowControlStore,
  WorkforceCommandService,
  WorkforceQueryService,
  type ControlPlaneContext,
} from "../control/index.js";
import {
  AccessService,
  InMemoryExecutionRecordStore,
  LockdownService,
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  InMemoryOperatorAccountStore,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
} from "../core/index.js";

/** Tokens look like `tok-<uid>-<iat>`. */
class FakeAuth implements FirebaseAuthLike {
  revoked: string[] = [];
  async verifyIdToken(token: string): Promise<DecodedTokenLike> {
    const m = /^tok-([a-z0-9-]+?)-(\d+)$/.exec(token);
    if (!m) throw new Error("invalid token");
    return {
      uid: m[1]!,
      iat: Number(m[2]),
      auth_time: Number(m[2]),
      email_verified: true,
    };
  }
  async revokeRefreshTokens(uid: string) {
    this.revoked.push(uid);
  }
}

async function setup(now: { iso: string }) {
  const accounts = new InMemoryOperatorAccountStore();
  const base = {
    allowedProjects: "*" as const,
    emailVerified: true,
    requestedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    revision: 1,
  };
  await accounts.commit({
    kind: "create_pending",
    account: { id: "owner", status: "active", role: "admin", ...base },
  });
  await accounts.commit({
    kind: "create_pending",
    account: { id: "viewer", status: "active", role: "viewer", ...base },
  });
  await accounts.commit({
    kind: "create_pending",
    account: { id: "newbie", status: "pending", ...base, allowedProjects: [] },
  });
  const auth = new FakeAuth();
  const audit = new AuditLog();
  const projects = new ProjectRegistry();
  const access = new AccessService({
    store: accounts,
    audit,
    projects,
    clock: () => now.iso,
    identityProvider: auth,
  });
  const directory = new FirebaseOperatorDirectory(auth, accounts);
  const ctx: ControlPlaneContext = {
    agents: new AgentRegistry(),
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: new ApprovalSystem(),
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(),
    projects,
    audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
  };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: directory,
      identityVerifier: directory,
      access,
      lockdown: new LockdownService(
        new InMemoryExecutionRecordStore(),
        audit,
        () => Date.parse(now.iso),
      ),
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
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
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : null) as any,
    };
  };
  return {
    auth,
    audit,
    accounts,
    call,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

test("L7 LOST DEVICE: sign out all devices refuses every earlier token immediately", async () => {
  const now = { iso: "2026-10-15T12:00:00.000Z" };
  const s = await setup(now);
  try {
    const stolen = `tok-owner-${sec("2026-10-15T11:00:00.000Z")}`;
    assert.equal(
      (await s.call("GET", "/agents", stolen)).status,
      200,
      "token works before revocation",
    );

    const revoke = await s.call("POST", "/me/sessions/revoke", stolen);
    assert.equal(revoke.status, 200, JSON.stringify(revoke.body));
    assert.equal(revoke.body.sessionsValidAfter, sec(now.iso));
    assert.equal(revoke.body.refreshTokensRevoked, true);
    assert.deepEqual(s.auth.revoked, ["owner"]);

    // The stolen (earlier) token is dead everywhere, including /me/access.
    assert.equal((await s.call("GET", "/agents", stolen)).status, 401);
    assert.equal((await s.call("GET", "/me/access", stolen)).status, 401);
    assert.equal(
      (await s.call("POST", "/me/sessions/revoke", stolen)).status,
      401,
      "a revoked token cannot act",
    );

    // The owner signs in again on a trusted device: a NEW token works.
    const fresh = `tok-owner-${sec("2026-10-15T12:05:00.000Z")}`;
    assert.equal((await s.call("GET", "/agents", fresh)).status, 200);
    assert.equal((await s.call("GET", "/me/access", fresh)).status, 200);

    // Audited, without any token material.
    const events = s.audit
      .query({})
      .filter((e) => (e.data as any)?.action === "sessions_revoked");
    assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events).includes("tok-owner"));
  } finally {
    await s.close();
  }
});

test("L7 LOST DEVICE: only an active, authenticated operator can revoke; repeat is idempotent", async () => {
  const now = { iso: "2026-10-15T12:00:00.000Z" };
  const s = await setup(now);
  try {
    assert.equal((await s.call("POST", "/me/sessions/revoke")).status, 401);
    assert.equal(
      (await s.call("POST", "/me/sessions/revoke", "tok-newbie-1")).status,
      401,
      "pending accounts cannot",
    );
    const t1 = `tok-owner-${sec(now.iso)}`;
    assert.equal((await s.call("POST", "/me/sessions/revoke", t1)).status, 200);
    // A token issued in the same second as the cut-off stays valid (not earlier).
    assert.equal((await s.call("GET", "/agents", t1)).status, 200);
    now.iso = "2026-10-15T12:10:00.000Z";
    assert.equal((await s.call("POST", "/me/sessions/revoke", t1)).status, 200);
    assert.equal((await s.call("GET", "/agents", t1)).status, 401);
    const account = await s.accounts.get("owner");
    assert.equal(account?.sessionsValidAfter, sec(now.iso));
    assert.equal(
      account?.status,
      "active",
      "the owner is never locked out of the account itself",
    );
  } finally {
    await s.close();
  }
});

test("L11 LOCKDOWN: admin + recent sign-in only; blocks every command; idempotent; lift restores", async () => {
  const now = { iso: "2026-10-16T12:00:00.000Z" };
  const s = await setup(now);
  try {
    const fresh = `tok-owner-${sec(now.iso) - 60}`;
    const stale = `tok-owner-${sec(now.iso) - 3600}`;
    const viewer = `tok-viewer-${sec(now.iso)}`;
    const st = await s.call("GET", "/platform/lockdown", viewer);
    assert.equal(st.body?.active, false, JSON.stringify(st));
    assert.equal(
      (await s.call("POST", "/platform/lockdown", undefined, { reason: "x" }))
        .status,
      401,
    );
    assert.equal(
      (await s.call("POST", "/platform/lockdown", viewer, { reason: "x" }))
        .status,
      403,
      "not an admin",
    );
    assert.equal(
      (await s.call("POST", "/platform/lockdown", stale, { reason: "x" }))
        .status,
      403,
      "sign-in too old",
    );
    assert.equal(
      (await s.call("POST", "/platform/lockdown", fresh, {})).status,
      400,
      "reason required",
    );

    const on = await s.call("POST", "/platform/lockdown", fresh, {
      reason: "phone stolen",
    });
    assert.equal(on.status, 200);
    assert.equal(on.body.active, true);
    const again = await s.call("POST", "/platform/lockdown", fresh, {
      reason: "again",
    });
    assert.equal(again.body.revision, on.body.revision, "idempotent");

    // Every command is refused, even for the administrator; reads still work.
    const cmd = await s.call("POST", "/commands/approve", fresh, {
      approvalId: "a1",
    });
    assert.equal(cmd.status, 423);
    assert.equal((await s.call("GET", "/agents", fresh)).status, 200);
    // Sign-out everywhere still works during lockdown (it only reduces access).
    assert.equal(
      (await s.call("POST", "/platform/lockdown/lift", stale)).status,
      403,
      "lift needs step-up too",
    );

    const off = await s.call("POST", "/platform/lockdown/lift", fresh);
    assert.equal(off.body.active, false);
    assert.notEqual(
      (await s.call("POST", "/commands/approve", fresh, { approvalId: "a1" }))
        .status,
      423,
    );
    const events = s.audit
      .query({})
      .filter((e) => String((e.data as any)?.action).startsWith("lockdown_"));
    assert.deepEqual(
      events.map((e) => (e.data as any).action),
      ["lockdown_activated", "lockdown_lifted"],
    );
  } finally {
    await s.close();
  }
});
