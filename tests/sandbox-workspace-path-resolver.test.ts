import assert from "node:assert/strict";
import test from "node:test";

import { SandboxWorkspacePathResolver } from "../adapters/environments/sandbox-workspace-path-resolver.js";
import type { WorkspaceRootLookup } from "../adapters/environments/sandbox-workspace-path-resolver.js";

function lookup(
  table: Readonly<Record<string, { projectId: string; root: string }>>,
): WorkspaceRootLookup {
  return {
    workspaceRoot(workspaceId, projectId) {
      const entry = table[workspaceId];
      if (!entry || entry.projectId !== projectId) return null;
      return entry.root;
    },
  };
}

test("R9: resolves the host path for a leased workspace in the correct project", async () => {
  const resolver = new SandboxWorkspacePathResolver(
    lookup({ "ws-1": { projectId: "proj-A", root: "/var/aiw/ws/ws-1" } }),
  );
  assert.equal(await resolver.resolve("ws-1", "proj-A"), "/var/aiw/ws/ws-1");
});

test("R9: returns null for a cross-project workspaceId (no path leak)", async () => {
  const resolver = new SandboxWorkspacePathResolver(
    lookup({ "ws-1": { projectId: "proj-A", root: "/var/aiw/ws/ws-1" } }),
  );
  assert.equal(await resolver.resolve("ws-1", "proj-B"), null);
});

test("R9: returns null for an unknown workspaceId", async () => {
  const resolver = new SandboxWorkspacePathResolver(lookup({}));
  assert.equal(await resolver.resolve("ws-missing", "proj-A"), null);
});

test("R9: swallows a throwing lookup and returns null (fail-closed, no leak)", async () => {
  const resolver = new SandboxWorkspacePathResolver({
    workspaceRoot: () => {
      throw new Error("adapter imploded");
    },
  });
  assert.equal(await resolver.resolve("ws-1", "proj-A"), null);
});
