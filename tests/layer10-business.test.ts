/**
 * Layer 10 — Business Operating Layer: structure, departments, managers, workforce, objectives,
 * KPIs measured from real data, plans, decisions. Real service; the data sources are fakes.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  BusinessError,
  BusinessService,
  inMemoryBusinessRepos,
  kpiStatus,
  measureMetric,
  type Kpi,
  type Measurement,
  type MeasuredMetric,
} from "../core/index.js";
import { BusinessControlService } from "../control/services/platform-layers-control.js";
import {
  ADMIN,
  ALPHA_ONLY,
  OPERATOR,
  VIEWER,
  derive,
  makeSecurity,
  run,
  task,
  usage,
} from "./helpers/platform-fixtures.js";

const PROJECTS = ["alpha", "beta"];
const AGENTS = ["dev-agent", "qa-agent"];

function rig(
  measure?: (m: MeasuredMetric, p?: string) => Measurement,
  remembered: unknown[] = [],
) {
  const f = makeSecurity();
  const business = new BusinessService(inMemoryBusinessRepos(), {
    projectExists: (id) => PROJECTS.includes(id),
    agentExists: (id) => AGENTS.includes(id),
    measure:
      measure ??
      (() => ({ value: null, sample: 0, unit: "%", note: "no data" })),
    workflowTemplates: () => [],
    ledger: f.security.ledger,
    clock: f.clock.iso,
    remember: (d) => void remembered.push(d),
  });
  const control = new BusinessControlService(
    { audit: f.audit, clock: f.clock.iso },
    business,
  );
  return { ...f, business, control, remembered };
}

/* ------------------------------- structure ------------------------------- */

test("business structure: business → board → executive functions → departments", () => {
  const { business } = rig();
  const org = business.organization();
  assert.equal(org.kind, "BUSINESS");
  const board = org.children[0]!;
  assert.equal(board.kind, "BOARD");
  assert.deepEqual(board.children.map((c) => c.id).sort(), [
    "FINANCE",
    "OPERATIONS",
    "PRODUCT",
    "SECURITY",
    "STRATEGY",
    "TECHNOLOGY",
  ]);
  const dept = (name: string) =>
    board.children.flatMap((c) => c.children).find((d) => d.name === name);
  for (const name of [
    "Engineering",
    "IT",
    "Finance",
    "Marketing",
    "Operations",
    "Research",
    "Design",
    "Business",
    "Security",
  ])
    assert.ok(dept(name), name);
  assert.equal(
    board.children.find((c) => c.id === "SECURITY")!.children[0]!.name,
    "Security",
  );
});

test("seeding defaults is idempotent", () => {
  const { business } = rig();
  const before = business.listDepartments().length;
  business.seedDefaults("again");
  assert.equal(business.listDepartments().length, before);
});

test("departments: create, duplicate refused, update, archive (never delete)", () => {
  const { business } = rig();
  const d = business.createDepartment(
    { name: "Legal", executiveFunction: "OPERATIONS" },
    "owner",
  );
  assert.throws(
    () => business.createDepartment({ name: "legal" }, "owner"),
    (e: unknown) => e instanceof BusinessError && e.code === "conflict",
  );
  assert.equal(
    business.updateDepartment(
      d.departmentId,
      { description: "Contracts" },
      "owner",
    ).description,
    "Contracts",
  );
  assert.throws(
    () => business.createDepartment({ name: "" }, "owner"),
    /required/,
  );
  assert.throws(() =>
    business.createDepartment(
      { name: "X", executiveFunction: "KING" },
      "owner",
    ),
  );
  business.archiveDepartment(d.departmentId, "owner");
  assert.equal(
    business.listDepartments().some((x) => x.departmentId === d.departmentId),
    false,
  );
  assert.equal(
    business
      .listDepartments(true)
      .some((x) => x.departmentId === d.departmentId),
    true,
    "history is kept",
  );
});

test("workforce: agents join departments only if they exist in the agent registry", () => {
  const { business } = rig();
  assert.deepEqual(
    business.assignAgent("dept-engineering", "dev-agent", "owner").agentIds,
    ["dev-agent"],
  );
  assert.deepEqual(
    business.assignAgent("dept-engineering", "dev-agent", "owner").agentIds,
    ["dev-agent"],
    "idempotent",
  );
  assert.throws(
    () => business.assignAgent("dept-engineering", "ghost", "owner"),
    /agent registry/,
  );
  const org = business.organization();
  const eng = org.children[0]!.children.flatMap((c) => c.children).find(
    (d) => d.name === "Engineering",
  )!;
  assert.ok(
    eng.children.some((c) => c.kind === "AGENT" && c.id === "dev-agent"),
  );
  business.unassignAgent("dept-engineering", "dev-agent", "owner");
  assert.throws(
    () => business.unassignAgent("dept-engineering", "dev-agent", "owner"),
    /not in this department/,
  );
});

test("managers coordinate through the existing registries; projects are linked, not duplicated", () => {
  const { business } = rig();
  const d = business.setManager(
    "dept-engineering",
    { kind: "AGENT", ref: "dev-agent", responsibilities: ["triage", "assign"] },
    "owner",
  );
  assert.equal(d.manager!.ref, "dev-agent");
  assert.throws(
    () =>
      business.setManager(
        "dept-engineering",
        { kind: "AGENT", ref: "ghost" },
        "owner",
      ),
    /agent registry/,
  );
  business.setManager(
    "dept-engineering",
    { kind: "USER", ref: "owner" },
    "owner",
  );
  assert.equal(
    business.linkProject("dept-engineering", "alpha", "owner").projectIds[0],
    "alpha",
  );
  assert.throws(
    () => business.linkProject("dept-engineering", "ghost", "owner"),
    /project not found/,
  );
  assert.equal(
    business.linkProject("dept-engineering", "alpha", "owner").projectIds
      .length,
    1,
  );
});

/* ------------------------------- objectives ------------------------------- */

test("objectives: levels, validation, status lifecycle", () => {
  const { business } = rig();
  const o = business.createObjective(
    {
      title: "Launch the site",
      level: "STRATEGIC",
      ownerFunction: "PRODUCT",
      priority: "HIGH",
    },
    "owner",
  );
  assert.equal(o.status, "DRAFT");
  assert.throws(
    () => business.createObjective({ title: "x", level: "PROJECT" }, "owner"),
    /needs a projectId/,
  );
  assert.throws(
    () =>
      business.createObjective(
        { title: "x", level: "PROJECT", projectId: "ghost" },
        "owner",
      ),
    /project not found/,
  );
  assert.throws(
    () =>
      business.createObjective({ title: "x", departmentId: "nope" }, "owner"),
    /department not found/,
  );
  assert.throws(
    () => business.createObjective({ title: "" }, "owner"),
    /required/,
  );
  assert.equal(
    business.setObjectiveStatus(o.objectiveId, "ACTIVE", "owner").status,
    "ACTIVE",
  );
  business.setObjectiveStatus(o.objectiveId, "ACHIEVED", "owner");
  assert.throws(
    () => business.setObjectiveStatus(o.objectiveId, "ACTIVE", "owner"),
    /closed/,
  );
  const child = business.createObjective(
    { title: "Design", level: "OPERATIONAL", parentObjectiveId: o.objectiveId },
    "owner",
  );
  assert.equal(child.parentObjectiveId, o.objectiveId);
});

/* ---------------------------------- KPIs ---------------------------------- */

const kpi = (o: Partial<Kpi> = {}): Kpi => ({
  kpiId: "k",
  name: "K",
  description: "",
  unit: "%",
  direction: "HIGHER_IS_BETTER",
  target: 100,
  source: { kind: "MANUAL" },
  readings: [],
  ...o,
});

test("KPI status: no data is NO_DATA, never zero", () => {
  const s = kpiStatus(kpi(), undefined);
  assert.equal(s.state, "NO_DATA");
  assert.equal(s.current, null);
  assert.equal(s.attainmentPercent, null);
  const m = kpiStatus(
    kpi({ source: { kind: "MEASURED", metric: "TASK_SUCCESS_RATE" } }),
    { value: null, sample: 0, unit: "%", note: "none" },
  );
  assert.equal(m.state, "NO_DATA");
});

test("KPI attainment: higher/lower is better, baselines, thresholds", () => {
  const r = (v: number) => ({ at: "2026-10-01T00:00:00Z", value: v, by: "o" });
  assert.equal(
    kpiStatus(kpi({ readings: [r(80)] }), undefined).state,
    "ON_TRACK",
  );
  assert.equal(
    kpiStatus(kpi({ readings: [r(50)] }), undefined).state,
    "AT_RISK",
  );
  assert.equal(
    kpiStatus(kpi({ readings: [r(10)] }), undefined).state,
    "OFF_TRACK",
  );
  assert.equal(
    kpiStatus(kpi({ readings: [r(100)] }), undefined).state,
    "ACHIEVED",
  );
  assert.equal(
    kpiStatus(kpi({ readings: [r(120)] }), undefined).attainmentPercent,
    100,
    "clamped",
  );
  const lower = kpi({ direction: "LOWER_IS_BETTER", target: 2, baseline: 10 });
  assert.equal(
    kpiStatus({ ...lower, readings: [r(6)] }, undefined).attainmentPercent,
    50,
  );
  assert.equal(
    kpiStatus({ ...lower, readings: [r(2)] }, undefined).state,
    "ACHIEVED",
  );
  assert.equal(
    kpiStatus(
      kpi({ direction: "LOWER_IS_BETTER", target: 5, readings: [r(4)] }),
      undefined,
    ).state,
    "ACHIEVED",
  );
  assert.equal(
    kpiStatus(kpi({ baseline: 40, target: 80, readings: [r(60)] }), undefined)
      .attainmentPercent,
    50,
  );
});

test("KPIs: manual readings are recorded; measured KPIs reject manual readings", () => {
  const { business } = rig((metric) => ({
    value: 75,
    sample: 8,
    unit: "%",
    note: `measured ${metric}`,
  }));
  const o = business.createObjective(
    { title: "Quality", ownerFunction: "TECHNOLOGY" },
    "owner",
  );
  const a = business.addKpi(
    o.objectiveId,
    { name: "NPS", sourceKind: "MANUAL", target: 50, unit: "pts" },
    "owner",
  );
  const b = business.addKpi(
    a.objectiveId,
    {
      name: "Success rate",
      sourceKind: "MEASURED",
      metric: "TASK_SUCCESS_RATE",
      target: 90,
    },
    "owner",
  );
  const manual = b.kpis[0]!;
  const measured = b.kpis[1]!;
  business.recordReading(o.objectiveId, manual.kpiId, 40, "survey", "owner");
  assert.throws(
    () => business.recordReading(o.objectiveId, measured.kpiId, 1, "", "owner"),
    /measured from platform data/,
  );
  assert.throws(
    () =>
      business.recordReading(o.objectiveId, manual.kpiId, "NaN", "", "owner"),
    /number/,
  );
  const st = business.kpiStatuses(business.objective(o.objectiveId));
  assert.equal(st[0]!.current, 40);
  assert.equal(st[1]!.current, 75);
  assert.equal(st[1]!.sample, 8);
  assert.throws(
    () =>
      business.addKpi(
        o.objectiveId,
        { name: "x", sourceKind: "MEASURED", metric: "VIBES", target: 1 },
        "owner",
      ),
    /metric/,
  );
});

test("measured metrics are computed from real runs, usage and alerts — and return null with no data", () => {
  const runs = [
    run("alpha", [
      task({ status: "COMPLETED" }),
      task({ status: "COMPLETED" }),
      task({ status: "FAILED" }),
      task({ status: "READY" }),
    ]),
    run("alpha", [
      task({ status: "COMPLETED", type: "DEPLOYMENT" }),
      task({ status: "FAILED", type: "DEPLOYMENT" }),
    ]),
    run("beta", [task({ status: "COMPLETED" })]),
  ];
  const inputs = {
    runs,
    deriveRunStatus: derive,
    usage: [
      usage({ usd: 0.5 }),
      usage({ usd: null }),
      usage({ projectId: "beta", usd: 2 }),
    ],
    alerts: [
      { projectId: "alpha", status: "OPEN" },
      { projectId: "alpha", status: "RESOLVED" },
      { projectId: "beta", status: "OPEN" },
    ],
  };
  assert.equal(measureMetric("PROJECT_COMPLETION", "alpha", inputs).value, 50);
  assert.equal(measureMetric("TASK_SUCCESS_RATE", "alpha", inputs).value, 60);
  assert.equal(measureMetric("RUN_FAILURE_RATE", "alpha", inputs).value, 100);
  assert.equal(
    measureMetric("DEPLOYMENT_SUCCESS_RATE", "alpha", inputs).value,
    50,
  );
  assert.equal(measureMetric("AI_COST_USD", "alpha", inputs).value, 0.5);
  assert.match(
    measureMetric("AI_COST_USD", "alpha", inputs).note,
    /1 unpriced/,
  );
  assert.equal(measureMetric("OPEN_SECURITY_ALERTS", "alpha", inputs).value, 1);
  assert.equal(
    measureMetric("OPEN_SECURITY_ALERTS", undefined, inputs).value,
    2,
  );
  const empty = { runs: [], deriveRunStatus: derive, usage: [], alerts: [] };
  for (const m of [
    "PROJECT_COMPLETION",
    "TASK_SUCCESS_RATE",
    "RUN_FAILURE_RATE",
    "DEPLOYMENT_SUCCESS_RATE",
    "AI_COST_USD",
  ] as const)
    assert.equal(measureMetric(m, "alpha", empty).value, null, m);
});

/* --------------------------- business → execution --------------------------- */

test("objective → initiative → plan proposal → approval hand-off; no project, task or run is created", () => {
  const { business } = rig();
  business.assignAgent("dept-engineering", "dev-agent", "owner");
  const o = business.createObjective(
    {
      title: "Launch a new website",
      description: "Marketing site",
      strategy: "Ship an MVP in phases",
      level: "STRATEGIC",
      ownerFunction: "PRODUCT",
      departmentId: "dept-engineering",
    },
    "owner",
  );
  const i = business.createInitiative(
    { objectiveId: o.objectiveId, title: "Build the MVP" },
    "owner",
  );
  assert.equal(
    i.strategy,
    "Ship an MVP in phases",
    "the strategy flows from the objective",
  );
  const plan = business.proposePlan(i.initiativeId, {}, "owner");
  assert.equal(plan.status, "PROPOSED");
  assert.equal(plan.needsProject, true);
  assert.equal(plan.workflow.source, "default");
  assert.deepEqual(
    plan.tasks.map((t) => t.taskKey),
    ["analyze", "plan", "code", "test", "review", "security", "approval"],
  );
  assert.ok(
    plan.tasks
      .find((t) => t.taskKey === "code")!
      .suggestedAgentIds.includes("dev-agent"),
  );
  assert.equal(
    plan.tasks.find((t) => t.taskKey === "approval")!.requiresApproval,
    true,
  );
  assert.match(plan.promptObjective, /Launch a new website — Build the MVP/);
  assert.throws(
    () => business.decidePlan(i.initiativeId, plan.planId, "APPROVED", "owner"),
    /needs a project/,
  );
  const withProject = business.proposePlan(
    i.initiativeId,
    { projectId: "alpha" },
    "owner",
  );
  assert.equal(withProject.needsProject, false);
  assert.equal(
    business.decidePlan(i.initiativeId, withProject.planId, "APPROVED", "owner")
      .status,
    "ACTIVE",
  );
  assert.throws(
    () =>
      business.decidePlan(
        i.initiativeId,
        withProject.planId,
        "REJECTED",
        "owner",
      ),
    /already approved/,
  );
  assert.throws(
    () => business.proposePlan(i.initiativeId, { projectId: "ghost" }, "owner"),
    /project not found/,
  );
});

test("an enabled workflow template shapes the plan", () => {
  const f = makeSecurity();
  const business = new BusinessService(inMemoryBusinessRepos(), {
    projectExists: (id) => PROJECTS.includes(id),
    agentExists: () => true,
    measure: () => ({ value: null, sample: 0, unit: "", note: "" }),
    workflowTemplates: () => [
      {
        extensionId: "workflow.fix",
        name: "Maintenance fix",
        version: "1.0.0",
        stages: [
          { id: "diagnose", title: "Diagnose", taskType: "ANALYSIS" },
          {
            id: "fix",
            title: "Fix",
            taskType: "DEVELOPMENT",
            dependsOn: ["diagnose"],
          },
        ],
      },
    ],
    ledger: f.security.ledger,
    clock: f.clock.iso,
  });
  const o = business.createObjective(
    { title: "Fix login", projectId: "alpha", level: "PROJECT" },
    "owner",
  );
  const i = business.createInitiative(
    { objectiveId: o.objectiveId, title: "Fix" },
    "owner",
  );
  const plan = business.proposePlan(
    i.initiativeId,
    { templateId: "workflow.fix" },
    "owner",
  );
  assert.equal(plan.workflow.source, "extension");
  assert.deepEqual(
    plan.tasks.map((t) => t.taskKey),
    ["diagnose", "fix"],
  );
  assert.throws(
    () =>
      business.proposePlan(
        i.initiativeId,
        { templateId: "workflow.missing" },
        "owner",
      ),
    /not enabled/,
  );
});

/* --------------------------------- decisions --------------------------------- */

test("decision records: record, adopt, supersede — never edited or deleted", () => {
  const remembered: unknown[] = [];
  const { business } = rig(undefined, remembered);
  const o = business.createObjective(
    { title: "Platform", ownerFunction: "TECHNOLOGY" },
    "owner",
  );
  const d = business.recordDecision(
    {
      title: "Use Firestore",
      decision: "Store project data in Firestore",
      context: "Need realtime",
      alternatives: ["Postgres", "Supabase"],
      rationale: "Already in use",
      actions: ["Document the schema"],
      objectiveId: o.objectiveId,
      projectId: "alpha",
    },
    "owner",
  );
  assert.equal(d.status, "PROPOSED");
  assert.equal(remembered.length, 0, "a proposal is not remembered");
  assert.equal(business.adoptDecision(d.decisionId, "owner").status, "ADOPTED");
  assert.equal(
    remembered.length,
    1,
    "an adopted decision is offered to the Knowledge layer",
  );
  assert.throws(
    () => business.adoptDecision(d.decisionId, "owner"),
    /already adopted/,
  );
  const { old, next } = business.supersedeDecision(
    d.decisionId,
    {
      title: "Use Firestore + BigQuery",
      decision: "Add BigQuery for analytics",
      rationale: "Reporting needs",
    },
    "owner",
  );
  assert.equal(old.status, "SUPERSEDED");
  assert.equal(old.supersededBy, next.decisionId);
  assert.equal(next.supersedes, d.decisionId);
  assert.equal(next.status, "ADOPTED");
  assert.deepEqual(next.links, d.links, "links carry over");
  assert.equal(
    business.listDecisions({ projectId: "alpha" }).length,
    2,
    "both stay on record",
  );
  assert.throws(
    () =>
      business.supersedeDecision(
        d.decisionId,
        { title: "again", decision: "again" },
        "owner",
      ),
    /only an adopted decision/,
  );
  assert.throws(
    () =>
      business.recordDecision(
        { title: "t", decision: "d", projectId: "ghost" },
        "owner",
      ),
    /project not found/,
  );
});

/* ---------------------------------- board ---------------------------------- */

test("board view reports performance and risks from real state", () => {
  const f = makeSecurity();
  const business = new BusinessService(inMemoryBusinessRepos(), {
    projectExists: (id) => PROJECTS.includes(id),
    agentExists: () => true,
    measure: (m) =>
      m === "TASK_SUCCESS_RATE"
        ? { value: 10, sample: 20, unit: "%", note: "x" }
        : { value: null, sample: 0, unit: "%", note: "none" },
    workflowTemplates: () => [],
    projectHealth: (id) =>
      id === "alpha"
        ? { state: "CRITICAL", reasons: ["tests failing"] }
        : undefined,
    ledger: f.security.ledger,
    clock: f.clock.iso,
  });
  const a = business.createObjective(
    {
      title: "Quality",
      level: "PROJECT",
      projectId: "alpha",
      targetDate: "2026-09-01T00:00:00Z",
    },
    "owner",
  );
  business.setObjectiveStatus(a.objectiveId, "ACTIVE", "owner");
  business.addKpi(
    a.objectiveId,
    {
      name: "Success",
      sourceKind: "MEASURED",
      metric: "TASK_SUCCESS_RATE",
      target: 90,
    },
    "owner",
  );
  const b = business.createObjective({ title: "Unmeasured goal" }, "owner");
  business.setObjectiveStatus(b.objectiveId, "ACTIVE", "owner");
  const board = business.board();
  const kinds = board.risks.map((r) => r.kind);
  for (const k of ["OVERDUE", "PROJECT_HEALTH", "KPI_OFF_TRACK", "UNMEASURED"])
    assert.ok(kinds.includes(k), k);
  assert.equal(board.performance.kpis, 1);
  assert.equal(board.performance.offTrack, 1);
});

/* --------------------------------- control --------------------------------- */

test("control: viewers read, operators manage structure, only the owner decides plans and decisions", async () => {
  const { control, business } = rig();
  assert.ok(control.overview(VIEWER).board);
  assert.equal(
    (
      await control.execute("business_create_department", VIEWER, {
        name: "Legal",
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (
      await control.execute("business_create_department", OPERATOR, {
        name: "Legal",
      })
    ).outcome,
    "executed",
  );
  const o = await control.execute("business_create_objective", OPERATOR, {
    title: "Goal",
    level: "OPERATIONAL",
  });
  assert.equal(o.outcome, "executed");
  const objectiveId = o.details["objectiveId"] as string;
  const init = await control.execute("business_create_initiative", OPERATOR, {
    objectiveId,
    title: "Do it",
    projectIds: ["alpha"],
  });
  const initiativeId = init.details["initiativeId"] as string;
  const plan = await control.execute("business_propose_plan", OPERATOR, {
    initiativeId,
  });
  const planId = plan.details["planId"] as string;
  assert.equal(
    (
      await control.execute("business_decide_plan", OPERATOR, {
        initiativeId,
        planId,
        decision: "APPROVED",
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (
      await control.execute("business_decide_plan", ADMIN, {
        initiativeId,
        planId,
        decision: "APPROVED",
      })
    ).outcome,
    "executed",
  );
  const dec = await control.execute("business_record_decision", OPERATOR, {
    title: "T",
    decision: "D",
  });
  const decisionId = dec.details["decisionId"] as string;
  assert.equal(
    (await control.execute("business_adopt_decision", OPERATOR, { decisionId }))
      .outcome,
    "denied",
  );
  assert.equal(
    (await control.execute("business_adopt_decision", ADMIN, { decisionId }))
      .outcome,
    "executed",
  );
  assert.equal(
    (
      await control.execute("business_archive_department", OPERATOR, {
        departmentId: "dept-legal",
      })
    ).outcome,
    "denied",
  );
  assert.equal(
    (await control.execute("business_delete_everything", ADMIN, {})).outcome,
    "rejected",
  );
  assert.equal(business.listDecisions().length, 1);
});

test("control: project-bound business data is isolated per principal", async () => {
  const { control, business } = rig();
  business.createObjective(
    { title: "Alpha goal", level: "PROJECT", projectId: "alpha" },
    "owner",
  );
  business.createObjective(
    { title: "Beta goal", level: "PROJECT", projectId: "beta" },
    "owner",
  );
  const seen = control
    .objectives(ALPHA_ONLY, new URLSearchParams())
    .objectives.map((o) => o.title);
  assert.deepEqual(seen, ["Alpha goal"]);
  assert.throws(
    () =>
      control.objectives(
        ALPHA_ONLY,
        new URLSearchParams({ projectId: "beta" }),
      ),
    /project not found/,
  );
  const beta = business.listObjectives({ projectId: "beta" })[0]!;
  assert.throws(
    () => control.objective(ALPHA_ONLY, beta.objectiveId),
    /project not found/,
  );
  const denied = await control.execute(
    "business_create_objective",
    ALPHA_ONLY,
    { title: "Sneaky", level: "PROJECT", projectId: "beta" },
  );
  assert.equal(denied.outcome, "rejected");
  assert.equal(denied.errorKind, "not_found");
});

test("the business layer owns no tasks or workflows and never talks to a provider", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const dir = path.resolve(import.meta.dirname, "..", "core", "business");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const text = readFileSync(path.join(dir, f), "utf8");
    assert.ok(
      !/await fetch|globalThis[.]fetch|node:https?|process[.]env|child_process|from ["'][^"']*execution-orchestration|from ["'][^"']*workflows\//.test(
        text,
      ),
      `${f} must stay separate from execution`,
    );
  }
});
