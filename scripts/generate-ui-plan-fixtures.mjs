/**
 * Regenerates the UI test fixtures for the Execution Plan screens from the
 * REAL planner (compiled backend + the backend test fixtures), so the UI is
 * tested against the actual API contract — never hand-made plan data.
 *
 *   npm run build && node scripts/generate-ui-plan-fixtures.mjs
 *
 * Output: ui/src/pages/Projects/__tests__/fixtures/plans.json (test-only).
 * Excluded from the Functions upload ("scripts").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executionPlanView } from "../dist/control/plan-views.js";
import {
  IOS_AGENT,
  MAC_HOST,
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  XCODE_INSTANCE,
  agent,
  iosRequest,
  planningFixture,
  webRequest,
} from "../dist/tests/fixtures/planning.js";

const ACTOR = { id: "operator-1" };
const view = (plan, current = true) => executionPlanView(plan, current);

// READY: React web app with a production deployment (approval required).
const ready = planningFixture({
  hosts: [WEB_HOST],
  instances: [WEB_INSTANCE],
  agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
});
const readyPlan = await ready.planning.createPlan(
  {
    ...webRequest("alpha"),
    deployments: [
      {
        componentId: "web",
        targetType: "firebase_hosting",
        stage: "production",
      },
    ],
  },
  ACTOR,
);

// BLOCKED: native iOS, Xcode required, no Xcode instance registered.
const ios = planningFixture({ agents: [IOS_AGENT] });
const iosV1 = await ios.planning.createPlan(iosRequest("alpha"), ACTOR);

// NO_QUALIFIED_AGENT: environment fine, nobody qualified.
const noAgent = planningFixture({
  hosts: [WEB_HOST],
  instances: [WEB_INSTANCE],
  agents: [agent("generalist", ["software_analysis"])],
});
const noAgentPlan = await noAgent.planning.createPlan(
  webRequest("alpha"),
  ACTOR,
);

// MULTI-ENVIRONMENT: React + .NET + Android.
const multi = planningFixture();
const multiPlan = await multi.planning.createPlan(
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
    ],
  },
  ACTOR,
);

// HISTORY: V1 blocked → Xcode registered → V2 ready → agent disabled → V3 blocked.
ios.registry.upsertHost(MAC_HOST);
ios.registry.upsertInstance(XCODE_INSTANCE);
await ios.planning.replan(iosV1.planId, ACTOR, 1);
ios.disabled.add("ios-agent");
await ios.planning.replan(iosV1.planId, ACTOR, 2);
const [v3, v2, v1] = ios.planning.versions(iosV1.planId);

const fixtures = {
  ready: view(readyPlan),
  blockedIos: view(iosV1),
  noAgent: view(noAgentPlan),
  multi: view(multiPlan),
  history: { v3: view(v3), v2: view(v2, false), v1: view(v1, false) },
};

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../ui/src/pages/Projects/__tests__/fixtures/plans.json",
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(fixtures, null, 2) + "\n");
console.log(`wrote ${out}`);
