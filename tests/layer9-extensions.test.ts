/**
 * Layer 9 — Extension, Plugin & Developer Platform.
 * Real registry, validation, permission model, versioning, dependencies, audit and control service.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_EXTENSIONS,
  ExtensionError,
  ExtensionSystem,
  inMemoryExtensionRepos,
  validateManifest,
  type ExtensionManifest,
} from "../core/index.js";
import { ExtensionControlService } from "../control/services/platform-layers-control.js";
import {
  ADMIN,
  OPERATOR,
  VIEWER,
  makeSecurity,
} from "./helpers/platform-fixtures.js";

function rig(external?: {
  check: (k: string, id: string, r?: string) => { ok: boolean; reason: string };
}) {
  const f = makeSecurity();
  const system = new ExtensionSystem({
    repos: inMemoryExtensionRepos(),
    security: f.security,
    now: f.clock.now,
    ...(external ? { external: external as never } : {}),
  });
  const control = new ExtensionControlService(
    { audit: f.audit, clock: f.clock.iso },
    system.platform,
  );
  return { ...f, system, platform: system.platform, control };
}

const skill = (
  id: string,
  version = "1.0.0",
  over: Partial<ExtensionManifest> = {},
): ExtensionManifest => ({
  id,
  name: `Skill ${id}`,
  description: "A test skill",
  version,
  type: "SKILL",
  author: "tester",
  capabilities: ["test.capability"],
  dependencies: [],
  permissions: [],
  spec: {
    capability: "test.capability",
    instructions: "Do the thing carefully.",
    prerequisites: [],
    tools: [],
    expectedOutputs: ["a result"],
    validation: ["it works"],
    appliesTo: { keywords: ["widget"] },
  },
  ...over,
});
const ready = (r: ReturnType<typeof rig>, m: ExtensionManifest) => {
  r.platform.register(m, "owner");
  r.platform.test(m.id, "owner");
  r.platform.review(m.id, "owner");
};

/* ------------------------------ registration ------------------------------ */

test("built-in skills, agents and workflow templates are registered, validated and NOT enabled", () => {
  const r = rig();
  const list = r.platform.list();
  assert.equal(list.length, BUILTIN_EXTENSIONS.length);
  for (const type of ["SKILL", "AGENT", "WORKFLOW"])
    assert.ok(
      list.some((x) => x.type === type),
      type,
    );
  for (const x of list) {
    assert.equal(x.status, "REGISTERED", x.extensionId);
    assert.equal(x.health, "INSTALLED");
    assert.equal(x.versions[0]!.tested, true);
    assert.ok(
      ["PASSED", "APPROVED"].includes(x.versions[0]!.review ?? ""),
      `${x.extensionId} review`,
    );
  }
  for (const id of [
    "skill.react-development",
    "skill.firebase-development",
    "skill.wordpress-development",
    "skill.data-analysis",
    "skill.sql-analysis",
    "skill.ui-ux-review",
    "skill.security-review",
    "skill.3d-design",
    "skill.blender-workflow",
    "skill.financial-analysis",
  ])
    assert.ok(
      list.some((x) => x.extensionId === id),
      id,
    );
  for (const id of [
    "agent.wordpress",
    "agent.data-analyst",
    "agent.3d",
    "agent.finance",
    "agent.research",
  ])
    assert.ok(
      list.some((x) => x.extensionId === id),
      id,
    );
});

test("installing the built-ins twice does not duplicate anything", () => {
  const r = rig();
  assert.equal(r.system.installBuiltins("again"), 0);
  assert.equal(r.platform.list().length, BUILTIN_EXTENSIONS.length);
});

test("a valid skill registers; a duplicate id is a conflict", () => {
  const r = rig();
  const v = r.platform.register(skill("my.skill"), "owner");
  assert.equal(v.status, "REGISTERED");
  assert.equal(v.supportLevel, "ACTIVE");
  assert.throws(
    () => r.platform.register(skill("my.skill"), "owner"),
    (e: unknown) => e instanceof ExtensionError && e.code === "conflict",
  );
});

test("manifests carrying executable content, secrets or unknown/never-granted permissions are rejected", () => {
  const bad: [string, unknown][] = [
    [
      "executable key",
      {
        ...skill("a.b.c"),
        spec: { ...(skill("a.b.c").spec as object), script: "rm -rf /" },
      },
    ],
    [
      "nested code",
      {
        ...skill("a.b.d"),
        spec: { ...(skill("a.b.d").spec as object), appliesTo: { code: "x" } },
      },
    ],
    [
      "secret",
      {
        ...skill("a.b.e"),
        description: "key ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      },
    ],
    [
      "unknown permission",
      skill("a.b.f", "1.0.0", { permissions: ["root.everything"] }),
    ],
    [
      "never-granted permission",
      skill("a.b.g", "1.0.0", { permissions: ["secrets.read"] }),
    ],
    ["bad id", skill("X")],
    ["bad version", skill("a.b.h", "1.0")],
    ["no capability", skill("a.b.i", "1.0.0", { capabilities: [] })],
    [
      "bad dependency range",
      skill("a.b.j", "1.0.0", {
        dependencies: [{ kind: "extension", id: "x", range: "banana" }],
      }),
    ],
  ];
  for (const [name, m] of bad)
    assert.equal(validateManifest(m).manifest, undefined, name);
  assert.throws(
    () => rig().platform.register(bad[0]![1], "owner"),
    (e: unknown) => e instanceof ExtensionError && e.code === "invalid_request",
  );
});

test("agent, tool and workflow specs are validated", () => {
  const r = rig();
  const agent = (over: object = {}): ExtensionManifest => ({
    ...skill("agent.test"),
    type: "AGENT",
    spec: {
      agentId: "test-agent",
      role: "Tester",
      capabilities: ["x"],
      modelRequirements: { capabilities: ["text"] },
      tools: [],
      inputContract: "in",
      outputContract: "out",
      validation: [],
      costProfile: { tier: "low" },
      ...over,
    },
  });
  r.platform.register(agent(), "owner");
  assert.equal(validateManifest(agent({ role: "" })).manifest, undefined);
  assert.equal(
    validateManifest(agent({ costProfile: { tier: "huge" } })).manifest,
    undefined,
  );
  const tool = (over: object = {}): ExtensionManifest => ({
    ...skill("tool.test"),
    type: "TOOL",
    spec: {
      toolId: "test-tool",
      purpose: "p",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      risk: "LOW",
      authentication: "none",
      environment: "gateway",
      audit: { logInputs: true, logOutputs: false },
      backingCapability: "repository.read",
      ...over,
    },
  });
  assert.ok(validateManifest(tool()).manifest);
  assert.equal(validateManifest(tool({ risk: "EXTREME" })).manifest, undefined);
  assert.equal(
    validateManifest(tool({ backingCapability: undefined })).manifest,
    undefined,
    "a gateway tool must name its backing capability",
  );
  const wf = (stages: unknown): ExtensionManifest => ({
    ...skill("wf.test"),
    type: "WORKFLOW",
    spec: { stages },
  });
  assert.ok(
    validateManifest(
      wf([
        { id: "a", title: "A", taskType: "ANALYSIS" },
        { id: "b", title: "B", taskType: "DEVELOPMENT", dependsOn: ["a"] },
      ]),
    ).manifest,
  );
  assert.equal(
    validateManifest(
      wf([
        { id: "a", title: "A", taskType: "ANALYSIS", dependsOn: ["b"] },
        { id: "b", title: "B", taskType: "X" },
      ]),
    ).manifest,
    undefined,
    "forward dependency / cycle",
  );
  assert.equal(validateManifest(wf([])).manifest, undefined);
});

test("registry-only extension types are accepted but declared as having no runtime effect", () => {
  const r = rig();
  const m = {
    ...skill("ui.ext"),
    type: "UI_EXTENSION",
    spec: { anything: "declarative" },
  } as ExtensionManifest;
  const v = r.platform.register(m, "owner");
  assert.equal(v.supportLevel, "REGISTRY_ONLY");
  assert.match(v.effect, /Recorded only/);
});

/* --------------------------- enabling & the dev flow --------------------------- */

test("an extension cannot be enabled before it is tested and reviewed", () => {
  const r = rig();
  r.platform.register(skill("flow.skill"), "owner");
  assert.throws(
    () => r.platform.enable("flow.skill", "owner"),
    /validation test/,
  );
  r.platform.test("flow.skill", "owner");
  assert.throws(
    () => r.platform.enable("flow.skill", "owner"),
    /security review/,
  );
  r.platform.review("flow.skill", "owner");
  const v = r.platform.enable("flow.skill", "owner");
  assert.equal(v.health, "ACTIVE");
  assert.equal(v.activeVersion, "1.0.0");
  assert.ok(
    r.platform.audit("flow.skill").some((e) => e.action === "enable_refused"),
    "refusals are audited",
  );
});

test("the developer lifecycle is reported step by step", () => {
  const r = rig();
  r.platform.register(skill("life.skill"), "owner");
  let steps = r.platform.get("life.skill").lifecycle;
  assert.deepEqual(
    steps.map((s) => s.step),
    [
      "CREATE",
      "DEFINE_CAPABILITY",
      "DEFINE_TOOLS",
      "DEFINE_PERMISSIONS",
      "TEST",
      "SECURITY_REVIEW",
      "REGISTER",
      "ENABLE",
      "MONITOR",
    ],
  );
  assert.equal(steps.find((s) => s.step === "TEST")!.status, "PENDING");
  r.platform.test("life.skill", "owner");
  r.platform.review("life.skill", "owner");
  r.platform.enable("life.skill", "owner");
  steps = r.platform.get("life.skill").lifecycle;
  for (const s of ["TEST", "SECURITY_REVIEW", "ENABLE", "MONITOR"])
    assert.equal(steps.find((x) => x.step === s)!.status, "DONE", s);
});

test("a high-risk permission needs the owner's approval of the security review", () => {
  const r = rig();
  r.platform.register(
    skill("risky.skill", "1.0.0", { permissions: ["github.write"] }),
    "owner",
  );
  r.platform.test("risky.skill", "owner");
  const v = r.platform.review("risky.skill", "owner");
  assert.equal(v.versions[0]!.review, "NEEDS_APPROVAL");
  assert.throws(
    () => r.platform.enable("risky.skill", "owner"),
    /needs the owner's approval/,
  );
  r.platform.approveReview("risky.skill", "admin-1");
  assert.equal(r.platform.enable("risky.skill", "admin-1").health, "ACTIVE");
});

/* ------------------------------- permissions ------------------------------- */

test("least privilege: nothing is granted automatically and the check denies by default", () => {
  const r = rig();
  ready(
    r,
    skill("perm.skill", "1.0.0", {
      permissions: ["github.read", "workspace.read"],
    }),
  );
  r.platform.enable("perm.skill", "owner");
  const v = r.platform.get("perm.skill");
  assert.deepEqual(v.grantedPermissions, []);
  assert.deepEqual(v.missingGrants.sort(), ["github.read", "workspace.read"]);
  for (const scope of [
    "github.read",
    "workspace.read",
    "firebase.deploy",
    "secrets.read",
    "email.send",
  ])
    assert.equal(
      r.platform.authorize("perm.skill", scope).allowed,
      false,
      scope,
    );
  r.platform.grant("perm.skill", "github.read", "admin-1");
  assert.equal(r.platform.authorize("perm.skill", "github.read").allowed, true);
  assert.equal(
    r.platform.authorize("perm.skill", "workspace.read").allowed,
    false,
    "only the granted scope",
  );
  assert.equal(
    r.platform.authorize("perm.skill", "firebase.deploy").allowed,
    false,
    "a scope that was never requested",
  );
  assert.equal(
    r.platform.authorize("no.such.extension", "github.read").allowed,
    false,
  );
});

test("a permission that was not requested, or is never grantable, cannot be granted", () => {
  const r = rig();
  ready(r, skill("perm2.skill", "1.0.0", { permissions: ["github.read"] }));
  assert.throws(
    () => r.platform.grant("perm2.skill", "firebase.deploy", "admin-1"),
    /did not request/,
  );
  assert.throws(
    () => r.platform.grant("perm2.skill", "secrets.read", "admin-1"),
    (e: unknown) => e instanceof ExtensionError && e.code === "forbidden",
  );
  assert.throws(
    () => r.platform.grant("perm2.skill", "nope", "admin-1"),
    /unknown permission/,
  );
});

test("disabling or revoking removes access immediately", () => {
  const r = rig();
  ready(r, skill("perm3.skill", "1.0.0", { permissions: ["github.read"] }));
  r.platform.enable("perm3.skill", "owner");
  r.platform.grant("perm3.skill", "github.read", "admin-1");
  assert.equal(
    r.platform.authorize("perm3.skill", "github.read").allowed,
    true,
  );
  r.platform.revoke("perm3.skill", "github.read", "admin-1");
  assert.equal(
    r.platform.authorize("perm3.skill", "github.read").allowed,
    false,
  );
  r.platform.grant("perm3.skill", "github.read", "admin-1");
  r.platform.disable("perm3.skill", "owner");
  assert.equal(
    r.platform.authorize("perm3.skill", "github.read").allowed,
    false,
  );
});

test("a new version that asks for more permissions is not covered by the old grants", () => {
  const r = rig();
  ready(r, skill("perm4.skill", "1.0.0", { permissions: ["github.read"] }));
  r.platform.enable("perm4.skill", "owner");
  r.platform.grant("perm4.skill", "github.read", "admin-1");
  r.platform.registerVersion(
    skill("perm4.skill", "1.1.0", {
      permissions: ["github.read", "workspace.read"],
    }),
    "owner",
  );
  r.platform.test("perm4.skill", "owner");
  r.platform.review("perm4.skill", "owner");
  assert.throws(
    () => r.platform.enable("perm4.skill", "owner", { version: "1.1.0" }),
    /breaking changes/,
  );
  r.platform.enable("perm4.skill", "owner", {
    version: "1.1.0",
    acknowledgeBreaking: true,
  });
  assert.equal(
    r.platform.authorize("perm4.skill", "github.read").allowed,
    true,
  );
  assert.equal(
    r.platform.authorize("perm4.skill", "workspace.read").allowed,
    false,
    "the new scope must be granted explicitly",
  );
});

/* ------------------------------- dependencies ------------------------------- */

test("dependencies are validated before activation", () => {
  const r = rig();
  ready(
    r,
    skill("dep.consumer", "1.0.0", {
      dependencies: [{ kind: "extension", id: "dep.base", range: "^1.0.0" }],
    }),
  );
  assert.throws(
    () => r.platform.enable("dep.consumer", "owner"),
    /dependencies are not satisfied.*not registered/,
  );
  ready(r, skill("dep.base", "1.2.0"));
  assert.throws(
    () => r.platform.enable("dep.consumer", "owner"),
    /not enabled/,
  );
  r.platform.enable("dep.base", "owner");
  assert.equal(r.platform.enable("dep.consumer", "owner").health, "ACTIVE");
  assert.deepEqual(
    r.platform.dependentsOf("dep.base").map((d) => d.extensionId),
    ["dep.consumer"],
  );
  assert.throws(() => r.platform.disable("dep.base", "owner"), /depend on it/);
});

test("an out-of-range dependency version fails", () => {
  const r = rig();
  ready(r, skill("dep2.base", "2.0.0"));
  r.platform.enable("dep2.base", "owner");
  ready(
    r,
    skill("dep2.consumer", "1.0.0", {
      dependencies: [{ kind: "extension", id: "dep2.base", range: "^1.0.0" }],
    }),
  );
  assert.throws(
    () => r.platform.enable("dep2.consumer", "owner"),
    /does not satisfy/,
  );
});

test("connector/tool dependencies use the Integration Hub resolver; unknown kinds fail closed", () => {
  const r = rig({
    check: (kind, id) =>
      kind === "connector" && id === "github"
        ? { ok: true, reason: "enabled" }
        : { ok: false, reason: `${kind} ${id} unavailable` },
  });
  ready(
    r,
    skill("dep3.ok", "1.0.0", {
      dependencies: [{ kind: "connector", id: "github" }],
    }),
  );
  assert.equal(r.platform.enable("dep3.ok", "owner").health, "ACTIVE");
  ready(
    r,
    skill("dep3.bad", "1.0.0", {
      dependencies: [{ kind: "library", id: "left-pad" }],
    }),
  );
  assert.throws(() => r.platform.enable("dep3.bad", "owner"), /unavailable/);
  const noResolver = rig();
  ready(
    noResolver,
    skill("dep3.none", "1.0.0", { dependencies: [{ kind: "model", id: "x" }] }),
  );
  assert.throws(
    () => noResolver.platform.enable("dep3.none", "owner"),
    /no resolver/,
  );
});

test("platform compatibility is enforced", () => {
  const r = rig();
  r.platform.register(
    skill("compat.skill", "1.0.0", { compatibility: { platform: ">=9.0.0" } }),
    "owner",
  );
  const t = r.platform.test("compat.skill", "owner");
  assert.equal(t.versions[0]!.tested, false);
  r.platform.review("compat.skill", "owner");
  assert.throws(() => r.platform.enable("compat.skill", "owner"));
});

/* ------------------------------- versioning ------------------------------- */

test("versions: must increase, type cannot change, update-available is reported, rollback works", () => {
  const r = rig();
  ready(r, skill("ver.skill", "1.0.0"));
  r.platform.enable("ver.skill", "owner");
  assert.throws(
    () => r.platform.registerVersion(skill("ver.skill", "1.0.0"), "owner"),
    (e: unknown) => e instanceof ExtensionError && e.code === "conflict",
  );
  assert.throws(
    () => r.platform.registerVersion(skill("ver.skill", "0.9.0"), "owner"),
    /greater/,
  );
  assert.throws(() =>
    r.platform.registerVersion(
      { ...skill("ver.skill", "1.1.0"), type: "AGENT" } as never,
      "owner",
    ),
  );
  r.platform.registerVersion(skill("ver.skill", "1.1.0"), "owner");
  assert.equal(r.platform.get("ver.skill").health, "UPDATE_AVAILABLE");
  assert.equal(
    r.platform.get("ver.skill").activeVersion,
    "1.0.0",
    "registering never switches the active version",
  );
  r.platform.test("ver.skill", "owner", "1.1.0");
  r.platform.review("ver.skill", "owner", "1.1.0");
  r.platform.enable("ver.skill", "owner", { version: "1.1.0" });
  assert.equal(r.platform.get("ver.skill").activeVersion, "1.1.0");
  assert.equal(
    r.platform.rollback("ver.skill", "1.0.0", "owner").activeVersion,
    "1.0.0",
  );
  assert.throws(
    () => r.platform.rollback("ver.skill", "1.5.0", "owner"),
    /older/,
  );
});

test("a major version or removed capability is a breaking change that must be acknowledged", () => {
  const r = rig();
  ready(r, skill("brk.skill", "1.0.0", { capabilities: ["a", "b"] }));
  r.platform.enable("brk.skill", "owner");
  r.platform.registerVersion(
    skill("brk.skill", "2.0.0", { capabilities: ["a"] }),
    "owner",
  );
  r.platform.test("brk.skill", "owner", "2.0.0");
  r.platform.review("brk.skill", "owner", "2.0.0");
  assert.throws(
    () => r.platform.enable("brk.skill", "owner", { version: "2.0.0" }),
    /major version change.*removes capabilities: b/,
  );
  assert.equal(
    r.platform.enable("brk.skill", "owner", {
      version: "2.0.0",
      acknowledgeBreaking: true,
    }).activeVersion,
    "2.0.0",
  );
});

test("a new version that would break an enabled dependent is refused outright", () => {
  const r = rig();
  ready(r, skill("brk2.base", "1.0.0"));
  r.platform.enable("brk2.base", "owner");
  ready(
    r,
    skill("brk2.consumer", "1.0.0", {
      dependencies: [{ kind: "extension", id: "brk2.base", range: "^1.0.0" }],
    }),
  );
  r.platform.enable("brk2.consumer", "owner");
  r.platform.registerVersion(skill("brk2.base", "2.0.0"), "owner");
  r.platform.test("brk2.base", "owner", "2.0.0");
  r.platform.review("brk2.base", "owner", "2.0.0");
  assert.throws(
    () =>
      r.platform.enable("brk2.base", "owner", {
        version: "2.0.0",
        acknowledgeBreaking: true,
      }),
    /would break dependents: brk2.consumer/,
  );
  assert.equal(r.platform.get("brk2.base").activeVersion, "1.0.0");
});

/* ------------------------------ type effects ------------------------------ */

test("enabled skills reach the prompt briefing; disabled ones do not", () => {
  const r = rig();
  ready(r, skill("brief.skill"));
  assert.equal(r.platform.skillsFor({ text: "fix the widget" }).length, 0);
  r.platform.enable("brief.skill", "owner");
  assert.equal(r.platform.skillsFor({ text: "fix the widget" }).length, 1);
  assert.equal(
    r.platform.skillsFor({ text: "unrelated request" }).length,
    0,
    "keyword scoped",
  );
  const fragments = r.system.skillContext.fetch({
    projectId: "alpha",
    intent: {
      objective: "fix the widget",
      target: undefined,
      scope: undefined,
    },
  } as never);
  assert.equal(fragments.length, 1);
  assert.match(fragments[0]!.value, /Do the thing carefully/);
  assert.equal(fragments[0]!.mandatory, false);
  assert.notEqual(
    fragments[0]!.authority,
    "authoritative",
    "a skill is advice, never policy",
  );
  r.platform.disable("brief.skill", "owner");
  assert.equal(
    r.system.skillContext.fetch({
      projectId: "alpha",
      intent: { objective: "fix the widget" },
    } as never).length,
    0,
  );
});

test("a TOOL extension registers in the governance catalogue with no agent allowed and approval always", () => {
  const r = rig();
  const tool: ExtensionManifest = {
    ...skill("tool.ext"),
    type: "TOOL",
    spec: {
      toolId: "my-tool",
      purpose: "p",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      risk: "MEDIUM",
      authentication: "none",
      environment: "gateway",
      audit: { logInputs: true, logOutputs: true },
      backingCapability: "repository.read",
    },
  };
  ready(r, tool);
  r.platform.enable("tool.ext", "owner");
  const rec = r.security.trust.toolRecord("ext.my-tool");
  assert.ok(rec, "tool is in the trust catalogue");
  assert.deepEqual(rec!.allowedAgents, []);
  assert.equal(rec!.approval, "ALWAYS");
  assert.equal(rec!.status, "ENABLED");
  r.platform.disable("tool.ext", "owner");
  assert.equal(r.security.trust.toolRecord("ext.my-tool")!.status, "DISABLED");
});

test("workflow templates and agent descriptors are available only while enabled", () => {
  const r = rig();
  assert.equal(r.platform.enabledWorkflowTemplates().length, 0);
  r.platform.test("workflow.standard-development", "owner");
  r.platform.review("workflow.standard-development", "owner");
  r.platform.enable("workflow.standard-development", "owner");
  const t = r.platform.enabledWorkflowTemplates();
  assert.equal(t.length, 1);
  assert.ok(t[0]!.stages.some((s) => s.requiresApproval));
  assert.equal(r.platform.enabledAgents().length, 0);
});

/* --------------------------- config, audit, removal --------------------------- */

test("configuration follows the schema and never accepts a secret", () => {
  const r = rig();
  ready(
    r,
    skill("cfg.skill", "1.0.0", {
      configSchema: { depth: { type: "number" }, label: { type: "string" } },
    }),
  );
  r.platform.configure("cfg.skill", { depth: 3, label: "x" }, "owner");
  assert.equal(r.platform.get("cfg.skill").config["depth"], 3);
  assert.throws(
    () => r.platform.configure("cfg.skill", { depth: "three" }, "owner"),
    /must be a number/,
  );
  assert.throws(
    () => r.platform.configure("cfg.skill", { unknown: 1 }, "owner"),
    /not a configuration option/,
  );
  assert.throws(
    () =>
      r.platform.configure(
        "cfg.skill",
        { label: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
        "owner",
      ),
    /secret/,
  );
});

test("every lifecycle change is audited, in the extension log and in the governance ledger", () => {
  const r = rig();
  ready(
    r,
    skill("aud.skill", "1.0.0", {
      permissions: ["github.read"],
      configSchema: { x: { type: "number" } },
    }),
  );
  r.platform.enable("aud.skill", "owner");
  r.platform.grant("aud.skill", "github.read", "admin-1");
  r.platform.configure("aud.skill", { x: 1 }, "owner");
  r.platform.registerVersion(
    skill("aud.skill", "1.0.1", { permissions: ["github.read"] }),
    "owner",
  );
  r.platform.disable("aud.skill", "owner");
  r.platform.remove("aud.skill", "owner");
  const actions = r.platform.audit("aud.skill").map((e) => e.action);
  for (const a of [
    "registered",
    "tested",
    "reviewed",
    "enabled",
    "permission_granted",
    "configured",
    "version_registered",
    "disabled",
    "removed",
  ])
    assert.ok(actions.includes(a as never), a);
  const ledger = r.security.ledger
    .query({ limit: 1000 })
    .map((e) => e.operation);
  for (const a of [
    "extension.registered",
    "extension.enabled",
    "extension.permission_granted",
    "extension.removed",
  ])
    assert.ok(ledger.includes(a), a);
  assert.equal(r.security.ledger.verify().ok, true);
  assert.equal(
    r.platform.list().some((x) => x.extensionId === "aud.skill"),
    false,
    "removed extensions leave the list but their history stays",
  );
  assert.ok(r.platform.audit("aud.skill").length > 0);
});

test("built-in extensions can be disabled but not removed; enabled ones cannot be removed", () => {
  const r = rig();
  assert.throws(
    () => r.platform.remove("skill.react-development", "owner"),
    /built-in/,
  );
  ready(r, skill("rm.skill"));
  r.platform.enable("rm.skill", "owner");
  assert.throws(
    () => r.platform.remove("rm.skill", "owner"),
    /disable the extension/,
  );
});

/* ---------------------------------- control ---------------------------------- */

test("control: reads need view; registering, enabling and granting are administrator-only", async () => {
  const r = rig();
  assert.ok(r.control.overview(VIEWER).summary.total > 0);
  const manifest = skill("ctl.skill");
  assert.equal(
    (await r.control.execute("extension_register", VIEWER, { manifest }))
      .outcome,
    "denied",
  );
  assert.equal(
    (await r.control.execute("extension_register", OPERATOR, { manifest }))
      .outcome,
    "denied",
  );
  assert.equal(
    (await r.control.execute("extension_register", ADMIN, { manifest }))
      .outcome,
    "executed",
  );
  assert.equal(
    (
      await r.control.execute("extension_test", OPERATOR, {
        extensionId: "ctl.skill",
      })
    ).outcome,
    "executed",
  );
  assert.equal(
    (
      await r.control.execute("extension_review", OPERATOR, {
        extensionId: "ctl.skill",
      })
    ).outcome,
    "executed",
  );
  assert.equal(
    (
      await r.control.execute("extension_enable", OPERATOR, {
        extensionId: "ctl.skill",
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (
      await r.control.execute("extension_enable", ADMIN, {
        extensionId: "ctl.skill",
      })
    ).outcome,
    "executed",
  );
  assert.equal(
    (
      await r.control.execute("extension_grant_permission", OPERATOR, {
        extensionId: "ctl.skill",
        scope: "github.read",
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (
      await r.control.execute("extension_disable", OPERATOR, {
        extensionId: "ctl.skill",
      })
    ).outcome,
    "executed",
    "turning something off is allowed to an operator",
  );
  assert.equal(
    (await r.control.execute("extension_make_me_root", ADMIN, {})).outcome,
    "rejected",
  );
});

test("control: refusals come back as rejected, with a reason and an audit record", async () => {
  const r = rig();
  const bad = await r.control.execute("extension_register", ADMIN, {
    manifest: { ...skill("ctl.bad"), spec: { script: "evil()" } },
  });
  assert.equal(bad.outcome, "rejected");
  assert.match(bad.reason, /invalid manifest/);
  const missing = await r.control.execute("extension_enable", ADMIN, {
    extensionId: "ghost",
  });
  assert.equal(missing.outcome, "rejected");
  assert.equal(missing.errorKind, "not_found");
  assert.ok(missing.auditEventId);
});

test("no extension module contains an HTTP client or reads the environment", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const dir = path.resolve(
    import.meta.dirname,
    "..",
    "core",
    "extension-platform",
  );
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const text = readFileSync(path.join(dir, f), "utf8");
    assert.ok(
      !/await fetch|globalThis[.]fetch|node:https?|process[.]env|child_process|[^a-z]eval[(]|new Function/.test(
        text,
      ),
      `${f} must stay declarative`,
    );
  }
});
