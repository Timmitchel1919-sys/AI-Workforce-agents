/**
 * EO-6.3 — onboarding → AI Cost Center bridge.
 *
 * Approving a plan with an actually-configured budget limit now also sets
 * the project's ENFORCED `BudgetPolicy` — the one thing ADR-0027 explicitly
 * deferred. A plan with NO limit configured bridges nothing (never a
 * fabricated policy), and a bridging failure never fails the approval itself
 * (PROJECT READY != AUTOMATIC EXECUTION extends to "budget bridging failed"
 * too — onboarding's own success is never undone by it).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditLog,
  InMemoryOnboardingSessionStore,
  InMemoryProvisionedProjectStore,
  OnboardingService,
  ProjectProvisioningService,
  ProjectRegistry,
  type OperatorPrincipal,
  type RepositoryReadResult,
  type RepositorySourceReader,
} from "../core/index.js";
import { ProvisionedProjectAdapter } from "../adapters/projects/provisioned/provisioned-project-adapter.js";
import { OnboardingControlService } from "../control/services/onboarding-control-service.js";
import type { BudgetPolicy } from "../contracts/index.js";

const ADMIN: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};

const EVIDENCE = {
  provider: "github" as const,
  url: "https://github.com/acme/webapp",
  visibility: "private" as const,
  defaultBranch: "main",
  branch: "main",
  commit: "a".repeat(40),
  truncated: false,
  paths: ["package.json"],
  files: {
    "package.json": JSON.stringify({
      scripts: {},
      dependencies: {},
      devDependencies: {},
    }),
  },
};

function readerReturning(result: RepositoryReadResult): RepositorySourceReader {
  return {
    providers: ["github"],
    privateAccess: true,
    read: async () => result,
  };
}

function setup(budgetPolicies?: {
  set: (...args: never[]) => Promise<BudgetPolicy>;
}) {
  const audit = new AuditLog();
  const registry = new ProjectRegistry();
  const sessions = new InMemoryOnboardingSessionStore();
  const projects = new InMemoryProvisionedProjectStore();
  const provisioning = new ProjectProvisioningService({
    sessions,
    projects,
    registry,
    audit,
    adapterFactory: (p) => new ProvisionedProjectAdapter(p),
  });
  const service = new OnboardingService({
    sessions,
    projects,
    registry,
    audit,
    reader: readerReturning({ ok: true, evidence: EVIDENCE }),
    provisioning,
    platform: () => ({
      descriptors: [],
      usableDescriptorIds: new Set(),
      agents: [],
    }),
  });
  return {
    control: new OnboardingControlService(
      service,
      audit,
      budgetPolicies as never,
    ),
  };
}

async function planWithCost(
  control: OnboardingControlService,
  costPolicy: Record<string, unknown> | undefined,
  code: string,
) {
  const created = await control.onboardingCreate(ADMIN, {
    mode: "guided",
    kind: "import_existing",
  });
  const session = created.details["session"] as {
    id: string;
    revision: number;
  };
  const updated = await control.onboardingUpdate(ADMIN, {
    id: session.id,
    expectedRevision: session.revision,
    patch: {
      identity: { name: "Acme", code },
      source: { repositoryUrl: "https://github.com/acme/webapp" },
      ...(costPolicy ? { costPolicy } : {}),
    },
  });
  const u = updated.details["session"] as { id: string; revision: number };
  const analyzed = await control.onboardingAnalyze(ADMIN, {
    id: u.id,
    expectedRevision: u.revision,
  });
  const a = analyzed.details["session"] as { id: string; revision: number };
  const planned = await control.onboardingPlan(ADMIN, {
    id: a.id,
    expectedRevision: a.revision,
  });
  return planned.details["session"] as {
    id: string;
    revision: number;
    plan: { planVersion: number; planHash: string };
  };
}

test("BRIDGE: approving a plan with an actual budget limit sets the REAL enforced BudgetPolicy", async () => {
  const calls: unknown[] = [];
  const budgetPolicies = {
    set: async (...args: never[]) => {
      calls.push(args);
      return {
        projectId: "p",
        allowUnknownCost: false,
        warningThresholdPercent: 80,
        hardStop: true,
        updatedAt: "t",
        updatedBy: "admin-1",
      } as unknown as BudgetPolicy;
    },
  };
  const { control } = setup(budgetPolicies);
  const planned = await planWithCost(
    control,
    { dailyLimit: 5, warningThresholdPercent: 80, hardStop: true },
    "AAA1",
  );
  const result = await control.onboardingApprovePlan(ADMIN, {
    id: planned.id,
    expectedRevision: planned.revision,
    planVersion: planned.plan.planVersion,
    planHash: planned.plan.planHash,
  });
  assert.equal(result.outcome, "executed");
  assert.equal(
    calls.length,
    1,
    "the bridge called BudgetPolicyStore.set exactly once",
  );
  const [principal, projectId, draft] = calls[0] as [
    OperatorPrincipal,
    string,
    { dailyLimitUsd?: number; hardStop?: boolean },
  ];
  assert.equal(principal.id, "admin-1");
  assert.equal(typeof projectId, "string");
  assert.equal(draft.dailyLimitUsd, 5);
  assert.equal(draft.hardStop, true);
});

test("BRIDGE: a plan with NO budget limit configured bridges nothing — never a fabricated policy", async () => {
  const calls: unknown[] = [];
  const budgetPolicies = {
    set: async (...args: never[]) => {
      calls.push(args);
      return {} as BudgetPolicy;
    },
  };
  const { control } = setup(budgetPolicies);
  const planned = await planWithCost(control, undefined, "BBB1");
  const result = await control.onboardingApprovePlan(ADMIN, {
    id: planned.id,
    expectedRevision: planned.revision,
    planVersion: planned.plan.planVersion,
    planHash: planned.plan.planHash,
  });
  assert.equal(result.outcome, "executed");
  assert.equal(
    calls.length,
    0,
    "no limit was configured — the bridge must not invent one",
  );
});

test("BRIDGE: a bridging failure never undoes the onboarding approval that already succeeded", async () => {
  const budgetPolicies = {
    set: async (..._args: never[]) => {
      throw new Error("boom — the store is unavailable");
    },
  };
  const { control } = setup(budgetPolicies);
  const planned = await planWithCost(
    control,
    { dailyLimit: 5, warningThresholdPercent: 80, hardStop: true },
    "CCC1",
  );
  const result = await control.onboardingApprovePlan(ADMIN, {
    id: planned.id,
    expectedRevision: planned.revision,
    planVersion: planned.plan.planVersion,
    planHash: planned.plan.planHash,
  });
  assert.equal(
    result.outcome,
    "executed",
    "the approval itself still succeeded despite the bridge throwing",
  );
});

test("BRIDGE: with no BudgetPolicyStore injected at all, approval still works (backward compatible, no crash)", async () => {
  const { control } = setup(undefined);
  const planned = await planWithCost(
    control,
    { dailyLimit: 5, warningThresholdPercent: 80, hardStop: true },
    "DDD1",
  );
  const result = await control.onboardingApprovePlan(ADMIN, {
    id: planned.id,
    expectedRevision: planned.revision,
    planVersion: planned.plan.planVersion,
    planHash: planned.plan.planHash,
  });
  assert.equal(result.outcome, "executed");
});
