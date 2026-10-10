/**
 * EO-3.1 — Execution Planning Foundation.
 *
 * Planning converts a structured project request into a validated, auditable
 * ExecutionPlan. These tests verify requirements, environment matching,
 * agent qualification, dependency/build/test/security/deployment planning,
 * blockers, versioning/replan, determinism and secret safety — WITHOUT
 * executing anything.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  EnvironmentRouter,
  ExecutionPlanRepository,
  StateTransitionError,
  ValidationError,
  NotFoundError,
  normalizeProjectRequest,
  planDependencies,
  validateExecutionPlan,
  type ExecutionPlan,
} from "../core/index.js";
import {
  IOS_AGENT,
  MAC_HOST,
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  XCODE_INSTANCE,
  agent,
  host,
  instance,
  iosRequest,
  planningFixture,
  toolchain,
  ver,
  webRequest,
} from "./fixtures/planning.js";

const ACTOR = { id: "operator-1" };

function blockerCodes(plan: ExecutionPlan): string[] {
  return plan.blockers.map((b) => b.code);
}

/* ------------------------------------------------------------------ */
/* React web                                                          */
/* ------------------------------------------------------------------ */

test("react web: requirements, environment, agent, dependency/build/test plan — ready, nothing executed", async () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT],
  });
  const plan = await f.planning.createPlan(webRequest(), ACTOR);

  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.id, "plan_1@v1");
  assert.equal(plan.version, 1);

  // Technology requirements (REQUIRED, not availability).
  const tech = plan.analysis.technologies[0]!;
  assert.equal(tech.technologyId, "react_typescript");
  assert.deepEqual(tech.toolchains[0], {
    kind: "node",
    minimum: ver("20"),
    components: [{ name: "npm" }],
  });
  assert.deepEqual(tech.capabilities, ["web_build_capable"]);

  // Environment requirement satisfied by a REAL instance, with evidence.
  assert.equal(plan.environments.length, 1);
  const env = plan.environments[0]!;
  assert.equal(env.status, "satisfied");
  assert.equal(env.descriptorSupport, "supported");
  assert.equal(env.match.selectedInstanceId, "web-1");
  assert.deepEqual(env.match.candidates[0]!.matchedCapabilities, [
    "web_build_capable",
  ]);

  // Agent qualification by stable id.
  const assignment = plan.agents.find(
    (a) => a.requirementId === "agent:build:web",
  );
  assert.equal(assignment?.agentId, "web-agent");
  assert.equal(assignment?.qualification, "qualified");
  assert.deepEqual(assignment?.matchedCapabilities, ["web_development"]);

  // Model requirement is capability based and resolved via declared profiles.
  assert.equal(plan.models[0]!.status, "satisfied");
  assert.deepEqual(plan.models[0]!.eligibleProfileIds, ["openai-general"]);

  // Dependency plan: DAG with deterministic order.
  assert.deepEqual(plan.dependencies.order, [
    "toolchain:node",
    "toolchain:node:npm",
  ]);
  assert.deepEqual(plan.dependencies.conflicts, []);

  // Build + test plans are PLANS.
  assert.equal(plan.build.length, 1);
  assert.equal(plan.build[0]!.status, "planned");
  assert.equal(plan.build[0]!.environmentRequirementId, env.id);
  assert.equal(plan.build[0]!.expectedArtifact.kind, "static_web_bundle");
  assert.deepEqual(
    plan.tests.map((t) => t.type),
    ["unit", "ui", "e2e", "build_verification"],
  );
  assert.ok(plan.tests.every((t) => t.status === "planned"));
  assert.deepEqual(
    plan.security.map((s) => s.check),
    ["secret_scan", "dependency_scan", "sast"],
  );
  assert.deepEqual(plan.approvalRequirements, []);
  assert.deepEqual(plan.cost, { status: "not_estimated" });

  // No PASS/FAIL anywhere in the plan.
  const json = JSON.stringify(plan);
  assert.doesNotMatch(json, /"(passed|failed|succeeded|PASS|FAIL)"/);

  // Persisted + audited.
  assert.equal(f.planning.get(plan.id)?.id, plan.id);
  const actions = f.audit
    .query({ type: "execution_plan_event" })
    .map((e) => e.data.action);
  assert.deepEqual(actions, ["created", "ready"]);
});

/* ------------------------------------------------------------------ */
/* iOS                                                                */
/* ------------------------------------------------------------------ */

test("ios ready: a macOS host with Xcode + iOS SDK satisfies the requirement", async () => {
  const f = planningFixture({
    hosts: [MAC_HOST],
    instances: [XCODE_INSTANCE],
    agents: [IOS_AGENT],
  });
  const plan = await f.planning.createPlan(iosRequest(), ACTOR);
  assert.equal(plan.status, "ready");
  const env = plan.environments[0]!;
  assert.deepEqual(env.requirement.os, { os: "macos" });
  assert.equal(env.status, "satisfied");
  assert.equal(env.match.selectedInstanceId, "xcode-1");
});

test("ios blocked: no eligible Xcode instance is a valid BLOCKED plan, not an error", async () => {
  const f = planningFixture({ agents: [IOS_AGENT] });
  const plan = await f.planning.createPlan(iosRequest(), ACTOR);
  assert.equal(plan.status, "blocked");
  assert.deepEqual(blockerCodes(plan), ["MISSING_ENVIRONMENT"]);
  const blocker = plan.blockers[0]!;
  assert.equal(blocker.subjectType, "environment");
  assert.ok(blocker.missing.includes("swift_xcode:ios_sdk"));
  // The descriptor exists (type support) — it is NOT an available environment.
  assert.equal(plan.environments[0]!.descriptorSupport, "supported");
  assert.equal(plan.environments[0]!.match.outcome, "REQUIRES_PROVISIONING");
  assert.equal(plan.environments[0]!.match.selectedInstanceId, undefined);
  assert.doesNotThrow(() => validateExecutionPlan(plan));
  assert.equal(f.planning.get(plan.id)?.status, "blocked");
});

test("ios blocked: an Xcode instance on an unavailable host is never selected", async () => {
  const f = planningFixture({
    hosts: [host("mac-1", "macos", { availability: "unavailable" })],
    instances: [XCODE_INSTANCE],
    agents: [IOS_AGENT],
  });
  const plan = await f.planning.createPlan(iosRequest(), ACTOR);
  assert.deepEqual(blockerCodes(plan), ["MISSING_ENVIRONMENT"]);
  assert.deepEqual(plan.environments[0]!.match.candidates[0]!.reasonCodes, [
    "host_unavailable",
  ]);
});

/* ------------------------------------------------------------------ */
/* Android                                                            */
/* ------------------------------------------------------------------ */

function androidRequest(): Record<string, unknown> {
  return {
    projectId: "alpha",
    title: "Android app",
    components: [
      {
        id: "android-app",
        kind: "mobile_app",
        platforms: ["android"],
        technologies: ["android_kotlin"],
      },
    ],
  };
}

test("android incomplete: Android Studio without the Android SDK toolchain is BLOCKED", async () => {
  const f = planningFixture({
    hosts: [host("linux-a", "linux")],
    instances: [
      instance("studio-1", "android-studio", "linux-a", {
        capabilities: ["mobile_build_capable"],
        toolchains: [toolchain("jdk_gradle", "17.0.2")],
      }),
    ],
    agents: [agent("android-agent", ["android_development"])],
  });
  const plan = await f.planning.createPlan(androidRequest(), ACTOR);
  assert.equal(plan.status, "blocked");
  assert.deepEqual(blockerCodes(plan), ["MISSING_TOOLCHAIN"]);
  assert.ok(plan.blockers[0]!.missing.includes("android_sdk"));
});

test("android incomplete: an SDK without build tools is still BLOCKED", async () => {
  const f = planningFixture({
    hosts: [host("linux-a", "linux")],
    instances: [
      instance("studio-1", "android-studio", "linux-a", {
        capabilities: ["mobile_build_capable"],
        toolchains: [
          toolchain("jdk_gradle", "17.0.2"),
          toolchain("android_sdk", "34.0.0"),
        ],
      }),
    ],
    agents: [agent("android-agent", ["android_development"])],
  });
  const plan = await f.planning.createPlan(androidRequest(), ACTOR);
  assert.deepEqual(blockerCodes(plan), ["MISSING_TOOLCHAIN"]);
  assert.deepEqual(plan.blockers[0]!.missing, ["android_sdk:build_tools"]);
  // android_sdk depends on jdk_gradle → resolution order respects the edge.
  const order = plan.dependencies.order;
  assert.ok(
    order.indexOf("toolchain:jdk_gradle") <
      order.indexOf("toolchain:android_sdk"),
  );
});

/* ------------------------------------------------------------------ */
/* Windows .NET, Docker, Unity, Unreal                                */
/* ------------------------------------------------------------------ */

function wpfRequest(): Record<string, unknown> {
  return {
    projectId: "alpha",
    title: "Back-office desktop",
    components: [
      {
        id: "desktop",
        kind: "desktop_app",
        platforms: ["windows"],
        technologies: ["dotnet_wpf"],
      },
    ],
  };
}

const DOTNET = toolchain("dotnet", "8.0.4");

test("windows .NET: only a Windows host with .NET matches; a Linux .NET host is rejected", async () => {
  const f = planningFixture({
    hosts: [host("linux-d", "linux"), host("win-d", "windows")],
    instances: [
      instance("desk-linux", "desktop-build", "linux-d", {
        capabilities: ["desktop_build_capable"],
        toolchains: [DOTNET],
      }),
      instance("desk-win", "desktop-build", "win-d", {
        capabilities: ["desktop_build_capable"],
        toolchains: [DOTNET],
      }),
    ],
    agents: [
      agent("dotnet-agent", ["dotnet_development", "desktop_development"]),
    ],
  });
  const plan = await f.planning.createPlan(wpfRequest(), ACTOR);
  assert.equal(plan.status, "ready");
  const match = plan.environments[0]!.match;
  assert.equal(match.selectedInstanceId, "desk-win");
  const linux = match.candidates.find((c) => c.instanceId === "desk-linux");
  assert.deepEqual(linux?.reasonCodes, ["os_mismatch"]);

  const linuxOnly = await planningFixture({
    hosts: [host("linux-d", "linux")],
    instances: [
      instance("desk-linux", "desktop-build", "linux-d", {
        capabilities: ["desktop_build_capable"],
        toolchains: [DOTNET],
      }),
    ],
    agents: [
      agent("dotnet-agent", ["dotnet_development", "desktop_development"]),
    ],
  }).planning.createPlan(wpfRequest(), ACTOR);
  assert.deepEqual(blockerCodes(linuxOnly), ["MISSING_ENVIRONMENT"]);
});

test("docker: Docker installed is not the same as a usable container runtime", async () => {
  const request = {
    projectId: "alpha",
    title: "Container service",
    components: [
      {
        id: "svc",
        kind: "backend_service",
        platforms: ["linux"],
        technologies: ["container_image"],
      },
    ],
  };
  const ops = agent("ops-agent", ["container_operations"]);
  const installedOnly = await planningFixture({
    hosts: [host("linux-c", "linux")],
    instances: [
      instance("docker-1", "docker", "linux-c", {
        capabilities: [["container_runtime_available", false]],
      }),
    ],
    agents: [ops],
  }).planning.createPlan(request, ACTOR);
  assert.deepEqual(blockerCodes(installedOnly), ["MISSING_CAPABILITY"]);
  assert.deepEqual(installedOnly.blockers[0]!.missing, [
    "container_runtime_available",
  ]);

  const running = await planningFixture({
    hosts: [host("linux-c", "linux")],
    instances: [
      instance("docker-1", "docker", "linux-c", {
        capabilities: ["container_runtime_available"],
      }),
    ],
    agents: [ops],
  }).planning.createPlan(request, ACTOR);
  assert.equal(running.status, "ready");
});

function unityRequest(): Record<string, unknown> {
  return {
    projectId: "alpha",
    title: "Mobile game",
    components: [
      {
        id: "game",
        kind: "game",
        platforms: ["android", "windows"],
        technologies: ["unity"],
      },
    ],
  };
}

test("unity: editor, version and per-target build modules are represented and enforced", async () => {
  const game = agent("game-agent", ["game_development"]);
  const plan = await planningFixture({ agents: [game] }).planning.createPlan(
    unityRequest(),
    ACTOR,
  );
  assert.deepEqual(plan.analysis.technologies[0]!.toolchains, [
    {
      kind: "unity",
      minimum: ver("2022.3"),
      components: [{ name: "module:android" }, { name: "module:windows" }],
    },
  ]);

  const missingModule = await planningFixture({
    hosts: [host("win-u", "windows")],
    instances: [
      instance("unity-1", "unity", "win-u", {
        capabilities: ["game_build_capable"],
        toolchains: [
          toolchain("unity", "2022.3.10", { "module:windows": "2022.3.10" }),
        ],
      }),
    ],
    agents: [game],
  }).planning.createPlan(unityRequest(), ACTOR);
  assert.deepEqual(blockerCodes(missingModule), ["MISSING_TOOLCHAIN"]);
  assert.deepEqual(missingModule.blockers[0]!.missing, [
    "unity:module:android",
  ]);

  const tooOld = await planningFixture({
    hosts: [host("win-u", "windows")],
    instances: [
      instance("unity-1", "unity", "win-u", {
        capabilities: ["game_build_capable"],
        toolchains: [
          toolchain("unity", "2021.3.0", {
            "module:windows": "2021.3.0",
            "module:android": "2021.3.0",
          }),
        ],
      }),
    ],
    agents: [game],
  }).planning.createPlan(unityRequest(), ACTOR);
  assert.deepEqual(tooOld.blockers[0]!.reasonCodes, [
    "toolchain_version_too_low",
  ]);

  const complete = await planningFixture({
    hosts: [host("win-u", "windows")],
    instances: [
      instance("unity-1", "unity", "win-u", {
        capabilities: ["game_build_capable"],
        toolchains: [
          toolchain("unity", "2022.3.10", {
            "module:windows": "2022.3.10",
            "module:android": "2022.3.10",
          }),
        ],
      }),
    ],
    agents: [game],
  }).planning.createPlan(unityRequest(), ACTOR);
  assert.equal(complete.status, "ready");
});

test("unreal: engine, C++ toolchain and target-platform prerequisites are represented", async () => {
  const plan = await planningFixture().planning.createPlan(
    {
      projectId: "alpha",
      title: "Unreal title",
      components: [
        {
          id: "game",
          kind: "game",
          platforms: ["windows"],
          technologies: ["unreal"],
        },
      ],
    },
    ACTOR,
  );
  assert.deepEqual(plan.analysis.technologies[0]!.toolchains, [
    {
      kind: "unreal",
      minimum: ver("5.3"),
      components: [{ name: "platform:windows" }],
    },
    { kind: "cpp_compiler" },
  ]);
  const order = plan.dependencies.order;
  assert.ok(
    order.indexOf("toolchain:cpp_compiler") < order.indexOf("toolchain:unreal"),
  );
  assert.ok(
    order.indexOf("toolchain:unreal") <
      order.indexOf("toolchain:unreal:platform:windows"),
  );
});

/* ------------------------------------------------------------------ */
/* Multi-environment                                                  */
/* ------------------------------------------------------------------ */

test("multi-environment: React + .NET + Android produces three environment requirements", async () => {
  const plan = await planningFixture().planning.createPlan(
    {
      projectId: "alpha",
      title: "Banking platform",
      components: [
        {
          id: "frontend",
          kind: "web_frontend",
          platforms: ["web"],
          technologies: ["react_typescript"],
        },
        {
          id: "backend",
          kind: "backend_service",
          platforms: ["linux"],
          technologies: ["dotnet_aspnet"],
        },
        {
          id: "mobile",
          kind: "mobile_app",
          platforms: ["android"],
          technologies: ["android_kotlin"],
        },
        {
          id: "admin",
          kind: "web_frontend",
          platforms: ["web"],
          technologies: ["react_typescript"],
        },
      ],
    },
    ACTOR,
  );
  assert.equal(plan.architecture.style, "multi_platform");
  assert.equal(plan.environments.length, 3);
  assert.deepEqual(
    plan.environments.map((e) => e.componentIds),
    [["frontend", "admin"], ["backend"], ["mobile"]],
  );
  assert.deepEqual(
    plan.environments.map((e) => e.requirement.toolchains?.map((t) => t.kind)),
    [["node"], ["dotnet"], ["android_sdk", "jdk_gradle"]],
  );
  // Nothing is registered: every environment is honestly missing.
  assert.ok(plan.environments.every((e) => e.status === "missing"));
});

/* ------------------------------------------------------------------ */
/* Agents and models                                                  */
/* ------------------------------------------------------------------ */

test("no qualified agent: valid environment + no qualified agent → BLOCKED, no closest match", async () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [
      agent("generalist", ["software_analysis"]),
      agent("other-project", ["web_development"], {
        allowedProjects: ["beta"],
      }),
      agent("disabled-web", ["web_development"]),
    ],
  });
  f.disabled.add("disabled-web");
  const plan = await f.planning.createPlan(webRequest(), ACTOR);
  assert.equal(plan.status, "blocked");
  assert.deepEqual(blockerCodes(plan), ["NO_QUALIFIED_AGENT"]);
  const assignment = plan.agents[0]!;
  assert.equal(assignment.agentId, undefined);
  assert.equal(assignment.qualification, "none_qualified");
  const reasons = Object.fromEntries(
    assignment.candidates.map((c) => [c.agentId, c.reasonCodes]),
  );
  assert.deepEqual(reasons, {
    "disabled-web": ["agent_disabled"],
    generalist: ["missing_capability"],
    "other-project": ["project_not_allowed"],
  });
  assert.equal(plan.models[0]!.status, "not_evaluated");
});

test("model requirements: an agent without a declared model profile → MISSING_MODEL_CAPABILITY", async () => {
  const plan = await planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [
      agent("web-agent", ["web_development"], {
        modelPolicy: { provider: "unregistered" },
      }),
    ],
  }).planning.createPlan(webRequest(), ACTOR);
  assert.deepEqual(blockerCodes(plan), ["MISSING_MODEL_CAPABILITY"]);
  assert.deepEqual(plan.models[0]!.missingCapabilities, [
    "coding",
    "reasoning",
  ]);
});

/* ------------------------------------------------------------------ */
/* Unsupported technology, dependency graph                           */
/* ------------------------------------------------------------------ */

test("unsupported technology is a structured blocker, not an exception", async () => {
  const plan = await planningFixture().planning.createPlan(
    {
      projectId: "alpha",
      title: "Mixed",
      components: [
        {
          id: "a",
          kind: "mobile_app",
          platforms: ["android"],
          technologies: ["swiftui"],
        },
        {
          id: "b",
          kind: "web_frontend",
          platforms: ["web"],
          technologies: ["cobol_web"],
        },
      ],
    },
    ACTOR,
  );
  assert.deepEqual(
    plan.blockers.map((b) => [b.code, b.subjectId, b.reasonCodes[0]]),
    [
      ["UNSUPPORTED_TECHNOLOGY", "a:swiftui", "incompatible_platform"],
      ["UNSUPPORTED_TECHNOLOGY", "b:cobol_web", "unknown_technology"],
    ],
  );
  assert.deepEqual(plan.environments, []);
});

test("dependency graph: cycles and unknown references are conflicts; order is deterministic", async () => {
  const base = {
    kind: "toolchain" as const,
    toolchainKind: "node" as const,
    requiredBy: ["x"],
  };
  const plan = planDependencies([
    { ...base, id: "c", name: "c", dependsOn: [] },
    { ...base, id: "a", name: "a", dependsOn: ["b"] },
    { ...base, id: "b", name: "b", dependsOn: ["a"] },
    { ...base, id: "d", name: "d", dependsOn: ["c", "ghost"] },
  ]);
  assert.deepEqual(plan.order, ["c", "d"]);
  assert.deepEqual(plan.conflicts, [
    { dependencyId: "a", reason: "cycle" },
    { dependencyId: "b", reason: "cycle" },
    { dependencyId: "d", reason: "unknown_dependency" },
  ]);
});

/* ------------------------------------------------------------------ */
/* Deployment, approvals                                              */
/* ------------------------------------------------------------------ */

function productionWebRequest(): Record<string, unknown> {
  return {
    ...webRequest(),
    deployments: [
      {
        componentId: "web",
        targetType: "firebase_hosting",
        stage: "production",
        credentialRef: {
          kind: "secret_manager",
          ref: "projects/ai-workforce-agents/secrets/hosting-deployer",
        },
      },
    ],
  };
}

test("deployment + approvals: production needs approval and security review; approval never executes", async () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
  });
  const plan = await f.planning.createPlan(productionWebRequest(), ACTOR);
  assert.equal(plan.status, "ready");
  const deploy = plan.deployment[0]!;
  assert.equal(deploy.status, "planned");
  assert.equal(deploy.targetType, "firebase_hosting");
  assert.equal(deploy.rollbackRequired, true);
  assert.equal(deploy.requiredArtifact.kind, "static_web_bundle");
  assert.ok(
    deploy.preDeploymentGates.includes("approval:production_deployment"),
  );
  assert.ok(
    deploy.preDeploymentGates.includes("security:security_agent_review"),
  );
  assert.deepEqual(
    plan.approvalRequirements.map((a) => a.reason),
    ["production_deployment"],
  );
  assert.equal(
    plan.agents.find((a) => a.requirementId === "agent:security-review")
      ?.agentId,
    "sec-agent",
  );

  const submitted = await f.planning.submitForApproval(plan.planId, ACTOR);
  assert.equal(submitted.status, "awaiting_approval");
  const approval = f.approvals.require(submitted.approval.approvalId!);
  assert.equal(approval.action, "execution_plan.approve");
  assert.equal(approval.status, "requested");

  const decided = f.approvals.decide(approval.id, "approved", "admin-1");
  const approved = await f.planning.applyApprovalDecision(decided, {
    id: "admin-1",
  });
  assert.equal(approved?.status, "approved");
  assert.equal(approved?.approval.state, "approved");
  // Approval is governance only: stages remain planned.
  assert.ok(approved!.build.every((s) => s.status === "planned"));
  assert.ok(approved!.deployment.every((s) => s.status === "planned"));
});

test("approval rejection blocks the plan; a blocked plan cannot be submitted", async () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
  });
  const plan = await f.planning.createPlan(productionWebRequest(), ACTOR);
  const submitted = await f.planning.submitForApproval(plan.planId, ACTOR);
  const decided = f.approvals.decide(
    submitted.approval.approvalId!,
    "rejected",
    "admin-1",
  );
  const rejected = await f.planning.applyApprovalDecision(decided, {
    id: "admin-1",
  });
  assert.equal(rejected?.status, "blocked");
  assert.deepEqual(blockerCodes(rejected!), ["APPROVAL_REJECTED"]);

  const blocked = await f.planning.createPlan(iosRequest(), ACTOR);
  await assert.rejects(
    () => f.planning.submitForApproval(blocked.planId, ACTOR),
    StateTransitionError,
  );
  const noApprovals = await f.planning.createPlan(webRequest(), ACTOR);
  await assert.rejects(
    () => f.planning.submitForApproval(noApprovals.planId, ACTOR),
    ValidationError,
  );
});

/* ------------------------------------------------------------------ */
/* Determinism and tie-breaking                                       */
/* ------------------------------------------------------------------ */

test("determinism: identical inputs yield identical evaluations and selections", async () => {
  const build = () =>
    planningFixture({
      hosts: [WEB_HOST, host("linux-2", "linux")],
      instances: [
        WEB_INSTANCE,
        instance("web-2", "web-build", "linux-2", {
          capabilities: ["web_build_capable"],
          toolchains: [toolchain("node", "20.11.1", { npm: "10.2.0" })],
        }),
      ],
      agents: [
        agent("web-b", ["web_development"]),
        agent("web-a", ["web_development"]),
      ],
    });
  const request = normalizeProjectRequest(webRequest());
  const first = build().planning.evaluate(request);
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(build().planning.evaluate(request), first);
  }
  // Tie-break: equal trust/version → instance id; agents → id.
  assert.equal(first.environments[0]!.match.selectedInstanceId, "web-1");
  assert.equal(first.agents[0]!.agentId, "web-a");
});

test("tie-break: higher trust wins, then higher environment version", async () => {
  const f = planningFixture({
    hosts: [
      host("mac-1", "macos"),
      host("mac-2", "macos"),
      host("mac-3", "macos"),
    ],
    instances: [
      instance("xcode-a", "xcode", "mac-1", {
        capabilities: ["mobile_build_capable"],
        toolchains: [toolchain("swift_xcode", "16.0", { ios_sdk: "18.0" })],
        version: "16.0",
        trustLevel: "detected",
      }),
      instance("xcode-b", "xcode", "mac-2", {
        capabilities: ["mobile_build_capable"],
        toolchains: [toolchain("swift_xcode", "15.4", { ios_sdk: "17.5" })],
        version: "15.4",
        trustLevel: "verified",
      }),
      instance("xcode-c", "xcode", "mac-3", {
        capabilities: ["mobile_build_capable"],
        toolchains: [toolchain("swift_xcode", "16.1", { ios_sdk: "18.1" })],
        version: "16.1",
        trustLevel: "verified",
      }),
    ],
    agents: [IOS_AGENT],
  });
  const plan = await f.planning.createPlan(iosRequest(), ACTOR);
  assert.equal(plan.environments[0]!.match.selectedInstanceId, "xcode-c");
});

/* ------------------------------------------------------------------ */
/* Versioning and replan                                              */
/* ------------------------------------------------------------------ */

test("replan: V1 blocked → Xcode registered → V2 ready; V1 superseded and preserved", async () => {
  const f = planningFixture({ agents: [IOS_AGENT] });
  const v1 = await f.planning.createPlan(iosRequest(), ACTOR);
  assert.equal(v1.status, "blocked");

  // Unchanged inputs → no new version.
  const same = await f.planning.replan(v1.planId, ACTOR);
  assert.equal(same.outcome, "unchanged");
  assert.equal(f.planning.versions(v1.planId).length, 1);

  f.registry.upsertHost(MAC_HOST);
  f.registry.upsertInstance(XCODE_INSTANCE);
  const result = await f.planning.replan(v1.planId, ACTOR);
  assert.equal(result.outcome, "replanned");
  const v2 = result.plan;
  assert.equal(v2.id, `${v1.planId}@v2`);
  assert.equal(v2.status, "ready");
  assert.equal(v2.supersedes, v1.id);

  const stored = f.planning.get(v1.id)!;
  assert.equal(stored.status, "superseded");
  assert.equal(stored.supersededBy, v2.id);
  // Historical content untouched.
  assert.deepEqual(stored.environments, v1.environments);
  assert.deepEqual(stored.blockers, v1.blockers);
  assert.equal(stored.inputsFingerprint, v1.inputsFingerprint);

  assert.deepEqual(
    f.planning.versions(v1.planId).map((p) => p.version),
    [2, 1],
  );
  assert.equal(f.planning.latest(v1.planId)?.id, v2.id);
  const actions = f.audit
    .query({ type: "execution_plan_event" })
    .map((e) => e.data.action);
  assert.deepEqual(actions, [
    "created",
    "blocked",
    "replan_unchanged",
    "replanned",
    "superseded",
    "ready",
  ]);
});

test("replan of a plan awaiting approval expires the pending approval", async () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
  });
  const plan = await f.planning.createPlan(productionWebRequest(), ACTOR);
  const submitted = await f.planning.submitForApproval(plan.planId, ACTOR);
  f.disabled.add("web-agent");
  const { plan: v2, previous } = await f.planning.replan(plan.planId, ACTOR);
  assert.equal(v2.status, "blocked");
  assert.equal(previous.status, "superseded");
  assert.equal(previous.approval.state, "expired");
  assert.equal(
    f.approvals.require(submitted.approval.approvalId!).status,
    "expired",
  );
});

test("repository: versions are immutable; only lifecycle fields may change along allowed transitions", async () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT],
  });
  const plan = await f.planning.createPlan(webRequest(), ACTOR);
  const repo = f.planning.repository;
  assert.throws(() => repo.create(plan), ValidationError);
  assert.throws(
    () =>
      repo.transition({
        ...plan,
        request: { ...plan.request, title: "rewritten" },
      }),
    ValidationError,
  );
  assert.throws(
    () => repo.transition({ ...plan, status: "approved" }),
    StateTransitionError,
  );
  assert.throws(
    () => repo.create({ ...plan, id: `${plan.planId}@v3`, version: 3 }),
    ValidationError,
  );
  const fresh = new ExecutionPlanRepository();
  assert.throws(
    () => fresh.create({ ...plan, status: "blocked" }),
    ValidationError,
  );
});

/* ------------------------------------------------------------------ */
/* Input trust, project existence, secret safety                      */
/* ------------------------------------------------------------------ */

test("client-supplied status, agents, environments and approvals are ignored", async () => {
  const f = planningFixture({ agents: [IOS_AGENT] });
  const plan = await f.planning.createPlan(
    {
      ...iosRequest(),
      status: "approved",
      agentId: "ios-agent",
      environmentId: "xcode-1",
      approval: { state: "approved" },
    },
    ACTOR,
  );
  assert.equal(plan.status, "blocked");
  assert.equal(plan.approval.state, "not_requested");
  assert.equal("status" in plan.request, false);
  assert.equal("agentId" in plan.request, false);
});

test("unknown project: no orphan plan is created", async () => {
  const f = planningFixture({ projects: ["alpha"] });
  await assert.rejects(
    () => f.planning.createPlan(webRequest("ghost"), ACTOR),
    NotFoundError,
  );
  assert.deepEqual(f.planning.listByProject("ghost"), []);
});

test("secret safety: plans hold references only; secret-looking values are refused", async () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
  });
  const plan = await f.planning.createPlan(productionWebRequest(), ACTOR);
  const json = JSON.stringify(plan);
  assert.doesNotMatch(
    json,
    /sk-|ghp_|AKIA|AIza|PRIVATE KEY|"password"|"apiKey"/,
  );
  assert.match(
    json,
    /projects\/ai-workforce-agents\/secrets\/hosting-deployer/,
  );

  const smuggled = {
    ...webRequest(),
    deployments: [
      {
        componentId: "web",
        targetType: "firebase_hosting",
        stage: "staging",
        credentialRef: { kind: "alias", ref: "sk-proj-abcdefghijklmnopqrstuv" },
      },
    ],
  };
  const before = f.planning.listByProject("alpha").length;
  await assert.rejects(
    () => f.planning.createPlan(smuggled, ACTOR),
    ValidationError,
  );
  assert.equal(f.planning.listByProject("alpha").length, before);

  assert.throws(
    () =>
      normalizeProjectRequest({
        ...webRequest(),
        deployments: [
          {
            componentId: "web",
            targetType: "firebase_hosting",
            stage: "production",
            credentialRef: {
              kind: "secret_manager",
              ref: "AIzaSyD-not-a-resource-name",
            },
          },
        ],
      }),
    ValidationError,
  );
});

/* ------------------------------------------------------------------ */
/* EO-2A regression: router now enforces minimum toolchain versions   */
/* ------------------------------------------------------------------ */

test("router: toolchain minimum versions and components are enforced; route() matches evaluate()", async () => {
  const f = planningFixture({ hosts: [WEB_HOST], instances: [WEB_INSTANCE] });
  const router = new EnvironmentRouter(f.registry);
  assert.equal(
    router.route({ toolchains: [{ kind: "node", minimum: ver("20") }] })
      .outcome,
    "ROUTED",
  );
  const tooNew = router.route({
    environmentType: "web_build",
    toolchains: [{ kind: "node", minimum: ver("22") }],
  });
  assert.equal(tooNew.outcome, "REQUIRES_PROVISIONING");
  const evidence = router.evaluate({
    environmentType: "web_build",
    toolchains: [{ kind: "node", components: [{ name: "pnpm" }] }],
  });
  assert.deepEqual(evidence.candidates[0]!.reasonCodes, [
    "missing_toolchain_component",
  ]);
  assert.deepEqual(evidence.candidates[0]!.missingToolchains, ["node:pnpm"]);
});

/* ------------------------------------------------------------------ */
/* Security gate                                                      */
/* ------------------------------------------------------------------ */

test("security gate: planning code has no process execution surface", async () => {
  const root = new URL("../../", import.meta.url);
  const files = [
    ...readdirSync(new URL("core/planning/", root)).map(
      (name) => new URL(`core/planning/${name}`, root),
    ),
    new URL("contracts/planning.ts", root),
    new URL("control/plan-views.ts", root),
  ].filter((url) => url.pathname.endsWith(".ts"));
  assert.ok(files.length >= 10);
  const forbidden =
    /child_process|execSync|\bexec\(|\bspawn\(|shell:\s*true|powershell|cmd(\.exe|\s\/c)|bash -c|adapters\/execution|node:/i;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, forbidden, file.pathname);
  }
});
