import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  createControlPlaneApi,
  FirebaseAppAttestationVerifier,
  type AppCheckVerifierSeam,
} from "../api/index.js";
import { InMemoryOperatorAccountStore } from "../core/index.js";
import { FirebaseOperatorDirectory } from "../adapters/index.js";
import type { DecodedTokenLike, FirebaseAuthLike } from "../adapters/index.js";
import type { WorkforceCommandService, WorkforceQueryService } from "../control/index.js";

class FakeAuth implements FirebaseAuthLike {
  constructor(private readonly tokens: Record<string, DecodedTokenLike>) {}
  async verifyIdToken(idToken: string): Promise<DecodedTokenLike> {
    const decoded = this.tokens[idToken];
    if (!decoded) throw new Error("token expired or invalid");
    return decoded;
  }
}

class FakeAppCheck implements AppCheckVerifierSeam {
  constructor(private readonly validTokens: Set<string>) {}
  async verifyToken(token: string) {
    if (!this.validTokens.has(token)) {
      throw new Error("App Check token invalid");
    }
    return { appId: "test-app-id" };
  }
}

function buildTestServer(appCheckMode: "disabled" | "monitor" | "enforced" = "enforced") {
  const accounts = new InMemoryOperatorAccountStore();
  const T = "2026-10-10T00:00:00.000Z";

  // Active admin operator
  accounts.commit({
    kind: "create_pending",
    account: {
      id: "admin-uid",
      status: "active",
      role: "admin",
      allowedProjects: "*",
      emailVerified: true,
      requestedAt: T,
      updatedAt: T,
      revision: 1,
    },
  });

  const auth = new FakeAuth({
    "token-admin": { uid: "admin-uid", email: "admin@example.test", email_verified: true },
  });

  const appCheckSeam = new FakeAppCheck(new Set(["valid-app-check-token"]));
  const appAttestationVerifier = new FirebaseAppAttestationVerifier(appCheckSeam, appCheckMode);
  const operatorDirectory = new FirebaseOperatorDirectory(auth, accounts);

  const query = {} as unknown as WorkforceQueryService;
  const command = {} as unknown as WorkforceCommandService;
  const access = {
    myAccess: async () => ({ authenticated: true as const, authorized: true, status: "active" as const, role: "admin" as const, capabilities: ["view" as const] }),
  };

  const handler = createControlPlaneApi({
    query,
    command,
    operatorDirectory,
    identityVerifier: operatorDirectory,
    access,
    appAttestationVerifier,
    appCheckMode,
  });

  const server = createServer(handler);
  return { server, accounts, auth };
}

test("full security chain: authorized request with valid Auth and App Check succeeds", async () => {
  const { server } = buildTestServer("enforced");
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://localhost:${port}/api/me/access`, {
      headers: {
        Authorization: "Bearer token-admin",
        "X-Firebase-AppCheck": "valid-app-check-token",
      },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.authorized, true);
    assert.equal(body.role, "admin");
  } finally {
    server.close();
  }
});

test("full security chain: request without Auth token is denied 401", async () => {
  const { server } = buildTestServer("enforced");
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://localhost:${port}/api/me/access`, {
      headers: {
        "X-Firebase-AppCheck": "valid-app-check-token",
      },
    });

    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test("full security chain: request without App Check in enforced mode is denied 401", async () => {
  const { server } = buildTestServer("enforced");
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://localhost:${port}/api/me/access`, {
      headers: {
        Authorization: "Bearer token-admin",
      },
    });

    assert.equal(res.status, 401);
    const body = (await res.json()) as any;
    assert.equal(body.error.code, "app_check_missing");
  } finally {
    server.close();
  }
});

test("full security chain: request with invalid App Check in enforced mode is denied 401", async () => {
  const { server } = buildTestServer("enforced");
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://localhost:${port}/api/me/access`, {
      headers: {
        Authorization: "Bearer token-admin",
        "X-Firebase-AppCheck": "invalid-token",
      },
    });

    assert.equal(res.status, 401);
    const body = (await res.json()) as any;
    assert.equal(body.error.code, "app_check_invalid");
  } finally {
    server.close();
  }
});

test("full security chain: App Check monitor mode logs without blocking", async () => {
  const { server } = buildTestServer("monitor");
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://localhost:${port}/api/me/access`, {
      headers: {
        Authorization: "Bearer token-admin",
      },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.authorized, true);
  } finally {
    server.close();
  }
});
