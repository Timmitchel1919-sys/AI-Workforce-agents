import assert from "node:assert/strict";
import test from "node:test";

import { DeclarativeEnvironmentProbe } from "../adapters/index.js";
import {
  AuditLog,
  EnvironmentDetector,
  EnvironmentRegistry,
  EnvironmentRouter,
  ProbeRegistry,
} from "../core/index.js";
import type { DetectHostRequest } from "../core/environments/environment-detector.js";
import type {
  EnvironmentDescriptor,
  EnvironmentType,
  OperatingSystem,
  ToolchainDescriptor,
} from "../contracts/index.js";

/* ------------------------------------------------------------------ */
/* Deterministic fixtures                                             */
/* ------------------------------------------------------------------ */

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

function buildCatalog(): readonly EnvironmentDescriptor[] {
  return [
    descriptor({
      id: "vscode-env",
      environmentType: "visual_studio_code",
      supportedToolchains: [{ kind: "node" }],
      declaredCapabilities: ["web_build_capable"],
    }),
    descriptor({
      id: "command-cli",
      environmentType: "cli",
      declaredCapabilities: ["command_execution_available"],
    }),
    descriptor({
      id: "docker-env",
      environmentType: "docker",
      declaredCapabilities: ["container_runtime_available"],
    }),
    descriptor({
      id: "xcode-env",
      environmentType: "xcode",
      supportedToolchains: [{ kind: "swift_xcode" }],
      minimumOs: { os: "macos" },
      declaredCapabilities: ["mobile_build_capable", "desktop_build_capable"],
    }),
    descriptor({
      id: "web-build-cli",
      environmentType: "web_build",
      declaredCapabilities: ["web_build_capable"],
    }),
  ];
}

function hostRequest(hostId: string, os: OperatingSystem): DetectHostRequest {
  return {
    hostId,
    name: hostId,
    hostType: "local_workstation",
    os,
    detectedAt: T,
  };
}

const WINDOWS: OperatingSystem = { os: "windows", architecture: "x64" };
const MACOS: OperatingSystem = { os: "macos", architecture: "arm64" };
const LINUX: OperatingSystem = { os: "linux", architecture: "x64" };

const NODE_20: ToolchainDescriptor = {
  kind: "node",
  name: "node",
  version: { major: 20, minor: 11, patch: 1 },
};
const DOTNET_8: ToolchainDescriptor = {
  kind: "dotnet",
  name: ".NET SDK",
  version: { major: 8, minor: 0, patch: 2 },
};

interface FactInput {
  id?: string;
  hostId?: string | "*";
  platform?: OperatingSystem["os"] | "*";
  environmentType: EnvironmentType;
  detected?: boolean;
  version?: string;
  toolchains?: readonly ToolchainDescriptor[];
  evidence?: string[];
}

function probeSet(facts: readonly FactInput[]): ProbeRegistry {
  const probes = new ProbeRegistry();
  for (const fact of facts) {
    probes.register(
      new DeclarativeEnvironmentProbe({
        id: fact.id,
        hostId: fact.hostId ?? "*",
        platform: fact.platform ?? "*",
        environmentType: fact.environmentType,
        detected: fact.detected,
        version: fact.version,
        toolchains: fact.toolchains,
        evidence: fact.evidence,
      }),
    );
  }
  return probes;
}

/** Windows fixture: VS Code (with Node) + CLI (with .NET) + a macOS-only Xcode probe. */
function windowsProbesWithVscode(vscodeDetected: boolean): ProbeRegistry {
  return probeSet([
    {
      platform: "windows",
      environmentType: "visual_studio_code",
      detected: vscodeDetected,
      version: "1.85",
      toolchains: vscodeDetected ? [NODE_20] : [],
      evidence: vscodeDetected ? ["vscode install found"] : [],
    },
    {
      platform: "windows",
      environmentType: "cli",
      detected: true,
      toolchains: [DOTNET_8],
      evidence: ["dotnet sdk found"],
    },
    // macOS-only probe — never runs on Windows.
    {
      id: "xcode-probe",
      hostId: "mac-build",
      platform: "macos",
      environmentType: "xcode",
      detected: true,
      version: "15.3",
    },
  ]);
}

const windowsProbes = () => windowsProbesWithVscode(true);

const macosProbes = () =>
  probeSet([
    {
      hostId: "mac-build",
      platform: "macos",
      environmentType: "xcode",
      detected: true,
      version: "15.3",
      toolchains: [
        {
          kind: "swift_xcode",
          name: "Xcode",
          version: { major: 15, minor: 3, patch: 0 },
        },
      ],
      evidence: ["xcodebuild found"],
    },
    {
      hostId: "mac-build",
      platform: "macos",
      environmentType: "visual_studio_code",
      detected: true,
      version: "1.85",
      toolchains: [NODE_20],
      evidence: ["vscode install found"],
    },
  ]);

const linuxProbes = () =>
  probeSet([
    {
      hostId: "lin-runner",
      platform: "linux",
      environmentType: "docker",
      detected: true,
      version: "26.0",
      evidence: ["docker server reachable"],
    },
    {
      hostId: "lin-runner",
      platform: "linux",
      environmentType: "cli",
      detected: true,
      toolchains: [
        {
          kind: "node",
          name: "node",
          version: { major: 22, minor: 0, patch: 0 },
        },
      ],
      evidence: ["node present"],
    },
  ]);

function createRegistry(): EnvironmentRegistry {
  const registry = new EnvironmentRegistry();
  for (const d of buildCatalog()) registry.registerDescriptor(d);
  return registry;
}

function makeDetector(
  probes: ProbeRegistry,
  audit?: AuditLog,
  registry: EnvironmentRegistry = createRegistry(),
) {
  const detector = new EnvironmentDetector(registry, probes, audit, {
    clock: () => T,
  });
  return {
    registry,
    detector,
    router: new EnvironmentRouter(registry),
  };
}

/* ------------------------------------------------------------------ */
/* Windows host — VS Code + Node + .NET, no imaginary Xcode            */
/* ------------------------------------------------------------------ */

test("windows host: detects VS Code and CLI, never Xcode", async () => {
  const { registry, detector } = makeDetector(windowsProbes());
  const outcome = await detector.detect(hostRequest("win-dev", WINDOWS));

  assert.deepEqual([...outcome.detected].sort(), ["cli", "visual_studio_code"]);
  assert.equal(outcome.warnings.length, 0);
  assert.equal(registry.listInstances().length, 2);

  const host = registry.getHost("win-dev")!;
  assert.equal(host?.availability, "available");
  assert.equal(
    host.capabilities.find((c) => c.capability === "web_build_capable")
      ?.available,
    true,
  );
  // A .NET toolchain is not a desktop build environment — never inferred.
  assert.equal(
    host.capabilities.some((c) => c.capability === "desktop_build_capable"),
    false,
  );
  assert.equal(
    host.capabilities.some(
      (c) => c.capability === "container_runtime_available",
    ),
    false,
  );
});

test("windows host: detection is idempotent (no duplicates)", async () => {
  const { registry, detector } = makeDetector(windowsProbes());
  const first = await detector.detect(hostRequest("win-dev", WINDOWS));
  const firstIds = [...first.registered, ...first.refreshed].sort();
  const second = await detector.detect(hostRequest("win-dev", WINDOWS));

  assert.equal(registry.listInstances().length, 2);
  assert.equal(second.registered.length, 0);
  assert.equal(second.refreshed.length, 2);
  assert.deepEqual(
    [...second.registered, ...second.refreshed].sort(),
    firstIds,
  );
});

test("windows host: router routes to a real instance, never an imaginary Xcode", async () => {
  const { detector, router } = makeDetector(windowsProbes());
  await detector.detect(hostRequest("win-dev", WINDOWS));

  const routed = router.route({ descriptorId: "vscode-env" });
  assert.equal(routed.outcome, "ROUTED");
  if (routed.outcome === "ROUTED") {
    assert.equal(routed.instance.hostId, "win-dev");
    assert.equal(routed.instance.environmentType, "visual_studio_code");
  }

  // Xcode is supported (descriptor exists) but NOT installed on this host.
  const xcode = router.route({ environmentType: "xcode" });
  assert.equal(xcode.outcome, "REQUIRES_PROVISIONING");
  if (xcode.outcome === "REQUIRES_PROVISIONING") {
    assert.equal(xcode.descriptorId, "xcode-env");
  }

  // No descriptor offers a GPU capability — definitively not available.
  const gpu = router.route({ requiredCapabilities: ["gpu_available"] });
  assert.equal(gpu.outcome, "NO_AVAILABLE_ENVIRONMENT");
});

/* ------------------------------------------------------------------ */
/* macOS host — real Xcode, Swift, VS Code                             */
/* ------------------------------------------------------------------ */

test("macos host: detects Xcode and derives mobile build capability", async () => {
  const { registry, detector, router } = makeDetector(macosProbes());
  const outcome = await detector.detect(hostRequest("mac-build", MACOS));

  assert.deepEqual([...outcome.detected].sort(), [
    "visual_studio_code",
    "xcode",
  ]);
  const host = registry.getHost("mac-build")!;
  assert.equal(
    host.capabilities.find((c) => c.capability === "mobile_build_capable")
      ?.available,
    true,
  );
  assert.equal(
    host.capabilities.find((c) => c.capability === "gpu_available"),
    undefined,
  );

  // Here Xcode IS real — routing must reach it.
  const routed = router.route({ environmentType: "xcode" });
  assert.equal(routed.outcome, "ROUTED");
  if (routed.outcome === "ROUTED") {
    assert.equal(routed.instance.hostId, "mac-build");
    assert.equal(routed.host.os.os, "macos");
  }
});

/* ------------------------------------------------------------------ */
/* Linux host — Docker + Node, conservative web capability             */
/* ------------------------------------------------------------------ */

test("linux host: Docker implies container runtime; node alone is not web build", async () => {
  const { registry, detector } = makeDetector(linuxProbes());
  const outcome = await detector.detect(hostRequest("lin-runner", LINUX));

  assert.deepEqual([...outcome.detected].sort(), ["cli", "docker"]);
  const host = registry.getHost("lin-runner")!;
  assert.equal(
    host.capabilities.find(
      (c) => c.capability === "container_runtime_available",
    )?.available,
    true,
  );
  // Node toolchain without a web build environment must NOT grant web builds.
  assert.equal(
    host.capabilities.some((c) => c.capability === "web_build_capable"),
    false,
  );
});

/* ------------------------------------------------------------------ */
/* Availability lifecycle                                             */
/* ------------------------------------------------------------------ */

test("unavailable transition: a disappeared environment is marked unavailable", async () => {
  const audit = new AuditLog();
  const registry = createRegistry();
  const { detector } = makeDetector(windowsProbes(), audit, registry);
  await detector.detect(hostRequest("win-dev", WINDOWS));

  const vscodeInstance = registry
    .listInstances()
    .find((i) => i.environmentType === "visual_studio_code")!;
  assert.equal(vscodeInstance.availability, "available");

  // Re-run discovery on the SAME registry with vscode no longer detected.
  const { detector: quieter } = makeDetector(
    windowsProbesWithVscode(false),
    audit,
    registry,
  );
  const outcome = await quieter.detect(hostRequest("win-dev", WINDOWS));

  assert.ok(outcome.madeUnavailable.includes(vscodeInstance.id));
  const after = registry.getInstance(vscodeInstance.id);
  assert.equal(after?.availability, "unavailable");
  assert.equal(after?.lastHealthCheckAt, T);
  assert.equal(
    audit.list().some((e) => e.type === "environment_unavailable"),
    true,
  );
});

test("a re-appearing environment returns to available", async () => {
  const registry = createRegistry();

  const first = makeDetector(windowsProbes(), undefined, registry);
  await first.detector.detect(hostRequest("win-dev", WINDOWS));

  const missing = makeDetector(
    windowsProbesWithVscode(false),
    undefined,
    registry,
  );
  await missing.detector.detect(hostRequest("win-dev", WINDOWS));
  const goneInstance = registry
    .listInstances()
    .find((i) => i.environmentType === "visual_studio_code")!;
  assert.equal(goneInstance.availability, "unavailable");

  const resumed = makeDetector(windowsProbes(), undefined, registry);
  const outcome = await resumed.detector.detect(
    hostRequest("win-dev", WINDOWS),
  );
  assert.equal(outcome.madeUnavailable.length, 0);

  const back = registry
    .listInstances()
    .find((i) => i.environmentType === "visual_studio_code")!;
  assert.equal(back.availability, "available");
});

/* ------------------------------------------------------------------ */
/* Duplicate handling                                                 */
/* ------------------------------------------------------------------ */

test("duplicate detections of the same environment deduplicate", async () => {
  const probes = new ProbeRegistry();
  probes.register(
    new DeclarativeEnvironmentProbe({
      id: "vscode-1",
      platform: "windows",
      hostId: "win-dev",
      environmentType: "visual_studio_code",
      detected: true,
      version: "1.85",
      toolchains: [NODE_20],
    }),
  );
  // A second, independent probe reporting the same environment + version.
  probes.register(
    new DeclarativeEnvironmentProbe({
      id: "vscode-2",
      platform: "windows",
      hostId: "win-dev",
      environmentType: "visual_studio_code",
      detected: true,
      version: "1.85",
      toolchains: [NODE_20],
    }),
  );

  const { registry, detector } = makeDetector(probes);
  const outcome = await detector.detect(hostRequest("win-dev", WINDOWS));

  assert.equal(outcome.registered.length, 1);
  assert.equal(outcome.refreshed.length, 1);
  const vscodeInstances = registry
    .listInstances()
    .filter((i) => i.environmentType === "visual_studio_code");
  assert.equal(vscodeInstances.length, 1);
});
