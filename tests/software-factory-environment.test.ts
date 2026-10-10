import assert from "node:assert/strict";
import test from "node:test";

import { DeclarativeEnvironmentProbe } from "../adapters/index.js";
import {
  EnvironmentDetector,
  EnvironmentRegistry,
  EnvironmentRouter,
  ProbeRegistry,
} from "../core/index.js";
import { createSoftwareFactoryEnvironmentProvider } from "../core/environments/software-factory-router.js";
import {
  SOFTWARE_FACTORY_ENVIRONMENT_CODES,
  validateEnvironmentRequirement,
  type EnvironmentDescriptor,
  type OperatingSystem,
} from "../contracts/index.js";

const T = "2026-09-23T00:00:00.000Z";
const LINUX: OperatingSystem = { os: "linux", architecture: "x64" };

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

function dockerRegistry(): EnvironmentRegistry {
  const registry = new EnvironmentRegistry({ clock: () => T });
  registry.registerDescriptor(
    descriptor({
      id: "docker",
      environmentType: "docker",
      declaredCapabilities: ["container_runtime_available"],
    }),
  );
  return registry;
}

function makeProvider(registry: EnvironmentRegistry) {
  return createSoftwareFactoryEnvironmentProvider(
    new EnvironmentRouter(registry),
  );
}

async function detectDocker(registry: EnvironmentRegistry): Promise<void> {
  const probes = new ProbeRegistry();
  probes.register(
    new DeclarativeEnvironmentProbe({
      hostId: "lin-runner",
      platform: "linux",
      environmentType: "docker",
      detected: true,
      version: "26.0",
      evidence: ["docker server reachable"],
    }),
  );
  const detector = new EnvironmentDetector(registry, probes, undefined, {
    clock: () => T,
  });
  await detector.detect({
    hostId: "lin-runner",
    name: "lin-runner",
    hostType: "dedicated_runner",
    os: LINUX,
    detectedAt: T,
  });
}

test("provider: requirementFor maps every allowlisted non-none code to a valid requirement", () => {
  const provider = makeProvider(new EnvironmentRegistry());
  for (const code of SOFTWARE_FACTORY_ENVIRONMENT_CODES) {
    if (code === "none") continue;
    const requirement = provider.requirementFor(code);
    assert.notEqual(requirement, null, `${code} must map to a requirement`);
    assert.doesNotThrow(() => validateEnvironmentRequirement(requirement!));
  }
});

test("provider: requirementFor returns null for none, empty and unknown codes", () => {
  const provider = makeProvider(new EnvironmentRegistry());
  assert.equal(provider.requirementFor("none"), null);
  assert.equal(provider.requirementFor(""), null);
  assert.equal(provider.requirementFor("hydra"), null);
});

test("provider: route([none]) is deterministic and never throws", () => {
  const provider = makeProvider(new EnvironmentRegistry());
  const first = provider.route(["none"]);
  assert.deepEqual(provider.route(["none"]), first);
  assert.equal(first.length, 1);
  const route = first[0]!;
  assert.equal(route.code, "none");
  assert.equal(route.requirement, null);
  assert.equal(route.outcome.outcome, "NO_AVAILABLE_ENVIRONMENT");
});

test("provider: routes a real detected docker instance (ROUTED)", async () => {
  const registry = dockerRegistry();
  await detectDocker(registry);
  const entry = makeProvider(registry).route(["docker"])[0]!;
  assert.equal(entry.code, "docker");
  assert.notEqual(entry.requirement, null);
  assert.equal(entry.outcome.outcome, "ROUTED");
  if (entry.outcome.outcome === "ROUTED") {
    assert.equal(entry.outcome.instance.hostId, "lin-runner");
    assert.equal(entry.outcome.instance.environmentType, "docker");
  }
});

test("provider: descriptor exists but no usable instance (REQUIRES_PROVISIONING)", () => {
  const provider = makeProvider(dockerRegistry());
  const entry = provider.route(["docker"])[0]!;
  assert.equal(entry.outcome.outcome, "REQUIRES_PROVISIONING");
  if (entry.outcome.outcome === "REQUIRES_PROVISIONING") {
    assert.equal(entry.outcome.descriptorId, "docker");
  }
});

test("provider: no registered support at all (NO_AVAILABLE_ENVIRONMENT)", () => {
  const provider = makeProvider(new EnvironmentRegistry());
  const entry = provider.route(["docker"])[0]!;
  assert.equal(entry.outcome.outcome, "NO_AVAILABLE_ENVIRONMENT");
});

test("provider: unknown code resolves to UNSUPPORTED", () => {
  const provider = makeProvider(new EnvironmentRegistry());
  const entry = provider.route(["hydra"])[0]!;
  assert.equal(entry.code, "hydra");
  assert.equal(entry.requirement, null);
  assert.equal(entry.outcome.outcome, "UNSUPPORTED");
  if (entry.outcome.outcome === "UNSUPPORTED") {
    assert.match(entry.outcome.reason, /hydra/);
  }
});

test("provider: routes each code independently, preserving order, never throwing", async () => {
  const registry = dockerRegistry();
  await detectDocker(registry);
  const provider = makeProvider(registry);
  const routes = provider.route(["hydra", "none", "docker"]);
  assert.equal(routes.length, 3);
  assert.equal(routes[0]!.code, "hydra");
  assert.equal(routes[0]!.outcome.outcome, "UNSUPPORTED");
  assert.equal(routes[1]!.code, "none");
  assert.equal(routes[1]!.outcome.outcome, "NO_AVAILABLE_ENVIRONMENT");
  assert.equal(routes[2]!.code, "docker");
  assert.equal(routes[2]!.outcome.outcome, "ROUTED");
});
