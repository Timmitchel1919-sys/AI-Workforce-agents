import assert from "node:assert/strict";
import test from "node:test";

import { EnvironmentRegistry } from "../core/index.js";
import type {
  EnvironmentDescriptor,
  EnvironmentInstance,
  HostInstance,
} from "../contracts/index.js";

const T = "2026-09-23T00:00:00.000Z";

function descriptor(
  d: Pick<EnvironmentDescriptor, "id" | "environmentType"> &
    Partial<EnvironmentDescriptor>,
): EnvironmentDescriptor {
  return {
    name: d.id,
    description: d.id,
    supportedToolchains: [],
    requiredCapabilities: [],
    ...d,
  };
}

const XCODE = descriptor({
  id: "xcode-env",
  environmentType: "xcode",
  minimumOs: { os: "macos" },
});

const WEB_CLI = descriptor({
  id: "web-build-cli",
  environmentType: "web_build",
});

function makeRegistry() {
  const registry = new EnvironmentRegistry();
  registry.registerDescriptor(XCODE);
  registry.registerDescriptor(WEB_CLI);
  return registry;
}

function makeHost(overrides: Partial<HostInstance> = {}): HostInstance {
  return {
    id: "host-1",
    hostId: "host-1",
    name: "host-1",
    hostType: "local_workstation",
    os: { os: "windows", architecture: "x64" },
    trustLevel: "detected",
    availability: "available",
    capabilities: [],
    fingerprint: "fingerprint-host-1",
    ...overrides,
  };
}

function makeInstance(
  overrides: Partial<EnvironmentInstance> = {},
): EnvironmentInstance {
  return {
    id: "instance-1",
    descriptorId: "web-build-cli",
    hostId: "host-1",
    environmentType: "web_build",
    name: "Web Build",
    availability: "available",
    capabilities: [],
    toolchains: [],
    trustLevel: "detected",
    fingerprint: "fingerprint-instance-1",
    ...overrides,
  };
}

test("registry: registerDescriptor validates and looks up by id/type", () => {
  const registry = new EnvironmentRegistry();
  assert.throws(() => registry.registerDescriptor({ ...XCODE, id: "  " }));
  registry.registerDescriptor(XCODE);
  assert.equal(registry.hasDescriptor("xcode-env"), true);
  assert.equal(registry.getDescriptor("xcode-env")?.environmentType, "xcode");
  assert.equal(registry.descriptorForType("xcode")?.id, "xcode-env");
  assert.throws(
    () => registry.requireDescriptor("nope"),
    /unknown environment descriptor/,
  );
});

test("registry: an instance must reference a known descriptor", () => {
  const registry = makeRegistry();
  registry.upsertHost(makeHost());
  assert.throws(
    () => registry.upsertInstance(makeInstance({ descriptorId: "ghost" })),
    /unknown environment descriptor/,
  );
});

test("registry: an instance must reference a known host", () => {
  const registry = makeRegistry();
  assert.throws(() => registry.upsertInstance(makeInstance()), /unknown host/);
});

test("registry: OS compatibility is enforced against the descriptor", () => {
  const registry = makeRegistry();
  registry.upsertHost(
    makeHost({
      hostId: "linux-1",
      id: "linux-1",
      os: { os: "linux", architecture: "x64" },
    }),
  );
  assert.throws(
    () =>
      registry.upsertInstance(
        makeInstance({
          id: "x",
          descriptorId: "xcode-env",
          hostId: "linux-1",
          environmentType: "xcode",
          fingerprint: "fp-x",
        }),
      ),
    /requires OS macos/,
  );
});

test("registry: capability declarations must be well-formed", () => {
  const registry = makeRegistry();
  registry.upsertHost(makeHost());
  assert.throws(
    () =>
      registry.upsertInstance(
        makeInstance({
          capabilities: [
            {
              capability: "not-a-capability" as never,
              available: true,
            },
          ],
        }),
      ),
    /not a known capability/,
  );
  assert.throws(
    () =>
      registry.upsertHost(
        makeHost({
          capabilities: [
            { capability: "web_build_capable", available: "yes" as never },
          ],
        }),
      ),
    /available must be a boolean/,
  );
});

test("registry: duplicate fingerprints on different ids are rejected", () => {
  const registry = makeRegistry();
  registry.upsertHost(makeHost());
  registry.upsertInstance(makeInstance());
  assert.throws(
    () =>
      registry.upsertInstance(
        makeInstance({
          id: "instance-2",
          fingerprint: "fingerprint-instance-1",
        }),
      ),
    /duplicates fingerprint/,
  );
});

test("registry: metadata smuggling credentials is rejected", () => {
  const registry = makeRegistry();
  registry.upsertHost(makeHost());
  assert.throws(
    () =>
      registry.upsertInstance(
        makeInstance({ safeMetadata: { token: "super-secret" } }),
      ),
    /must not contain credential fields/,
  );
});

test("registry: markInstanceUnavailable transitions state and stamps health check", () => {
  const registry = makeRegistry();
  registry.upsertHost(makeHost());
  registry.upsertInstance(makeInstance());

  const updated = registry.markInstanceUnavailable("instance-1", { now: T });
  assert.equal(updated?.availability, "unavailable");
  assert.equal(updated?.lastHealthCheckAt, T);
  const after = registry.getInstance("instance-1");
  assert.equal(after?.availability, "unavailable");
});

test("registry: markHostUnavailable and removeHost cascade", () => {
  const registry = makeRegistry();
  registry.upsertHost(makeHost());
  registry.upsertInstance(makeInstance());

  const host = registry.markHostUnavailable("host-1", { now: T });
  assert.equal(host?.availability, "unavailable");

  assert.equal(registry.removeHost("host-1"), true);
  assert.equal(registry.getHost("host-1"), undefined);
  assert.equal(registry.listInstances().length, 0);

  assert.equal(registry.removeHost("host-1"), false);
});

test("registry: instances are isolated per host", () => {
  const registry = makeRegistry();
  registry.upsertHost(makeHost());
  registry.upsertHost(
    makeHost({
      id: "host-2",
      hostId: "host-2",
      fingerprint: "fingerprint-host-2",
    }),
  );
  registry.upsertInstance(makeInstance());
  registry.upsertInstance(
    makeInstance({
      id: "instance-2",
      hostId: "host-2",
      fingerprint: "fingerprint-instance-2",
    }),
  );

  assert.deepEqual(
    registry.instancesForHost("host-1").map((i) => i.id),
    ["instance-1"],
  );
  assert.equal(registry.usableInstances().length, 2);
});
