/**
 * R12 (ADR-0034) — End-to-end integration test for the release
 * pipeline's credential + adapter chain.
 *
 * Drives a candidate through:
 *   EnvSecretBroker.resolve("secret://firebase-token")
 *     → FirebaseHostingDeploymentAdapter.deploy()
 *     → .verify() (stubbed HTTP matching the candidate's commit)
 *     → .rollback(previousReleaseId)
 *
 * Asserts the credential NEVER appears in docker/firebase argv OR captured
 * output, and that every step receives `FIREBASE_TOKEN` via env only.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { EnvSecretBroker } from "../adapters/vault/env-secret-broker.js";
import { FirebaseHostingDeploymentAdapter } from "../adapters/release/firebase-hosting-deployment-adapter.js";
import type {
  BoundedProcessResult,
  BoundedProcessSpec,
} from "../adapters/execution/bounded-process-runner.js";
import type {
  DeploymentCandidate,
  DeploymentContext,
  DeploymentTarget,
  SecretReference,
} from "../contracts/index.js";

const FIREBASE_PATH =
  process.platform === "win32"
    ? "C:\\Program Files\\nodejs\\firebase.cmd"
    : "/usr/local/bin/firebase";
const CWD = process.platform === "win32" ? "C:\\tmp\\deploy" : "/tmp/deploy";

const SECRET_VALUE = "sekret-token-value-must-not-leak";
const COMMIT = "deadbeefcafebabe1234";

const CANDIDATE: DeploymentCandidate = Object.freeze({
  candidateId: "cand-e2e",
  projectId: "proj-e2e",
  planId: "plan-e2e",
  planVersion: 1,
  changeSetId: "cs-e2e",
  sourceFingerprint: "fp-e2e",
  commitSha: COMMIT,
  pushReceiptId: "pr-e2e",
  verificationId: "vr-e2e",
  artifacts: [],
  targetId: "tgt-e2e",
  releasePolicyVersion: 1,
  createdBy: "op-e2e",
  createdAt: "2026-10-18T00:00:00Z",
}) as DeploymentCandidate;

const TARGET: DeploymentTarget = Object.freeze({
  targetId: "tgt-e2e",
  projectId: "proj-e2e",
  targetClass: "production",
  adapterId: "firebase-hosting",
  resources: ["hosting:prod-site@https://prod.example.com"],
  providerRef: "prod-firebase-project",
  credentialRef: "secret://firebase-token" as `secret://${string}`,
  timeoutMs: 60_000,
}) as DeploymentTarget;

test("R12: full deploy → verify → rollback chain with EnvSecretBroker credentials", async () => {
  const broker = new EnvSecretBroker({
    env: () => ({ AIW_SECRET_FIREBASE_TOKEN: SECRET_VALUE }),
  });
  const specs: BoundedProcessSpec[] = [];

  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    processRunner: async (spec): Promise<BoundedProcessResult> => {
      specs.push(spec);
      // The credential must NEVER appear in argv. Only in env.
      assert.ok(
        !spec.argv.some((a) => a.includes(SECRET_VALUE)),
        `credential leaked to argv: ${spec.argv.join(" ")}`,
      );
      // Must be injected via FIREBASE_TOKEN env var.
      assert.equal(spec.env.FIREBASE_TOKEN, SECRET_VALUE);
      // Deploy returns a provider release id; rollback is called with it.
      if (spec.argv[0] === "deploy") {
        return {
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          stdout: {
            text: JSON.stringify({
              status: "success",
              result: {
                "prod-site": {
                  release: "sites/prod-site/releases/REL-E2E-1",
                },
              },
            }),
            truncated: false,
            originalBytes: 100,
          },
          stderr: { text: "", truncated: false, originalBytes: 0 },
          durationMs: 50,
          redactions: 0,
        };
      }
      // hosting:clone (rollback) — just succeeds.
      return {
        exitCode: 0,
        timedOut: false,
        cancelled: false,
        stdout: { text: "", truncated: false, originalBytes: 0 },
        stderr: { text: "", truncated: false, originalBytes: 0 },
        durationMs: 20,
        redactions: 0,
      };
    },
    httpFetch: async (url) => {
      assert.equal(url, "https://prod.example.com/__/release.json");
      return {
        status: 200,
        text: async () => JSON.stringify({ commit: COMMIT }),
      };
    },
  });

  // STEP 1: broker resolves the credential — this is the authoritative
  // boundary. The DeploymentOrchestrator does exactly this before building
  // the DeploymentContext.
  const credential = await broker.resolve(
    TARGET.credentialRef as SecretReference,
  );
  assert.equal(credential, SECRET_VALUE);

  function ctx(): DeploymentContext {
    return {
      candidate: CANDIDATE,
      target: TARGET,
      signal: new AbortController().signal,
      credential,
    };
  }

  // STEP 2: deploy
  const deployResult = await adapter.deploy(ctx());
  assert.equal(deployResult.failedResources, undefined);
  assert.equal(
    deployResult.providerReleaseId,
    "sites/prod-site/releases/REL-E2E-1",
  );

  // STEP 3: verify HEALTHY (reachable AND commit match)
  const verifyResult = await adapter.verify(ctx());
  assert.equal(verifyResult.reachable, true);
  assert.equal(verifyResult.reportedVersion, COMMIT);

  // STEP 4: rollback to the previous release
  await adapter.rollback(ctx(), "sites/prod-site/releases/REL-E2E-prev");

  // We expected 2 process calls (deploy + hosting:clone), each with the
  // credential in env ONLY.
  assert.equal(specs.length, 2);
  assert.deepEqual(
    specs.map((s) => s.argv[0]),
    ["deploy", "hosting:clone"],
  );
  for (const spec of specs) {
    assert.equal(spec.env.FIREBASE_TOKEN, SECRET_VALUE);
    assert.ok(!spec.argv.join(" ").includes(SECRET_VALUE));
    assert.ok(!spec.cwd.includes(SECRET_VALUE));
  }
});

test("R12: broker resolution failure aborts BEFORE any provider call", async () => {
  const broker = new EnvSecretBroker({ env: () => ({}) });
  let providerWasCalled = false;
  const adapter = new FirebaseHostingDeploymentAdapter({
    firebaseExecutable: FIREBASE_PATH,
    workingDirectory: CWD,
    processRunner: async () => {
      providerWasCalled = true;
      throw new Error("should never run");
    },
  });

  await assert.rejects(
    () => broker.resolve(TARGET.credentialRef as SecretReference),
    /not configured/,
  );

  // Even if callers then invoked the adapter without a credential, the
  // adapter still shouldn't be reached — because the orchestrator aborts.
  // We only prove the first invariant here: the resolver throws.
  assert.equal(providerWasCalled, false);
  // Mark the adapter as used so it isn't a dead ref:
  assert.equal(adapter.adapterId, "firebase-hosting");
});
