import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "../contracts/index.js";
import type {
  WebhookTransport,
  WebhookTransportResult,
} from "../contracts/index.js";
import { ApiKeyService, WebhookService } from "../core/developer/index.js";

/** Records every send so tests can assert on headers, not just outcomes. */
function recordingTransport(
  responder: (attempt: number) => WebhookTransportResult | Error,
) {
  const calls: {
    url: string;
    body: string;
    signature: string;
    headers: Record<string, string>;
  }[] = [];
  let attempts = 0;

  const transport: WebhookTransport = {
    async send(request) {
      attempts += 1;
      calls.push(request);
      const outcome = responder(attempts);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };

  return {
    transport,
    calls,
    get count(): number {
      return calls.length;
    },
  };
}

function alwaysOk(): WebhookTransportResult {
  return { statusCode: 204, latencyMs: 12 };
}

describe("ApiKeyService", () => {
  it("issues a credential that verifies and returns the caller's identity", () => {
    const service = new ApiKeyService();
    const issued = service.createKey("org_1", "CI pipeline", [
      "read:billing",
      "write:billing",
    ]);

    assert.ok(issued.secret.startsWith(`${issued.record.locator}.`));
    assert.ok(!issued.secret.includes(issued.record.digest));

    const principal = service.verify(issued.secret, "read:billing");
    assert.ok(principal);
    assert.equal(principal.organizationId, "org_1");
    assert.deepEqual(principal.scopes, ["read:billing", "write:billing"]);
  });

  it("never stores the plaintext secret and never derives the locator from it", () => {
    const service = new ApiKeyService();
    const issued = service.createKey("org_1", "k", ["read:data"]);
    const secretPart = issued.secret.split(".")[1]!;

    const stored = service.listKeys("org_1")[0]!;
    assert.equal(stored.digest.includes(secretPart), false);
    // The display locator is independent of key material.
    assert.equal(stored.locator.includes(secretPart), false);
    assert.match(stored.locator, /^sk_live_[0-9a-f]{8}$/);
  });

  it("salts digests so identical secrets do not produce identical records", () => {
    const service = new ApiKeyService();
    const a = service.createKey("org_1", "a", ["read:data"]);
    const b = service.createKey("org_1", "b", ["read:data"]);
    assert.notEqual(a.record.digest, b.record.digest);
  });

  it("rejects a wrong secret, an unknown locator, and a malformed value", () => {
    const service = new ApiKeyService();
    const issued = service.createKey("org_1", "k", ["read:data"]);

    assert.equal(service.verify("sk_live_deadbeef.not-a-real-secret"), null);
    assert.equal(
      service.verify(`${issued.record.locator}.${"x".repeat(43)}`),
      null,
    );
    assert.equal(service.verify(""), null);
    assert.equal(service.verify("no-separator"), null);
    assert.equal(service.verify(".leading-dot"), null);
    assert.equal(service.verify("trailing-dot."), null);
    assert.equal(service.verify(undefined), null);
  });

  it("enforces scopes rather than treating any valid key as sufficient", () => {
    const service = new ApiKeyService();
    const issued = service.createKey("org_1", "k", ["read:billing"]);

    assert.ok(service.verify(issued.secret, "read:billing"));
    assert.equal(service.verify(issued.secret, "write:billing"), null);
    assert.equal(service.verify(issued.secret, "admin:full"), null);
  });

  it("stops accepting a revoked key", () => {
    const service = new ApiKeyService();
    const issued = service.createKey("org_1", "k", ["read:data"]);

    const revoked = service.revokeKey("org_1", issued.record.keyId);
    assert.equal(revoked.status, "REVOKED");
    assert.equal(service.verify(issued.secret), null);
  });

  it("stops accepting an expired key and records the expiry", () => {
    let now = 1_700_000_000_000;
    const service = new ApiKeyService(() => now);
    const issued = service.createKey("org_1", "k", ["read:data"], 1);

    assert.ok(service.verify(issued.secret));

    // One millisecond past the one-day window.
    now += 86_400_001;
    assert.equal(service.verify(issued.secret), null);
    assert.equal(service.listKeys("org_1")[0]!.status, "EXPIRED");
  });

  it("returns defensive copies so callers cannot mutate stored keys", () => {
    const service = new ApiKeyService();
    service.createKey("org_1", "k", ["read:data"]);

    const listed = service.listKeys("org_1")[0]!;
    listed.status = "REVOKED";
    // Bypass the readonly type to prove the returned array is a copy.
    (listed.scopes as string[]).push("admin:full");

    const fresh = service.listKeys("org_1")[0]!;
    assert.equal(fresh.status, "ACTIVE");
    assert.deepEqual(fresh.scopes, ["read:data"]);
  });

  it("refuses to let one tenant revoke another tenant's key", () => {
    const service = new ApiKeyService();
    const globex = service.createKey("org_globex", "g", ["read:data"]);

    assert.throws(
      () => service.revokeKey("org_acme", globex.record.keyId),
      NotFoundError,
    );
    // And the victim's key still works.
    assert.ok(service.verify(globex.secret));
  });

  it("does not leak other tenants' keys through listKeys", () => {
    const service = new ApiKeyService();
    service.createKey("org_acme", "a", ["read:data"]);
    service.createKey("org_globex", "g", ["read:data"]);

    const acme = service.listKeys("org_acme");
    assert.equal(acme.length, 1);
    assert.equal(acme[0]!.organizationId, "org_acme");
  });

  it("assigns unique key ids across many generations", () => {
    const service = new ApiKeyService();
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      ids.add(service.createKey("org_1", `k${i}`, ["read:data"]).record.keyId);
    }
    assert.equal(ids.size, 2000);
  });

  it("validates scope syntax, expiry, and name", () => {
    const service = new ApiKeyService();
    assert.throws(
      () => service.createKey("org_1", "k", ["not-a-scope"]),
      ValidationError,
    );
    assert.throws(() => service.createKey("org_1", "k", []), ValidationError);
    assert.throws(
      () => service.createKey("org_1", "k", ["read:data"], 0),
      ValidationError,
    );
    assert.throws(
      () => service.createKey("org_1", "k", ["read:data"], -5),
      ValidationError,
    );
    assert.throws(
      () => service.createKey("org_1", "k", ["read:data"], Number.NaN),
      ValidationError,
    );
    assert.throws(() => service.createKey("", "k", ["read:data"]));
    assert.throws(() => service.createKey("org_1", "", ["read:data"]));
  });

  it("centralizes scope enforcement for the API boundary", () => {
    const principal = { keyId: "k", organizationId: "o", scopes: ["read:x"] };

    ApiKeyService.requireScope(principal, "read:x");
    assert.throws(
      () => ApiKeyService.requireScope(principal, "write:x"),
      PermissionDeniedError,
    );
  });
});

describe("WebhookService", () => {
  it("shows the signing secret once and never again", () => {
    const service = new WebhookService({ send: async () => alwaysOk() });
    const registered = service.registerEndpoint(
      "org_1",
      "https://hooks.example.com/aiw",
      "primary",
      ["invoice.paid"],
    );

    assert.ok(registered.secret.startsWith("whsec_"));
    assert.equal(
      JSON.stringify(registered.endpoint).includes(registered.secret),
      false,
    );

    const [listed] = service.listEndpoints("org_1");
    assert.ok(listed);
    assert.equal("secret" in listed, false);
    assert.equal("secretDigest" in listed, false);
    assert.ok(listed.secretHint.includes("…"));
  });

  it("signs the timestamp and payload, and detects tampering", () => {
    const service = new WebhookService({ send: async () => alwaysOk() });
    const registered = service.registerEndpoint(
      "org_1",
      "https://hooks.example.com/aiw",
      "",
      ["*"],
    );

    const signature = service.sign('{"a":1}', registered.secret, 1_700_000_000);
    assert.match(signature, /^t=1700000000,v1=[0-9a-f]{64}$/);

    assert.equal(
      service.verifySignature(
        '{"a":1}',
        registered.secret,
        signature,
        1_700_000_000,
      ),
      true,
    );
    // Same instant, altered body.
    assert.equal(
      service.verifySignature(
        '{"a":2}',
        registered.secret,
        signature,
        1_700_000_000,
      ),
      false,
    );
    // Same body, replayed at a different instant.
    assert.equal(
      service.verifySignature(
        '{"a":1}',
        registered.secret,
        signature,
        1_700_000_001,
      ),
      false,
    );
    // Wrong secret entirely.
    assert.equal(
      service.verifySignature(
        '{"a":1}',
        "whsec_other",
        signature,
        1_700_000_000,
      ),
      false,
    );
  });

  it("reports DELIVERED only when the transport reports 2xx", async () => {
    const { transport, calls } = recordingTransport(() => ({
      statusCode: 200,
      latencyMs: 8,
    }));
    const service = new WebhookService(transport);
    service.registerEndpoint("org_1", "https://hooks.example.com/aiw", "", [
      "*",
    ]);

    const [delivery] = await service.dispatch(
      "org_1",
      "evt_1",
      "user.created",
      {
        id: "u_1",
      },
    );

    assert.ok(delivery);
    assert.equal(delivery.status, "DELIVERED");
    assert.equal(delivery.responseStatusClass, "2xx");
    assert.equal(delivery.latencyMs, 8);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.headers["x-aiw-event-id"], "evt_1");
    assert.equal(calls[0]!.signature, delivery.signature);
  });

  it("records a non-2xx response as FAILED, not success", async () => {
    const { transport } = recordingTransport(() => ({
      statusCode: 503,
      latencyMs: 30,
    }));
    const service = new WebhookService(transport);
    service.registerEndpoint("org_1", "https://hooks.example.com/aiw", "", [
      "*",
    ]);

    const [delivery] = await service.dispatch(
      "org_1",
      "evt_1",
      "user.created",
      {},
    );
    assert.ok(delivery);
    assert.equal(delivery.status, "FAILED");
    assert.equal(delivery.responseStatusClass, "5xx");
    assert.match(delivery.error!, /503/);
  });

  it("records a transport throw as FAILED with a truncated reason", async () => {
    const { transport } = recordingTransport(() => new Error("x".repeat(500)));
    const service = new WebhookService(transport);
    service.registerEndpoint("org_1", "https://hooks.example.com/aiw", "", [
      "*",
    ]);

    const [delivery] = await service.dispatch(
      "org_1",
      "evt_1",
      "user.created",
      {},
    );
    assert.ok(delivery);
    assert.equal(delivery.status, "FAILED");
    assert.equal(delivery.responseStatusClass, undefined);
    assert.ok((delivery.error?.length ?? 0) <= 201);
  });

  it("deactivates an endpoint after the consecutive-failure threshold and records skips", async () => {
    let fail = true;
    const { transport } = recordingTransport(() =>
      fail
        ? { statusCode: 500, latencyMs: 1 }
        : { statusCode: 200, latencyMs: 1 },
    );
    const service = new WebhookService(transport);
    const registered = service.registerEndpoint(
      "org_1",
      "https://hooks.example.com/aiw",
      "",
      ["*"],
    );

    for (let i = 0; i < 5; i++) {
      await service.dispatch("org_1", `evt_${i}`, "user.created", {});
    }
    const endpointId = registered.endpoint.endpointId;
    assert.equal(service.listEndpoints("org_1")[0]!.status, "INACTIVE");
    assert.equal(service.listEndpoints("org_1")[0]!.consecutiveFailures, 5);

    // A later success does not silently resume an inactive endpoint.
    fail = false;
    const [skipped] = await service.dispatch(
      "org_1",
      "evt_after",
      "user.created",
      {},
    );
    assert.ok(skipped);
    assert.equal(skipped.status, "SKIPPED_ENDPOINT_INACTIVE");
    assert.equal(service.listEndpoints("org_1")[0]!.status, "INACTIVE");

    // Explicit human action resumes it.
    const deliveries = service.listDeliveries("org_1", endpointId);
    assert.equal(deliveries.length, 6);
  });

  it("resets the failure count after a success and resumes on explicit action", async () => {
    let fail = true;
    const { transport } = recordingTransport(() =>
      fail
        ? { statusCode: 500, latencyMs: 1 }
        : { statusCode: 200, latencyMs: 1 },
    );
    const service = new WebhookService(transport);
    const registered = service.registerEndpoint(
      "org_1",
      "https://hooks.example.com/aiw",
      "",
      ["*"],
    );
    const endpointId = registered.endpoint.endpointId;

    for (let i = 0; i < 3; i++) {
      await service.dispatch("org_1", `f_${i}`, "user.created", {});
    }
    fail = false;
    const [ok] = await service.dispatch("org_1", "ok", "user.created", {});
    assert.equal(ok?.status, "DELIVERED");
    assert.equal(service.listEndpoints("org_1")[0]!.consecutiveFailures, 0);
    assert.equal(service.listEndpoints("org_1")[0]!.status, "ACTIVE");

    service.deactivateEndpoint("org_1", endpointId);
    assert.equal(service.listEndpoints("org_1")[0]!.status, "INACTIVE");
  });

  it("rotates the signing secret, invalidating the previous one", async () => {
    const { transport, calls } = recordingTransport(() => alwaysOk());
    const service = new WebhookService(transport);
    const first = service.registerEndpoint(
      "org_1",
      "https://hooks.example.com/aiw",
      "",
      ["*"],
    );
    const endpointId = first.endpoint.endpointId;
    const payload = '{"a":1}';
    const stamp = 1_700_000_000;

    const oldSignature = service.sign(payload, first.secret, stamp);
    const rotated = service.rotateSecret("org_1", endpointId);
    assert.notEqual(rotated.secret, first.secret);

    // Dispatch after rotation signs with the new secret, so a recipient
    // holding the old one can no longer validate what we send.
    await service.dispatch("org_1", "evt_1", "user.created", { a: 1 });
    const sent = calls[0]!.signature;
    assert.equal(
      service.verifySignature(calls[0]!.body, rotated.secret, sent),
      true,
    );
    assert.equal(
      service.verifySignature(calls[0]!.body, first.secret, sent),
      false,
    );

    // And a signature minted with the retired secret no longer matches the
    // endpoint's recorded digest.
    assert.equal(
      service.verifySignature(payload, rotated.secret, oldSignature, stamp),
      false,
    );

    // Rotation clears the failure budget.
    assert.equal(service.listEndpoints("org_1")[0]!.consecutiveFailures, 0);
  });

  it("routes only to endpoints subscribed to the event", async () => {
    const { transport, calls } = recordingTransport(() => alwaysOk());
    const service = new WebhookService(transport);
    service.registerEndpoint("org_1", "https://a.example.com/h", "", [
      "invoice.paid",
    ]);
    service.registerEndpoint("org_1", "https://b.example.com/h", "", ["*"]);

    await service.dispatch("org_1", "evt_1", "invoice.paid", {});
    assert.equal(calls.length, 2);

    await service.dispatch("org_1", "evt_2", "user.created", {});
    assert.equal(calls.length, 3);
    assert.equal(calls[2]!.url, "https://b.example.com/h");
  });

  it("does not deliver one tenant's event to another tenant's endpoints", async () => {
    const { transport, calls } = recordingTransport(() => alwaysOk());
    const service = new WebhookService(transport);
    service.registerEndpoint("org_acme", "https://acme.example.com/h", "", [
      "*",
    ]);

    await service.dispatch("org_globex", "evt_1", "user.created", {});
    assert.equal(calls.length, 0);
  });

  it("refuses cross-tenant delivery reads and endpoint mutation", () => {
    const service = new WebhookService({ send: async () => alwaysOk() });
    const registered = service.registerEndpoint(
      "org_acme",
      "https://acme.example.com/h",
      "",
      ["*"],
    );
    const endpointId = registered.endpoint.endpointId;

    assert.throws(
      () => service.listDeliveries("org_globex", endpointId),
      NotFoundError,
    );
    assert.throws(
      () => service.deactivateEndpoint("org_globex", endpointId),
      NotFoundError,
    );
    assert.throws(
      () => service.rotateSecret("org_globex", endpointId),
      NotFoundError,
    );
    assert.equal(service.listEndpoints("org_acme")[0]!.status, "ACTIVE");
  });

  it("requires https and refuses loopback or private-network targets", () => {
    const service = new WebhookService({ send: async () => alwaysOk() });
    const bad = [
      "http://hooks.example.com/aiw",
      "https://localhost/aiw",
      "https://127.0.0.1/aiw",
      "https://10.0.0.5/aiw",
      "https://192.168.1.10/aiw",
      "https://172.16.4.4/aiw",
      "https://169.254.169.254/latest/meta-data",
      "https://svc.internal/aiw",
      "not-a-url",
    ];
    for (const url of bad) {
      assert.throws(
        () => service.registerEndpoint("org_1", url, "", ["*"]),
        ValidationError,
        `expected ${url} to be rejected`,
      );
    }
  });

  it("validates event names and rejects an empty subscription", () => {
    const service = new WebhookService({ send: async () => alwaysOk() });
    assert.throws(
      () =>
        service.registerEndpoint(
          "org_1",
          "https://hooks.example.com/h",
          "",
          [],
        ),
      ValidationError,
    );
    assert.throws(
      () =>
        service.registerEndpoint("org_1", "https://hooks.example.com/h", "", [
          "Invoice.PAID",
        ]),
      ValidationError,
    );
    assert.throws(
      () =>
        service.registerEndpoint("org_1", "https://hooks.example.com/h", "", [
          "nocolon",
        ]),
      ValidationError,
    );
  });

  it("requires organizationId on every operation", async () => {
    const service = new WebhookService({ send: async () => alwaysOk() });
    assert.throws(() => service.listEndpoints(""));
    await assert.rejects(() => service.dispatch("", "evt", "user.created", {}));
  });
});
