import assert from "node:assert/strict";
import test from "node:test";

import type { EnvironmentInstance } from "../contracts/environments.js";
import type { TaskEnvironmentRoutingSummary } from "../contracts/orchestration.js";
import {
  buildEnvironmentFragment,
  MAX_INSTANCE_NODES,
  type EnvironmentFragmentInput,
} from "../core/orchestrator/graph-environment-fragment.js";

const P = "proj-a";
const task = (id: string, projectId = P) => ({ id, projectId });
const route = (
  taskId: string,
  code: string,
  status: TaskEnvironmentRoutingSummary["status"],
): TaskEnvironmentRoutingSummary => ({ taskId, code, status, detail: "d" });

function instance(
  id: string,
  environmentType: EnvironmentInstance["environmentType"],
  availability: EnvironmentInstance["availability"] = "available",
): EnvironmentInstance {
  return {
    id,
    descriptorId: "desc-secret",
    hostId: "HOST-SENTINEL",
    environmentType,
    name: `Instance ${id}`,
    version: { major: 24, minor: 1, patch: 0 },
    installation: "C:/SENTINEL/INSTALL/PATH",
    availability,
    capabilities: [],
    toolchains: [],
    trustLevel: "verified",
    fingerprint: "FINGERPRINT-SENTINEL",
    safeMetadata: { token: "SAFEMETA-SENTINEL" },
  };
}
const registryOf = (list: EnvironmentInstance[]) => ({
  listInstances: () => list,
});

test("empty inputs and none/skipped routes yield an empty fragment", () => {
  assert.deepEqual(
    buildEnvironmentFragment({ projectId: P, tasks: [], routes: [] }),
    { nodes: [], edges: [] },
  );
  const f = buildEnvironmentFragment({
    projectId: P,
    tasks: [task("t1")],
    routes: [route("t1", "none", "routed"), route("t1", "docker", "skipped")],
  });
  assert.deepEqual(f, { nodes: [], edges: [] });
});

test("routes for foreign tasks or foreign-project tasks are ignored", () => {
  const f = buildEnvironmentFragment({
    projectId: P,
    tasks: [task("t1"), task("t2", "proj-b")],
    routes: [route("t2", "docker", "routed"), route("zzz", "docker", "routed")],
  });
  assert.deepEqual(f, { nodes: [], edges: [] });
});

test("status precedence and counts per environment", () => {
  const f = buildEnvironmentFragment({
    projectId: P,
    tasks: [task("t1"), task("t2"), task("t3")],
    routes: [
      route("t1", "docker", "unsupported"),
      route("t2", "docker", "requires_provisioning"),
      route("t3", "docker", "routed"),
    ],
  });
  const docker = f.nodes.find((n) => n.id === "env-docker")!;
  assert.equal(docker.status, "routed");
  assert.equal(docker.state, "active");
  assert.equal(docker.label, "Docker");
  assert.equal(docker.referenceId, "docker");
  assert.deepEqual(docker.metadata, {
    code: "docker",
    environmentType: "docker",
    routedTasks: 1,
    totalTasks: 3,
  });
  const g = buildEnvironmentFragment({
    projectId: P,
    tasks: [task("t1"), task("t2")],
    routes: [
      route("t1", "xcode", "unsupported"),
      route("t2", "xcode", "no_environment"),
    ],
  });
  assert.equal(
    g.nodes.find((n) => n.id === "env-xcode")!.status,
    "no_environment",
  );
});

test("node and edge shapes and ids", () => {
  const f = buildEnvironmentFragment({
    projectId: P,
    tasks: [task("t1"), task("t2")],
    routes: [
      route("t1", "vs-code", "routed"),
      route("t2", "custom-x", "no_environment"),
    ],
  });
  const router = f.nodes.find((n) => n.id === `env-router-${P}`)!;
  assert.equal(router.type, "ENVIRONMENT_ROUTER");
  assert.equal(router.label, "Environment Router");
  assert.equal(router.state, "active");
  const custom = f.nodes.find((n) => n.id === "env-custom-x")!;
  assert.equal(custom.label, "custom-x");
  assert.equal(custom.metadata?.environmentType, undefined);
  assert.equal(f.nodes.find((n) => n.id === "env-vs-code")!.label, "VS Code");
  assert.equal(
    f.nodes.find((n) => n.id === "env-vs-code")!.metadata?.environmentType,
    "visual_studio_code",
  );

  const ids = f.edges.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(
    new Set(ids),
    new Set([
      "task-routed-t1",
      "task-routed-t2",
      "env-router-to-vs-code",
      "env-router-to-custom-x",
      "task-executes-t1-vs-code",
    ]),
  );
  const exec = f.edges.find((e) => e.id === "task-executes-t1-vs-code")!;
  assert.equal(exec.type, "EXECUTES_IN");
  assert.equal(exec.source, "task-t1");
  assert.equal(exec.target, "env-vs-code");
  const tr = f.edges.find((e) => e.id === "task-routed-t2")!;
  assert.equal(tr.type, "ROUTED_TO");
  assert.equal(tr.source, "task-t2");
  assert.equal(tr.target, `env-router-${P}`);
  const rt = f.edges.find((e) => e.id === "env-router-to-custom-x")!;
  assert.equal(rt.source, `env-router-${P}`);
  assert.equal(rt.status, "no_environment");
  // no EXECUTES_IN for non-routed
  assert.equal(f.edges.filter((e) => e.type === "EXECUTES_IN").length, 1);
});

test("unsupported / unavailable never render as active", () => {
  const f = buildEnvironmentFragment({
    projectId: P,
    tasks: [task("t1"), task("t2"), task("t3")],
    routes: [
      route("t1", "unity", "unsupported"),
      route("t2", "unreal", "no_environment"),
      route("t3", "xcode", "requires_provisioning"),
    ],
    registry: registryOf([
      instance("i1", "unity", "unavailable"),
      instance("i2", "xcode", "disabled"),
    ]),
  });
  for (const n of f.nodes.filter((n) => n.id !== `env-router-${P}`)) {
    assert.notEqual(n.state, "active", n.id);
  }
});

test("instance nodes leak no host/installation/fingerprint/safeMetadata", () => {
  const input: EnvironmentFragmentInput = {
    projectId: P,
    tasks: [task("t1")],
    routes: [route("t1", "docker", "routed")],
    registry: registryOf([instance("i1", "docker"), instance("i2", "unity")]),
  };
  const f = buildEnvironmentFragment(input);
  const inst = f.nodes.find((n) => n.label === "Instance i1")!;
  assert.match(inst.id, /^env-instance-[0-9a-f]{12}$/);
  assert.equal(inst.id.includes("i1"), false, "raw registry id must not leak");
  assert.equal(inst.label, "Instance i1");
  assert.equal(inst.status, "available");
  assert.equal(inst.state, "active");
  assert.deepEqual(inst.metadata, {
    availability: "available",
    environmentType: "docker",
    trustLevel: "verified",
    version: "24.1.0",
  });
  assert.equal(
    f.nodes.some((n) => n.label === "Instance i2"),
    false,
  );
  const edge = f.edges.find((e) => e.type === "BELONGS_TO")!;
  assert.equal(edge.source, inst.id);
  assert.equal(edge.target, "env-docker");
  const json = JSON.stringify(f);
  for (const s of [
    "HOST-SENTINEL",
    "SENTINEL/INSTALL",
    "FINGERPRINT-SENTINEL",
    "SAFEMETA-SENTINEL",
    "desc-secret",
  ]) {
    assert.equal(json.includes(s), false, s);
  }
});

test("registry absent yields no instance nodes", () => {
  const f = buildEnvironmentFragment({
    projectId: P,
    tasks: [task("t1")],
    routes: [route("t1", "docker", "routed")],
  });
  assert.equal(
    f.nodes.filter((n) => n.id.startsWith("env-instance-")).length,
    0,
  );
  assert.equal(f.nodes.length, 2);
});

test("deterministic regardless of input order", () => {
  const mk = (rev: boolean): EnvironmentFragmentInput => {
    const routes = [
      route("t1", "docker", "routed"),
      route("t2", "xcode", "unsupported"),
      route("t2", "docker", "no_environment"),
    ];
    const insts = [instance("b", "docker"), instance("a", "docker")];
    return {
      projectId: P,
      tasks: [task("t1"), task("t2")],
      routes: rev ? routes.reverse() : routes,
      registry: registryOf(rev ? insts.reverse() : insts),
    };
  };
  assert.deepEqual(
    buildEnvironmentFragment(mk(false)),
    buildEnvironmentFragment(mk(false)),
  );
  assert.deepEqual(
    buildEnvironmentFragment(mk(false)),
    buildEnvironmentFragment(mk(true)),
  );
});

test("instance nodes are capped and sorted by id", () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    instance(`i${String(29 - i).padStart(2, "0")}`, "docker"),
  );
  const f = buildEnvironmentFragment({
    projectId: P,
    tasks: [task("t1")],
    routes: [route("t1", "docker", "routed")],
    registry: registryOf(many),
  });
  const ids = f.nodes
    .filter((n) => n.id.startsWith("env-instance-"))
    .map((n) => n.id);
  assert.equal(ids.length, MAX_INSTANCE_NODES);
  const labels = f.nodes
    .filter((n) => n.id.startsWith("env-instance-"))
    .map((n) => n.label)
    .sort();
  assert.equal(labels[0], "Instance i00");
  assert.equal(labels[labels.length - 1], "Instance i19");
});

test("env code cannot collide with router/instance id namespaces", () => {
  const f = buildEnvironmentFragment({
    projectId: P,
    tasks: [task("t1")],
    routes: [
      route("t1", `router-${P}`, "routed"),
      route("t1", "instance-x", "routed"),
      route("t1", "Bad Code!", "routed"),
    ],
  });
  assert.deepEqual(f, { nodes: [], edges: [] });
});

test("instance ids differ per project and never equal the registry id", () => {
  const mk = (projectId: string) =>
    buildEnvironmentFragment({
      projectId,
      tasks: [{ id: "t1", projectId }],
      routes: [route("t1", "docker", "routed")],
      registry: registryOf([instance("i1", "docker")]),
    }).nodes.find((n) => n.label === "Instance i1")!.id;
  assert.notEqual(mk("p-one"), mk("p-two"));
});
