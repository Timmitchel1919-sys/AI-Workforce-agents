/**
 * EO-6.1 — release capabilities are DERIVED from what is composed and registered, at read time.
 * (A hard-coded literal, or a construction-time snapshot, would pass the old test and lie.)
 */
import assert from "node:assert/strict";
import test from "node:test";

import { inertReleaseCapabilities } from "../contracts/index.js";
import {
  DeploymentOrchestrator,
  ExecutionOperationRegistry,
  SandboxRegistry,
  UnavailableArtifactSource,
  UnavailableGovernedGit,
  UnavailableWorkspaceControl,
  deriveReleaseCapabilities,
} from "../core/index.js";

const real = { available: true };
const parts = (over: Record<string, unknown> = {}) => {
  const adapters: string[] = [];
  const sandboxes = { ids: [] as string[], list() { return this.ids; } };
  const operations = { items: [] as unknown[], list() { return this.items; } };
  const p = {
    sandboxes,
    operations,
    git: real,
    workspace: real,
    artifactSource: real,
    deployments: { adapterIds: () => adapters },
    adapters,
    ...over,
  };
  return p as typeof p & { sandboxes: typeof sandboxes; operations: typeof operations; adapters: string[] };
};

test("nothing registered: every capability is off", () => {
  const p = parts();
  const c = deriveReleaseCapabilities(p as never);
  assert.deepEqual({ v: c.verification, s: c.sourceControl, d: c.deploymentAdapters }, { v: false, s: true, d: [] });
  // (a real git + workspace exist here, so source control is available; verification still needs a sandbox + operations)
  assert.deepEqual(inertReleaseCapabilities(c), ["verification", "deployment"]);
});

test("verification needs a sandbox AND operations AND a real workspace AND a real artifact source", () => {
  const p = parts();
  const c = deriveReleaseCapabilities(p as never);
  p.sandboxes.ids.push("workspace-runner");
  assert.equal(c.verification, false, "a sandbox alone is not enough");
  p.operations.items.push({ id: "node.build" });
  assert.equal(c.verification, true, "sandbox + operations + real ports");
  // ...but with the fail-closed workspace, the same sandbox+operations must NOT advertise verification.
  const noWs = deriveReleaseCapabilities({ ...p, workspace: new UnavailableWorkspaceControl() } as never);
  assert.equal(noWs.verification, false);
  const noArt = deriveReleaseCapabilities({ ...p, artifactSource: new UnavailableArtifactSource() } as never);
  assert.equal(noArt.verification, false);
});

test("source control needs a real Git port AND a real workspace", () => {
  const p = parts();
  assert.equal(deriveReleaseCapabilities(p as never).sourceControl, true);
  assert.equal(deriveReleaseCapabilities({ ...p, git: new UnavailableGovernedGit() } as never).sourceControl, false);
  assert.equal(deriveReleaseCapabilities({ ...p, workspace: new UnavailableWorkspaceControl() } as never).sourceControl, false);
});

test("the report is evaluated when READ: a provider or adapter registered later is reflected (no stale snapshot)", () => {
  const p = parts();
  const c = deriveReleaseCapabilities(p as never);
  assert.deepEqual(c.deploymentAdapters, []);
  p.adapters.push("firebase-hosting");
  assert.deepEqual(c.deploymentAdapters, ["firebase-hosting"]);
  assert.deepEqual(inertReleaseCapabilities(c), ["verification"]);
  p.sandboxes.ids.push("s");
  p.operations.items.push({});
  assert.deepEqual(inertReleaseCapabilities(c), []);
});

test("the REAL registries feed it: SandboxRegistry.list() and DeploymentOrchestrator.adapterIds()", () => {
  const sandboxes = new SandboxRegistry();
  assert.deepEqual(sandboxes.list(), []);
  sandboxes.register({ providerId: "b-provider" } as never);
  sandboxes.register({ providerId: "a-provider" } as never);
  assert.deepEqual(sandboxes.list(), ["a-provider", "b-provider"], "sorted");
  const deployments = new DeploymentOrchestrator({
    sourceControl: {} as never, verification: {} as never, artifacts: {} as never,
    approvals: {} as never, projects: { has: () => true }, audit: {} as never,
  });
  assert.deepEqual(deployments.adapterIds(), []);
  deployments.registerAdapter({ adapterId: "zeta", version: "1", deploy: async () => ({ providerReleaseId: "p" }), verify: async () => ({ reachable: true, detail: "" }) });
  deployments.registerAdapter({ adapterId: "alpha", version: "1", deploy: async () => ({ providerReleaseId: "p" }), verify: async () => ({ reachable: true, detail: "" }) });
  assert.deepEqual(deployments.adapterIds(), ["alpha", "zeta"]);
  const ops = new ExecutionOperationRegistry();
  assert.equal(ops.list().length, 0);
});

test("the fail-closed stand-ins mark themselves unavailable", () => {
  for (const port of [new UnavailableGovernedGit(), new UnavailableWorkspaceControl(), new UnavailableArtifactSource()]) {
    assert.equal(port.available, false);
  }
});
