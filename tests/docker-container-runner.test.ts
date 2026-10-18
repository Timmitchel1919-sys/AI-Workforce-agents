import assert from "node:assert/strict";
import test from "node:test";

import {
  DockerContainerRunner,
  type DockerImageBinding,
} from "../adapters/environments/docker-container-runner.js";
import type {
  BoundedProcessResult,
  BoundedProcessSpec,
} from "../adapters/execution/bounded-process-runner.js";
import type {
  ContainerPolicy,
  RunnerJobSpec,
  RunnerRunOptions,
  StructuredInvocation,
} from "../contracts/index.js";

const DOCKER_PATH =
  process.platform === "win32"
    ? "C:\\ProgramData\\docker\\docker.exe"
    : "/usr/bin/docker";

const POLICY_PIN: ContainerPolicy = {
  approvedImages: [
    { name: "node", versions: ["22"], digest: "sha256:aaaa" },
  ],
  requireDigest: true,
};

const BINDING: DockerImageBinding = {
  name: "node",
  version: "22",
  digest: "sha256:aaaa",
  limits: { memoryBytes: 256_000_000, cpus: 0.5, pidsLimit: 64 },
};

const JOB: RunnerJobSpec = Object.freeze({
  jobId: "job-1",
  sessionId: "sess-1",
  projectId: "proj-1",
  environmentInstanceId: "inst-1",
  workspaceId: "ws-1",
  workspaceMode: "read_only",
});

const RUN_OPTIONS: RunnerRunOptions = {
  signal: new AbortController().signal,
  maxOutputBytes: 65_536,
  knownSecrets: [],
};

function invocation(
  argv: readonly string[] = ["--version"],
  executableId = "node",
): StructuredInvocation {
  return {
    executableId,
    operationId: "node.version",
    argv,
    workingDirectoryRef: "workspace://proj/ws",
    environmentVariableRefs: [],
    timeoutMs: 10_000,
  };
}

interface Captured {
  spec: BoundedProcessSpec | null;
  runner: (spec: BoundedProcessSpec) => Promise<BoundedProcessResult>;
}

function captureRunner(): Captured {
  const state: Captured = {
    spec: null,
    runner: async (spec) => {
      state.spec = spec;
      return {
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        stdout: { text: "v22.0.0\n", truncated: false, originalBytes: 8 },
        stderr: { text: "", truncated: false, originalBytes: 0 },
        durationMs: 42,
        redactions: 0,
      };
    },
  };
  return state;
}

test("DockerContainerRunner composes a hardened docker run argv", async () => {
  const cap = captureRunner();
  const runner = new DockerContainerRunner({
    runnerId: "docker-local",
    adapterId: "docker-container",
    environmentInstanceIds: ["inst-1"],
    identityFingerprint: "fp-1",
    dockerExecutable: DOCKER_PATH,
    imagesByExecutable: { node: BINDING },
    containerPolicy: POLICY_PIN,
    processRunner: cap.runner,
    nameFactory: () => "aiw-exec-fixed",
  });
  await runner.prepare(JOB);
  const result = await runner.run(JOB.jobId, invocation(), RUN_OPTIONS);
  assert.equal(result.exitClass, "success");
  const argv = cap.spec?.argv ?? [];
  for (const flag of [
    "run",
    "--rm",
    "--read-only",
    "--network=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=1000",
    "--name=aiw-exec-fixed",
    "node:22@sha256:aaaa",
  ]) {
    assert.ok(argv.includes(flag), `expected ${flag} in ${argv.join(" ")}`);
  }
  assert.ok(argv.includes("--memory=256000000"));
  assert.ok(argv.includes("--memory-swap=256000000"));
  assert.ok(argv.includes("--cpus=0.5"));
  const imageIdx = argv.indexOf("node:22@sha256:aaaa");
  assert.deepEqual(argv.slice(imageIdx + 1), ["node", "--version"]);
});

test("DockerContainerRunner denies an executable without an approved image binding", async () => {
  const cap = captureRunner();
  const runner = new DockerContainerRunner({
    runnerId: "docker-local",
    adapterId: "docker-container",
    environmentInstanceIds: ["inst-1"],
    identityFingerprint: "fp-1",
    dockerExecutable: DOCKER_PATH,
    imagesByExecutable: { node: BINDING },
    containerPolicy: POLICY_PIN,
    processRunner: cap.runner,
  });
  await runner.prepare(JOB);
  const result = await runner.run(
    JOB.jobId,
    invocation(["x"], "python"),
    RUN_OPTIONS,
  );
  assert.equal(result.exitClass, "denied");
  assert.equal(result.denial?.code, "TOOL_NOT_ALLOWED");
  assert.equal(cap.spec, null);
});

test("DockerContainerRunner re-evaluates the container policy on every call", async () => {
  const cap = captureRunner();
  const revoked: ContainerPolicy = { approvedImages: [], requireDigest: true };
  const runner = new DockerContainerRunner({
    runnerId: "docker-local",
    adapterId: "docker-container",
    environmentInstanceIds: ["inst-1"],
    identityFingerprint: "fp-1",
    dockerExecutable: DOCKER_PATH,
    imagesByExecutable: { node: BINDING },
    containerPolicy: revoked,
    processRunner: cap.runner,
  });
  await runner.prepare(JOB);
  const result = await runner.run(JOB.jobId, invocation(), RUN_OPTIONS);
  assert.equal(result.exitClass, "denied");
  assert.equal(result.denial?.code, "CAPABILITY_NOT_GRANTED");
  assert.equal(cap.spec, null);
});

test("DockerContainerRunner reports a self-hosted, isolating sandbox", () => {
  const runner = new DockerContainerRunner({
    runnerId: "docker-local",
    adapterId: "docker-container",
    environmentInstanceIds: ["inst-1"],
    identityFingerprint: "fp-1",
    dockerExecutable: DOCKER_PATH,
    imagesByExecutable: { node: BINDING },
    containerPolicy: POLICY_PIN,
  });
  const d = runner.descriptor;
  assert.equal(d.runnerClass, "self_hosted");
  assert.equal(d.trust, "trusted");
  assert.equal(d.sandbox.filesystemIsolation, true);
  assert.equal(d.sandbox.networkIsolation, true);
  assert.deepEqual([...d.sandbox.networkModes], ["deny_all"]);
  assert.ok(d.sandbox.enforcedLimits.includes("memoryBytes"));
  assert.ok(d.sandbox.enforcedLimits.includes("maxProcesses"));
});

test("DockerContainerRunner cancel issues docker kill against the job's container name", async () => {
  const seen: string[][] = [];
  const runner = new DockerContainerRunner({
    runnerId: "docker-local",
    adapterId: "docker-container",
    environmentInstanceIds: ["inst-1"],
    identityFingerprint: "fp-1",
    dockerExecutable: DOCKER_PATH,
    imagesByExecutable: { node: BINDING },
    containerPolicy: POLICY_PIN,
    nameFactory: () => "aiw-exec-cancel",
    processRunner: async (spec) => {
      seen.push([...spec.argv]);
      return {
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        stdout: { text: "", truncated: false, originalBytes: 0 },
        stderr: { text: "", truncated: false, originalBytes: 0 },
        durationMs: 1,
        redactions: 0,
      };
    },
  });
  await runner.prepare(JOB);
  await runner.cancel(JOB.jobId);
  assert.ok(
    seen.some((argv) => argv[0] === "kill" && argv[1] === "aiw-exec-cancel"),
    `expected docker kill aiw-exec-cancel, got ${JSON.stringify(seen)}`,
  );
});

test("DockerContainerRunner mounts the workspace read-only by default via a trusted resolver", async () => {
  const cap = captureRunner();
  const hostPath =
    process.platform === "win32" ? "C:\\aiw\\ws\\ws-1" : "/var/aiw/ws/ws-1";
  const runner = new DockerContainerRunner({
    runnerId: "docker-local",
    adapterId: "docker-container",
    environmentInstanceIds: ["inst-1"],
    identityFingerprint: "fp-1",
    dockerExecutable: DOCKER_PATH,
    imagesByExecutable: { node: BINDING },
    containerPolicy: POLICY_PIN,
    workspaceResolver: {
      resolve: async (workspaceId, projectId) => {
        assert.equal(workspaceId, "ws-1");
        assert.equal(projectId, "proj-1");
        return hostPath;
      },
    },
    processRunner: cap.runner,
    nameFactory: () => "aiw-exec-mount",
  });
  await runner.prepare(JOB);
  await runner.run(JOB.jobId, invocation(), RUN_OPTIONS);
  const argv = cap.spec?.argv ?? [];
  const mountIdx = argv.indexOf("--mount");
  assert.notEqual(mountIdx, -1, "expected --mount flag");
  const mountSpec = argv[mountIdx + 1] ?? "";
  assert.ok(mountSpec.includes("type=bind"));
  assert.ok(mountSpec.includes(`source=${hostPath}`));
  assert.ok(mountSpec.includes("target=/workspace"));
  assert.ok(mountSpec.includes("readonly"), "default spec is read_only");
  assert.ok(mountSpec.includes("bind-propagation=rprivate"));
  assert.ok(argv.includes("--workdir=/workspace"));
});

test("DockerContainerRunner mounts read-write only when workspaceMode == read_write", async () => {
  const cap = captureRunner();
  const runner = new DockerContainerRunner({
    runnerId: "docker-local",
    adapterId: "docker-container",
    environmentInstanceIds: ["inst-1"],
    identityFingerprint: "fp-1",
    dockerExecutable: DOCKER_PATH,
    imagesByExecutable: { node: BINDING },
    containerPolicy: POLICY_PIN,
    workspaceResolver: { resolve: async () => "/var/aiw/ws/ws-rw" },
    processRunner: cap.runner,
  });
  const rwSpec: RunnerJobSpec = Object.freeze({ ...JOB, workspaceMode: "read_write" });
  await runner.prepare(rwSpec);
  await runner.run(rwSpec.jobId, invocation(), RUN_OPTIONS);
  const mountSpec =
    cap.spec?.argv[(cap.spec.argv.indexOf("--mount") + 1) | 0] ?? "";
  assert.ok(mountSpec.includes("source=/var/aiw/ws/ws-rw"));
  assert.ok(!mountSpec.includes("readonly"), "rw spec drops the readonly flag");
});

test("DockerContainerRunner rejects a non-absolute workspace path with WORKSPACE_VIOLATION", async () => {
  const cap = captureRunner();
  const runner = new DockerContainerRunner({
    runnerId: "docker-local",
    adapterId: "docker-container",
    environmentInstanceIds: ["inst-1"],
    identityFingerprint: "fp-1",
    dockerExecutable: DOCKER_PATH,
    imagesByExecutable: { node: BINDING },
    containerPolicy: POLICY_PIN,
    workspaceResolver: { resolve: async () => "relative/path" },
    processRunner: cap.runner,
  });
  await runner.prepare(JOB);
  const result = await runner.run(JOB.jobId, invocation(), RUN_OPTIONS);
  assert.equal(result.exitClass, "denied");
  assert.equal(result.denial?.code, "WORKSPACE_VIOLATION");
  assert.equal(cap.spec, null);
});

test("DockerContainerRunner runs without a mount when the resolver returns null", async () => {
  const cap = captureRunner();
  const runner = new DockerContainerRunner({
    runnerId: "docker-local",
    adapterId: "docker-container",
    environmentInstanceIds: ["inst-1"],
    identityFingerprint: "fp-1",
    dockerExecutable: DOCKER_PATH,
    imagesByExecutable: { node: BINDING },
    containerPolicy: POLICY_PIN,
    workspaceResolver: { resolve: async () => null },
    processRunner: cap.runner,
  });
  await runner.prepare(JOB);
  const result = await runner.run(JOB.jobId, invocation(), RUN_OPTIONS);
  assert.equal(result.exitClass, "success");
  const argv = cap.spec?.argv ?? [];
  assert.equal(argv.indexOf("--mount"), -1, "no mount flag when resolver returns null");
});

test("DockerContainerRunner requires at least one image binding", () => {
  assert.throws(
    () =>
      new DockerContainerRunner({
        runnerId: "docker-local",
        adapterId: "docker-container",
        environmentInstanceIds: ["inst-1"],
        identityFingerprint: "fp-1",
        dockerExecutable: DOCKER_PATH,
        imagesByExecutable: {},
        containerPolicy: POLICY_PIN,
      }),
    /at least one imagesByExecutable binding/,
  );
});
