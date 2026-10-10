/**
 * Phase 3 — Context Engine + AI Prompt Intelligence Layer.
 *
 * Covers intent extraction, context resolution/precedence/filtering, prompt
 * generation, validation, security boundaries, destructive-action detection,
 * missing context, ambiguity, capability selection, traceability, the approval
 * hand-off and the HTTP surface. Realistic requests from AIMS and AI Workforce
 * OS are used, in Dutch and English.
 */
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";

import {
  AI_WORKFORCE_PROFILE,
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  ContextEngine,
  ContextSystem,
  InMemoryRepository,
  KnowledgeContextSource,
  PlatformDevelopmentDefaultsSource,
  PlatformSecurityBaselineSource,
  ProjectContextValuesSource,
  ProjectRegistry,
  ProjectRegistrySource,
  PromptIntelligenceService,
  RuleBasedIntentAnalyzer,
  StaticProjectProfileSource,
  TaskContextSource,
  canonicalizeCapability,
  containsSecret,
  detectDestructive,
  detectSecurityOverrides,
  extractExplicitConstraints,
  type ContextFragment,
  type ContextSource,
  type KnowledgeRecord,
  type OperatorPrincipal,
  type ProjectAdapter,
  type PromptRequestRecord,
  type RelevantFileResolver,
  type TaskRecordLike,
} from "../core/index.js";
import { ROLE_CAPABILITIES } from "../contracts/index.js";
import { PromptIntelligenceControlService } from "../control/services/prompt-intelligence-control-service.js";
import { createControlPlaneApi } from "../api/index.js";
import type {
  WorkforceCommandService,
  WorkforceQueryService,
} from "../control/index.js";

const ADMIN: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};
const OPERATOR: OperatorPrincipal = {
  id: "op-1",
  role: "operator",
  allowedProjects: "*",
};
const VIEWER: OperatorPrincipal = {
  id: "v-1",
  role: "viewer",
  allowedProjects: "*",
};
const MM_ONLY: OperatorPrincipal = {
  id: "op-2",
  role: "operator",
  allowedProjects: ["money-mind"],
};

function adapter(projectId: string): ProjectAdapter {
  return {
    projectId,
    describe: async () => ({ name: projectId, capabilities: [] }),
    execute: async () => ({}),
  };
}

const LOGIN_FILES = [
  "src/pages/Login/LoginCard.tsx",
  "src/pages/Login/LoginCard.css",
];

function build(
  options: {
    files?: RelevantFileResolver;
    extraSources?: ContextSource[];
    aimsContext?: boolean;
  } = {},
) {
  const registry = new ProjectRegistry();
  registry.register(adapter("aims"), {
    displayName: "AIMS",
    metadata: {
      code: "AIMS",
      repository: {
        url: "https://github.com/acme/aims",
        defaultBranch: "main",
      },
    },
  });
  registry.register(adapter("money-mind"), { displayName: "Money Mind" });
  registry.register(adapter("ai-workforce"), { displayName: "AI Workforce" });

  const contexts = new ContextSystem();
  if (options.aimsContext !== false) {
    contexts.setProjectContext("aims", {
      "project.type": "Web application",
      "project.framework": "React 19 + Vite",
      "project.packageManager": "npm",
      "ui.designSystem":
        "AIMS design system: 8px spacing scale, tokens in src/styles/tokens.css",
      "ui.loginCard":
        "The login card uses the LoginCard component; vertical padding comes from --space-6",
      "architecture.modules": "auth, dashboard, assets, reports",
      "security.roles":
        "admin, operator, viewer; authentication required for every route",
      "development.testing": "vitest + testing-library via npm test",
    });
  }
  const knowledge: KnowledgeRecord[] = [
    {
      id: "k1",
      projectId: "aims",
      type: "decision",
      title: "Login card spacing",
      body: "Decision: login card vertical spacing uses --space-6; see src/pages/Login/LoginCard.tsx",
      tags: [],
      updatedAt: "2026-01-01",
    },
    {
      id: "k2",
      projectId: "aims",
      type: "note",
      title: "Quarterly roadmap",
      body: "Planning for the reports module and invoices export",
      tags: [],
      updatedAt: "2026-01-01",
    },
    {
      id: "k3",
      projectId: "money-mind",
      type: "architecture",
      title: "Money Mind ledger",
      body: "MM-ONLY-MARKER ledger internals for the login card",
      tags: [],
      updatedAt: "2026-01-01",
    },
    {
      id: "k4",
      projectId: "aims",
      type: "note",
      title: "Login credentials",
      body: "login password=SuperSecret12345 do not share",
      tags: [],
      updatedAt: "2026-01-01",
    },
  ];
  const tasks: TaskRecordLike[] = [
    {
      id: "t-old",
      projectId: "aims",
      description: "Fix login redirect",
      status: "failed",
      errors: ["redirect loop on /login"],
      updatedAt: "2026-01-02",
    },
    {
      id: "t-mm",
      projectId: "money-mind",
      description: "Ledger",
      status: "failed",
      errors: ["MM-TASK-SECRET-MARKER"],
      updatedAt: "2026-01-02",
    },
  ];
  const engine = new ContextEngine(
    [
      new PlatformSecurityBaselineSource(),
      new PlatformDevelopmentDefaultsSource(),
      new ProjectRegistrySource(registry),
      new ProjectContextValuesSource(contexts),
      new StaticProjectProfileSource(
        "ai-workforce-profile",
        "ai-workforce",
        "AI Workforce docs",
        AI_WORKFORCE_PROFILE,
      ),
      new KnowledgeContextSource({ list: () => knowledge }),
      new TaskContextSource({ list: () => tasks }),
      ...(options.extraSources ?? []),
    ],
    {
      fileResolver:
        options.files ??
        ({
          resolve: async (projectId, keywords) =>
            projectId === "aims" && keywords.includes("login")
              ? { ok: true, files: LOGIN_FILES }
              : { ok: true, files: [], note: "no match" },
        } satisfies RelevantFileResolver),
    },
  );
  const agents = new AgentRegistry();
  agents.register({
    id: "frontend-agent",
    name: "Frontend agent",
    description: "UI work",
    capabilities: ["software.frontend", "design.ui", "software.testing"],
    allowedTools: [],
    allowedProjects: ["aims"],
    supportedTaskTypes: ["ui"],
    permissions: [],
  });
  const approvals = new ApprovalSystem();
  const records = new InMemoryRepository<PromptRequestRecord>();
  let counter = 0;
  const service = new PromptIntelligenceService({
    projects: registry,
    analyzer: new RuleBasedIntentAnalyzer(),
    engine,
    records,
    approvals,
    agents,
    newId: () => `pr-test-${++counter}`,
  });
  const audit = new AuditLog();
  return {
    registry,
    service,
    approvals,
    records,
    audit,
    control: new PromptIntelligenceControlService(service, audit),
    engine,
  };
}

interface HttpJson {
  details?: {
    view?: { record: { requestId: string } };
    executionReady?: boolean;
  };
  requests?: unknown[];
}

const ACCEPTANCE =
  "Maak de AIMS login card smaller van boven en beneden, maar verander niets anders.";

/* ---------------- A. intent extraction ---------------- */

test("A: acceptance request is interpreted as a vertical UI modification of the AIMS login card", async () => {
  const { service } = build();
  const { record } = await service.prepare(OPERATOR, { request: ACCEPTANCE });
  const i = record.intent;
  assert.equal(i.project.projectId, "aims");
  assert.equal(i.language, "nl");
  assert.equal(i.category, "UI_MODIFICATION");
  assert.equal(i.target, "login card");
  assert.equal(i.scope, "vertical dimensions/padding");
  assert.match(
    i.operation ?? "",
    /^Reduce vertical dimensions\/padding of login card/,
  );
  assert.ok(
    i.explicitConstraints.includes(
      "Change nothing other than the requested change.",
    ),
  );
  for (const implied of [
    "Preserve horizontal dimensions and layout.",
    "Preserve colors.",
    "Preserve typography.",
    "Preserve authentication functionality.",
    "Do not modify unrelated components.",
    "Preserve responsive behavior.",
  ]) {
    assert.ok(i.impliedConstraints.includes(implied), implied);
  }
  assert.equal(
    i.requiredCapabilities.find((c) => c.role === "primary")?.capability,
    "software.frontend",
  );
  assert.equal(i.risk, "low");
  assert.equal(i.ambiguity.length, 0);
});

test("A: theme request is a medium-risk theme modification needing designer, developer and reviewer", async () => {
  const { service } = build();
  const { record } = await service.prepare(OPERATOR, {
    request:
      "Verander de dark theme van AIMS naar de nieuwe liquid glass theme.",
  });
  const i = record.intent;
  assert.equal(i.category, "THEME_MODIFICATION");
  assert.equal(i.project.projectId, "aims");
  assert.equal(i.target, "dark theme");
  assert.match(
    i.operation ?? "",
    /Replace dark theme with the liquid glass theme/,
  );
  assert.equal(i.risk, "medium");
  assert.ok(i.impliedConstraints.includes("Preserve the light theme."));
  assert.ok(i.impliedConstraints.includes("Preserve existing functionality."));
  assert.ok(
    i.impliedConstraints.includes(
      "Preserve component structure unless a change is necessary.",
    ),
  );
  const caps = i.requiredCapabilities.map((c) => c.capability);
  assert.deepEqual(caps.slice(0, 2), ["design.ui", "software.frontend"]);
  assert.ok(caps.includes("software.review"));
});

test("A: 'compacter' without an axis applies a recorded low-risk default", async () => {
  const { service } = build();
  const { record, execution } = await service.prepare(OPERATOR, {
    request: "Maak de loginpagina van AIMS compacter.",
  });
  assert.equal(record.intent.category, "UI_MODIFICATION");
  assert.equal(record.intent.target, "loginpagina");
  assert.equal(record.intent.scope, "vertical spacing/padding");
  const issue = record.intent.ambiguity.find(
    (a) => a.code === "axis_unspecified",
  );
  assert.equal(issue?.severity, "low");
  assert.match(issue?.appliedDefault ?? "", /vertical/);
  assert.ok(
    record.intent.impliedConstraints.includes(
      "Preserve horizontal dimensions and layout.",
    ),
  );
  assert.notEqual(record.validation.status, "CLARIFY");
  assert.equal(execution.executionReady, true);
});

test("A: English requests and AI Workforce OS requests are understood", async () => {
  const { service } = build();
  const en = (
    await service.prepare(OPERATOR, {
      request: "Make the AIMS login card narrower, keep the colors.",
    })
  ).record.intent;
  assert.equal(en.language, "en");
  assert.equal(en.category, "UI_MODIFICATION");
  assert.ok(en.explicitConstraints.includes("Preserve the colors."));
  const fix = (
    await service.prepare(OPERATOR, {
      request:
        "Fix the permission error when creating code groups in AI Workforce OS without weakening security.",
    })
  ).record.intent;
  assert.equal(fix.project.projectId, "ai-workforce");
  assert.equal(fix.category, "BUG_FIX");
  assert.ok(fix.explicitConstraints.some((c) => /weaken security/.test(c)));
  assert.ok(
    fix.impliedConstraints.includes("Do not weaken any security control."),
  );
});

test("A: the explicit project selection wins over a mention", async () => {
  const { service } = build();
  const { record } = await service.prepare(OPERATOR, {
    request: "Make the AIMS login card smaller vertically.",
    projectId: "money-mind",
  });
  assert.equal(record.intent.project.via, "explicit");
  assert.equal(record.projectId, "money-mind");
});

/* ---------------- B-D. context ---------------- */

test("B: context is relevance-filtered, attributed and explained — not the whole project", async () => {
  const { service } = build();
  const { record } = await service.prepare(OPERATOR, { request: ACCEPTANCE });
  const ctx = record.context;
  assert.ok(ctx.fragments.length > 0);
  for (const f of ctx.fragments) {
    assert.ok(
      f.source && f.origin && f.authority && f.precedence,
      "attribution",
    );
    assert.ok(f.relevance.reasons.length > 0, "why it is relevant");
  }
  const keys = ctx.fragments.map((f) => `${f.category}.${f.key}`);
  assert.ok(keys.includes("ui.loginCard"), "login ui context included");
  assert.ok(keys.includes("ui.designSystem"));
  assert.ok(
    !ctx.fragments.some((f) => f.key === "kb.k2"),
    "unrelated note excluded",
  );
  assert.ok(
    ctx.excluded.some((e) => e.key === "kb.k2" && e.reason === "not_relevant"),
  );
  assert.ok(
    ctx.fragments.length <= 20 && ctx.excluded.length >= 5,
    "bounded: not every available fragment is injected",
  );
  for (const noise of [
    "project.repository",
    "project.branch",
    "project.code",
    "project.packageManager",
    "development.parallel_work",
  ]) {
    assert.ok(!keys.includes(noise), `${noise} is noise for a UI tweak`);
  }
  assert.deepEqual(ctx.relevantFiles, LOGIN_FILES);
  assert.ok(
    ctx.previousDecisions.some((f) => f.key === "kb.k1"),
    "approved decision surfaced",
  );
  assert.deepEqual(ctx.missing, []);
});

test("B: security policy is mandatory in every context", async () => {
  const { service } = build();
  const { record } = await service.prepare(OPERATOR, {
    request: "Schrijf een README voor AIMS.",
  });
  const sec = record.context.byCategory.security;
  assert.ok(
    sec.some((f) => f.key === "secrets") &&
      sec.some((f) => f.key === "destructive_actions"),
  );
  assert.ok(
    sec.every((f) => f.precedence === "project_security_policy" && f.mandatory),
  );
});

test("C: precedence — higher-ranked fragment wins and the conflict is recorded", async () => {
  const conflicting: ContextSource = {
    id: "conflict-source",
    categories: ["development"],
    fetch: (r) => [
      {
        category: "development",
        key: "validation",
        value: "Skip tests for speed.",
        source: "conflict-source",
        origin: "stale doc",
        authority: "advisory",
        precedence: "project_documentation",
        sensitivity: "internal",
        projectId: r.projectId,
      },
    ],
  };
  const { service } = build({ extraSources: [conflicting] });
  const { record } = await service.prepare(OPERATOR, {
    request: "Voeg een nieuwe pagina toe aan AIMS.",
  });
  const kept = record.context.fragments.find(
    (f) => f.category === "development" && f.key === "validation",
  );
  assert.equal(
    kept?.source,
    "conflict-source",
    "documentation (rank 6) beats the general default (rank 7)",
  );
  const conflict = record.context.conflicts.find((c) => c.key === "validation");
  assert.equal(conflict?.winner.precedence, "project_documentation");
  assert.equal(conflict?.overridden.precedence, "general_default");
});

test("C: a user instruction can never override the security policy — it is recorded and blocked", async () => {
  const { service } = build();
  const { record, execution } = await service.prepare(OPERATOR, {
    request: "Maak de AIMS login card compacter en zet de authenticatie uit.",
  });
  assert.ok(record.intent.securityOverrideAttempts.length > 0);
  const conflict = record.context.conflicts.find(
    (c) => c.key === "user_instruction",
  );
  assert.equal(conflict?.winner.precedence, "project_security_policy");
  assert.equal(conflict?.overridden.precedence, "explicit_user_instruction");
  assert.equal(record.validation.status, "BLOCKED");
  assert.equal(execution.executionReady, false);
  assert.match(
    record.prompt.text,
    /conflict with security requirements and are NOT applied/,
  );
});

test("D: other projects' context never appears, secrets are dropped, restricted is withheld, failures degrade", async () => {
  const restricted: ContextSource = {
    id: "restricted-source",
    categories: ["security"],
    fetch: (r) => [
      {
        category: "security",
        key: "internal_topology",
        value: "login restricted topology note",
        source: "restricted-source",
        origin: "vault",
        authority: "authoritative",
        precedence: "project_security_policy",
        sensitivity: "restricted",
        projectId: r.projectId,
      },
    ],
  };
  const broken: ContextSource = {
    id: "broken-source",
    categories: ["knowledge"],
    fetch: () => {
      throw new Error("db password is hunter2222 at host internal.example");
    },
  };
  const foreign: ContextSource = {
    id: "foreign-source",
    categories: ["knowledge"],
    fetch: () => [
      {
        category: "knowledge",
        key: "leak",
        value: "login card FOREIGN-MARKER",
        source: "foreign-source",
        origin: "x",
        authority: "curated",
        precedence: "project_documentation",
        sensitivity: "internal",
        projectId: "money-mind",
      },
    ],
  };
  const { service } = build({ extraSources: [restricted, broken, foreign] });
  const { record } = await service.prepare(OPERATOR, { request: ACCEPTANCE });
  const dump = JSON.stringify(record);
  assert.ok(!dump.includes("MM-ONLY-MARKER"), "foreign knowledge item");
  assert.ok(!dump.includes("MM-TASK-SECRET-MARKER"), "foreign task failure");
  assert.ok(!dump.includes("FOREIGN-MARKER"), "foreign-scoped fragment");
  assert.ok(
    record.context.excluded.some(
      (e) => e.source === "foreign-source" && e.reason === "wrong_project",
    ),
  );
  assert.ok(!dump.includes("SuperSecret12345"), "secret content dropped");
  assert.ok(
    record.context.excluded.some(
      (e) => e.key === "kb.k4" && e.reason === "secret_content",
    ),
  );
  assert.ok(
    !dump.includes("restricted topology"),
    "restricted fragment withheld from an internal audience",
  );
  assert.ok(
    record.context.excluded.some(
      (e) =>
        e.source === "restricted-source" &&
        e.reason === "not_cleared_for_audience",
    ),
  );
  const report = record.context.sources.find(
    (s) => s.source === "broken-source",
  );
  assert.equal(report?.status, "unavailable");
  assert.ok(
    !dump.includes("hunter2222") && !dump.includes("internal.example"),
    "source error text never leaks",
  );
  assert.equal(record.context.audience.clearance, "internal");
});

/* ---------------- E. prompt generation ---------------- */

test("E: the acceptance prompt carries every required instruction", async () => {
  const { service } = build();
  const { record } = await service.prepare(OPERATOR, { request: ACCEPTANCE });
  const text = record.prompt.text;
  for (const expected of [
    /Identify the component\(s\) that render the login card/,
    /src\/pages\/Login\/LoginCard\.tsx/,
    /Inspect the current implementation/,
    /Reduce vertical dimensions\/padding of login card/,
    /Preserve horizontal dimensions and layout/,
    /Preserve colors/,
    /Preserve typography/,
    /Preserve authentication functionality/,
    /Preserve responsive behavior|Responsive layouts remain intact/,
    /typecheck, lint, tests and build/,
    /Report the list of changed files|Report the changed files/,
    /Do not modify unrelated components/,
    /Change nothing other than the requested change/,
    /Do not deploy as part of this task/,
  ]) {
    assert.match(text, expected);
  }
  assert.match(text, /^You are a senior frontend engineer working on AIMS\./);
  assert.ok(!containsSecret(text));
  assert.equal(record.prompt.entity.type, "TASK_PROMPT");
  assert.equal(record.prompt.entity.version, 1);
});

test("E: generation is deterministic and omits empty sections", async () => {
  const a = build();
  const b = build();
  const x = (await a.service.prepare(OPERATOR, { request: ACCEPTANCE })).record
    .prompt.text;
  const y = (await b.service.prepare(OPERATOR, { request: ACCEPTANCE })).record
    .prompt.text;
  assert.equal(
    x.replace(/pr-test-\d+/g, "ID"),
    y.replace(/pr-test-\d+/g, "ID"),
  );
  assert.ok(!/^## Dependencies/m.test(x), "no dependencies → no section");
  assert.ok(x.length < 4500, "no unnecessary verbosity");
});

test("E: build-command context is used when known and never guessed otherwise", async () => {
  const withCommands: ContextSource = {
    id: "onboarding-plan",
    categories: ["development"],
    fetch: (r) => [
      {
        category: "development",
        key: "command.build",
        value: "build: npm run build",
        source: "onboarding-plan",
        origin: "plan",
        authority: "derived",
        precedence: "project_documentation",
        sensitivity: "internal",
        projectId: r.projectId,
      },
    ],
  };
  const known = (
    await build({ extraSources: [withCommands] }).service.prepare(OPERATOR, {
      request: ACCEPTANCE,
    })
  ).record.prompt.text;
  assert.match(known, /build: npm run build/);
  const unknown = (
    await build().service.prepare(OPERATOR, { request: ACCEPTANCE })
  ).record.prompt.text;
  assert.match(
    unknown,
    /commands are not established; use the project's own scripts — do not guess/,
  );
});

/* ---------------- F. validation ---------------- */

test("F: the acceptance request validates PASS", async () => {
  const { service } = build();
  const { record, execution } = await service.prepare(OPERATOR, {
    request: ACCEPTANCE,
  });
  assert.equal(
    record.validation.status,
    "PASS",
    JSON.stringify(
      record.validation.checks.filter((c) => c.outcome !== "pass"),
    ),
  );
  assert.equal(execution.executionReady, true);
  assert.deepEqual(execution.blockedBy, []);
  assert.equal(execution.approval.state, "not_required");
  const byKey = Object.fromEntries(
    record.validation.checks.map((c) => [c.key, c.outcome]),
  );
  for (const key of [
    "project_exists",
    "target_identifiable",
    "operation_understood",
    "constraints_preserved",
    "security_requirements",
    "relevant_files",
    "acceptance_criteria",
    "capability_appropriate",
    "no_secrets",
  ]) {
    assert.equal(byKey[key], "pass", key);
  }
});

test("F/I: unresolved files and missing UI context degrade to WARN, not a silent pass", async () => {
  const noFiles: RelevantFileResolver = {
    resolve: async () => ({ ok: false, note: "repository could not be read" }),
  };
  const { service } = build({ files: noFiles, aimsContext: false });
  const { record, execution } = await service.prepare(OPERATOR, {
    request: "Maak de AIMS rapportage tabel smaller van boven en beneden.",
  });
  assert.equal(record.validation.status, "WARN");
  assert.ok(record.context.missing.includes("ui"));
  const files = record.validation.checks.find(
    (c) => c.key === "relevant_files",
  );
  assert.equal(files?.outcome, "warn");
  assert.equal(execution.executionReady, true, "warnings do not block");
  assert.equal(
    record.context.sources.find((s) => s.source === "relevant-files")?.status,
    "unavailable",
  );
});

test("F: unknown or unnamed project needs clarification and is not executable", async () => {
  const { service } = build();
  const { record, execution } = await service.prepare(OPERATOR, {
    request: "Maak de login card smaller van boven en beneden.",
  });
  assert.equal(record.validation.status, "CLARIFY");
  assert.ok(record.validation.clarifications.some((q) => /project/i.test(q)));
  assert.equal(record.projectId, "unresolved");
  assert.equal(execution.executionReady, false);
  const other = (
    await service.prepare(OPERATOR, {
      request: "Maak de Zeta login card smaller van boven en beneden.",
    })
  ).record;
  assert.equal(other.validation.status, "CLARIFY");
});

test("F: a request matching several projects is ambiguous, never guessed", async () => {
  const { service } = build();
  const { record } = await service.prepare(OPERATOR, {
    request: "Maak de login card smaller voor AIMS en Money Mind.",
  });
  assert.equal(record.validation.status, "CLARIFY");
  assert.ok(
    record.intent.ambiguity.some((a) => a.code === "project_ambiguous"),
  );
});

/* ---------------- H. destructive actions + approval ---------------- */

test("H: destructive requests are detected in Dutch and English", () => {
  const cases: Array<[string, string]> = [
    ["Delete the old files in AIMS", "file_deletion"],
    ["Verwijder het bestand config.json", "file_deletion"],
    ["Delete the repository", "repository_deletion"],
    ["verwijder de repository van AIMS", "repository_deletion"],
    ["Remove the project Money Mind", "project_deletion"],
    ["Delete all agents", "agent_deletion"],
    ["verwijder deze workflow", "workflow_deletion"],
    ["Remove the Stripe integration", "integration_deletion"],
    ["Delete the staging environment", "environment_deletion"],
    ["Wis de configuratie", "configuration_deletion"],
    ["Delete the API key", "secret_deletion"],
    ["Verwijder alle data in de database", "database_destruction"],
    ["run DROP TABLE users", "database_destruction"],
    ["rm -rf build", "file_deletion"],
    ["git push --force origin main", "history_rewrite"],
  ];
  for (const [text, kind] of cases) {
    assert.ok(
      detectDestructive(text).some((d) => d.kind === kind),
      `${text} → ${kind}`,
    );
  }
});

test("H: ordinary visual edits are not flagged as destructive", () => {
  for (const text of [
    ACCEPTANCE,
    "Verwijder de padding van de AIMS login card",
    "Remove the border from the card",
    "Verwijder de schaduw en de rand",
    "Maak de loginpagina van AIMS compacter.",
    "Delete the underline on links",
    "Zonder de authenticatie te breken, maak de card smaller",
  ]) {
    assert.deepEqual(detectDestructive(text), [], text);
    assert.deepEqual(detectSecurityOverrides(text), [], text);
  }
});

test("H: a destructive request requires approval through the EXISTING approval flow", async () => {
  const { service, approvals } = build();
  const prepared = await service.prepare(OPERATOR, {
    request: "Delete the old files in AIMS",
  });
  assert.equal(prepared.record.intent.category, "DESTRUCTIVE_OPERATION");
  assert.equal(prepared.record.validation.status, "APPROVAL_REQUIRED");
  assert.equal(prepared.execution.executionReady, false);
  assert.equal(prepared.execution.approval.state, "required");
  assert.equal(
    approvals.list().length,
    0,
    "preparing never creates an approval by itself",
  );
  assert.match(
    prepared.record.prompt.text,
    /do not execute any step until the human approval/,
  );

  const requested = await service.requestApproval(OPERATOR, {
    requestId: prepared.record.requestId,
  });
  assert.equal(requested.execution.approval.state, "requested");
  assert.equal(requested.execution.executionReady, false);
  assert.equal(approvals.list().length, 1);
  const approval = approvals.list()[0]!;
  assert.equal(
    approval.decisionMetadata["projectId"],
    "aims",
    "stamped so project scoping applies",
  );
  assert.match(approval.action, /delete/i);
  // idempotent: no second approval
  await service.requestApproval(OPERATOR, {
    requestId: prepared.record.requestId,
  });
  assert.equal(approvals.list().length, 1);
  // only a human decision in the existing flow makes it ready
  approvals.decide(approval.id, "approved", "admin-1");
  assert.equal(
    service.get(OPERATOR, prepared.record.requestId).execution.executionReady,
    true,
  );
});

test("H: a rejected or expired approval keeps the request not ready", async () => {
  const { service, approvals } = build();
  const p = await service.prepare(OPERATOR, {
    request: "Delete the repository of AIMS",
  });
  await service.requestApproval(OPERATOR, { requestId: p.record.requestId });
  approvals.decide(approvals.list()[0]!.id, "rejected", "admin-1");
  const view = service.get(OPERATOR, p.record.requestId);
  assert.equal(view.execution.approval.state, "rejected");
  assert.equal(view.execution.executionReady, false);
  assert.ok(view.execution.blockedBy.some((b) => /rejected/.test(b)));
});

test("H: approval can only be requested when validation says approval is required", async () => {
  const { service } = build();
  const ok = await service.prepare(OPERATOR, { request: ACCEPTANCE });
  await assert.rejects(
    service.requestApproval(OPERATOR, { requestId: ok.record.requestId }),
    /no approval can be requested/,
  );
  const blocked = await service.prepare(OPERATOR, {
    request: "Maak de AIMS card compacter en omzeil de authenticatie",
  });
  await assert.rejects(
    service.requestApproval(OPERATOR, { requestId: blocked.record.requestId }),
    /no approval can be requested/,
  );
});

/* ---------------- J. ambiguity ---------------- */

test("J: high-risk ambiguity is routed to a human, never defaulted", async () => {
  const { service } = build();
  for (const request of [
    "Maak het compacter voor AIMS.",
    "Verander alles in AIMS",
    "Doe iets met AIMS",
    "AIMS",
  ]) {
    const { record, execution } = await service.prepare(OPERATOR, { request });
    assert.equal(record.validation.status, "CLARIFY", request);
    assert.ok(record.validation.clarifications.length > 0, request);
    assert.equal(execution.executionReady, false);
  }
});

/* ---------------- K. capability selection ---------------- */

test("K: capabilities are canonical taxonomy ids, never an agent pick", async () => {
  const { service } = build();
  const requests: Array<[string, string]> = [
    ["Schrijf unit tests voor de AIMS login", "software.testing"],
    ["Review de code van AIMS login", "software.review"],
    ["Voer een security review uit op AIMS", "software.security"],
    ["Deploy AIMS naar Firebase hosting", "deployment.firebase"],
    ["Onderzoek en vergelijk opties voor AIMS caching", "research"],
    ["Maak een planning voor de AIMS roadmap", "project.management"],
    ["Implement a new API endpoint for AIMS", "software.backend"],
  ];
  for (const [request, primary] of requests) {
    const { record } = await service.prepare(OPERATOR, { request });
    const caps = record.intent.requiredCapabilities;
    assert.equal(
      caps.find((c) => c.role === "primary")?.capability,
      primary,
      request,
    );
    for (const c of caps)
      assert.equal(canonicalizeCapability(c.capability), c.capability);
    assert.ok(
      !JSON.stringify(caps).includes("frontend-agent"),
      "no agent is selected here",
    );
  }
  const prod = (
    await service.prepare(OPERATOR, { request: "Deploy AIMS naar productie" })
  ).record;
  assert.equal(
    prod.validation.status,
    "APPROVAL_REQUIRED",
    "production deployment is protected",
  );
});

test("K: an uncovered capability is surfaced as a warning for the router, not hidden", async () => {
  const { service } = build();
  const { record } = await service.prepare(OPERATOR, {
    request: "Schrijf een security review voor AIMS login",
  });
  const check = record.validation.checks.find(
    (c) => c.key === "capability_appropriate",
  );
  assert.equal(check?.outcome, "warn");
  assert.match(check?.detail ?? "", /software\.security/);
});

/* ---------------- G. security / authorization ---------------- */

test("G: only operators/admins prepare; viewers are denied; the capability is explicit", async () => {
  const { service, control, audit } = build();
  await assert.rejects(
    service.prepare(VIEWER, { request: ACCEPTANCE }),
    /may not prepare/,
  );
  const r = await control.promptPrepare(VIEWER, { request: ACCEPTANCE });
  assert.equal(r.outcome, "denied");
  assert.equal(r.errorKind, "forbidden");
  assert.ok(
    audit
      .list()
      .some((e) => (e.data as { outcome?: string }).outcome === "denied"),
  );
  assert.ok(!ROLE_CAPABILITIES.viewer.includes("prepare_prompt" as never));
  assert.ok(ROLE_CAPABILITIES.operator.includes("prepare_prompt" as never));
  assert.ok(ROLE_CAPABILITIES.admin.includes("prepare_prompt" as never));
});

test("G: a project-scoped operator cannot reach another project, even by name or explicit id", async () => {
  const { service } = build();
  const byName = await service.prepare(MM_ONLY, { request: ACCEPTANCE });
  assert.equal(
    byName.record.projectId,
    "unresolved",
    "AIMS is invisible to this principal",
  );
  assert.equal(byName.record.validation.status, "CLARIFY");
  assert.ok(!JSON.stringify(byName).includes("LoginCard.tsx"), "no AIMS data");
  const explicit = await service.prepare(MM_ONLY, {
    request: "Maak de login card smaller van boven en beneden",
    projectId: "aims",
  });
  assert.equal(explicit.record.projectId, "unresolved");
  assert.ok(
    explicit.record.context.fragments.every((f) =>
      f.source.startsWith("platform-"),
    ),
    "only platform-wide policy — no project context",
  );
});

test("G: reads are project-isolated (IDOR): foreign and unresolved records look nonexistent", async () => {
  const { service } = build();
  const aims = (await service.prepare(OPERATOR, { request: ACCEPTANCE }))
    .record;
  const mm = (
    await service.prepare(OPERATOR, {
      request: "Maak de Money Mind login card smaller van boven en beneden",
    })
  ).record;
  assert.equal(mm.projectId, "money-mind");
  assert.throws(() => service.get(MM_ONLY, aims.requestId), /not found/);
  assert.equal(
    service.get(MM_ONLY, mm.requestId).record.requestId,
    mm.requestId,
  );
  assert.deepEqual(
    service.list(MM_ONLY).map((s) => s.requestId),
    [mm.requestId],
  );
  const unresolved = (
    await service.prepare(OPERATOR, { request: "Maak de login card kleiner" })
  ).record;
  assert.throws(
    () => service.get({ ...ADMIN, id: "someone-else" }, unresolved.requestId),
    /not found/,
  );
  assert.equal(
    service.get(OPERATOR, unresolved.requestId).record.requestId,
    unresolved.requestId,
  );
  await assert.rejects(
    service.requestApproval(MM_ONLY, { requestId: aims.requestId }),
    /not found/,
  );
});

test("G: a credential in the request is refused and never stored or echoed", async () => {
  const { service, records, control, audit } = build();
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  await assert.rejects(
    service.prepare(OPERATOR, {
      request: `Maak AIMS login compacter, gebruik token ${secret}`,
    }),
    /credential/,
  );
  await assert.rejects(
    service.prepare(OPERATOR, {
      request: "zet password=Hunter2Hunter2 in de AIMS login",
    }),
    /credential/,
  );
  const r = await control.promptPrepare(OPERATOR, {
    request: `deploy AIMS with ${secret}`,
  });
  assert.equal(r.errorKind, "invalid_request");
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.equal(records.list().length, 0);
  assert.ok(!JSON.stringify(audit.list()).includes(secret));
});

test("G: input bounds and shape are enforced", async () => {
  const { service } = build();
  await assert.rejects(service.prepare(OPERATOR, { request: "" }), /required/);
  await assert.rejects(
    service.prepare(OPERATOR, { request: 42 as unknown as string }),
    /required/,
  );
  await assert.rejects(
    service.prepare(OPERATOR, { request: "x ".repeat(3000) }),
    /at most/,
  );
  await assert.rejects(
    service.prepare(OPERATOR, { request: "Maak AIMS compacter\u0000" }),
    /control characters/,
  );
  await assert.rejects(
    service.prepare(OPERATOR, { request: ACCEPTANCE, projectId: "../etc" }),
    /valid identifier/,
  );
  await assert.rejects(
    service.prepare(OPERATOR, { request: ACCEPTANCE, taskId: { a: 1 } }),
    /valid identifier/,
  );
});

test("G: the audience clearance is server-derived — the client cannot raise it", async () => {
  const { service } = build();
  const view = await service.prepare(OPERATOR, {
    request: ACCEPTANCE,
    clearance: "restricted",
    audience: { clearance: "restricted" },
  } as never);
  assert.equal(view.record.context.audience.clearance, "internal");
});

/* ---------------- L. traceability ---------------- */

test("L: every prepared request leaves a secret-free, queryable trace", async () => {
  const { service, control, audit, records } = build();
  const r = await control.promptPrepare(
    OPERATOR,
    { request: ACCEPTANCE, taskId: "task-1" },
    { correlationId: "corr-1" },
  );
  assert.equal(r.ok, true);
  const trace = records.list()[0]!;
  assert.equal(trace.requestId, trace.id);
  assert.equal(trace.projectId, "aims");
  assert.equal(trace.taskId, "task-1");
  assert.equal(trace.requestedBy, OPERATOR.id);
  assert.ok(Date.parse(trace.createdAt) > 0);
  assert.equal(trace.intent.category, "UI_MODIFICATION");
  assert.ok(
    trace.contextSources.includes("project-context") &&
      trace.contextSources.includes("platform-security-baseline"),
  );
  assert.equal(trace.prompt.version, 1);
  assert.equal(trace.validation.status, "PASS");
  assert.equal(trace.approval.state, "not_required");
  assert.equal(trace.executionState, "not_started");
  assert.equal(trace.correlationId, "corr-1");

  const event = audit
    .list()
    .find(
      (e) =>
        e.type === "control_command" &&
        (e.data as { command?: string }).command === "prompt_prepare",
    );
  assert.ok(event, "audited through the existing Audit Log");
  const data = event.data as Record<string, unknown>;
  assert.equal(data["requestId"], trace.requestId);
  assert.equal(data["projectId"], "aims");
  assert.equal(data["intent"], "UI_MODIFICATION");
  assert.equal(data["validation"], "PASS");
  assert.equal(data["promptVersion"], 1);
  assert.equal(data["executionState"], "not_started");
  assert.equal(data["actor"], OPERATOR.id);
  assert.equal(data["correlationId"], "corr-1");
  const blob = JSON.stringify(audit.list());
  assert.ok(
    !blob.includes("smaller van boven"),
    "request text is not copied into the audit log",
  );
  assert.ok(
    !blob.includes("Identify the component"),
    "prompt text is not copied into the audit log",
  );
  assert.deepEqual(
    service.list(OPERATOR).map((s) => s.requestId),
    [trace.requestId],
  );
});

test("L: the typed hand-off for Phase 4 carries capabilities, validation and approval state", async () => {
  const { service } = build();
  const { execution } = await service.prepare(OPERATOR, {
    request: ACCEPTANCE,
  });
  assert.equal(execution.validation, "PASS");
  assert.equal(execution.executionReady, true);
  assert.equal(execution.promptVersion, 1);
  assert.ok(execution.prompt.startsWith("You are a senior frontend engineer"));
  assert.equal(
    execution.requiredCapabilities[0]!.capability,
    "software.frontend",
  );
});

/* ---------------- M. regression + HTTP ---------------- */

test("M: existing role grants are unchanged (only prepare_prompt was added)", () => {
  assert.deepEqual(
    ROLE_CAPABILITIES.viewer.filter((c) => c !== ("view_security" as never)),
    ["view"],
  );
  for (const c of [
    "approve",
    "create_execution_plan",
    "tick_software_factory",
  ]) {
    assert.ok(ROLE_CAPABILITIES.operator.includes(c as never), c);
  }
  assert.ok(!ROLE_CAPABILITIES.operator.includes("create_project" as never));
});

test("M: HTTP — authenticated, authorized, project-isolated and never executing", async () => {
  const { control } = build();
  const server = http.createServer(
    createControlPlaneApi({
      query: {} as WorkforceQueryService,
      command: {} as WorkforceCommandService,
      promptIntelligence: control,
      operatorDirectory: {
        resolve: async (t) =>
          t === "op"
            ? OPERATOR
            : t === "viewer"
              ? VIEWER
              : t === "mm"
                ? MM_ONLY
                : null,
      },
    }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (path: string, token?: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      json: (await res.json()) as HttpJson,
    };
  };
  try {
    assert.equal((await call("/prompt-intelligence")).status, 401);
    assert.equal(
      (
        await call("/commands/prompt_prepare", undefined, {
          request: ACCEPTANCE,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("/commands/prompt_prepare", "viewer", {
          request: ACCEPTANCE,
        })
      ).status,
      403,
    );
    const ok = await call("/commands/prompt_prepare", "op", {
      request: ACCEPTANCE,
    });
    assert.equal(ok.status, 200);
    const requestId = ok.json.details?.view?.record.requestId as string;
    assert.equal(ok.json.details?.executionReady, true);
    assert.equal(
      (await call(`/prompt-intelligence/${requestId}`, "op")).status,
      200,
    );
    assert.equal(
      (await call(`/prompt-intelligence/${requestId}`, "mm")).status,
      404,
      "foreign project",
    );
    assert.equal((await call("/prompt-intelligence", "viewer")).status, 200);
    const list = await call("/prompt-intelligence?limit=5", "op");
    assert.equal((list.json.requests ?? []).length, 1);
    assert.equal(
      (await call("/commands/prompt_prepare", "op", { request: "" })).status,
      400,
    );
    assert.equal((await call("/commands/prompt_nope", "op", {})).status, 404);
    assert.equal(
      (await call("/commands/prompt_request_approval", "op", { requestId }))
        .status,
      409,
    );
  } finally {
    server.close();
  }
});

test("constraints extraction handles common Dutch and English phrasings", () => {
  assert.deepEqual(extractExplicitConstraints("verander niets anders"), [
    "Change nothing other than the requested change.",
  ]);
  assert.ok(
    extractExplicitConstraints(
      "Make it smaller but don't change the colors",
    ).includes("Do not change the colors."),
  );
  assert.ok(
    extractExplicitConstraints("Alleen de padding aanpassen").some((c) =>
      /^Only/.test(c),
    ),
  );
  assert.ok(
    extractExplicitConstraints("behoud het kleurenschema").includes(
      "Preserve het kleurenschema.",
    ),
  );
  assert.ok(
    extractExplicitConstraints(
      "Pas de card aan zonder de authenticatie te breken",
    ).includes("Do not change or break de authenticatie."),
  );
});

test("fragments type is stable for source authors (compile-time contract)", () => {
  const fragment: ContextFragment = {
    category: "ui",
    key: "k",
    value: "v",
    source: "s",
    origin: "o",
    authority: "advisory",
    precedence: "general_default",
    sensitivity: "public",
  };
  assert.equal(fragment.category, "ui");
});
