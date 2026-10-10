/**
 * EO-5.8 — governance boundaries the spatial layer must not weaken: AVAILABLE != QUALIFIED,
 * qualification is separate from environment placement, and AGENT != MODEL != ENVIRONMENT.
 * (Broader autonomy / containment evidence already lives in the EO-4.x suites; see ADR-0025.)
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentQualificationRouter,
  AgentRegistry,
  EnvironmentRegistry,
  ModelProviderRegistry,
} from "../core/index.js";
import { WorkforceGraphProjectionService } from "../core/orchestrator/graph-projection.js";
import { ProjectRegistry, TaskSystem } from "../core/index.js";
import {
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  agent,
  planningFixture,
} from "./fixtures/planning.js";

const REQUIRE = {
  projectId: "alpha",
  requiredCapabilities: ["web_development"],
};

test("AVAILABLE != QUALIFIED: being registered, enabled and reachable does not make an agent qualified", () => {
  const router = new AgentQualificationRouter(new EnvironmentRegistry());
  const agents = [
    agent("qualified", ["web_development"], { allowedProjects: ["alpha"] }),
    agent("available-but-unqualified", ["ios_development"], {
      allowedProjects: ["alpha"],
    }),
    agent("wildcard", ["*"], { allowedProjects: ["alpha"] }),
    agent("wrong-project", ["web_development"], { allowedProjects: ["beta"] }),
    agent("disabled", ["web_development"], { allowedProjects: ["alpha"] }),
  ];
  const evidence = router.evaluateCandidates(
    agents,
    REQUIRE,
    (id) => id !== "disabled",
  );
  const by = Object.fromEntries(evidence.map((e) => [e.agentId, e]));
  assert.equal(by["qualified"]!.qualifies, true);
  assert.equal(by["available-but-unqualified"]!.qualifies, false);
  assert.deepEqual(by["available-but-unqualified"]!.reasonCodes, [
    "missing_capability",
  ]);
  assert.equal(
    by["wildcard"]!.qualifies,
    false,
    "a '*' capability is not a nearest-match escape hatch",
  );
  assert.deepEqual(by["wrong-project"]!.reasonCodes, ["project_not_allowed"]);
  assert.deepEqual(by["disabled"]!.reasonCodes, ["agent_disabled"]);
  assert.equal(
    evidence[0]!.agentId,
    "qualified",
    "qualified candidates come first",
  );
});

test("qualification is checked BEFORE placement: an unqualified agent is refused even when an environment is available", () => {
  const f = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT],
  });
  const router = new AgentQualificationRouter(f.registry);
  const requirement = {
    environmentType: "web_build" as const,
    requiredCapabilities: ["web_build_capable" as const],
  };
  // A usable web_build environment exists (an agent declaring what it needs is routed to it) ...
  const capable = agent("web-capable", ["web_build", "web_build_capable"]);
  assert.equal(router.route(capable, requirement).outcome, "ROUTED");
  // ... but an agent that does not declare the capability is refused, environment or not.
  const unqualified = agent("no-web", ["ios_development"]);
  assert.equal(router.route(unqualified, requirement).outcome, "NOT_QUALIFIED");
});

test("a qualified agent with no usable environment is REQUIRES_PROVISIONING / NO_AVAILABLE — never a fabricated success", () => {
  const empty = new AgentQualificationRouter(new EnvironmentRegistry());
  const capable = agent("web-capable", ["web_build", "web_build_capable"]);
  const r = empty.route(capable, {
    environmentType: "web_build",
    requiredCapabilities: ["web_build_capable"],
  });
  assert.ok(
    ["REQUIRES_PROVISIONING", "NO_AVAILABLE_ENVIRONMENT"].includes(r.outcome),
    r.outcome,
  );
  assert.notEqual(r.outcome, "ROUTED");
});

test("AGENT != MODEL != ENVIRONMENT: changing the model policy changes neither identity nor qualification", () => {
  const openai = agent("dev", ["web_development"], {
    modelPolicy: { provider: "openai", model: "gpt-x" },
  });
  const other = agent("dev", ["web_development"], {
    modelPolicy: { provider: "someone-else", model: "y" },
  });
  const router = new AgentQualificationRouter(new EnvironmentRegistry());
  const q = (a: typeof openai) => router.evaluateCandidates([a], REQUIRE)[0]!;
  assert.deepEqual(
    q(openai),
    q(other),
    "qualification does not depend on the model",
  );
  assert.equal(
    openai.id,
    other.id,
    "the agent's identity is its id, not its model",
  );
  // The provider registry is provider-neutral: adding a provider does not touch any agent.
  const providers = new ModelProviderRegistry();
  const before = JSON.stringify(openai);
  providers.register("openai", () => ({}) as never);
  providers.register("another", () => ({}) as never);
  assert.deepEqual(providers.list(), ["another", "openai"]);
  assert.equal(JSON.stringify(openai), before);
});

test("the graph keeps agent, model and environment as separate facts: a model change moves neither node ids nor edges", () => {
  const build = (model: string) => {
    const projects = new ProjectRegistry();
    projects.register({
      projectId: "alpha",
      async describe() {
        return { name: "a", capabilities: [] };
      },
      async execute() {
        return {};
      },
    });
    const agents = new AgentRegistry();
    agents.register(
      agent("dev", ["web_development"], {
        allowedProjects: ["alpha"],
        modelPolicy: { provider: "openai", model },
      }),
    );
    const tasks = new TaskSystem();
    const t = tasks.create({
      type: "build",
      description: "job",
      projectId: "alpha",
    });
    tasks.transition(t.id, "queued");
    tasks.assign(t.id, "dev");
    return new WorkforceGraphProjectionService(
      projects,
      agents,
      tasks,
      undefined,
    ).getProjection({ projectId: "alpha", mode: "AGENT" });
  };
  const a = build("model-one");
  const b = build("model-two");
  assert.deepEqual(
    a.nodes.map((n) => n.id),
    b.nodes.map((n) => n.id),
  );
  assert.deepEqual(
    a.edges.map((e) => e.id),
    b.edges.map((e) => e.id),
  );
  const agentNode = a.nodes.find((n) => n.type === "AGENT")!;
  assert.equal(agentNode.referenceId, "dev");
  assert.equal(
    agentNode.metadata?.model,
    "model-one",
    "the model is a fact ABOUT the agent, not the agent",
  );
  assert.ok(
    !a.nodes.some((n) => n.id.includes("model-one")),
    "the model is not an identity",
  );
});

test("OpenAI remains the primary provider in the production agent configuration", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(
    new URL("../../api/production-workforce-config.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /modelPolicy:\s*\{\s*provider:\s*"openai"/);
  assert.ok(
    !/provider:\s*"(anthropic|google)"/.test(src),
    "no other provider is introduced in production wiring",
  );
});
