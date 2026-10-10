/**
 * AUTHZ-1 — initial administrator bootstrap, access approval and operator
 * lifecycle.
 *
 * Authentication ≠ authorization: a verified Firebase identity alone grants
 * nothing. Only an ACTIVE operator account does. These tests drive the real
 * FirebaseOperatorDirectory + AccessService + Control Plane HTTP API against
 * in-memory / fake Firestore stores — never a real project.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  bootstrapInitialAdministrator,
  createControlPlaneApi,
  maskIdentifier,
} from "../api/index.js";
import {
  FirebaseOperatorDirectory,
  FirestoreOperatorAccountStore,
  type DecodedTokenLike,
  type FirebaseAuthLike,
  type FirebaseServices,
  type FirebaseUserRecordLike,
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
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  InMemoryOperatorAccountStore,
  LastAdministratorError,
  PermissionSystem,
  ProjectRegistry,
  TaskSystem,
  ToolRegistry,
  WorkflowSystem,
  type OperatorAccountStore,
  type ProjectAdapter,
} from "../core/index.js";
import { FakeFirestore } from "./fixtures/fake-firestore.js";

/* ------------------------------------------------------------------ */
/* Fakes                                                              */
/* ------------------------------------------------------------------ */

const USERS: Record<string, FirebaseUserRecordLike> = {
  "owner-uid-1": {
    uid: "owner-uid-1",
    email: "owner@example.test",
    displayName: "Owner",
    emailVerified: false,
    disabled: false,
  },
  "second-uid-2": {
    uid: "second-uid-2",
    email: "second@example.test",
    emailVerified: true,
    disabled: false,
  },
  "disabled-uid-3": {
    uid: "disabled-uid-3",
    emailVerified: true,
    disabled: true,
  },
};

/** token → decoded claims. Tokens are "tok-<uid>". */
class FakeAuth implements FirebaseAuthLike {
  async verifyIdToken(token: string): Promise<DecodedTokenLike> {
    const uid = token.startsWith("tok-") ? token.slice(4) : "";
    if (!uid) throw new Error("invalid token");
    const user = USERS[uid];
    return {
      uid,
      ...(user?.email
        ? { email: user.email }
        : { email: `${uid}@example.test` }),
      email_verified: user?.emailVerified ?? true,
    };
  }
  async getUser(uid: string): Promise<FirebaseUserRecordLike> {
    const user = USERS[uid];
    if (!user) throw new Error("auth/user-not-found");
    return user;
  }
}

function fakeServices(firestore: FakeFirestore): FirebaseServices {
  return {
    firestore,
    auth: new FakeAuth(),
    storage: {} as FirebaseServices["storage"],
    config: { projectId: "test-project", storageBucket: "b", emulated: true },
  };
}

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

async function harness(
  store: OperatorAccountStore = new InMemoryOperatorAccountStore(),
) {
  const audit = new AuditLog();
  const projects = new ProjectRegistry();
  projects.register(stubAdapter("alpha"));
  projects.register(stubAdapter("beta"));
  const access = new AccessService({ store, audit, projects });
  const directory = new FirebaseOperatorDirectory(new FakeAuth(), store);
  const ctx: ControlPlaneContext = {
    agents: new AgentRegistry(),
    tasks: new TaskSystem(),
    workflows: new WorkflowSystem(),
    approvals: new ApprovalSystem(),
    permissions: new PermissionSystem([]),
    tools: new ToolRegistry(audit),
    projects,
    audit,
    agentOps: new AgentOperationalStore(),
    workflowControl: new WorkflowControlStore(),
    access,
  };
  const server = http.createServer(
    createControlPlaneApi({
      query: new WorkforceQueryService(ctx),
      command: new WorkforceCommandService(ctx),
      operatorDirectory: directory,
      identityVerifier: directory,
      access,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const call = async (
    method: "GET" | "POST",
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
    store,
    access,
    audit,
    call,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Bootstrap an admin directly through the service (in-memory store). */
async function withAdmin(uid = "owner-uid-1") {
  const h = await harness();
  await h.access.bootstrapInitialAdmin({ uid, emailVerified: true });
  return h;
}

function accessActions(audit: AuditLog): unknown[] {
  return audit.query({ type: "access_event" }).map((e) => e.data.action);
}

/* ------------------------------------------------------------------ */
/* Bootstrap (trusted tool, transactional Firestore)                  */
/* ------------------------------------------------------------------ */

test("bootstrap: provisions the existing Firebase identity as the first admin, audited", async () => {
  const firestore = new FakeFirestore();
  const result = await bootstrapInitialAdministrator({
    services: fakeServices(firestore),
    uid: "owner-uid-1",
  });
  assert.equal(result.outcome, "created");

  const account = firestore.collection("operators").values.get("owner-uid-1");
  assert.equal(account?.status, "active");
  assert.equal(account?.role, "admin");
  assert.equal(account?.allowedProjects, "*");
  assert.equal(account?.bootstrap, true);
  assert.deepEqual(
    firestore.collection("access_control").values.get("summary"),
    {
      activeAdmins: 1,
    },
  );
  assert.equal(
    firestore.collection("access_control").values.get("bootstrap")?.operatorId,
    "owner-uid-1",
  );
  const audit = [...firestore.collection("audit_events").values.values()];
  assert.deepEqual(
    audit.map((e) => (e.data as { action: string }).action),
    ["initial_admin_bootstrapped"],
  );
  assert.doesNotMatch(JSON.stringify(audit), /tok-|password|secret/i);

  // The existing identity now authorizes — no new account, no email hardcoding.
  const directory = new FirebaseOperatorDirectory(
    new FakeAuth(),
    new FirestoreOperatorAccountStore(firestore),
  );
  assert.deepEqual(await directory.resolve("tok-owner-uid-1"), {
    id: "owner-uid-1",
    role: "admin",
    allowedProjects: "*",
  });
});

test("bootstrap: idempotent for the same admin; locked for anyone else", async () => {
  const firestore = new FakeFirestore();
  const services = fakeServices(firestore);
  await bootstrapInitialAdministrator({ services, uid: "owner-uid-1" });

  const again = await bootstrapInitialAdministrator({
    services,
    uid: "owner-uid-1",
  });
  assert.equal(again.outcome, "already_provisioned");
  assert.equal(firestore.collection("operators").values.size, 1);
  assert.deepEqual(
    firestore.collection("access_control").values.get("summary"),
    {
      activeAdmins: 1,
    },
  );

  const second = await bootstrapInitialAdministrator({
    services,
    uid: "second-uid-2",
  });
  assert.equal(second.outcome, "refused");
  assert.equal(
    firestore.collection("operators").values.has("second-uid-2"),
    false,
  );

  await assert.rejects(
    () => bootstrapInitialAdministrator({ services, uid: "unknown-uid-9" }),
    /no Firebase Authentication user/,
  );
  await assert.rejects(
    () => bootstrapInitialAdministrator({ services, uid: "disabled-uid-3" }),
    /disabled/,
  );
  await assert.rejects(
    () => bootstrapInitialAdministrator({ services, uid: "bad uid!" }),
    /not a valid Firebase UID/,
  );
  assert.equal(maskIdentifier("owner-uid-1"), "owne…-1");
});

/* ------------------------------------------------------------------ */
/* Sign-up → pending → approval → access                              */
/* ------------------------------------------------------------------ */

test("public sign-up: an authenticated identity is PENDING, never authorized", async () => {
  const h = await withAdmin();
  try {
    const me = await h.call("GET", "/me/access", "tok-newbie-7");
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, {
      authenticated: true,
      authorized: false,
      status: "pending",
      capabilities: [],
    });
    assert.equal((await h.store.get("newbie-7"))?.status, "pending");
    // Second visit: no duplicate request.
    await h.call("GET", "/me/access", "tok-newbie-7");
    assert.equal(
      accessActions(h.audit).filter((a) => a === "access_requested").length,
      1,
    );
    // Protected Control Plane stays closed.
    assert.equal((await h.call("GET", "/status", "tok-newbie-7")).status, 401);
  } finally {
    await h.close();
  }
});

test("missing operator and invalid tokens: safe pending / 401, never 500 or admin", async () => {
  const h = await harness();
  try {
    const me = await h.call("GET", "/me/access", "tok-ghost-5");
    assert.equal(me.status, 200);
    assert.equal(me.body.status, "pending");
    const bad = await h.call("GET", "/me/access", "not-a-token");
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.body, {
      error: { message: "authentication required" },
    });
    assert.equal((await h.call("GET", "/me/access")).status, 401);
    assert.equal(
      (await h.call("GET", "/operators", "not-a-token")).status,
      401,
    );
  } finally {
    await h.close();
  }
});

test("approval: admin approves with a role → ACTIVE, audited; Check Access Again grants", async () => {
  const h = await withAdmin();
  try {
    await h.call("GET", "/me/access", "tok-newbie-7");
    const list = await h.call("GET", "/operators", "tok-owner-uid-1");
    assert.equal(list.status, 200);
    const pending = (
      list.body as unknown as { operatorId: string; status: string }[]
    ).find((a) => a.operatorId === "newbie-7");
    assert.equal(pending?.status, "pending");

    const approved = await h.call(
      "POST",
      "/commands/approve-access",
      "tok-owner-uid-1",
      {
        operatorId: "newbie-7",
        role: "operator",
        allowedProjects: ["alpha"],
      },
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.outcome, "executed");

    // "Check access again": the backend now says authorized.
    const me = await h.call("GET", "/me/access", "tok-newbie-7");
    assert.equal(me.body.authorized, true);
    assert.equal(me.body.role, "operator");
    assert.deepEqual(me.body.allowedProjects, ["alpha"]);
    assert.ok(
      (me.body.capabilities as string[]).includes("create_execution_plan"),
    );
    assert.ok(!(me.body.capabilities as string[]).includes("manage_access"));
    assert.equal((await h.call("GET", "/status", "tok-newbie-7")).status, 200);
    assert.deepEqual(accessActions(h.audit), [
      "initial_admin_bootstrapped",
      "access_requested",
      "access_approved",
    ]);
  } finally {
    await h.close();
  }
});

test("approval validation: role must exist, projects must be registered", async () => {
  const h = await withAdmin();
  try {
    await h.call("GET", "/me/access", "tok-newbie-7");
    const badRole = await h.call(
      "POST",
      "/commands/approve-access",
      "tok-owner-uid-1",
      {
        operatorId: "newbie-7",
        role: "superuser",
        allowedProjects: "*",
      },
    );
    assert.equal(badRole.status, 400);
    const badProject = await h.call(
      "POST",
      "/commands/approve-access",
      "tok-owner-uid-1",
      {
        operatorId: "newbie-7",
        role: "viewer",
        allowedProjects: ["ghost"],
      },
    );
    assert.equal(badProject.status, 400);
    const unknown = await h.call(
      "POST",
      "/commands/approve-access",
      "tok-owner-uid-1",
      {
        operatorId: "nobody",
        role: "viewer",
        allowedProjects: "*",
      },
    );
    assert.equal(unknown.status, 404);
    assert.equal((await h.store.get("newbie-7"))?.status, "pending");
  } finally {
    await h.close();
  }
});

test("rejection: stays locked out, status shown, audited", async () => {
  const h = await withAdmin();
  try {
    await h.call("GET", "/me/access", "tok-newbie-7");
    const res = await h.call(
      "POST",
      "/commands/reject-access",
      "tok-owner-uid-1",
      {
        operatorId: "newbie-7",
        reason: "unknown requester",
      },
    );
    assert.equal(res.status, 200);
    const me = await h.call("GET", "/me/access", "tok-newbie-7");
    assert.equal(me.body.status, "rejected");
    assert.equal(me.body.authorized, false);
    assert.equal((await h.call("GET", "/status", "tok-newbie-7")).status, 401);
    assert.ok(accessActions(h.audit).includes("access_rejected"));
  } finally {
    await h.close();
  }
});

test("suspension and revocation take effect on the very next request", async () => {
  const h = await withAdmin();
  try {
    await h.call("GET", "/me/access", "tok-newbie-7");
    await h.call("POST", "/commands/approve-access", "tok-owner-uid-1", {
      operatorId: "newbie-7",
      role: "viewer",
      allowedProjects: "*",
    });
    assert.equal((await h.call("GET", "/status", "tok-newbie-7")).status, 200);

    await h.call("POST", "/commands/suspend-access", "tok-owner-uid-1", {
      operatorId: "newbie-7",
    });
    assert.equal((await h.call("GET", "/status", "tok-newbie-7")).status, 401);
    assert.equal(
      (await h.call("GET", "/me/access", "tok-newbie-7")).body.status,
      "suspended",
    );

    await h.call("POST", "/commands/reactivate-access", "tok-owner-uid-1", {
      operatorId: "newbie-7",
    });
    assert.equal((await h.call("GET", "/status", "tok-newbie-7")).status, 200);

    await h.call("POST", "/commands/revoke-access", "tok-owner-uid-1", {
      operatorId: "newbie-7",
    });
    assert.equal((await h.call("GET", "/status", "tok-newbie-7")).status, 401);
    const again = await h.call(
      "POST",
      "/commands/reactivate-access",
      "tok-owner-uid-1",
      {
        operatorId: "newbie-7",
      },
    );
    assert.equal(again.status, 409);
    assert.deepEqual(accessActions(h.audit).slice(-4), [
      "access_approved",
      "operator_suspended",
      "operator_reactivated",
      "access_revoked",
    ]);
  } finally {
    await h.close();
  }
});

test("role change: validated and audited; self-change refused", async () => {
  const h = await withAdmin();
  try {
    await h.call("GET", "/me/access", "tok-newbie-7");
    await h.call("POST", "/commands/approve-access", "tok-owner-uid-1", {
      operatorId: "newbie-7",
      role: "viewer",
      allowedProjects: ["alpha"],
    });
    const changed = await h.call(
      "POST",
      "/commands/change-operator-role",
      "tok-owner-uid-1",
      {
        operatorId: "newbie-7",
        role: "operator",
      },
    );
    assert.equal(changed.status, 200);
    assert.equal((await h.store.get("newbie-7"))?.role, "operator");
    assert.deepEqual((await h.store.get("newbie-7"))?.allowedProjects, [
      "alpha",
    ]);
    const event = h.audit.query({ type: "access_event" }).at(-1);
    assert.equal(event?.data.fromRole, "viewer");
    assert.equal(event?.data.toRole, "operator");

    const self = await h.call(
      "POST",
      "/commands/suspend-access",
      "tok-owner-uid-1",
      {
        operatorId: "owner-uid-1",
      },
    );
    assert.equal(self.status, 403);
  } finally {
    await h.close();
  }
});

/* ------------------------------------------------------------------ */
/* Privilege escalation / direct API attacks                          */
/* ------------------------------------------------------------------ */

test("privilege escalation: non-admins cannot list or change access, even by direct API call", async () => {
  const h = await withAdmin();
  try {
    for (const uid of ["op-1", "viewer-1"]) {
      await h.call("GET", "/me/access", `tok-${uid}`);
    }
    await h.call("POST", "/commands/approve-access", "tok-owner-uid-1", {
      operatorId: "op-1",
      role: "operator",
      allowedProjects: "*",
    });
    await h.call("POST", "/commands/approve-access", "tok-owner-uid-1", {
      operatorId: "viewer-1",
      role: "viewer",
      allowedProjects: "*",
    });
    await h.call("GET", "/me/access", "tok-mallory-9");

    assert.equal((await h.call("GET", "/operators", "tok-op-1")).status, 403);
    assert.equal(
      (await h.call("GET", "/operators", "tok-viewer-1")).status,
      403,
    );
    for (const [command, body] of [
      [
        "approve-access",
        { operatorId: "mallory-9", role: "admin", allowedProjects: "*" },
      ],
      ["change-operator-role", { operatorId: "op-1", role: "admin" }],
      ["suspend-access", { operatorId: "owner-uid-1" }],
    ] as const) {
      const res = await h.call(
        "POST",
        `/commands/${command}`,
        "tok-op-1",
        body,
      );
      assert.equal(res.status, 403, command);
    }
    // A pending user cannot approve themselves either.
    assert.equal(
      (
        await h.call("POST", "/commands/approve-access", "tok-mallory-9", {
          operatorId: "mallory-9",
          role: "admin",
          allowedProjects: "*",
        })
      ).status,
      401,
    );
    assert.equal((await h.store.get("mallory-9"))?.status, "pending");
    assert.equal((await h.store.get("op-1"))?.role, "operator");
  } finally {
    await h.close();
  }
});

/* ------------------------------------------------------------------ */
/* Concurrency + last administrator                                   */
/* ------------------------------------------------------------------ */

test("concurrent approvals of one pending account: exactly one wins", async () => {
  const h = await withAdmin();
  try {
    await h.access.bootstrapInitialAdmin({
      uid: "owner-uid-1",
      emailVerified: true,
    });
    // A second administrator, approved by the first.
    await h.call("GET", "/me/access", "tok-admin-2");
    await h.call("POST", "/commands/approve-access", "tok-owner-uid-1", {
      operatorId: "admin-2",
      role: "admin",
      allowedProjects: "*",
    });
    await h.call("GET", "/me/access", "tok-newbie-7");
    const results = await Promise.all([
      h.call("POST", "/commands/approve-access", "tok-owner-uid-1", {
        operatorId: "newbie-7",
        role: "viewer",
        allowedProjects: "*",
      }),
      h.call("POST", "/commands/approve-access", "tok-admin-2", {
        operatorId: "newbie-7",
        role: "operator",
        allowedProjects: "*",
      }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await h.store.get("newbie-7"))?.revision, 2);
  } finally {
    await h.close();
  }
});

test("last administrator: two admins revoking each other cannot leave zero admins", async () => {
  const store = new InMemoryOperatorAccountStore();
  const h = await harness(store);
  try {
    await h.access.bootstrapInitialAdmin({
      uid: "owner-uid-1",
      emailVerified: true,
    });
    await h.call("GET", "/me/access", "tok-admin-2");
    await h.call("POST", "/commands/approve-access", "tok-owner-uid-1", {
      operatorId: "admin-2",
      role: "admin",
      allowedProjects: "*",
    });
    const results = await Promise.all([
      h.call("POST", "/commands/revoke-access", "tok-owner-uid-1", {
        operatorId: "admin-2",
      }),
      h.call("POST", "/commands/revoke-access", "tok-admin-2", {
        operatorId: "owner-uid-1",
      }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // One revocation succeeds; the other is refused (409 or 401 once revoked).
    assert.equal(statuses.filter((s) => s === 200).length, 1);
    const accounts = await store.list();
    assert.equal(
      accounts.filter((a) => a.status === "active" && a.role === "admin")
        .length,
      1,
    );
  } finally {
    await h.close();
  }
});

test("last administrator: the store refuses to remove the final active admin", async () => {
  const store = new InMemoryOperatorAccountStore();
  const access = new AccessService({
    store,
    audit: new AuditLog(),
    projects: { has: () => true },
  });
  await access.bootstrapInitialAdmin({
    uid: "owner-uid-1",
    emailVerified: true,
  });
  const owner = (await store.get("owner-uid-1"))!;
  await assert.rejects(
    () =>
      store.commit({
        kind: "update",
        account: {
          ...owner,
          status: "suspended",
          revision: owner.revision + 1,
        },
        expectedRevision: owner.revision,
        activeAdminDelta: -1,
      }),
    LastAdministratorError,
  );
  assert.equal((await store.get("owner-uid-1"))?.status, "active");
});

test("Firestore store: approval commits transactionally with revision checks", async () => {
  const firestore = new FakeFirestore();
  await bootstrapInitialAdministrator({
    services: fakeServices(firestore),
    uid: "owner-uid-1",
  });
  const h = await harness(new FirestoreOperatorAccountStore(firestore));
  try {
    await h.call("GET", "/me/access", "tok-newbie-7");
    const res = await h.call(
      "POST",
      "/commands/approve-access",
      "tok-owner-uid-1",
      {
        operatorId: "newbie-7",
        role: "viewer",
        allowedProjects: "*",
      },
    );
    assert.equal(res.status, 200);
    assert.equal(
      firestore.collection("operators").values.get("newbie-7")?.status,
      "active",
    );
    assert.ok(firestore.transactions >= 3);
  } finally {
    await h.close();
  }
});
