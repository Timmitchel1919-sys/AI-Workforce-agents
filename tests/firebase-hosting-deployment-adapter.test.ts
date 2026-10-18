import assert from "node:assert/strict";
import test from "node:test";

import { FirebaseHostingDeploymentAdapter } from "../adapters/release/firebase-hosting-deployment-adapter.js";
import type {
  BoundedProcessResult,
  BoundedProcessSpec,
} from "../adapters/execution/bounded-process-runner.js";
import type {
  DeploymentContext,
  DeploymentCandidate,
  DeploymentTarget,
} from "../contracts/index.js";

const FIREBASE_PATH =
  process.platform === "win32"
    ? "C:\\Program Files\\nodejs\\firebase.cmd"
    : "/usr/local/bin/firebase";
const CWD = process.platform === "win32" ? "C:\\tmp\\deploy" : "/tmp/deploy";

const CANDIDATE: DeploymentCandidate = Object.freeze({
  candidateId: "cand-1",
  projectId: "proj-1",
  planId: "plan-1",
  planVersion: 1,
  changeSetId: "cs-1",
  sourceFingerprint: "fp-1",
  commitSha: "abcdef1234567890",
  pushReceiptId: "pr-1",
  verificationId: "vr-1",
  artifacts: [],
  targetId: "tgt-1",
  releasePolicyVersion: 1,
  createdBy: "op-1",
  createdAt: "2026-10-17T18:00:00Z",
}) as DeploymentCandidate;

const TARGET: DeploymentTarget = Object.freeze({
  targetId: "tgt-1",
  projectId: "proj-1",
  targetClass: "production",
  adapterId: "firebase-hosting",
  resources: ["hosting:site-a@https://site-a.web.app"],
  providerRef: "my-firebase-project",
  credentialRef: "secret://firebase-token",
  timeoutMs: 60_000,
}) as DeploymentTarget;

function ctx(overrides: Partial<DeploymentContext> = {}): DeploymentContext {
  return {
    candidate: CANDIDATE,
    target: TARGET,
    signal: new AbortController().signal,
    credential: "the-token",
    ...overrides,
  };
}

type ProcessSpec = BoundedProcessSpec;
function okResult(stdout: string): BoundedProcessResult {
  return {
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    stdout: { text: stdout, truncated: false, originalBytes: stdout.length },
    stderr: { text: "", truncated: false, originalBytes: 0 },
    durationMs: 10,
    redactions: 0,
  };
}
function failResult(stderr: string, exitCode = 1): BoundedProcessResult {
  return {
    exitCode,
    timedOut: false,
    cancelled: false,
    stdout: { text: "", truncated: false, originalBytes: 0 },
    stderr: { text: stderr, truncated: false, originalBytes: stderr.length },
    durationMs: 10,
    redactions: 0,
  };
}

test("deploy() runs firebase deploy with hardened argv and returns the release id", async () => {
  const specs: ProcessSpec[] = [];
  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    processRunner: async (spec) => {
      specs.push(spec);
      return okResult(
        JSON.stringify({
          status: "success",
          result: { "site-a": { release: "sites/site-a/releases/REL-123" } },
        }),
      );
    },
  });
  const result = await adapter.deploy(ctx());
  assert.equal(result.providerReleaseId, "sites/site-a/releases/REL-123");
  assert.equal(result.failedResources, undefined);
  assert.equal(specs.length, 1);
  const argv = specs[0]!.argv;
  // Fixed, server-controlled argv — no shell, no agent values.
  assert.deepEqual(
    [...argv],
    [
      "deploy",
      "--only",
      "hosting:site-a",
      "--project",
      "my-firebase-project",
      "--non-interactive",
      "--json",
    ],
  );
  // Credential arrives via FIREBASE_TOKEN env var — never argv.
  assert.equal(specs[0]!.env.FIREBASE_TOKEN, "the-token");
  assert.ok(!argv.join(" ").includes("the-token"));
});

test("deploy() reports failedResources for a non-zero exit", async () => {
  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    processRunner: async () => failResult("boom"),
  });
  const result = await adapter.deploy(ctx());
  assert.deepEqual([...(result.failedResources ?? [])], ["hosting:site-a"]);
  assert.equal(result.providerReleaseId, "");
});

test("deploy() rejects malformed resources with every resource failed", async () => {
  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    processRunner: async () => okResult("{}"),
  });
  const result = await adapter.deploy(
    ctx({
      target: {
        ...TARGET,
        resources: ["hosting:site-a", "unknown:thing"], // missing @https URL
      } as DeploymentTarget,
    }),
  );
  assert.deepEqual(
    [...(result.failedResources ?? [])],
    ["hosting:site-a", "unknown:thing"],
  );
});

test("verify() HEALTHY requires reachable AND commit match", async () => {
  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    httpFetch: async (url) => {
      assert.equal(url, "https://site-a.web.app/__/release.json");
      return {
        status: 200,
        text: async () => JSON.stringify({ commit: CANDIDATE.commitSha }),
      };
    },
    processRunner: async () => okResult("{}"),
  });
  const r = await adapter.verify(ctx());
  assert.equal(r.reachable, true);
  assert.equal(r.reportedVersion, CANDIDATE.commitSha);
});

test("verify() reports a commit mismatch as reachable but degraded", async () => {
  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    httpFetch: async () => ({
      status: 200,
      text: async () => JSON.stringify({ commit: "stale-commit" }),
    }),
    processRunner: async () => okResult("{}"),
  });
  const r = await adapter.verify(ctx());
  assert.equal(r.reachable, true);
  assert.equal(r.reportedVersion, "stale-commit");
  assert.match(r.detail, /commit mismatch/);
});

test("verify() reports unreachable on non-200", async () => {
  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    httpFetch: async () => ({ status: 503, text: async () => "down" }),
    processRunner: async () => okResult("{}"),
  });
  const r = await adapter.verify(ctx());
  assert.equal(r.reachable, false);
  assert.match(r.detail, /503/);
});

test("rollback() calls firebase hosting:clone with the previous release id", async () => {
  const specs: ProcessSpec[] = [];
  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    processRunner: async (spec) => {
      specs.push(spec);
      return okResult("");
    },
  });
  await adapter.rollback(ctx(), "sites/site-a/releases/PREV");
  assert.equal(specs.length, 1);
  assert.deepEqual(
    [...specs[0]!.argv],
    [
      "hosting:clone",
      "sites/site-a/releases/PREV",
      "my-firebase-project:live",
      "--non-interactive",
      "--project",
      "my-firebase-project",
    ],
  );
});

test("rollback() refuses an empty previous release id", async () => {
  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    processRunner: async () => okResult(""),
  });
  await assert.rejects(() => adapter.rollback(ctx(), ""), /previous/);
});
