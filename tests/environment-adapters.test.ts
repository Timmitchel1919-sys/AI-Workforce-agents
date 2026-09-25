/**
 * EO-4.5 — environment execution adapters & cross-platform runners.
 *
 * Deterministic: every non-local platform uses the FakeRunner test double
 * (`simulated: true`). The only real runner exercised is the local
 * HostProcessRunner (Windows host on this machine). No cloud, no Docker
 * daemon, no signing, no publishing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  HostProcessRunner,
  createAndroidAdapter,
  createCloudRunnerAdapter,
  createDockerAdapter,
  createLinuxAdapter,
  createMacosXcodeAdapter,
  createPlatformAdapters,
  createUnityAdapter,
  createUnrealAdapter,
  createWindowsAdapter,
} from "../adapters/index.js";
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  evaluateContainerRequest,
  parseVersion,
  resolveWorkspacePath,
  validateRunnerDescriptor,
  type ContainerPolicy,
  type ContainerRequest,
  type EnvironmentInstance,
  type ExecutionOperationDefinition,
  type ExecutionPolicy,
  type ExecutionToolDefinition,
  type WorkspaceControl,
} from "../contracts/index.js";
import {
  ArtifactHandoffService,
  ArtifactManager,
  BASELINE_DENY_ALL_POLICY,
  BoundedInvocationDispatcher,
  EnvironmentAdapterRegistry,
  ExecutionManager,
  ExecutionOperationRegistry,
  ExecutionPolicyRegistry,
  ExecutionToolRegistry,
  InMemoryExecutionReceiptStore,
  InMemoryExecutionSessionStore,
  PermissionSystem,
  RunnerSandboxProvider,
  SandboxRegistry,
  ToolExecutionEngine,
  ToolRegistry,
  VerificationService,
  registerExecutionTool,
} from "../core/index.js";
import {
  FakeRunner,
  adapterContractSuite,
  envOperation,
  invocation,
  sandboxSpec,
  stubEnvironments,
} from "./fixtures/adapter-contract.js";
import { BETA_OPERATOR, OPERATOR, VIEWER } from "./fixtures/execution.js";
import {
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  XCODE_INSTANCE,
  MAC_HOST,
  host,
  instance,
  planningFixture,
  toolchain,
  webRequest,
} from "./fixtures/planning.js";

const v = (s: string) => parseVersion(s)!;
const withMeta = (
  i: EnvironmentInstance,
  execution: Record<string, unknown>,
): EnvironmentInstance => ({
  ...i,
  safeMetadata: { execution },
});

/* ---------------- fleet (EO-2 discovery shapes) ---------------- */
const WIN_HOST = host("win-1", "windows");
const DOCK_HOST = host("dock-1", "linux", { hostType: "container_host" });
const CLOUD_HOST = host("cloud-1", "linux", { hostType: "cloud_runner" });
const DOTNET = instance("dotnet-1", "desktop-build", "win-1", {
  toolchains: [toolchain("dotnet", "8.0.100"), toolchain("node", "20.11.1")],
});
const DOTNET_OLD = instance("dotnet-old", "desktop-build", "win-1", {
  toolchains: [toolchain("dotnet", "6.0.400")],
});
const ANDROID = instance("android-1", "android-studio", "linux-1", {
  toolchains: [
    toolchain("jdk_gradle", "17.0.0"),
    toolchain("android_sdk", "34.0.0"),
  ],
});
const ANDROID_NOSDK = instance("android-nosdk", "android-studio", "linux-1", {
  toolchains: [toolchain("jdk_gradle", "17.0.0")],
});
const DOCKER_UP = withMeta(
  instance("docker-1", "docker", "dock-1", {
    capabilities: ["container_runtime_available"],
  }),
  { containerDaemon: "operational" },
);
const DOCKER_DOWN = withMeta(
  instance("docker-down", "docker", "dock-1", {
    capabilities: ["container_runtime_available"],
  }),
  { containerDaemon: "unreachable" },
);
const CLOUD: EnvironmentInstance = {
  ...instance("cloud-inst", "web-build", "cloud-1", {
    toolchains: [toolchain("node", "20.11.1")],
  }),
  environmentType: "cloud_runner",
};
const UNITY = withMeta(
  instance("unity-1", "unity", "win-1", {
    toolchains: [toolchain("unity", "2022.3.10")],
  }),
  { targets: ["windows"] },
);
const UNREAL = withMeta(
  instance("unreal-1", "unreal", "win-1", {
    toolchains: [
      toolchain("unreal", "5.3.2"),
      toolchain("cpp_compiler", "19.38.0"),
    ],
  }),
  { targets: ["win64"] },
);
const UNREAL_NOCC = withMeta(
  instance("unreal-nocc", "unreal", "win-1", {
    toolchains: [toolchain("unreal", "5.3.2")],
  }),
  { targets: ["win64"] },
);
const HOSTS = [WEB_HOST, WIN_HOST, MAC_HOST, DOCK_HOST, CLOUD_HOST];
const INSTANCES = [
  WEB_INSTANCE,
  DOTNET,
  DOTNET_OLD,
  XCODE_INSTANCE,
  ANDROID,
  ANDROID_NOSDK,
  DOCKER_UP,
  DOCKER_DOWN,
  CLOUD,
  UNITY,
  UNREAL,
  UNREAL_NOCC,
];
const CONTAINER_POLICY: ContainerPolicy = {
  approvedImages: [
    { name: "node", versions: ["20.11.1"], digest: "sha256:abc" },
  ],
  requireDigest: true,
};
const SAFE_CONTAINER: ContainerRequest = {
  image: { name: "node", version: "20.11.1", digest: "sha256:abc" },
  mounts: [{ source: "workspace", target: "/workspace", readOnly: true }],
};

/* ---------------- requirements ---------------- */
const REQ = {
  windows: {
    family: "windows" as const,
    toolchains: [{ kind: "dotnet" as const, minimum: v("8.0.0") }],
  },
  macos: {
    family: "macos" as const,
    toolchains: [{ kind: "swift_xcode" as const }],
    targets: ["ios"],
  },
  android: {
    family: "android" as const,
    toolchains: [{ kind: "jdk_gradle" as const }],
  },
  linux: {
    family: "linux" as const,
    toolchains: [{ kind: "node" as const, minimum: v("20.0.0") }],
  },
  docker: {
    family: "docker" as const,
    toolchains: [],
    container: SAFE_CONTAINER,
  },
  cloud: { family: "cloud" as const, toolchains: [{ kind: "node" as const }] },
  unity: {
    family: "unity" as const,
    toolchains: [],
    exactVersions: [
      {
        kind: "unity" as const,
        version: v("2022.3.10"),
        match: "exact" as const,
      },
    ],
    targets: ["windows"],
  },
  unreal: {
    family: "unreal" as const,
    toolchains: [],
    exactVersions: [
      {
        kind: "unreal" as const,
        version: v("5.3.0"),
        match: "major_minor" as const,
      },
    ],
    targets: ["win64"],
  },
};

/* ================= 74: reusable contract, every family ================= */
for (const f of [
  {
    name: "windows",
    adapter: createWindowsAdapter,
    ready: "dotnet-1",
    bad: "web-1",
    exe: "dotnet",
  },
  {
    name: "macos",
    adapter: createMacosXcodeAdapter,
    ready: "xcode-1",
    bad: "dotnet-1",
    exe: "xcodebuild",
  },
  {
    name: "android",
    adapter: createAndroidAdapter,
    ready: "android-1",
    bad: "android-nosdk",
    exe: "gradle",
  },
  {
    name: "linux",
    adapter: createLinuxAdapter,
    ready: "web-1",
    bad: "dotnet-1",
    exe: "node",
  },
  {
    name: "docker",
    adapter: () => createDockerAdapter(CONTAINER_POLICY),
    ready: "docker-1",
    bad: "docker-down",
    exe: "docker",
  },
  {
    name: "cloud",
    adapter: () => createCloudRunnerAdapter(),
    ready: "cloud-inst",
    bad: "web-1",
    exe: "node",
  },
  {
    name: "unity",
    adapter: createUnityAdapter,
    ready: "unity-1",
    bad: "dotnet-1",
    exe: "unity",
  },
  {
    name: "unreal",
    adapter: createUnrealAdapter,
    ready: "unreal-1",
    bad: "unreal-nocc",
    exe: "unreal-uat",
  },
] as const) {
  adapterContractSuite({
    name: f.name,
    adapter: f.adapter,
    hosts: HOSTS,
    instances: INSTANCES,
    readyInstanceId: f.ready,
    incompatibleInstanceId: f.bad,
    requirement: REQ[f.name],
    executableId: f.exe,
  });
}

/* ---------------- registry helper (all adapters + fake runners) -------- */
function fleet(
  runners: { runnerId: string; adapterId: string; instances: string[] }[] = [],
  instances: readonly EnvironmentInstance[] = INSTANCES,
) {
  const registry = new EnvironmentAdapterRegistry({
    environments: stubEnvironments(HOSTS, instances),
    heartbeatPollMs: 10,
    timeoutGraceMs: 30,
  });
  createPlatformAdapters({ containerPolicy: CONTAINER_POLICY }).forEach((a) =>
    registry.registerAdapter(a),
  );
  const providers: RunnerSandboxProvider[] = [];
  const fakes = runners.map((r) => {
    const fake = new FakeRunner(r);
    providers.push(registry.registerRunner(fake));
    return fake;
  });
  return { registry, fakes, providers };
}
const codesOf = (r: { reasons: readonly { code: string }[] }) =>
  r.reasons.map((x) => x.code);
const ctxOf = (id: string) => {
  const inst = INSTANCES.find((i) => i.id === id)!;
  return { instance: inst, host: HOSTS.find((h) => h.hostId === inst.hostId)! };
};

test("EO-4.5 75 WINDOWS/.NET: capability matching (not labels), version floor, Windows path semantics", () => {
  const adapter = createWindowsAdapter();
  // Labels are irrelevant: a Linux box named "Visual Studio PC" is not Windows.
  const fake = { ...WEB_INSTANCE, name: "Visual Studio PC" };
  assert.ok(
    codesOf(
      adapter.evaluate({ instance: fake, host: WEB_HOST }, REQ.windows),
    ).includes("PLATFORM_MISMATCH"),
  );
  assert.equal(adapter.evaluate(ctxOf("dotnet-1"), REQ.windows).eligible, true);
  assert.deepEqual(
    codesOf(adapter.evaluate(ctxOf("dotnet-old"), REQ.windows)),
    ["TOOLCHAIN_VERSION_MISMATCH"],
  );
  // IDE ≠ TOOLCHAIN: no IDE-named adapter exists.
  const ids = createPlatformAdapters({ containerPolicy: CONTAINER_POLICY })
    .map((a) => a.adapterId)
    .join(" ");
  assert.doesNotMatch(ids, /visual|vscode|studio|ide/i);
  // Drive letters, UNC shares and traversal never become workspace paths.
  for (const p of [
    "C:\\Windows\\System32",
    "\\\\server\\share\\x",
    "..\\secrets",
    "/etc/passwd",
  ]) {
    assert.throws(() => resolveWorkspacePath(p), p);
  }
  // No unrestricted shell executables.
  assert.ok(
    !adapter.executables.some((e) =>
      /^(cmd|powershell|pwsh|bash|sh)$/i.test(e),
    ),
  );
});

test(
  "EO-4.5 75b WINDOWS REAL RUNNER: bounded `node --version` on the local Windows host",
  { skip: process.platform !== "win32" },
  async () => {
    const LOCAL: EnvironmentInstance = instance(
      "local-win",
      "desktop-build",
      "win-1",
      {
        toolchains: [toolchain("node", process.versions.node)],
      },
    );
    const registry = new EnvironmentAdapterRegistry({
      environments: stubEnvironments(HOSTS, [LOCAL]),
    });
    registry.registerAdapter(createWindowsAdapter());
    const runner = new HostProcessRunner({
      runnerId: "local-windows",
      adapterId: "windows-toolchain",
      environmentInstanceIds: ["local-win"],
      executables: { node: process.execPath },
      identityFingerprint: "fp-win-1",
    });
    const provider = registry.registerRunner(runner);
    const op = envOperation("windows.node.version", {
      family: "windows",
      toolchains: [{ kind: "node" }],
    });
    const resolution = registry.resolve({
      projectId: "alpha",
      environmentInstanceId: "local-win",
      operation: op,
      executableId: "node",
    });
    assert.equal(resolution.ready, true, JSON.stringify(resolution.reasons));
    assert.deepEqual(
      provider.capabilities.filesystemIsolation,
      false,
      "honest: host runner does not isolate",
    );
    const handle = await provider.start(sandboxSpec("local-win"));
    const outcome = await provider.invoke(
      handle,
      invocation("node", ["--version"]),
      {
        signal: new AbortController().signal,
        maxOutputBytes: 4096,
      },
    );
    await provider.cleanup(handle);
    assert.equal(outcome.exitClass, "success");
    assert.match(outcome.stdout.text.trim(), /^v\d+\.\d+\.\d+$/);
    assert.equal(outcome.environment!.simulated, false);
    assert.equal(outcome.environment!.toolchains[0]!.kind, "node");
  },
);

test("EO-4.5 76 APPLE/XCODE: macOS+Xcode eligible; Windows-only registry BLOCKED; signing and missing SDKs refused", () => {
  const ios = envOperation("ios.build", REQ.macos);
  const macFleet = fleet([
    { runnerId: "mac-r", adapterId: "macos-xcode", instances: ["xcode-1"] },
  ]);
  assert.equal(
    macFleet.registry.routeStages("alpha", [
      { stageId: "ios", operation: ios },
    ])[0]!.environmentInstanceId,
    "xcode-1",
  );
  const winOnly = fleet(
    [
      {
        runnerId: "win-r",
        adapterId: "windows-toolchain",
        instances: ["dotnet-1"],
      },
    ],
    [DOTNET],
  );
  const blocked = winOnly.registry.routeStages("alpha", [
    { stageId: "ios", operation: ios },
  ])[0]!;
  assert.equal(blocked.environmentInstanceId, undefined);
  assert.ok(
    codesOf(blocked).includes("PLATFORM_MISMATCH"),
    JSON.stringify(blocked.reasons),
  );
  const adapter = createMacosXcodeAdapter();
  assert.ok(
    codesOf(
      adapter.evaluate(ctxOf("xcode-1"), { ...REQ.macos, signing: true }),
    ).includes("SIGNING_NOT_AUTHORIZED"),
  );
  assert.deepEqual(
    codesOf(
      adapter.evaluate(ctxOf("xcode-1"), {
        ...REQ.macos,
        targets: ["watchos"],
      }),
    ),
    ["MODULE_MISSING"],
  );
});

test("EO-4.5 77 ANDROID: JDK+SDK eligible; missing SDK BLOCKED; build ≠ sign ≠ publish", () => {
  const adapter = createAndroidAdapter();
  assert.equal(
    adapter.evaluate(ctxOf("android-1"), REQ.android).eligible,
    true,
  );
  assert.deepEqual(
    codesOf(adapter.evaluate(ctxOf("android-nosdk"), REQ.android)),
    ["TOOLCHAIN_MISSING"],
  );
  const codes = codesOf(
    adapter.evaluate(ctxOf("android-1"), {
      ...REQ.android,
      signing: true,
      publishing: true,
    }),
  );
  assert.deepEqual(codes, [
    "SIGNING_NOT_AUTHORIZED",
    "PUBLISHING_NOT_AUTHORIZED",
  ]);
});

test("EO-4.5 78 LINUX: Node workloads route to the Linux runner; no Linux runner → not assigned", () => {
  const op = envOperation("web.build", REQ.linux);
  const { registry } = fleet([
    { runnerId: "lin-r", adapterId: "linux-toolchain", instances: ["web-1"] },
  ]);
  const [d] = registry.routeStages("alpha", [
    { stageId: "web", operation: op },
  ]);
  assert.deepEqual(
    [d!.environmentInstanceId, d!.adapterId, d!.runnerId],
    ["web-1", "linux-toolchain", "lin-r"],
  );
  const none = fleet([]).registry.routeStages("alpha", [
    { stageId: "web", operation: op },
  ])[0]!;
  assert.equal(none.environmentInstanceId, undefined);
  assert.ok(codesOf(none).includes("RUNNER_UNAVAILABLE"));
});

test("EO-4.5 79 DOCKER: runtime known + daemon unreachable ≠ execution ready", () => {
  const adapter = createDockerAdapter(CONTAINER_POLICY);
  assert.equal(adapter.evaluate(ctxOf("docker-1"), REQ.docker).eligible, true);
  assert.deepEqual(
    codesOf(adapter.evaluate(ctxOf("docker-down"), REQ.docker)),
    ["ENVIRONMENT_OFFLINE"],
  );
  const noRuntime = { ...DOCKER_UP, capabilities: [] };
  assert.deepEqual(
    codesOf(
      adapter.evaluate({ instance: noRuntime, host: DOCK_HOST }, REQ.docker),
    ),
    ["TOOLCHAIN_MISSING"],
  );
});

test("EO-4.5 80 DOCKER SECURITY: privileged, host root mount, socket, host network, devices, unapproved images DENIED", () => {
  const deny = (r: Partial<ContainerRequest>) =>
    codesOf({
      reasons: evaluateContainerRequest(
        { ...SAFE_CONTAINER, ...r },
        CONTAINER_POLICY,
      ),
    });
  assert.deepEqual(deny({}), []);
  assert.deepEqual(deny({ privileged: true }), ["CONTAINER_POLICY_DENIED"]);
  assert.deepEqual(deny({ hostNetwork: true }), ["CONTAINER_POLICY_DENIED"]);
  assert.deepEqual(deny({ hostPid: true }), ["CONTAINER_POLICY_DENIED"]);
  assert.deepEqual(deny({ dockerSocket: true }), ["CONTAINER_POLICY_DENIED"]);
  assert.deepEqual(deny({ devices: ["/dev/kvm"] }), [
    "CONTAINER_POLICY_DENIED",
  ]);
  assert.ok(
    deny({
      mounts: [{ source: "/" as never, target: "/host", readOnly: false }],
    }).length > 0,
  );
  assert.ok(
    deny({ mounts: [{ source: "workspace", target: "/", readOnly: false }] })
      .length > 0,
  );
  assert.ok(
    deny({
      mounts: [{ source: "workspace", target: "/var/run", readOnly: false }],
    }).length > 0,
  );
  assert.ok(
    deny({ image: { name: "attacker/miner", version: "latest" } }).length > 0,
  );
  assert.ok(
    deny({ image: { name: "node", version: "20.11.1" } }).length > 0,
    "digest pinning required",
  );
  assert.ok(
    deny({ image: { name: "node", version: "20.11.1", digest: "sha256:evil" } })
      .length > 0,
  );
  // Through the adapter too.
  assert.equal(
    createDockerAdapter(CONTAINER_POLICY).evaluate(ctxOf("docker-1"), {
      ...REQ.docker,
      container: { ...SAFE_CONTAINER, privileged: true },
    }).eligible,
    false,
  );
});

test("EO-4.5 81 CLOUD RUNNER: verified identity, lease, execution, timeout, artifact collection, termination, expiry", async () => {
  const { registry, fakes, providers } = fleet([
    {
      runnerId: "cloud-r",
      adapterId: "cloud-runner",
      instances: ["cloud-inst"],
    },
  ]);
  const [cloud] = fakes;
  const provider = providers[0]!;
  const handle = await provider.start(sandboxSpec("cloud-inst"));
  assert.equal(registry.activeLeases("cloud-r").length, 1);
  const ok = await provider.invoke(handle, invocation("node", ["ok"]), {
    signal: new AbortController().signal,
    maxOutputBytes: 1024,
  });
  assert.equal(ok.exitClass, "success");
  const slow = await provider.invoke(handle, invocation("node", ["hang"], 30), {
    signal: new AbortController().signal,
    maxOutputBytes: 1024,
  });
  assert.equal(slow.exitClass, "timeout");
  cloud!.files.set("dist/app.js", new TextEncoder().encode("bundle"));
  assert.equal(
    new TextDecoder().decode(await cloud!.readArtifact("alpha", "dist/app.js")),
    "bundle",
  );
  await provider.cleanup(handle);
  assert.equal(cloud!.calls.release, 1, "terminated/released");
  assert.equal(registry.activeLeases("cloud-r").length, 0);

  // Unverified identity never runs.
  const unverified = new EnvironmentAdapterRegistry({
    environments: stubEnvironments(HOSTS, INSTANCES),
  });
  unverified.registerAdapter(createCloudRunnerAdapter());
  unverified.registerRunner(
    new FakeRunner({
      runnerId: "rogue",
      adapterId: "cloud-runner",
      instances: ["cloud-inst"],
      verified: false,
    }),
  );
  const r = unverified.resolve({
    projectId: "alpha",
    environmentInstanceId: "cloud-inst",
    operation: envOperation("c", REQ.cloud),
  });
  assert.deepEqual(codesOf(r), ["RUNNER_IDENTITY_UNVERIFIED"]);
  // Runners are identified, never addressed by URL.
  assert.throws(
    () =>
      validateRunnerDescriptor({
        ...cloud!.descriptor,
        runnerId: "x",
        routing: { provider: "https://evil.example/run" },
      }),
    ValidationError,
  );
  // Leases are bounded and expire (crashed sessions never lock forever).
  const lease = registry.acquireLease("cloud-r", "s1", "alpha", 5);
  registry.acquireLease("cloud-r", "s2", "alpha", 5);
  assert.throws(
    () => registry.acquireLease("cloud-r", "s3", "alpha", 5),
    /capacity/,
  );
  await new Promise((res) => setTimeout(res, 15));
  assert.equal(registry.activeLeases("cloud-r").length, 0);
  assert.ok(lease.expiresAt);
});

test("EO-4.5 82 UNITY: missing module BLOCKED; version mismatch rejected; version must be pinned", () => {
  const adapter = createUnityAdapter();
  assert.deepEqual(
    codesOf(
      adapter.evaluate(ctxOf("unity-1"), {
        ...REQ.unity,
        targets: ["android"],
      }),
    ),
    ["MODULE_MISSING"],
  );
  assert.deepEqual(
    codesOf(
      adapter.evaluate(ctxOf("unity-1"), {
        ...REQ.unity,
        exactVersions: [
          { kind: "unity", version: v("2021.3.5"), match: "exact" },
        ],
      }),
    ),
    ["TOOLCHAIN_VERSION_MISMATCH"],
  );
  assert.deepEqual(
    codesOf(
      adapter.evaluate(ctxOf("unity-1"), { ...REQ.unity, exactVersions: [] }),
    ),
    ["ADAPTER_ERROR"],
  );
});

test("EO-4.5 83 UNREAL: missing compiler or platform SDK BLOCKED; never migrated", () => {
  const adapter = createUnrealAdapter();
  assert.deepEqual(
    codesOf(adapter.evaluate(ctxOf("unreal-nocc"), REQ.unreal)),
    ["TOOLCHAIN_MISSING"],
  );
  assert.deepEqual(
    codesOf(
      adapter.evaluate(ctxOf("unreal-1"), { ...REQ.unreal, targets: ["ps5"] }),
    ),
    ["MODULE_MISSING"],
  );
  const wrong = adapter.evaluate(ctxOf("unreal-1"), {
    ...REQ.unreal,
    exactVersions: [
      { kind: "unreal", version: v("5.4.0"), match: "major_minor" },
    ],
  });
  assert.deepEqual(codesOf(wrong), ["TOOLCHAIN_VERSION_MISMATCH"]);
  assert.match(wrong.reasons[0]!.detail, /never migrated/);
});

test("EO-4.5 84 VERSION + GPU: incompatible toolchain rejected; GPU only when required and discovered", () => {
  const linux = createLinuxAdapter();
  assert.deepEqual(
    codesOf(
      linux.evaluate(ctxOf("web-1"), {
        family: "linux",
        toolchains: [{ kind: "node", minimum: v("22.0.0") }],
      }),
    ),
    ["TOOLCHAIN_VERSION_MISMATCH"],
  );
  const gpuReq = {
    ...REQ.unity,
    gpu: { required: true as const, graphicsApis: ["vulkan"] },
  };
  assert.deepEqual(
    codesOf(createUnityAdapter().evaluate(ctxOf("unity-1"), gpuReq)),
    ["GPU_UNAVAILABLE"],
  );
  const withGpu = {
    ...withMeta(UNITY, {
      targets: ["windows"],
      gpu: {
        vendor: "nvidia",
        memoryClass: "high",
        graphicsApis: ["vulkan", "dx12"],
        compute: true,
      },
    }),
    capabilities: [{ capability: "gpu_available" as const, available: true }],
  };
  assert.equal(
    createUnityAdapter().evaluate({ instance: withGpu, host: WIN_HOST }, gpuReq)
      .eligible,
    true,
  );
  // A 3D project stage that does not need a GPU is not blocked by its absence.
  assert.equal(
    createUnityAdapter().evaluate(ctxOf("unity-1"), REQ.unity).eligible,
    true,
  );
});

test("EO-4.5 85 MULTI-ENVIRONMENT: web/backend/iOS/Android/3D stages get stage-specific environments, deterministically", () => {
  const { registry } = fleet([
    { runnerId: "r-lin", adapterId: "linux-toolchain", instances: ["web-1"] },
    {
      runnerId: "r-win",
      adapterId: "windows-toolchain",
      instances: ["dotnet-1", "dotnet-old"],
    },
    { runnerId: "r-mac", adapterId: "macos-xcode", instances: ["xcode-1"] },
    {
      runnerId: "r-and",
      adapterId: "android-gradle",
      instances: ["android-1", "android-nosdk"],
    },
    { runnerId: "r-uni", adapterId: "unity-editor", instances: ["unity-1"] },
  ]);
  const stages = [
    { stageId: "web", operation: envOperation("web", REQ.linux) },
    { stageId: "backend", operation: envOperation("backend", REQ.windows) },
    { stageId: "ios", operation: envOperation("ios", REQ.macos) },
    { stageId: "android", operation: envOperation("android", REQ.android) },
    { stageId: "3d", operation: envOperation("3d", REQ.unity) },
  ];
  const decisions = registry.routeStages("alpha", stages);
  assert.deepEqual(
    decisions.map((d) => [d.stageId, d.environmentInstanceId, d.runnerId]),
    [
      ["web", "web-1", "r-lin"],
      ["backend", "dotnet-1", "r-win"],
      ["ios", "xcode-1", "r-mac"],
      ["android", "android-1", "r-and"],
      ["3d", "unity-1", "r-uni"],
    ],
  );
  assert.deepEqual(
    registry.routeStages("alpha", stages),
    decisions,
    "deterministic",
  );
});

test("EO-4.5 59/60 SECURITY + RESIDENCY-AWARE ROUTING: policy excludes shared/foreign-region runners", () => {
  const registry = new EnvironmentAdapterRegistry({
    environments: stubEnvironments(HOSTS, INSTANCES),
  });
  registry.registerAdapter(createLinuxAdapter());
  registry.registerRunner(
    new FakeRunner({
      runnerId: "shared",
      adapterId: "linux-toolchain",
      instances: ["web-1"],
      runnerClass: "shared",
      trust: "shared_untrusted",
      routing: { region: "us", resourceClass: "small" },
    }),
  );
  const op = envOperation("web", REQ.linux);
  assert.equal(
    registry.resolve({
      projectId: "alpha",
      environmentInstanceId: "web-1",
      operation: op,
    }).ready,
    true,
  );
  registry.setProjectPolicy("alpha", { requireTrustedRunner: true });
  assert.deepEqual(
    codesOf(
      registry.resolve({
        projectId: "alpha",
        environmentInstanceId: "web-1",
        operation: op,
      }),
    ),
    ["POLICY_DENIED"],
  );
  registry.setProjectPolicy("beta", { allowedRegions: ["eu"] });
  assert.deepEqual(
    codesOf(
      registry.resolve({
        projectId: "beta",
        environmentInstanceId: "web-1",
        operation: op,
      }),
    ),
    ["POLICY_DENIED"],
  );
});

test("EO-4.5 87 ARTIFACT HANDOFF: declared artifact moves between runners with digest verification", async () => {
  const { registry, fakes } = fleet([
    {
      runnerId: "r-backend",
      adapterId: "windows-toolchain",
      instances: ["dotnet-1"],
    },
    { runnerId: "r-mobile", adapterId: "macos-xcode", instances: ["xcode-1"] },
  ]);
  const [backend, mobile] = fakes;
  backend!.files.set("dist/schema.json", new TextEncoder().encode('{"v":1}'));
  const artifacts = new ArtifactManager({
    source: {
      digestFile: async (_p, path) => {
        const bytes = backend!.files.get(path)!;
        const { createHash } = await import("node:crypto");
        return {
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.byteLength,
        };
      },
    },
    maxArtifactBytes: 1024,
  });
  const record = await artifacts.record({
    projectId: "alpha",
    verificationId: "v1",
    stageId: "build:backend",
    sourceFingerprint: "fp-A",
    kind: "schema",
    path: "dist/schema.json",
  });
  const handoff = new ArtifactHandoffService({
    registry,
    artifacts,
    maxBytes: 1024,
  });
  const moved = await handoff.transfer({
    projectId: "alpha",
    artifactId: record.artifactId,
    fromRunnerId: "r-backend",
    toRunnerId: "r-mobile",
    expectedSourceFingerprint: "fp-A",
  });
  assert.equal(moved.sha256, record.digest.value);
  assert.equal(
    new TextDecoder().decode(mobile!.files.get("dist/schema.json")),
    '{"v":1}',
  );
  await assert.rejects(
    handoff.transfer({
      projectId: "alpha",
      artifactId: record.artifactId,
      fromRunnerId: "r-backend",
      toRunnerId: "r-mobile",
      expectedSourceFingerprint: "fp-OTHER",
    }),
    /different source fingerprint/,
  );
  backend!.files.set("dist/schema.json", new TextEncoder().encode('{"v":666}'));
  await assert.rejects(
    handoff.transfer({
      projectId: "alpha",
      artifactId: record.artifactId,
      fromRunnerId: "r-backend",
      toRunnerId: "r-mobile",
      expectedSourceFingerprint: "fp-A",
    }),
    /digest/,
  );
  await assert.rejects(
    handoff.transfer({
      projectId: "beta",
      artifactId: record.artifactId,
      fromRunnerId: "r-backend",
      toRunnerId: "r-mobile",
      expectedSourceFingerprint: "fp-A",
    }),
    NotFoundError,
    "project isolation",
  );
});

test("EO-4.5 95 NO FAKE SUPPORT: status never reports a platform operational from contracts or test doubles", () => {
  const { registry } = fleet([
    { runnerId: "sim-lin", adapterId: "linux-toolchain", instances: ["web-1"] },
  ]);
  const status = Object.fromEntries(
    registry.status().map((s) => [s.family, s]),
  );
  assert.equal(status.macos!.status, "not_configured");
  assert.equal(
    status.linux!.status,
    "not_configured",
    "a simulated runner is not real support",
  );
  assert.equal(status.linux!.simulatedRunners, 1);
  const bare = new EnvironmentAdapterRegistry({
    environments: stubEnvironments(HOSTS, INSTANCES),
  });
  assert.ok(bare.status().every((s) => s.status === "unsupported"));
});

/* ================= manager integration (Linux fixture web-1) ================= */

const SECRET = "rk-live-9f8e7d6c5b4a3210zz";
const OPS: ExecutionOperationDefinition[] = [
  envOperation("linux.ok", REQ.linux, { toolId: "linux-tool" }),
  envOperation("linux.hang", REQ.linux, { toolId: "linux-tool" }),
  envOperation("linux.disconnect", REQ.linux, { toolId: "linux-tool" }),
  envOperation("linux.echo", REQ.linux, { toolId: "linux-tool" }),
  envOperation("linux.high", REQ.linux, { toolId: "linux-tool", risk: "high" }),
  envOperation("linux.build.fp", REQ.linux, { toolId: "linux-tool" }),
  envOperation("linux.test.fp", REQ.linux, {
    toolId: "linux-tool",
    stageKind: "test",
  }),
];
const ARGV: Record<string, string[]> = {
  "linux.ok": ["ok", "fp-A"],
  "linux.hang": ["hang"],
  "linux.disconnect": ["disconnect"],
  "linux.echo": ["echo-credential"],
  "linux.high": ["ok"],
  "linux.build.fp": ["ok", "fp-A"],
  "linux.test.fp": ["ok", "fp-B"],
};
const LINUX_TOOL: ExecutionToolDefinition = {
  toolId: "linux-tool",
  version: "1.0.0",
  displayName: "Linux node tool",
  description: "Fixed argv test tool",
  requiredCapabilities: [],
  supportedEnvironmentCapabilities: [],
  executable: {
    executableId: "node",
    operations: Object.fromEntries(
      Object.entries(ARGV).map(([id, argv]) => [
        id,
        argv.map((value) => ({ kind: "literal" as const, value })),
      ]),
    ),
    environmentVariables: [],
  },
  operations: OPS.map((o) => o.id),
};

async function managerHarness(
  options: {
    adapters?: boolean;
    runnerProjects?: string[];
    credential?: boolean;
  } = {},
) {
  const fixture = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT],
  });
  const tools = new ToolRegistry(fixture.audit);
  const executionTools = new ExecutionToolRegistry();
  const dispatcher = new BoundedInvocationDispatcher();
  registerExecutionTool(tools, executionTools, dispatcher, LINUX_TOOL, {
    allowedAgents: ["web-agent"],
    allowedProjects: ["alpha", "beta"],
    allowedEnvironments: ["local"],
  });
  const operations = new ExecutionOperationRegistry();
  OPS.forEach((o) => operations.register(o));
  const policy: ExecutionPolicy = {
    policyId: "adapters",
    version: 1,
    description: "EO-4.5 test policy.",
    rules: [
      {
        id: "run",
        operationIds: OPS.map((o) => o.id),
        capabilities: ["process.invoke.bounded"],
        filesystem: [],
        requiredEnvironmentCapabilities: [],
      },
    ],
    forbiddenCapabilities: ["repository.push", "deploy.invoke"],
    maxRisk: "high",
    approvalRequiredAtOrAbove: "high",
    defaultLimits: {
      sessionTimeoutMs: 600_000,
      operationTimeoutMs: 5_000,
      maxOutputBytes: 64 * 1024,
      maxArtifactBytes: 1_000_000,
      maxToolCalls: 20,
    },
    network: { mode: "deny_all" },
    grantTtlMs: 600_000,
  };
  const policies = new ExecutionPolicyRegistry({
    policyId: "baseline-deny-all",
    version: 1,
  });
  policies.register(BASELINE_DENY_ALL_POLICY);
  policies.register(policy);
  policies.bindProject("alpha", "adapters", 1);
  policies.bindProject("beta", "adapters", 1);
  const credentialCalls: string[] = [];
  const adapters = new EnvironmentAdapterRegistry({
    environments: fixture.registry,
    audit: fixture.audit,
    heartbeatPollMs: 10,
    timeoutGraceMs: 30,
    credentials: {
      resolve: async (ref, runnerId) => {
        credentialCalls.push(`${runnerId}:${ref}`);
        return SECRET;
      },
    },
  });
  adapters.registerAdapter(createLinuxAdapter());
  const sandboxes = new SandboxRegistry();
  const runnerA = new FakeRunner({
    runnerId: "runner-a",
    adapterId: "linux-toolchain",
    instances: ["web-1"],
    ...(options.runnerProjects ? { projectIds: options.runnerProjects } : {}),
    ...(options.credential
      ? { credentialRef: "secret://runner-token" as const }
      : {}),
  });
  const runnerB = new FakeRunner({
    runnerId: "runner-b",
    adapterId: "linux-toolchain",
    instances: ["web-1"],
    ...(options.runnerProjects ? { projectIds: options.runnerProjects } : {}),
  });
  sandboxes.register(adapters.registerRunner(runnerA));
  sandboxes.register(adapters.registerRunner(runnerB));
  const receipts = new InMemoryExecutionReceiptStore();
  const sessions = new InMemoryExecutionSessionStore();
  let seq = 0;
  const projects = { has: (id: string) => id === "alpha" || id === "beta" };
  const manager = new ExecutionManager({
    planning: fixture.planning,
    approvals: fixture.approvals,
    agents: fixture.agents,
    environments: fixture.registry,
    tools,
    projects,
    operations,
    policies,
    sandboxes,
    sessions,
    audit: fixture.audit,
    clock: () => new Date().toISOString(),
    idFactory: (p) => `${p}_${++seq}`,
    executionTools,
    toolEngine: new ToolExecutionEngine({
      registry: tools,
      permissions: new PermissionSystem([
        { effect: "allow", action: "execute" },
      ]),
      audit: fixture.audit,
    }),
    dispatcher,
    receipts,
    ...(options.adapters === false ? {} : { environmentAdapters: adapters }),
  });
  const plan = await fixture.planning.createPlan(webRequest("alpha"), {
    id: "op-1",
  });
  const request = (operationId: string, stageId = "build:web") => ({
    projectId: "alpha",
    planId: plan.planId,
    planVersion: plan.version,
    stageId,
    operationId,
  });
  let keys = 0;
  const run = async (operationId: string) => {
    const { session } = await manager.createSession(
      OPERATOR,
      request(operationId),
      `k-${++keys}`,
    );
    return {
      session,
      result:
        session.status === "ready"
          ? await manager.invoke(OPERATOR, {
              sessionId: session.sessionId,
              invocationId: `i-${keys}`,
              toolId: "linux-tool",
              operationId,
            })
          : undefined,
    };
  };
  return {
    fixture,
    manager,
    adapters,
    runnerA,
    runnerB,
    receipts,
    sessions,
    plan,
    request,
    run,
    operations,
    projects,
    credentialCalls,
  };
}

test("EO-4.5 67/68 RECEIPT + AUDIT: environment, adapter, runner, toolchains and source fingerprint are recorded", async () => {
  const h = await managerHarness();
  const { session, result } = await h.run("linux.ok");
  assert.equal(session.sandbox!.providerId, "runner:runner-a");
  assert.equal(result!.exitClass, "success", JSON.stringify(result!.reasons));
  const receipt = h.receipts.get(result!.receiptId)!;
  assert.deepEqual(
    [
      receipt.environment!.environmentInstanceId,
      receipt.environment!.adapterId,
      receipt.environment!.runnerId,
      receipt.environment!.sourceFingerprint,
    ],
    ["web-1", "linux-toolchain", "runner-a", "fp-A"],
  );
  assert.equal(receipt.simulated, true);
  const actions = h.fixture.audit
    .query({ type: "execution_event" })
    .map((e) => e.data.action);
  for (const a of [
    "adapter_selected",
    "runner_lease_acquired",
    "runner_execution_started",
    "runner_execution_completed",
    "runner_lease_released",
  ]) {
    assert.ok(actions.includes(a), a);
  }
});

test("EO-4.5 88 RUNNER OFFLINE before execution: nothing runs, and no silent failover to another runner", async () => {
  const h = await managerHarness();
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request("linux.ok"),
    "off-1",
  );
  assert.equal(session.sandbox!.providerId, "runner:runner-a");
  h.runnerA.status = "offline";
  const result = await h.manager.invoke(OPERATOR, {
    sessionId: session.sessionId,
    invocationId: "off-inv",
    toolId: "linux-tool",
    operationId: "linux.ok",
  });
  assert.notEqual(result.exitClass, "success");
  assert.ok(
    codesOf(result).includes("RUNNER_UNAVAILABLE"),
    JSON.stringify(result.reasons),
  );
  assert.equal(
    h.runnerA.calls.run + h.runnerB.calls.run,
    0,
    "no execution anywhere",
  );
  // A NEW session re-evaluates routing and may use runner-b (recorded).
  const next = await h.run("linux.ok");
  assert.equal(next.session.sandbox!.providerId, "runner:runner-b");
  assert.equal(next.result!.exitClass, "success");
});

test("EO-4.5 89 RUNNER DISCONNECT mid-operation: normalized non-success, never SUCCESS", async () => {
  const h = await managerHarness();
  const { session, result } = await h.run("linux.disconnect");
  assert.equal(result!.exitClass, "sandbox_failure");
  assert.ok(codesOf(result!).includes("RUNNER_DISCONNECTED"));
  assert.equal((await h.sessions.get(session.sessionId))!.status, "failed");
});

test("EO-4.5 90 CANCELLATION: manager cancel reaches the runner", async () => {
  const h = await managerHarness();
  const { session } = await h.manager.createSession(
    OPERATOR,
    h.request("linux.hang"),
    "c-1",
  );
  const pending = h.manager.invoke(OPERATOR, {
    sessionId: session.sessionId,
    invocationId: "c-inv",
    toolId: "linux-tool",
    operationId: "linux.hang",
  });
  await new Promise((r) => setTimeout(r, 60));
  await h.manager.cancel(
    OPERATOR,
    session.sessionId,
    "operator stop",
    "cancel",
  );
  const result = await pending;
  assert.equal(result.exitClass, "cancelled");
  assert.ok(h.runnerA.calls.cancel >= 1, "adapter/runner cancellation invoked");
});

test("EO-4.5 91/92/93 ISOLATION + AUTHZ + APPROVAL: foreign runner, unauthorized operator, missing approval DENIED", async () => {
  const restricted = await managerHarness({ runnerProjects: ["beta"] });
  const cross = await restricted.manager.preflight(
    OPERATOR,
    restricted.request("linux.ok"),
  );
  assert.equal(cross.decision, "DENIED");
  assert.ok(
    codesOf(cross).includes("POLICY_DENIED"),
    JSON.stringify(cross.reasons),
  );
  const h = await managerHarness();
  await assert.rejects(
    h.manager.preflight(VIEWER, h.request("linux.ok")),
    PermissionDeniedError,
  );
  await assert.rejects(
    h.manager.preflight(BETA_OPERATOR, h.request("linux.ok")),
    NotFoundError,
  );
  const high = await h.manager.preflight(OPERATOR, h.request("linux.high"));
  assert.equal(high.decision, "DENIED");
  assert.ok(
    codesOf(high).includes("APPROVAL_REQUIRED"),
    JSON.stringify(high.reasons),
  );
  const noAdapters = await managerHarness({ adapters: false });
  const none = await noAdapters.manager.preflight(
    OPERATOR,
    noAdapters.request("linux.ok"),
  );
  assert.ok(codesOf(none).includes("ADAPTER_UNAVAILABLE"));
});

test("EO-4.5 94 SECRET BOUNDARY: runner credential resolved server-side; absent from plan, API, receipts, audit", async () => {
  const h = await managerHarness({ credential: true });
  const { session, result } = await h.run("linux.echo");
  assert.equal(result!.exitClass, "success", JSON.stringify(result!.reasons));
  assert.deepEqual(
    h.runnerA.credentialsSeen,
    [SECRET],
    "the runner received the resolved credential",
  );
  assert.deepEqual(h.credentialCalls, ["runner-a:secret://runner-token"]);
  for (const [name, value] of [
    ["result", result],
    ["session", session],
    ["receipt", h.receipts.get(result!.receiptId)],
    ["plan", h.plan],
    ["audit", h.fixture.audit.query({})],
    ["runner descriptor", h.runnerA.descriptor],
  ] as const) {
    assert.ok(
      !JSON.stringify(value).includes(SECRET),
      `${name} leaks the runner credential`,
    );
  }
});

test("EO-4.5 86 SOURCE CONSISTENCY: a runner that executed a different source fingerprint fails verification", async () => {
  const h = await managerHarness();
  const artifacts = new ArtifactManager({
    source: { digestFile: async () => ({ sha256: "x", size: 1 }) },
    maxArtifactBytes: 1024,
  });
  const verification = new VerificationService({
    manager: h.manager,
    planning: h.fixture.planning,
    operations: h.operations,
    environments: h.fixture.registry,
    sandboxes: { get: () => undefined },
    projects: h.projects,
    audit: h.fixture.audit,
    artifacts,
    workspaceControl: {
      sourceFingerprint: async () => ({ fingerprint: "fp-A", changedFiles: 0 }),
    } as unknown as WorkspaceControl,
  });
  verification.registerProfile({
    projectId: "alpha",
    stages: {
      "build:web": { operationId: "linux.build.fp", required: true },
      "test:web:unit": { operationId: "linux.test.fp", required: true },
    },
    failFast: false,
    maxParallel: 1,
    requireAllPlannedStages: false,
  });
  const started = await verification.start(
    OPERATOR,
    { projectId: "alpha", planId: h.plan.planId, planVersion: h.plan.version },
    "src-1",
  );
  const r = await verification.wait(OPERATOR, started.verificationId);
  const build = r.stages.find((s) => s.stageId === "build:web")!;
  const unit = r.stages.find((s) => s.stageId === "test:web:unit")!;
  assert.equal(build.status, "passed", JSON.stringify(build));
  assert.equal(build.environment!.runnerId, "runner-a");
  assert.equal(unit.status, "failed");
  assert.equal(unit.failure!.kind, "SOURCE_CHANGED");
  assert.equal(r.status, "failed");
});
