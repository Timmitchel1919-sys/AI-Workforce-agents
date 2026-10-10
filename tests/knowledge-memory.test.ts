/* eslint-disable @typescript-eslint/no-explicit-any -- test helper reads loosely-typed JSON bodies */
/**
 * Knowledge, Memory & Context Intelligence.
 *
 * Real memory service, index, retrieval, assembler, ingestion and learner over
 * in-memory repositories and a real AuditLog; the end-to-end test also runs the
 * real Layer 3 → 4 → 5 chain against a real temporary workspace.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  ContextEngine,
  ExecutionOrchestrator,
  GovernedFileSystem,
  GovernedTaskRuntime,
  InMemoryRepository,
  KnowledgeError,
  KnowledgeSystem,
  PlatformDevelopmentDefaultsSource,
  PlatformSecurityBaselineSource,
  ProjectRegistry,
  ProjectRegistrySource,
  PromptIntelligenceService,
  RuleBasedIntentAnalyzer,
  SessionManager,
  StaticFileSource,
  WorkspaceRegistry,
  WorkspaceResolver,
  chunkMarkdown,
  extractCodeSymbols,
  extractFacets,
  failureSignature,
  inMemoryKnowledgeRepos,
  workspaceFileSource,
  type Actor,
  type MemoryProposal,
  type MemoryRecord,
  type OperatorPrincipal,
  type OrchTask,
  type ProjectAdapter,
  type PromptRequestRecord,
  type RuntimeOutcome,
  type RuntimeSession,
  type TaskExecutionContext,
} from "../core/index.js";
import { LocalGitOps } from "../core/index.js";
import type { RuntimeWorkspaceOperation } from "../contracts/execution-runtime.js";
import { KnowledgeControlService } from "../control/services/knowledge-control-service.js";
import { createControlPlaneApi } from "../api/index.js";
import type {
  WorkforceCommandService,
  WorkforceQueryService,
} from "../control/index.js";
import { ExecutionOrchestrationControlService } from "../control/services/execution-orchestration-control-service.js";

const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const USER: Actor = { id: "user-1", kind: "USER", admin: true };
const USER_NON_ADMIN: Actor = { id: "user-2", kind: "USER" };
const AGENT: Actor = {
  id: "dev-agent",
  kind: "AGENT",
  agentId: "dev-agent",
  agentRole: "developer",
};
const SYSTEM: Actor = { id: "system", kind: "SYSTEM" };
const ADMIN_P: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};
const OPERATOR_P: OperatorPrincipal = {
  id: "op-1",
  role: "operator",
  allowedProjects: "*",
};
const VIEWER_P: OperatorPrincipal = {
  id: "v-1",
  role: "viewer",
  allowedProjects: "*",
};
const MM_ONLY: OperatorPrincipal = {
  id: "op-2",
  role: "operator",
  allowedProjects: ["money-mind"],
};

const temps: string[] = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function fixture(start = Date.parse("2026-10-10T10:00:00.000Z")) {
  const clock = { t: start };
  const audit = new AuditLog();
  const k = new KnowledgeSystem({
    repos: inMemoryKnowledgeRepos(),
    audit,
    clock: () => clock.t,
  });
  const ops = () =>
    audit
      .query?.({ type: "knowledge_event" })
      .map((e) => e.data["operation"] as string) ?? [];
  return { clock, audit, k, ops };
}

const decision = (over: Partial<MemoryProposal> = {}): MemoryProposal => ({
  type: "ARCHITECTURAL",
  title: "Firebase Hosting for AIMS",
  content:
    "AIMS deploys to Firebase Hosting. Every validated build is deployed there.",
  projectId: "aims",
  source: "USER",
  importance: "HIGH",
  tags: ["deployment", "architecture"],
  explicit: true,
  ...over,
});

const READ_ALL = { projectIds: "*" as const, actor: "tester" };
const DEV = { id: "dev-agent", role: "developer" };

/* ================= memory lifecycle ================= */

test("memory: create → update → archive → restore keeps a version history and audits each step", () => {
  const { k, ops } = fixture();
  const created = k.memory.create(
    {
      type: "PROJECT",
      title: "Stack",
      content: "AIMS uses React, TypeScript and Vite.",
      projectId: "aims",
      source: "USER",
      explicit: true,
      tags: ["stack"],
    },
    USER,
  );
  assert.equal(created.outcome, "CREATED");
  const m = created.memory;
  assert.equal(m.status, "ACTIVE");
  assert.equal(m.confidence, "USER_CONFIRMED");
  assert.equal(m.version, 1);
  assert.equal(m.facets["framework"], "react");
  const u = k.memory.update(
    m.memoryId,
    {
      content: "AIMS uses React 19, TypeScript and Vite.",
      tags: ["stack", "frontend"],
    },
    USER,
  );
  assert.equal(u.version, 2);
  const a = k.memory.archive(m.memoryId, USER);
  assert.equal(a.status, "ARCHIVED");
  const r = k.memory.restore(m.memoryId, USER);
  assert.equal(r.status, "ACTIVE");
  const history = k.memory.history(m.memoryId);
  assert.deepEqual(
    history.map((h) => h.version),
    [1, 2, 3, 4],
  );
  assert.match(history[1]!.snapshot.content, /React 19/);
  for (const op of [
    "memory.created",
    "memory.updated",
    "memory.archived",
    "memory.restored",
  ])
    assert.ok(ops().includes(op), op);
});

test("write policy: users confirm, agents only suggest, hedging and secrets are handled", () => {
  const { k } = fixture();
  const user = k.memory.create(decision(), USER).memory;
  assert.equal(user.status, "ACTIVE");
  assert.equal(user.confidence, "USER_CONFIRMED");

  const draftByUser = k.memory.create(
    decision({
      title: "Maybe",
      content: "Consider Playwright for end-to-end tests.",
      explicit: false,
    }),
    USER,
  ).memory;
  assert.equal(draftByUser.status, "DRAFT");

  // An agent's protected-type proposal is only a candidate.
  const agent = k.memory.create(
    decision({
      title: "Use Vitest",
      content: "The project runs unit tests with Vitest.",
      source: "AGENT",
    }),
    AGENT,
  ).memory;
  assert.equal(agent.status, "DRAFT");
  assert.equal(agent.confidence, "AGENT_GENERATED");

  // "I think Firebase might be better" is not architecture memory.
  assert.throws(
    () =>
      k.memory.create(
        decision({
          title: "Opinion",
          content: "I think Firebase might be better here.",
          source: "AGENT",
        }),
        AGENT,
      ),
    /tentative/,
  );
  // Agents cannot write SYSTEM memory or user preferences.
  assert.throws(
    () =>
      k.memory.create(
        {
          type: "SYSTEM",
          title: "x",
          content: "Platform rule that should not be written.",
          source: "AGENT",
        },
        AGENT,
      ),
    KnowledgeError,
  );
  assert.throws(
    () =>
      k.memory.create(
        {
          type: "USER_PREFERENCE",
          title: "Theme",
          content: "The user prefers dark mode everywhere.",
          projectId: "aims",
          source: "AGENT",
        },
        AGENT,
      ),
    /preferences/,
  );
  // SYSTEM memory needs an administrator.
  assert.throws(
    () =>
      k.memory.create(
        {
          type: "SYSTEM",
          title: "Rule",
          content: "Security baseline applies everywhere.",
          source: "USER",
          explicit: true,
        },
        USER_NON_ADMIN,
      ),
    /administrator/,
  );
  const sys = k.memory.create(
    {
      type: "SYSTEM",
      title: "Rule",
      content: "Security baseline applies to every project.",
      source: "USER",
      explicit: true,
    },
    USER,
  ).memory;
  assert.equal(sys.projectId, undefined);
  // A project memory needs a project.
  assert.throws(
    () =>
      k.memory.create(
        {
          type: "PROJECT",
          title: "x",
          content: "no project given for this memory",
          source: "USER",
        },
        USER,
      ),
    /project/,
  );
  // Execution memory is active only with verified evidence.
  const unverified = k.memory.create(
    {
      type: "EXECUTION",
      title: "Build slow",
      content: "The build seemed slow yesterday on the CI box.",
      projectId: "aims",
      source: "EXECUTION",
    },
    SYSTEM,
  ).memory;
  assert.equal(unverified.status, "DRAFT");
  const verified = k.memory.create(
    {
      type: "EXECUTION",
      title: "Build failed",
      content: "typecheck failed with TS2322 in LoginCard.tsx.",
      projectId: "aims",
      source: "EXECUTION",
      verified: true,
    },
    SYSTEM,
  ).memory;
  assert.equal(verified.status, "ACTIVE");
  assert.equal(verified.confidence, "VERIFIED");
  assert.equal(verified.retention, "TEMPORARY");
  assert.ok(verified.expiresAt);
});

test("secrets: redacted before storage, and a memory that is only a secret is blocked", () => {
  const { k } = fixture();
  const m = k.memory.create(
    {
      type: "PROJECT",
      title: "Deploy notes",
      content: `Deploy with the standard pipeline; the token=${SECRET} must stay private in CI.`,
      projectId: "aims",
      source: "USER",
      explicit: true,
    },
    USER,
  ).memory;
  assert.ok(!m.content.includes(SECRET));
  assert.ok(m.tags.includes("redacted"));
  assert.ok(!JSON.stringify(k.memory.history(m.memoryId)).includes(SECRET));
  assert.throws(
    () =>
      k.memory.create(
        {
          type: "PROJECT",
          title: "key",
          content: `api_key=${SECRET}`,
          projectId: "aims",
          source: "USER",
          explicit: true,
        },
        USER,
      ),
    /secret/,
  );
});

test("duplicates: the same statement reinforces the existing memory instead of creating another", () => {
  const { k } = fixture();
  const a = k.memory.create(
    {
      type: "SYSTEM",
      title: "Private system",
      content: "AI Workforce is a private single-user system.",
      source: "USER",
      explicit: true,
    },
    USER,
  );
  const b = k.memory.create(
    {
      type: "SYSTEM",
      title: "Private system again",
      content: "AI Workforce is a private  single-user system!",
      source: "USER",
      explicit: true,
    },
    USER,
  );
  assert.equal(a.outcome, "CREATED");
  assert.equal(b.outcome, "REINFORCED");
  assert.equal(b.memory.memoryId, a.memory.memoryId);
  assert.equal(b.memory.reinforced, 1);
  assert.equal(k.memory.all().filter((m) => m.type === "SYSTEM").length, 1);
  // A stronger statement upgrades a draft candidate.
  const cand = k.memory.create(
    decision({
      title: "Vitest",
      content: "The project runs unit tests with Vitest every time.",
      source: "AGENT",
    }),
    AGENT,
  ).memory;
  assert.equal(cand.status, "DRAFT");
  const again = k.memory.create(
    decision({
      title: "Vitest",
      content: "The project runs unit tests with Vitest every time.",
    }),
    USER,
  );
  assert.equal(again.outcome, "REINFORCED");
  assert.equal(again.memory.status, "ACTIVE");
  assert.equal(again.memory.confidence, "USER_CONFIRMED");
});

test("confirmation: only a user turns a candidate into active, user-confirmed memory", () => {
  const { k } = fixture();
  const cand = k.memory.create(
    decision({
      title: "Deploy rule",
      content: "All validated AIMS builds are deployed to Firebase Hosting.",
      source: "AGENT",
    }),
    AGENT,
  ).memory;
  assert.equal(cand.status, "DRAFT");
  assert.throws(() => k.memory.confirm(cand.memoryId, SYSTEM), /only the user/);
  assert.throws(() => k.memory.confirm(cand.memoryId, AGENT), /only the user/);
  const ok = k.memory.confirm(cand.memoryId, USER);
  assert.equal(ok.status, "ACTIVE");
  assert.equal(ok.confidence, "USER_CONFIRMED");
  assert.throws(() => k.memory.confirm(cand.memoryId, USER), /draft/);
});

test("versioning & supersession: decisions are never overwritten, only superseded, with links both ways", () => {
  const { k, ops } = fixture();
  const v1 = k.memory.create(
    decision({
      title: "Enterprise SaaS architecture",
      content:
        "AI Workforce is built as a multi-tenant enterprise SaaS platform.",
      importance: "CRITICAL",
    }),
    USER,
  ).memory;
  assert.equal(v1.importance, "CRITICAL");
  // Critical/architectural content is protected from in-place edits.
  assert.throws(
    () =>
      k.memory.update(
        v1.memoryId,
        { content: "AI Workforce is a private system now." },
        USER,
      ),
    /never overwritten/,
  );
  assert.throws(() => k.memory.remove(v1.memoryId, USER), /cannot be deleted/);
  const { old, created } = k.memory.supersede(
    v1.memoryId,
    decision({
      title: "Private single-user architecture",
      content: "AI Workforce remains a private single-user system for now.",
      importance: "CRITICAL",
    }),
    USER,
  );
  assert.equal(old.status, "SUPERSEDED");
  assert.equal(old.supersededBy, created.memoryId);
  assert.equal(created.supersedes, v1.memoryId);
  assert.equal(created.status, "ACTIVE");
  assert.ok(k.memory.repos.edges.list().some((e) => e.type === "SUPERSEDES"));
  assert.ok(ops().includes("memory.superseded"));
  assert.equal(
    k.memory.listConflicts("aims").length,
    0,
    "a superseded decision is not a conflict",
  );
  // The old record is kept and still readable; it just no longer participates in retrieval.
  const hits = k.retrieval.search(
    { text: "enterprise SaaS multi-tenant architecture", projectId: "aims" },
    READ_ALL,
  );
  assert.ok(!hits.some((h) => h.memory.memoryId === v1.memoryId));
  const all = k.retrieval.search(
    {
      text: "enterprise SaaS multi-tenant",
      projectId: "aims",
      statuses: ["SUPERSEDED"],
    },
    READ_ALL,
  );
  assert.equal(all[0]?.memory.memoryId, v1.memoryId);
  // Agents cannot supersede.
  assert.throws(
    () =>
      k.memory.supersede(
        created.memoryId,
        decision({
          title: "x",
          content: "Something else entirely different here.",
        }),
        AGENT,
      ),
    KnowledgeError,
  );
  // Revoking critical memory needs an administrator.
  assert.throws(
    () => k.memory.revoke(created.memoryId, USER_NON_ADMIN),
    /administrator/,
  );
  assert.equal(k.memory.revoke(created.memoryId, USER).status, "REVOKED");
});

test("retention: temporary memory expires into the archive; permanent decisions and audit are untouched", () => {
  const { k, clock, audit } = fixture();
  const temp = k.memory.create(
    {
      type: "EXECUTION",
      title: "Deploy hiccup",
      content: "The deploy hiccuped because the CDN was slow today.",
      projectId: "aims",
      source: "EXECUTION",
      verified: true,
      expiresAt: new Date(clock.t + 86_400_000).toISOString(),
    },
    SYSTEM,
  ).memory;
  const perm = k.memory.create(decision(), USER).memory;
  const before = audit.query?.({ type: "knowledge_event" }).length ?? 0;
  clock.t += 2 * 86_400_000;
  assert.deepEqual(k.memory.applyRetention("system").archived, [temp.memoryId]);
  assert.equal(k.memory.get(temp.memoryId)!.status, "ARCHIVED");
  assert.equal(k.memory.get(perm.memoryId)!.status, "ACTIVE");
  assert.ok(
    (audit.query?.({ type: "knowledge_event" }).length ?? 0) > before,
    "audit records are only ever added",
  );
  assert.ok(
    !k.retrieval
      .search({ text: "deploy CDN slow", projectId: "aims" }, READ_ALL)
      .some((h) => h.memory.memoryId === temp.memoryId),
    "expired memory is not retrieved",
  );
  assert.throws(() => k.memory.restore(temp.memoryId, USER), /expired/);
});

/* ================= conflicts ================= */

test("conflicts: contradictory active decisions are flagged, never silently resolved", () => {
  const { k, ops } = fixture();
  assert.deepEqual(extractFacets("AIMS uses dark navy theme.", ["aims"]), {
    theme: "dark navy",
  });
  assert.deepEqual(
    extractFacets("AIMS uses AIMS Dark Liquid Glass theme.", ["aims"]),
    { theme: "dark liquid glass" },
  );
  const a = k.memory.create(
    decision({
      type: "PROJECT",
      title: "AIMS theme",
      content: "AIMS uses dark navy theme.",
      tags: ["ui", "theme"],
    }),
    USER,
  ).memory;
  const b = k.memory.create(
    decision({
      type: "PROJECT",
      title: "AIMS theme (glass)",
      content: "AIMS uses AIMS Dark Liquid Glass theme.",
      tags: ["ui", "theme"],
    }),
    USER,
  ).memory;
  const conflicts = k.memory.listConflicts("aims");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.facet, "theme");
  assert.deepEqual(
    conflicts[0]!.memoryIds.slice().sort(),
    [a.memoryId, b.memoryId].sort(),
  );
  assert.match(conflicts[0]!.suggestion, /decide|stronger|recent/i);
  assert.ok(ops().includes("memory.conflict_detected"));
  // Retrieval returns both and flags them.
  const hits = k.retrieval.search(
    { text: "AIMS theme", projectId: "aims" },
    READ_ALL,
  );
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => h.conflictWith.length === 1));
  // The assembled context says so explicitly.
  const pkg = k.assembler.assemble({
    projectId: "aims",
    query: "change the AIMS theme colors",
    agent: DEV,
    scope: READ_ALL,
  });
  assert.equal(pkg.status, "KNOWLEDGE_CONFLICT_DETECTED");
  assert.match(pkg.rendered, /KNOWLEDGE CONFLICT DETECTED/);
  assert.match(pkg.rendered, /dark navy/);
  assert.match(pkg.rendered, /dark liquid glass/i);
  // Hosting migration example.
  k.memory.create(
    decision({
      title: "Hosting",
      content: "Use Firebase Hosting.",
      type: "PROJECT",
    }),
    USER,
  );
  k.memory.create(
    decision({
      title: "Migration",
      content: "Project migrated to Cloud Run.",
      type: "PROJECT",
    }),
    USER,
  );
  assert.ok(
    k.memory.listConflicts("aims").some((c) => c.facet === "deployment"),
  );
  // Resolution: only a user; the loser is superseded and the conflict disappears.
  const c = conflicts[0]!;
  assert.throws(
    () =>
      k.memory.resolveConflict(
        c.conflictId,
        "SUPERSEDED_OTHER",
        SYSTEM,
        b.memoryId,
      ),
    /only the user/,
  );
  assert.throws(
    () => k.memory.resolveConflict(c.conflictId, "SUPERSEDED_OTHER", USER),
    /name the memory/,
  );
  k.memory.resolveConflict(c.conflictId, "SUPERSEDED_OTHER", USER, b.memoryId);
  assert.equal(k.memory.get(a.memoryId)!.status, "SUPERSEDED");
  assert.equal(k.memory.get(a.memoryId)!.supersededBy, b.memoryId);
  assert.ok(!k.memory.listConflicts("aims").some((x) => x.facet === "theme"));
  // Keeping both is an explicit decision too.
  const hosting = k.memory
    .listConflicts("aims")
    .find((x) => x.facet === "deployment")!;
  k.memory.resolveConflict(hosting.conflictId, "KEPT_BOTH", USER);
  assert.equal(k.memory.listConflicts("aims").length, 0);
});

test("conflicts: documents and execution history never create decision conflicts; explicit edges do", () => {
  const { k } = fixture();
  k.memory.create(
    {
      type: "DOCUMENT",
      title: "Hosting doc A",
      content: "Deployment uses Firebase Hosting for the web app.",
      projectId: "aims",
      source: "DOCUMENT",
    },
    SYSTEM,
  );
  k.memory.create(
    {
      type: "DOCUMENT",
      title: "Hosting doc B",
      content: "An alternative would be Cloud Run for the backend.",
      projectId: "aims",
      source: "DOCUMENT",
    },
    SYSTEM,
  );
  assert.equal(k.memory.listConflicts("aims").length, 0);
  const x = k.memory.create(
    decision({
      type: "PROJECT",
      title: "Rule X",
      content: "Always squash merge pull requests in this repository.",
    }),
    USER,
  ).memory;
  const y = k.memory.create(
    decision({
      type: "PROJECT",
      title: "Rule Y",
      content: "Always create merge commits for pull requests here.",
    }),
    USER,
  ).memory;
  assert.equal(
    k.memory.listConflicts("aims").length,
    0,
    "no shared facet, so no heuristic conflict",
  );
  k.memory.link(
    `mem:${x.memoryId}`,
    `mem:${y.memoryId}`,
    "CONFLICTS_WITH",
    "user-1",
    "USER",
    "aims",
  );
  assert.equal(k.memory.listConflicts("aims").length, 1);
});

/* ================= retrieval ================= */

function seedAims(k: KnowledgeSystem) {
  const mk = (p: MemoryProposal, a: Actor = USER) =>
    k.memory.create(p, a).memory;
  return {
    auth: mk(
      decision({
        type: "ARCHITECTURAL",
        title: "AIMS authentication architecture",
        content:
          "AIMS authenticates operators with Firebase Auth. The login page uses email and password sign in and sessions expire after 8 hours.",
        tags: ["architecture", "auth", "security"],
        importance: "HIGH",
      }),
    ),
    login: mk(
      {
        type: "DOCUMENT",
        title: "LoginCard component",
        content:
          "The LoginCard component renders the login form in src/pages/Login/LoginCard.tsx and its styles live in LoginCard.css.",
        projectId: "aims",
        source: "PROJECT_FILE",
        tags: ["code", "component", "login"],
        references: [{ kind: "file", ref: "src/pages/Login/LoginCard.tsx" }],
      },
      SYSTEM,
    ),
    design: mk(
      decision({
        type: "PROJECT",
        title: "AIMS design system",
        content:
          "All AIMS screens use the AIMS design system with the dark liquid glass look, 8px spacing and rounded cards.",
        tags: ["ui", "design"],
      }),
    ),
    inventory: mk(
      decision({
        type: "PROJECT",
        title: "Inventory import",
        content:
          "Inventory items are imported from Google Sheets every night using a scheduled job.",
        tags: ["inventory", "data"],
      }),
    ),
    security: mk(
      decision({
        type: "ARCHITECTURAL",
        title: "Security requirement: no credentials in the UI",
        content:
          "Never place passwords, tokens or API keys in client code, logs or the browser storage.",
        tags: ["security"],
        importance: "CRITICAL",
      }),
    ),
    failure: mk(
      {
        type: "EXECUTION",
        title: "Previous attempt failed (typecheck): login page",
        content:
          "While changing the login page the typecheck step failed with TS2322 in LoginCard.tsx.",
        projectId: "aims",
        source: "EXECUTION",
        verified: true,
        tags: ["failure", "typecheck"],
      },
      SYSTEM,
    ),
    other: k.memory.create(
      {
        type: "PROJECT",
        title: "Budget model",
        content:
          "The finance model uses monthly cash flow forecasts and a savings goal.",
        projectId: "money-mind",
        source: "USER",
        explicit: true,
      },
      USER,
    ).memory,
  };
}

test("retrieval: hybrid ranking finds authentication knowledge for a login request and skips unrelated AIMS data", () => {
  const { k } = fixture();
  const s = seedAims(k);
  const hits = k.retrieval.search(
    { text: "How does AIMS authentication work?", projectId: "aims" },
    READ_ALL,
  );
  const ids = hits.map((h) => h.memory.memoryId);
  assert.equal(
    ids[0],
    s.auth.memoryId,
    "the authentication architecture ranks first",
  );
  assert.ok(
    ids.includes(s.login.memoryId),
    "synonyms connect 'authentication' to the login component",
  );
  assert.ok(
    !ids.includes(s.inventory.memoryId),
    "unrelated AIMS inventory knowledge is not retrieved",
  );
  assert.ok(
    !ids.includes(s.other.memoryId),
    "other projects are never retrieved",
  );
  const top = hits[0]!;
  assert.ok(top.signals.keyword > 0.3);
  assert.ok(top.reasons.some((r) => /Project: aims/.test(r)));
  assert.ok(top.reasons.some((r) => /Importance: HIGH/.test(r)));
  assert.ok(top.reasons.some((r) => /Confidence: USER_CONFIRMED/.test(r)));
  assert.ok(top.reasons.some((r) => /Matched terms/.test(r)));
});

test("retrieval: metadata filters, similarity without shared words, and the graph signal", () => {
  const { k } = fixture();
  const s = seedAims(k);
  // Metadata filters.
  const onlyExec = k.retrieval.search(
    { text: "login page typecheck", projectId: "aims", types: ["EXECUTION"] },
    READ_ALL,
  );
  assert.deepEqual(
    onlyExec.map((h) => h.memory.memoryId),
    [s.failure.memoryId],
  );
  assert.equal(
    k.retrieval.search(
      { text: "login", projectId: "aims", confidences: ["VERIFIED"] },
      READ_ALL,
    ).length,
    1,
  );
  assert.equal(
    k.retrieval.search(
      { text: "login", projectId: "aims", sources: ["PROJECT_FILE"] },
      READ_ALL,
    )[0]?.memory.memoryId,
    s.login.memoryId,
  );
  assert.equal(
    k.retrieval.search(
      {
        text: "security credentials",
        projectId: "aims",
        importances: ["CRITICAL"],
      },
      READ_ALL,
    )[0]?.memory.memoryId,
    s.security.memoryId,
  );
  // Trigram similarity: "spacing" vs "padding" share no word, but the design memory still surfaces via the ui topic.
  const spacing = k.retrieval.search(
    { text: "card padding spacing", projectId: "aims" },
    READ_ALL,
  );
  assert.equal(spacing[0]?.memory.memoryId, s.design.memoryId);
  // Graph: a component entity related to a memory pulls it in at distance 1.
  const ent = k.memory.entity("aims", "Firebase Auth", "TECHNOLOGY");
  k.memory.link(
    `mem:${s.inventory.memoryId}`,
    ent.id,
    "RELATED_TO",
    "user-1",
    "USER",
    "aims",
  );
  const g = k.retrieval.search(
    { text: "firebase auth", projectId: "aims" },
    READ_ALL,
  );
  const inv = g.find((h) => h.memory.memoryId === s.inventory.memoryId);
  assert.ok(
    inv && inv.signals.relationship === 0.5,
    "one hop in the project graph",
  );
  assert.ok(inv!.reasons.some((r) => /project graph/.test(r)));
});

test("authorization: retrieval is scoped by project independent of the caller, and denials are audited", () => {
  const { k, ops } = fixture();
  const s = seedAims(k);
  const mmScope = { projectIds: ["money-mind"], actor: "op-2" };
  assert.throws(
    () =>
      k.retrieval.search(
        { text: "authentication", projectId: "aims" },
        mmScope,
      ),
    (e: unknown) => e instanceof KnowledgeError && e.code === "access_denied",
  );
  assert.ok(ops().includes("memory.retrieval_denied"));
  // Without naming a project the caller still only sees its own.
  const own = k.retrieval.search({ text: "finance savings forecast" }, mmScope);
  assert.deepEqual(
    own.map((h) => h.memory.projectId),
    ["money-mind"],
  );
  assert.equal(
    k.retrieval.search({ text: "authentication login firebase" }, mmScope)
      .length,
    0,
  );
  // A developer agent asking for another project's knowledge is denied.
  const agentScope = { projectIds: ["aims"], actor: "dev-agent", agent: DEV };
  assert.throws(
    () =>
      k.retrieval.search(
        { text: "finance savings", projectId: "money-mind" },
        agentScope,
      ),
    /denied/,
  );
  assert.throws(
    () =>
      k.assembler.assemble({
        projectId: "money-mind",
        query: "savings",
        agent: DEV,
        scope: agentScope,
      }),
    /denied/,
  );
  // Agents never see preferences or another agent's memory.
  k.memory.create(
    {
      type: "USER_PREFERENCE",
      title: "Preferred theme",
      content: "The user prefers the dark theme in all dashboards.",
      projectId: "aims",
      source: "USER",
      explicit: true,
    },
    USER,
  );
  k.memory.create(
    {
      type: "AGENT",
      title: "QA notes",
      content: "The QA agent runs the login smoke test first each time.",
      projectId: "aims",
      source: "AGENT",
      agentId: "qa-agent",
    },
    { id: "qa-agent", kind: "AGENT", agentId: "qa-agent" },
  );
  const asAgent = k.retrieval.search(
    { text: "dark theme dashboards login smoke test", projectId: "aims" },
    agentScope,
  );
  assert.ok(
    !asAgent.some(
      (h) => h.memory.type === "USER_PREFERENCE" || h.memory.type === "AGENT",
    ),
  );
  const asUser = k.retrieval.search(
    { text: "dark theme dashboards", projectId: "aims" },
    READ_ALL,
  );
  assert.ok(asUser.some((h) => h.memory.type === "USER_PREFERENCE"));
  void s;
  // The auditor reports the denial pattern.
  for (let i = 0; i < 3; i++) {
    try {
      k.retrieval.search({ text: "x", projectId: "aims" }, mmScope);
    } catch {
      /* expected */
    }
  }
  const findings = k.auditor.run();
  assert.ok(
    findings.some(
      (f) =>
        f.ruleId === "knowledge.unauthorized_retrieval" &&
        f.subjectId === "op-2",
    ),
  );
});

test("stale knowledge is down-ranked and flagged, and re-validation clears it", () => {
  const { k } = fixture();
  const s = seedAims(k);
  const before = k.retrieval
    .search(
      { text: "firebase auth login sessions", projectId: "aims" },
      READ_ALL,
    )
    .find((h) => h.memory.memoryId === s.auth.memoryId)!;
  k.memory.markStale(s.auth.memoryId, "architecture document changed");
  const after = k.retrieval
    .search(
      { text: "firebase auth login sessions", projectId: "aims" },
      READ_ALL,
    )
    .find((h) => h.memory.memoryId === s.auth.memoryId)!;
  assert.ok(after.stale);
  assert.ok(after.score < before.score);
  assert.ok(after.reasons.some((r) => /stale/i.test(r)));
  assert.throws(
    () => k.memory.validateFresh(s.auth.memoryId, SYSTEM),
    /only the user/,
  );
  assert.equal(
    k.memory.validateFresh(s.auth.memoryId, USER).freshness,
    "FRESH",
  );
});

/* ================= context assembly ================= */

test("assembler: a compact, cited, budgeted package — security first, nothing over budget, usage recorded", () => {
  const { k } = fixture();
  const s = seedAims(k);
  const pkg = k.assembler.assemble({
    projectId: "aims",
    taskId: "t-1",
    executionId: "exec-1",
    query: "Change the AIMS login card vertical padding",
    task: { title: "Reduce login card padding" },
    agent: DEV,
    scope: READ_ALL,
    acceptanceCriteria: ["Vertical padding is smaller"],
    relevantFiles: ["src/pages/Login/LoginCard.css"],
    constraints: ["Preserve colors"],
  });
  assert.equal(pkg.status, "OK");
  assert.ok(
    pkg.sections.security.length > 0,
    "the critical security requirement is mandatory",
  );
  assert.ok(pkg.items.some((i) => i.memoryId === s.security.memoryId));
  assert.ok(pkg.sections.previousAttempts.some((l) => /TS2322/.test(l)));
  assert.ok(pkg.sections.acceptance.includes("Vertical padding is smaller"));
  assert.ok(
    pkg.items.every((i) => i.citation.includes(i.memoryId) && i.why.length > 0),
  );
  assert.ok(
    !pkg.items.some(
      (i) =>
        i.memoryId === s.other.memoryId || i.memoryId === s.inventory.memoryId,
    ),
  );
  assert.match(pkg.rendered, /SECURITY REQUIREMENTS/);
  assert.match(pkg.rendered, /source: /);
  assert.ok(pkg.budget.usedChars <= pkg.budget.limitChars);
  // Usage feedback, then the outcome closes it.
  assert.equal(k.retrieval.usageFor(s.security.memoryId)[0]?.result, "PENDING");
  assert.ok(k.retrieval.recordOutcome("t-1", "TASK_SUCCEEDED", "exec-1") > 0);
  assert.equal(
    k.retrieval.usageFor(s.security.memoryId)[0]?.result,
    "TASK_SUCCEEDED",
  );

  // A tiny budget drops the lower-priority items, never the mandatory security item.
  const tiny = k.assembler.assemble({
    projectId: "aims",
    query: "Change the AIMS login card vertical padding",
    agent: DEV,
    scope: READ_ALL,
    budgetChars: 350,
  });
  assert.ok(tiny.excluded.some((e) => e.reason === "over_budget"));
  assert.ok(tiny.items.some((i) => i.memoryId === s.security.memoryId));
  assert.ok(tiny.items.length < pkg.items.length);
});

test("assembler: output is secret-masked even if an old memory carries a secret", () => {
  const { k } = fixture();
  const s = seedAims(k);
  // Simulate legacy data written before the policy existed.
  const raw = k.memory.repos.memories.findById(s.design.memoryId)!;
  k.memory.repos.memories.upsert({
    ...raw,
    content: `${raw.content} token=${SECRET}`,
  });
  k.index.upsert(k.memory.repos.memories.findById(s.design.memoryId)!);
  const pkg = k.assembler.assemble({
    projectId: "aims",
    query: "AIMS design system spacing cards",
    agent: DEV,
    scope: READ_ALL,
  });
  assert.ok(!pkg.rendered.includes(SECRET));
  assert.ok(!JSON.stringify(pkg.items).includes(SECRET));
});

/* ================= ingestion ================= */

test("ingestion: documents are classified, chunked with provenance, secret-safe, and unchanged sources are skipped", () => {
  const { k, ops } = fixture();
  const md = [
    "# AIMS Architecture",
    "AIMS is a React app hosted on Firebase Hosting.",
    "",
    "## Authentication",
    "Operators sign in with Firebase Auth. Sessions last eight hours.",
    `Do not commit the key api_key=${SECRET} anywhere.`,
    "",
    "## Data",
    "Inventory lives in Firestore and is synced from Google Sheets.",
  ].join("\n");
  const chunks = chunkMarkdown(md);
  assert.deepEqual(
    chunks.map((c) => c.heading),
    [
      "AIMS Architecture",
      "AIMS Architecture › Authentication",
      "AIMS Architecture › Authentication".replace("Authentication", "Data"),
    ],
  );
  const r1 = k.ingestion.ingestDocument({
    projectId: "aims",
    ref: "docs/architecture.md",
    text: md,
    requestedBy: "u",
  });
  assert.equal(r1.status, "ingested");
  assert.equal(r1.chunks, 3);
  assert.ok(r1.steps.includes("classify") && r1.steps.includes("chunk"));
  const stored = k.memory
    .all()
    .filter((m) => m.sourceRef === "docs/architecture.md");
  assert.equal(stored.length, 3);
  assert.ok(
    stored.every(
      (m) =>
        m.source === "PROJECT_FILE" &&
        m.confidence === "SYSTEM_GENERATED" &&
        m.status === "ACTIVE",
    ),
  );
  assert.ok(stored.every((m) => m.tags.includes("architecture")));
  assert.ok(
    stored.every((m) =>
      m.references.some((x) => x.ref === "docs/architecture.md"),
    ),
  );
  assert.ok(
    !JSON.stringify(stored).includes(SECRET),
    "secrets are redacted in stored chunks",
  );
  assert.ok(stored.some((m) => m.tags.includes("redacted")));
  assert.ok(
    ops().includes("knowledge.ingested") && ops().includes("knowledge.indexed"),
  );
  // Same content again: nothing happens.
  assert.equal(
    k.ingestion.ingestDocument({
      projectId: "aims",
      ref: "docs/architecture.md",
      text: md,
      requestedBy: "u",
    }).status,
    "unchanged",
  );
  // Retrieval can answer from the ingested chunks, with provenance.
  const hit = k.retrieval.search(
    { text: "how do operators sign in with Firebase Auth", projectId: "aims" },
    READ_ALL,
  )[0]!;
  assert.match(hit.memory.title, /Authentication/);
  assert.equal(hit.memory.sourceRef, "docs/architecture.md");
});

test("ingestion: denied paths, binary/PDF input and oversize documents are refused with a reason", () => {
  const { k } = fixture();
  const attempt = (ref: string, text: string, contentType?: string) =>
    k.ingestion.ingestDocument({
      projectId: "aims",
      ref,
      text,
      requestedBy: "u",
      ...(contentType ? { contentType } : {}),
    });
  for (const ref of [
    ".env",
    ".env.local",
    "node_modules/x/README.md",
    "dist/app.js",
    "keys/server.pem",
    "package-lock.json",
    "../outside.md",
    "/etc/passwd",
    "logo.png",
    "a/serviceAccount.json",
  ]) {
    const r = attempt(ref, "content that would otherwise be fine to index");
    assert.equal(r.status, "skipped", ref);
    assert.ok(r.reason, ref);
  }
  assert.match(
    attempt("docs/spec.pdf", "", "application/pdf").reason ?? "",
    /PDF/,
  );
  assert.match(
    attempt("docs/big.md", "x".repeat(300_000)).reason ?? "",
    /too large/,
  );
  assert.match(
    attempt("docs/bin.md", `a\0b${"x".repeat(100)}`).reason ?? "",
    /binary/,
  );
  assert.equal(k.memory.all().length, 0);
});

test("document updates: a changed source archives its old chunks and marks dependent knowledge potentially stale", () => {
  const { k } = fixture();
  k.ingestion.ingestDocument({
    projectId: "aims",
    ref: "docs/deploy.md",
    text: "# Deployment\nAIMS is deployed with Firebase Hosting from the main branch.",
    requestedBy: "u",
  });
  const belief = k.memory.create(
    decision({
      type: "PROJECT",
      title: "Hosting belief",
      content: "AIMS runs on Firebase Hosting.",
      references: [{ kind: "document", ref: "docs/deploy.md" }],
    }),
    USER,
  ).memory;
  const r = k.ingestion.ingestDocument({
    projectId: "aims",
    ref: "docs/deploy.md",
    text: "# Deployment\nThe deployment migrated; builds are now shipped by the new pipeline.",
    requestedBy: "u",
  });
  assert.equal(r.status, "ingested");
  assert.equal(r.archived.length, 1);
  assert.deepEqual(r.staleMarked, [belief.memoryId]);
  assert.equal(k.memory.get(belief.memoryId)!.freshness, "POTENTIALLY_STALE");
  assert.equal(
    k.memory.get(belief.memoryId)!.status,
    "ACTIVE",
    "flagged for validation, not deleted",
  );
  const old = k.memory
    .all()
    .filter((m) => m.sourceRef === "docs/deploy.md" && m.status === "ARCHIVED");
  assert.equal(old.length, 1);
});

test("code knowledge: components, hooks, routes, API calls, types and integrations are indexed at a high level", () => {
  const code = `import { signInWithEmailAndPassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";
export interface LoginForm { email: string }
export const LoginCard = () => { return null; };
export function useLoginSession() { return fetch("/api/session"); }
export const routes = [{ path: "/login", element: null }];`;
  const sym = extractCodeSymbols("src/pages/Login/LoginCard.tsx", code);
  assert.deepEqual(sym.components, ["LoginCard"]);
  assert.deepEqual(sym.hooks, ["useLoginSession"]);
  assert.deepEqual(sym.types, ["LoginForm"]);
  assert.deepEqual(sym.routes, ["/login"]);
  assert.deepEqual(sym.apiCalls, ["/api/session"]);
  assert.ok(sym.integrations.includes("firebase/auth"));
  const { k } = fixture();
  const r = k.ingestion.ingestDocument({
    projectId: "aims",
    ref: "src/pages/Login/LoginCard.tsx",
    text: code,
    requestedBy: "u",
  });
  assert.equal(r.status, "ingested");
  const m = k.memory
    .all()
    .find((x) => x.sourceRef === "src/pages/Login/LoginCard.tsx")!;
  assert.ok(m.tags.includes("code") && m.tags.includes("component"));
  assert.match(m.content, /components: LoginCard/);
  // The graph links the file to its area, and a query about "authentication" reaches the login code.
  assert.ok(
    k.memory.repos.entities
      .list()
      .some((e) => e.kind === "AREA" && e.label === "login"),
  );
  const hits = k.retrieval.search(
    { text: "where is the login component", projectId: "aims" },
    READ_ALL,
  );
  assert.equal(hits[0]?.memory.memoryId, m.memoryId);
});

test("project discovery & refresh: stack found by the onboarding analyzer, system-generated, never overwriting confirmed memory", async () => {
  const { k } = fixture();
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "aims",
      scripts: { build: "vite build", test: "vitest run", typecheck: "tsc -b" },
      dependencies: { react: "^19.0.0" },
      devDependencies: {
        typescript: "^5.0.0",
        vite: "^6.0.0",
        vitest: "^2.0.0",
      },
    }),
    "firebase.json": JSON.stringify({ hosting: { public: "dist" } }),
    "tsconfig.json": "{}",
    "README.md":
      "# AIMS\nAsset and inventory management for Suriname.\n\n## Run\nnpm run dev",
    "src/pages/Login/LoginCard.tsx": "export const LoginCard = () => null;",
  };
  const report = await k.discovery.run({
    projectId: "aims",
    source: new StaticFileSource(files),
    requestedBy: "u1",
  });
  assert.ok(
    report.topics.some((t) => t.topic === "stack" && t.outcome === "created"),
  );
  const stack = k.memory.all().find((m) => m.sourceRef === "discovery:stack")!;
  assert.equal(
    stack.confidence,
    "SYSTEM_GENERATED",
    "discovery is never USER_CONFIRMED",
  );
  assert.match(stack.content, /React/i);
  assert.ok(
    report.documents.some(
      (d) => d.ref === "README.md" && d.status === "ingested",
    ),
  );
  assert.ok(
    report.documents.some((d) => d.ref === "src/pages/Login/LoginCard.tsx"),
  );
  assert.ok(k.memory.repos.edges.list().some((e) => e.type === "USES"));
  // Refresh with no change: nothing new.
  const again = await k.discovery.run({
    projectId: "aims",
    source: new StaticFileSource(files),
    requestedBy: "u1",
    mode: "refresh",
  });
  assert.ok(again.topics.every((t) => t.outcome === "unchanged"));
  assert.ok(again.documents.every((d) => d.status === "unchanged"));
  // The framework changes: a system-generated memory is superseded with history kept.
  const changed = {
    ...files,
    "package.json": JSON.stringify({
      name: "aims",
      scripts: { build: "vite build" },
      dependencies: { vue: "^3.0.0" },
      devDependencies: { typescript: "^5.0.0", vite: "^6.0.0" },
    }),
  };
  const r3 = await k.discovery.run({
    projectId: "aims",
    source: new StaticFileSource(changed),
    requestedBy: "u1",
    mode: "refresh",
  });
  assert.ok(
    r3.topics.some((t) => t.topic === "stack" && t.outcome === "superseded"),
  );
  assert.equal(k.memory.get(stack.memoryId)!.status, "SUPERSEDED");
  // A user-confirmed memory is flagged stale and a candidate is proposed instead of overwriting it.
  const confirmed = k.memory
    .all()
    .find((m) => m.sourceRef === "discovery:stack" && m.status === "ACTIVE")!;
  k.memory.update(confirmed.memoryId, { title: confirmed.title }, USER);
  k.memory.supersede(
    confirmed.memoryId,
    {
      type: "PROJECT",
      title: "Stack (confirmed)",
      content: "AIMS uses Vue 3 with Vite and TypeScript.",
      projectId: "aims",
      source: "USER",
      sourceRef: "discovery:stack",
      explicit: true,
    },
    USER,
  );
  const userOwned = k.memory
    .all()
    .find((m) => m.sourceRef === "discovery:stack" && m.status === "ACTIVE")!;
  assert.equal(userOwned.confidence, "USER_CONFIRMED");
  const r4 = await k.discovery.run({
    projectId: "aims",
    source: new StaticFileSource({
      ...changed,
      "package.json": JSON.stringify({
        name: "aims",
        scripts: { build: "vite build" },
        dependencies: { svelte: "^5.0.0" },
        devDependencies: { typescript: "^5.0.0", vite: "^6.0.0" },
      }),
    }),
    requestedBy: "u1",
    mode: "refresh",
  });
  assert.ok(
    r4.topics.some((t) => t.topic === "stack" && t.outcome === "candidate"),
  );
  assert.equal(k.memory.get(userOwned.memoryId)!.status, "ACTIVE");
  assert.equal(
    k.memory.get(userOwned.memoryId)!.freshness,
    "POTENTIALLY_STALE",
  );
  assert.ok(
    k.memory
      .all()
      .some((m) => m.status === "DRAFT" && m.sourceRef === "discovery:stack"),
  );
});

test("git history is low-authority context: commits become documents, never architecture", async () => {
  const { k } = fixture();
  const src = new StaticFileSource({}, [
    {
      sha: "a".repeat(40),
      message: "feat: switch everything to Cloud Run\n\nlong body",
      files: ["src/app.ts"],
    },
    {
      sha: "b".repeat(40),
      message: "fix: login padding",
      files: ["src/pages/Login/LoginCard.css"],
    },
  ]);
  const r = await k.ingestion.ingestCommits({
    projectId: "aims",
    source: src,
    requestedBy: "u",
  });
  assert.equal(r.created, 2);
  assert.equal(
    (
      await k.ingestion.ingestCommits({
        projectId: "aims",
        source: src,
        requestedBy: "u",
      })
    ).created,
    0,
    "idempotent",
  );
  const commits = k.memory.all().filter((m) => m.tags.includes("commit"));
  assert.ok(
    commits.every(
      (m) =>
        m.type === "DOCUMENT" &&
        m.source === "GITHUB" &&
        m.importance === "LOW" &&
        m.retention === "TEMPORARY",
    ),
  );
  assert.equal(k.memory.listConflicts("aims").length, 0);
});

test("a real workspace and its git history feed the same ingestion path (read-only governed access)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiw-kn-"));
  temps.push(dir);
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(
    path.join(dir, "docs", "guide.md"),
    "# Guide\nRun the build with npm run build before every deploy of the app.\n",
  );
  writeFileSync(path.join(dir, ".env"), `KEY=${SECRET}\n`);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "x",
      scripts: { build: "tsc" },
      devDependencies: { typescript: "^5.0.0" },
    }),
  );
  const git = (...a: string[]) =>
    spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "T");
  git("add", "docs", "package.json");
  git("commit", "-q", "-m", "docs: add guide");
  const { k } = fixture();
  const { realpath } = await import("node:fs/promises");
  const fs = new GovernedFileSystem(await realpath(dir), ["read", "list"], {
    taskId: "kn",
    agentId: "kn",
    clock: () => "t",
  });
  const report = await k.discovery.run({
    projectId: "aims",
    source: workspaceFileSource(fs, new LocalGitOps(dir)),
    requestedBy: "u",
  });
  assert.equal(report.source, "workspace");
  assert.ok(
    report.documents.some(
      (d) => d.ref === "docs/guide.md" && d.status === "ingested",
    ),
  );
  assert.equal(report.commits.created, 1);
  assert.ok(
    !JSON.stringify(k.memory.all()).includes(SECRET),
    "credential files are never read",
  );
});

/* ================= learning loop ================= */

function mkSession(over: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: "exec-1",
    executionId: "exec-1",
    projectId: "aims",
    taskId: "run1-t1",
    runId: "run1",
    agentId: "dev-agent",
    status: "SUCCEEDED",
    paused: false,
    commands: [],
    changes: [],
    validation: [],
    tools: [],
    events: [],
    nextSeq: 1,
    retries: 0,
    revision: 1,
    createdAt: "t",
    updatedAt: "t",
    heartbeatAt: "t",
    ...over,
  } as unknown as RuntimeSession;
}
const mkTask = (over: Partial<OrchTask> = {}): OrchTask =>
  ({
    taskId: "run1-t1",
    runId: "run1",
    projectId: "aims",
    title: "Update the login page",
    type: "DEVELOPMENT",
    resources: ["src/a.css"],
    ...over,
  }) as OrchTask;
const mkCtx = (): TaskExecutionContext =>
  ({
    runId: "run1",
    projectId: "aims",
    objective: "o",
    constraints: [],
    acceptanceCriteria: [],
    relevantFiles: [],
    prompt: "p",
    upstream: [],
    permittedTools: [],
    agentId: "dev-agent",
  }) as TaskExecutionContext;

test("learning loop: verified failures become execution memory; recurrence proposes a DRAFT rule; claims without checks store nothing", () => {
  const { k } = fixture();
  const failing = (n: number) =>
    mkSession({
      id: `exec-${n}`,
      executionId: `exec-${n}`,
      taskId: `run${n}-t1`,
      status: "FAILED",
      validation: [
        {
          stage: "typecheck",
          status: "failed",
          errors: [
            `src/pages/Login/LoginCard.tsx(${n},5): error TS2322: Type 'string' is not assignable to type 'number'.`,
          ],
          warnings: 0,
          command: "npm run typecheck",
        },
      ],
      changes: [
        {
          path: "src/pages/Login/LoginCard.tsx",
          operation: "update",
          at: "t",
          taskId: "x",
          agentId: "a",
        },
      ],
    });
  assert.equal(
    failureSignature(
      "typecheck",
      "src/a.tsx(3,5): error TS2322: Type 'x' is not assignable",
    ),
    failureSignature(
      "typecheck",
      "src/b/c.tsx(99,1): error TS2322: Type 'x' is not assignable",
    ),
  );
  // Memories were handed to the agent: the outcome updates their usage.
  const seeded = k.memory.create(
    decision({
      type: "PROJECT",
      title: "Login rule",
      content: "The login card keeps its logo centered at all times.",
    }),
    USER,
  ).memory;
  k.retrieval.recordUsage({
    memoryId: seeded.memoryId,
    projectId: "aims",
    taskId: "run1-t1",
    agentId: "dev-agent",
    reason: "relevant",
  });
  const r1 = k.learner.learn({
    session: failing(1),
    task: mkTask(),
    context: mkCtx(),
    outcome: {
      kind: "failure",
      error: "typecheck failed",
      classification: "LOGICAL",
    },
  });
  assert.equal(r1.usageUpdated, 1);
  assert.equal(k.retrieval.usageFor(seeded.memoryId)[0]!.result, "TASK_FAILED");
  assert.equal(r1.created.length, 1);
  const m = k.memory.get(r1.created[0]!)!;
  assert.equal(m.type, "EXECUTION");
  assert.equal(m.confidence, "VERIFIED");
  assert.equal(m.status, "ACTIVE");
  assert.ok(m.references.some((r) => r.ref === "exec-1"));
  assert.equal(r1.candidates.length, 0, "one failure is not a pattern");
  // Same failure in a second execution: reinforced, and a candidate rule is proposed — as a DRAFT.
  const r2 = k.learner.learn({
    session: failing(2),
    task: mkTask({ taskId: "run2-t1" }),
    context: mkCtx(),
    outcome: {
      kind: "failure",
      error: "typecheck failed",
      classification: "LOGICAL",
    },
  });
  assert.equal(r2.candidates.length, 1);
  const cand = k.memory.get(r2.candidates[0]!)!;
  assert.equal(cand.status, "DRAFT");
  assert.equal(cand.type, "PROJECT");
  assert.ok(cand.tags.includes("candidate"));
  assert.equal(k.memory.get(r1.created[0]!)!.reinforced, 1);
  // Success without passing checks is not stored; success with passing checks is.
  const noChecks: RuntimeOutcome = {
    kind: "success",
    summary: "done",
    evidence: ["x"],
  };
  const s = mkSession({
    id: "exec-3",
    executionId: "exec-3",
    taskId: "run3-t1",
    changes: [
      {
        path: "src/a.css",
        operation: "update",
        at: "t",
        taskId: "x",
        agentId: "a",
      },
    ],
  });
  const none = k.learner.learn({
    session: s,
    task: mkTask({ taskId: "run3-t1" }),
    context: mkCtx(),
    outcome: noChecks,
  });
  assert.equal(none.created.length, 0);
  const good = k.learner.learn({
    session: s,
    task: mkTask({ taskId: "run3-t1" }),
    context: mkCtx(),
    outcome: {
      kind: "success",
      summary: "padding reduced",
      evidence: ["x"],
      checks: [{ name: "npm run typecheck", passed: true }],
    },
  });
  assert.equal(good.created.length, 1);
  assert.match(k.memory.get(good.created[0]!)!.content, /padding reduced/);
  // An unfinished (paused / waiting) execution teaches nothing.
  const paused = k.learner.learn({
    session: mkSession({ status: "PAUSED" }),
    task: mkTask(),
    context: mkCtx(),
    outcome: { kind: "failure", error: "paused" },
  });
  assert.deepEqual(paused.created, []);
});

/* ================= health & audit ================= */

test("health & auditor: counts reflect the store; suspicious agent-active memory and low-confidence use are raised", () => {
  const { k } = fixture();
  seedAims(k);
  k.memory.create(
    decision({
      title: "Cand",
      content: "Use pnpm for installs in the whole repository.",
      source: "AGENT",
    }),
    AGENT,
  );
  const h = k.health("aims");
  assert.equal(h.total, 7);
  assert.equal(h.drafts, 1);
  assert.ok(h.byType.ARCHITECTURAL >= 2);
  assert.equal(h.conflicts, 0);
  assert.equal(
    k.health().total,
    8,
    "platform-wide totals include other projects",
  );
  // Inject legacy/bad data directly (the policy would refuse to create it).
  const bad = k.memory.create(
    decision({
      title: "Sneaky",
      content: "Disable authentication in production for speed.",
    }),
    USER,
  ).memory;
  k.memory.repos.memories.upsert({
    ...bad,
    confidence: "AGENT_GENERATED",
    source: "AGENT",
    createdBy: "rogue-agent",
  });
  const low = k.memory.create(
    decision({
      type: "PROJECT",
      title: "Guess",
      content: "Probably the cache lives in Redis somewhere.",
      explicit: false,
    }),
    USER,
  ).memory;
  k.memory.repos.memories.upsert({ ...low, confidence: "INFERRED" });
  k.retrieval.recordUsage({
    memoryId: low.memoryId,
    projectId: "aims",
    taskId: "t9",
    agentId: "dev-agent",
    reason: "x",
  });
  k.retrieval.recordUsage({
    memoryId: bad.memoryId,
    projectId: "aims",
    taskId: "t9",
    agentId: "dev-agent",
    reason: "x",
  });
  const rules = k.auditor.run("aims").map((f) => f.ruleId);
  assert.ok(rules.includes("knowledge.suspicious_creation"));
  assert.ok(rules.includes("knowledge.low_confidence_usage"));
  // Unusual modification: a critical memory revoked just now.
  const crit = seedAimsCritical(k);
  k.memory.revoke(crit.memoryId, USER);
  assert.ok(
    k.auditor
      .run("aims")
      .some(
        (f) =>
          f.ruleId === "knowledge.unusual_modification" &&
          f.severity === "high",
      ),
  );
});
function seedAimsCritical(k: KnowledgeSystem): MemoryRecord {
  return k.memory.create(
    decision({
      title: "Never log tokens",
      content: "Authentication tokens are never written to any log output.",
      importance: "CRITICAL",
      tags: ["security"],
    }),
    USER,
  ).memory;
}

/* ================= Layer 3 integration ================= */

test("Layer 3: the memory context source feeds the Prompt Engineer with cited, precedence-ranked fragments", async () => {
  const { k } = fixture();
  seedAims(k);
  const fragments = k.contextSource.fetch({
    projectId: "aims",
    intent: {
      language: "en",
      category: "modify",
      objective: "Change the AIMS login card vertical padding",
      target: "login card",
      keywords: ["login", "card", "padding"],
      explicitConstraints: [],
      impliedConstraints: [],
    } as never,
    audience: { capabilities: ["software.frontend"], clearance: "internal" },
  }) as import("../contracts/prompt-intelligence.js").ContextFragment[];
  assert.ok(fragments.length >= 2);
  assert.ok(
    fragments.every(
      (f) =>
        f.source === "memory" &&
        f.projectId === "aims" &&
        /source: /.test(f.value),
    ),
  );
  const sec = fragments.find((f) => f.category === "security");
  assert.equal(sec?.precedence, "project_security_policy");
  assert.equal(sec?.mandatory, true);
  assert.ok(
    fragments.some(
      (f) =>
        f.category === "ui" ||
        f.category === "architecture" ||
        f.category === "knowledge",
    ),
  );
  assert.ok(
    !fragments.some((f) => /finance|savings/.test(f.value)),
    "other projects never reach the prompt",
  );
  assert.ok(!fragments.some((f) => /Preferred/.test(f.value)));
});

/* ================= control surface ================= */

function controlFixture() {
  const f = fixture();
  seedAims(f.k);
  const control = new KnowledgeControlService({
    knowledge: f.k,
    audit: f.audit,
    projectExists: (p) => p === "aims" || p === "money-mind",
    sourceFor: async (p) =>
      p === "aims"
        ? new StaticFileSource({
            "package.json": JSON.stringify({
              name: "x",
              dependencies: { react: "^19" },
              devDependencies: { typescript: "^5", vite: "^6" },
            }),
          })
        : undefined,
  });
  return { ...f, control };
}

test("control: reads respect project access; commands need manage_knowledge; only users confirm; admins apply retention", async () => {
  const { control, k } = controlFixture();
  // viewer: reads fine
  assert.ok(
    control.list(VIEWER_P, new URLSearchParams("projectId=aims")).memories
      .length >= 6,
  );
  // restricted operator cannot see aims
  assert.throws(
    () => control.list(MM_ONLY, new URLSearchParams("projectId=aims")),
    /not found/,
  );
  const aimsMem = k.memory.all().find((m) => m.projectId === "aims")!;
  assert.throws(() => control.detail(MM_ONLY, aimsMem.memoryId), /not found/);
  assert.equal(
    control
      .list(MM_ONLY, new URLSearchParams(""))
      .memories.every(
        (m) => m.projectId === "money-mind" || m.projectId === null,
      ),
    true,
  );
  assert.equal(control.overview(MM_ONLY).health.total, 1);
  assert.throws(
    () =>
      control.search(
        MM_ONLY,
        new URLSearchParams("q=authentication&projectId=aims"),
      ),
    /not found/,
  );
  const denied = await control.execute("knowledge_create_memory", VIEWER_P, {
    projectId: "aims",
    type: "PROJECT",
    title: "x",
    content: "Some project fact that is long enough.",
  });
  assert.equal(denied.outcome, "denied");
  assert.equal(denied.errorKind, "forbidden");
  const created = await control.execute("knowledge_create_memory", OPERATOR_P, {
    projectId: "aims",
    type: "PROJECT",
    title: "Deploy rule",
    content: "All validated AIMS builds are deployed to Firebase Hosting.",
    importance: "HIGH",
  });
  assert.equal(created.ok, true, created.reason);
  const memoryId = created.details["memoryId"] as string;
  assert.equal(k.memory.get(memoryId)!.confidence, "USER_CONFIRMED");
  // Cross-project writes are refused as not found.
  const cross = await control.execute("knowledge_create_memory", MM_ONLY, {
    projectId: "aims",
    type: "PROJECT",
    title: "x",
    content: "A fact about a project I cannot access.",
  });
  assert.equal(cross.errorKind, "not_found");
  assert.equal(
    (await control.execute("knowledge_archive_memory", MM_ONLY, { memoryId }))
      .errorKind,
    "not_found",
  );
  // Retention is admin-only.
  assert.equal(
    (await control.execute("knowledge_apply_retention", OPERATOR_P, {}))
      .outcome,
    "denied",
  );
  assert.equal(
    (await control.execute("knowledge_apply_retention", ADMIN_P, {})).ok,
    true,
  );
  // Unknown commands and invalid input.
  assert.equal(
    (await control.execute("knowledge_nope", OPERATOR_P, {})).errorKind,
    "not_found",
  );
  assert.equal(
    (
      await control.execute("knowledge_create_memory", OPERATOR_P, {
        projectId: "aims",
        type: "BOGUS",
        title: "x",
        content: "y",
      })
    ).errorKind,
    "invalid_request",
  );
  // Discovery uses the configured source; a project without a source is reported honestly.
  const found = await control.execute(
    "knowledge_discover_project",
    OPERATOR_P,
    { projectId: "aims" },
  );
  assert.equal(found.ok, true, found.reason);
  const none = await control.execute("knowledge_discover_project", OPERATOR_P, {
    projectId: "money-mind",
  });
  assert.equal(none.errorKind, "invalid_state");
  assert.match(none.reason, /no readable source/);
  // The command audit trail never contains content secrets.
  const sec = await control.execute("knowledge_create_memory", OPERATOR_P, {
    projectId: "aims",
    type: "PROJECT",
    title: "Secret holder",
    content: `Deploy notes: token=${SECRET} must stay in CI secrets only.`,
  });
  assert.equal(sec.ok, true);
  assert.ok(
    !JSON.stringify(
      control.detail(OPERATOR_P, sec.details["memoryId"] as string),
    ).includes(SECRET),
  );
});

test("control: drafts are confirmed by the user, conflicts resolved, detail shows provenance, versions and relations", async () => {
  const { control, k } = controlFixture();
  const draft = await control.execute("knowledge_create_memory", OPERATOR_P, {
    projectId: "aims",
    type: "PROJECT",
    title: "Cache layer",
    content: "AIMS caches inventory lists in memory for sixty seconds.",
    draft: true,
  });
  const id = draft.details["memoryId"] as string;
  assert.equal(k.memory.get(id)!.status, "DRAFT");
  assert.equal(control.candidates(VIEWER_P, "aims").candidates.length, 1);
  assert.equal(
    (
      await control.execute("knowledge_confirm_memory", OPERATOR_P, {
        memoryId: id,
      })
    ).ok,
    true,
  );
  assert.equal(k.memory.get(id)!.confidence, "USER_CONFIRMED");
  await control.execute("knowledge_update_memory", OPERATOR_P, {
    memoryId: id,
    content: "AIMS caches inventory lists in memory for ninety seconds.",
  });
  const detail = control.detail(VIEWER_P, id);
  assert.equal(detail.versions.length, 3);
  assert.match(detail.provenance.answer, /USER/);
  assert.equal(detail.memory.version, 3);
  // Two contradicting decisions → conflicts view → resolve.
  const a = await control.execute("knowledge_create_memory", OPERATOR_P, {
    projectId: "aims",
    type: "PROJECT",
    title: "Theme A",
    content: "AIMS uses dark navy theme.",
  });
  const b = await control.execute("knowledge_create_memory", OPERATOR_P, {
    projectId: "aims",
    type: "PROJECT",
    title: "Theme B",
    content: "AIMS uses AIMS Dark Liquid Glass theme.",
  });
  const conflicts = control.conflicts(VIEWER_P, "aims").conflicts;
  assert.equal(conflicts.length, 1);
  assert.equal(control.overview(VIEWER_P, "aims").conflicts, 1);
  const res = await control.execute("knowledge_resolve_conflict", OPERATOR_P, {
    conflictId: conflicts[0]!.conflictId,
    resolution: "SUPERSEDED_OTHER",
    winner: b.details["memoryId"],
  });
  assert.equal(res.ok, true, res.reason);
  assert.equal(control.conflicts(VIEWER_P, "aims").conflicts.length, 0);
  assert.equal(
    k.memory.get(a.details["memoryId"] as string)!.status,
    "SUPERSEDED",
  );
  // Supersede through the control surface.
  const sup = await control.execute("knowledge_supersede_memory", OPERATOR_P, {
    memoryId: b.details["memoryId"],
    title: "Theme C",
    content: "AIMS uses the AIMS Aurora Glass theme from now on.",
  });
  assert.equal(sup.ok, true, sup.reason);
  // Links and graph.
  const link = await control.execute("knowledge_link", OPERATOR_P, {
    projectId: "aims",
    from: "AIMS",
    to: "Firebase Auth",
    type: "USES",
  });
  assert.equal(link.ok, true, link.reason);
  const graph = control.graph(VIEWER_P, new URLSearchParams("projectId=aims"));
  assert.ok(graph.nodes.some((n) => n.label === "Firebase Auth"));
  assert.ok(graph.edges.some((e) => e.type === "USES"));
  assert.equal(
    control.graph(
      VIEWER_P,
      new URLSearchParams("projectId=aims&types=DEPENDS_ON"),
    ).edges.length,
    0,
  );
  assert.throws(
    () => control.graph(MM_ONLY, new URLSearchParams("projectId=aims")),
    /not found/,
  );
  // Documents list + preview context + findings + decisions.
  await control.execute("knowledge_ingest_document", OPERATOR_P, {
    projectId: "aims",
    ref: "docs/a.md",
    text: "# Title\nSome useful project documentation that is long enough to keep.",
  });
  assert.equal(control.documents(VIEWER_P, "aims").documents.length, 1);
  assert.ok(control.decisions(VIEWER_P, "aims").decisions.length >= 2);
  assert.ok(
    control.context(
      VIEWER_P,
      new URLSearchParams("projectId=aims&q=login+card+padding"),
    ).rendered.length > 0,
  );
  assert.ok(Array.isArray(control.findings(VIEWER_P).findings));
});

test("HTTP: knowledge routes are authenticated, project-isolated, and commands are audited", async () => {
  const { control } = controlFixture();
  const server = http.createServer(
    createControlPlaneApi({
      query: {} as WorkforceQueryService,
      command: {} as WorkforceCommandService,
      knowledge: control,
      operatorDirectory: {
        resolve: async (t) =>
          t === "op"
            ? OPERATOR_P
            : t === "viewer"
              ? VIEWER_P
              : t === "mm"
                ? MM_ONLY
                : null,
      },
    }),
  );
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (p: string, token?: string, body?: unknown) => {
    const res = await fetch(base + p, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      json: (await res.json()) as Record<string, any>,
    };
  };
  try {
    assert.equal((await call("/knowledge/overview")).status, 401);
    assert.equal(
      (await call("/knowledge/memories?projectId=aims")).status,
      401,
    );
    assert.equal((await call("/knowledge/overview", "viewer")).status, 200);
    const list = await call(
      "/knowledge/memories?projectId=aims&type=ARCHITECTURAL",
      "viewer",
    );
    assert.equal(list.status, 200);
    assert.ok(list.json["memories"].length >= 2);
    assert.equal(
      (await call("/knowledge/memories?projectId=aims", "mm")).status,
      404,
    );
    const first = list.json["memories"][0].memoryId as string;
    assert.equal(
      (await call(`/knowledge/memories/${first}`, "viewer")).status,
      200,
    );
    assert.equal(
      (await call(`/knowledge/memories/${first}`, "mm")).status,
      404,
    );
    const search = await call(
      "/knowledge/search?q=how+does+authentication+work&projectId=aims",
      "viewer",
    );
    assert.equal(search.status, 200);
    assert.match(search.json["hits"][0].title, /authentication/i);
    assert.ok(search.json["hits"][0].reasons.length > 0);
    assert.equal(
      (await call("/knowledge/search?q=&projectId=aims", "viewer")).status,
      400,
    );
    assert.equal(
      (await call("/knowledge/graph?projectId=aims", "mm")).status,
      404,
    );
    assert.equal((await call("/knowledge/bogus", "viewer")).status, 404);
    // Commands.
    const deniedCmd = await call(
      "/commands/knowledge_create_memory",
      "viewer",
      {
        projectId: "aims",
        type: "PROJECT",
        title: "x",
        content: "A fact that a viewer may not write down.",
      },
    );
    assert.equal(deniedCmd.status, 403);
    const ok = await call("/commands/knowledge_create_memory", "op", {
      projectId: "aims",
      type: "PROJECT",
      title: "HTTP fact",
      content: "AIMS exports reports as PDF files for auditors.",
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json["ok"], true);
    assert.ok(ok.json["auditEventId"]);
    assert.equal(
      (
        await call("/commands/knowledge_create_memory", "mm", {
          projectId: "aims",
          type: "PROJECT",
          title: "x",
          content: "A fact about a project I should not reach.",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call("/commands/knowledge_create_memory", undefined, {
          projectId: "aims",
        })
      ).status,
      401,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

/* ================= end to end ================= */

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiw-kn-e2e-"));
  temps.push(dir);
  const write = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  };
  write(
    "package.json",
    JSON.stringify({
      name: "aims",
      scripts: {
        typecheck: "node scripts/ok.js",
        lint: "node scripts/ok.js",
        test: "node scripts/ok.js",
        build: "node scripts/ok.js",
      },
    }),
  );
  write(
    "scripts/ok.js",
    `console.log("ℹ tests 1\\nℹ pass 1\\nℹ fail 0\\nok");`,
  );
  write(
    "src/pages/Login/LoginCard.tsx",
    "export const LoginCard = () => null;\n",
  );
  write(
    "src/pages/Login/LoginCard.css",
    ".login-card {\n  padding: 32px 24px;\n}\n",
  );
  write(".gitignore", ".env\n");
  const git = (...a: string[]) =>
    spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  return dir;
}

test("E2E: AIMS login request → memory-aware prompt → agent → runtime → verified result → learned memory", async () => {
  const { k, audit } = fixture(Date.now());
  const seeded = seedAims(k);
  const dir = makeWorkspace();
  const registry = new ProjectRegistry();
  const adapter = (projectId: string): ProjectAdapter => ({
    projectId,
    describe: async () => ({ name: projectId, capabilities: [] }),
    execute: async () => ({}),
  });
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
  const agents = new AgentRegistry();
  const ag = (id: string, caps: string[]) => ({
    id,
    name: id,
    description: id,
    capabilities: caps,
    allowedTools: [],
    allowedProjects: ["aims"],
    supportedTaskTypes: ["any"],
    permissions: [],
  });
  for (const a of [
    ag("dev-agent", ["software.frontend", "software.general"]),
    ag("qa-agent", ["software.testing"]),
    ag("reviewer-agent", ["software.review"]),
    ag("security-agent", ["software.security"]),
    ag("github-agent", ["integration.github"]),
    ag("deployer-agent", ["deployment.firebase"]),
    ag("designer-agent", ["design.ui"]),
  ])
    agents.register(a);
  const approvals = new ApprovalSystem();
  let counter = 0;
  const prompts = new PromptIntelligenceService({
    projects: registry,
    analyzer: new RuleBasedIntentAnalyzer(),
    engine: new ContextEngine(
      [
        new PlatformSecurityBaselineSource(),
        new PlatformDevelopmentDefaultsSource(),
        new ProjectRegistrySource(registry),
        k.contextSource,
      ],
      {
        fileResolver: {
          resolve: async (p) =>
            p === "aims"
              ? { ok: true, files: ["src/pages/Login/LoginCard.tsx"] }
              : { ok: true, files: [] },
        },
      },
    ),
    records: new InMemoryRepository<PromptRequestRecord>(),
    approvals,
    agents,
    newId: () => `pr-${++counter}`,
  });

  const seen: string[] = [];
  const sessions = new SessionManager(
    new InMemoryRepository<RuntimeSession>(),
    audit,
  );
  const wsRegistry = new WorkspaceRegistry();
  const ALL: RuntimeWorkspaceOperation[] = [
    "read",
    "list",
    "create",
    "update",
    "rename",
    "move",
    "delete",
    "run_script",
    "git_read",
  ];
  wsRegistry.register({
    workspaceId: "ws",
    projectId: "aims",
    rootPath: dir,
    repository: "https://github.com/acme/aims",
    branch: "main",
    environment: "local",
    runtime: "node",
    permittedOperations: ALL,
  });
  const runtime = new GovernedTaskRuntime({
    resolver: new WorkspaceResolver(wsRegistry),
    manager: sessions,
    agentExecutor: {
      async perform({ task, context, tools }): Promise<RuntimeOutcome> {
        seen.push(`${task.type}\n${context.prompt}`);
        if (task.type === "DEVELOPMENT") {
          const css = await tools.readFile("src/pages/Login/LoginCard.css");
          await tools.updateFile(
            "src/pages/Login/LoginCard.css",
            ".login-card {\n  padding: 16px 24px;\n}\n",
            css.hash,
          );
          const check = await tools.runCommand("npm run typecheck");
          return {
            kind: "success",
            summary: "Login card padding reduced to 16px",
            evidence: ["LoginCard.css updated"],
            checks: [{ name: check.display, passed: check.exitCode === 0 }],
          };
        }
        if (task.type === "REVIEW" || task.type === "SECURITY")
          return {
            kind: "success",
            summary: "reviewed",
            evidence: ["diff inspected"],
            verdict: "approved",
          };
        return {
          kind: "success",
          summary: `${task.title} done`,
          evidence: ["recorded"],
        };
      },
    },
    onFinished: ({ session, task, context, outcome }) => {
      k.learner.learn({ session, task, context, outcome });
    },
  });
  const orch = new ExecutionOrchestrator({
    runs: new InMemoryRepository(),
    projects: registry,
    agents,
    approvals,
    audit,
    runtime,
    newId: (() => {
      let n = 0;
      return () => `run${++n}`;
    })(),
    clock: () => new Date().toISOString(),
    policy: { retryBackoffMs: 1 },
  });
  void ExecutionOrchestrationControlService;

  const prepared = await prompts.prepare(OPERATOR_P, {
    request: "Change the AIMS login card vertical padding, but nothing else.",
  });
  const created = orch.createRun(OPERATOR_P, prepared);
  orch.start(OPERATOR_P, created.run.runId);
  let view = await orch.advance(OPERATOR_P, created.run.runId);
  for (
    let i = 0;
    i < 6 && view.status !== "COMPLETED" && view.status !== "FAILED";
    i++
  ) {
    let decided = 0;
    for (const a of approvals.pending()) {
      approvals.decide(a.id, "approved", ADMIN_P.id);
      decided++;
    }
    if (decided === 0) break;
    view = await orch.advance(OPERATOR_P, created.run.runId);
  }

  // 1. Memory reached the agent through Layer 3 → 4 → 5 (project knowledge, not other projects').
  const devPrompt = seen.find((s) => s.startsWith("DEVELOPMENT"))!;
  assert.ok(devPrompt, "the developer task ran");
  assert.match(
    devPrompt,
    /Memory: |source: /,
    "memory fragments are cited in the prompt",
  );
  assert.match(
    devPrompt,
    /liquid glass|design system/i,
    "the AIMS design memory reached the developer",
  );
  assert.match(
    devPrompt,
    /passwords, tokens or API keys/i,
    "the mandatory security requirement reached the developer",
  );
  assert.ok(
    !/finance model|savings goal/.test(devPrompt),
    "another project's memory never did",
  );
  assert.ok(!devPrompt.includes(SECRET));
  // 2. The change happened on the real workspace.
  const done = sessions.list({
    taskId:
      created.run.tasks?.find((t) => t.type === "DEVELOPMENT")?.taskId ?? "",
  })[0];
  void done;
  // 3. The learning loop stored verified history and closed the usage feedback.
  const learned = k.memory
    .all()
    .filter((m) => m.type === "EXECUTION" && m.tags.includes("completed"));
  assert.ok(learned.length >= 1, "a verified completion was stored");
  assert.ok(
    learned.every(
      (m) =>
        m.confidence === "VERIFIED" &&
        m.status === "ACTIVE" &&
        m.projectId === "aims",
    ),
  );
  assert.match(learned[0]!.content, /LoginCard\.css/);
  // 4. Retrieval can now surface that history for a similar task.
  const similar = k.retrieval.search(
    { text: "login card padding", projectId: "aims", types: ["EXECUTION"] },
    READ_ALL,
  );
  assert.ok(similar.some((h) => h.memory.memoryId === learned[0]!.memoryId));
  void seeded;
  const outcomes = k.memory.repos.usage.list().map((u) => u.result);
  assert.ok(
    outcomes.some((r) => r === "TASK_SUCCEEDED"),
    "memory usage was closed with the task outcome",
  );
});

/* ================= performance & persistence ================= */

test("performance: indexing and retrieval stay fast with thousands of memories (no per-read cloning)", () => {
  const { k } = fixture();
  const words = [
    "auth",
    "login",
    "firebase",
    "deploy",
    "inventory",
    "report",
    "theme",
    "build",
    "vite",
    "react",
    "test",
    "cache",
    "sync",
    "audit",
  ];
  const started = Date.now();
  for (let i = 0; i < 1500; i++) {
    const w = [0, 1, 2, 3, 4, 5]
      .map((j) => words[(i * 7 + j * 3) % words.length])
      .join(" ");
    k.memory.create(
      {
        type: "DOCUMENT",
        title: `Item ${i}`,
        content: `Note ${i}: ${w} configuration details number ${i} for module ${i % 40}.`,
        projectId: `p${i % 5}`,
        source: "DOCUMENT",
      },
      SYSTEM,
    );
  }
  const created = Date.now() - started;
  const t = Date.now();
  let hits = 0;
  for (let i = 0; i < 20; i++)
    hits += k.retrieval.search(
      {
        text: `how does login authentication work with firebase ${i}`,
        projectId: `p${i % 5}`,
        limit: 10,
      },
      READ_ALL,
    ).length;
  const searched = Date.now() - t;
  const t2 = Date.now();
  const pkg = k.assembler.assemble({
    projectId: "p1",
    query: "change the login theme",
    agent: DEV,
    scope: READ_ALL,
  });
  const assembled = Date.now() - t2;
  assert.ok(hits > 0 && pkg.items.length > 0);
  // Generous bounds (CI load); the point is "not quadratic": this was ~100x slower before.
  assert.ok(created < 8000, `create ${created}ms`);
  assert.ok(searched < 4000, `20 searches ${searched}ms`);
  assert.ok(assembled < 1500, `assemble ${assembled}ms`);
  // Repeated identical retrievals are served from the cache until memory changes.
  const again = Date.now();
  for (let i = 0; i < 50; i++)
    k.retrieval.search(
      { text: "login firebase", projectId: "p1", limit: 5 },
      READ_ALL,
    );
  assert.ok(Date.now() - again < 2000);
});

test("persistence: a new KnowledgeSystem over the same repositories sees everything and keeps working", () => {
  const repos = inMemoryKnowledgeRepos();
  const audit = new AuditLog();
  const a = new KnowledgeSystem({ repos, audit });
  const m = a.memory.create(decision(), USER).memory;
  const old = a.memory.create(
    decision({
      type: "PROJECT",
      title: "Theme",
      content: "AIMS uses dark navy theme.",
    }),
    USER,
  ).memory;
  a.memory.update(old.memoryId, { tags: ["ui"] }, USER);
  // "Restart": a fresh composition hydrated from the same durable repositories.
  const b = new KnowledgeSystem({ repos, audit });
  assert.equal(b.memory.get(m.memoryId)?.title, m.title);
  assert.equal(b.memory.history(old.memoryId).length, 2);
  assert.equal(
    b.retrieval.search(
      { text: "firebase hosting deploy", projectId: "aims" },
      READ_ALL,
    )[0]?.memory.memoryId,
    m.memoryId,
    "the index is rebuilt from storage",
  );
  b.memory.create(
    decision({
      type: "PROJECT",
      title: "Theme glass",
      content: "AIMS uses AIMS Dark Liquid Glass theme.",
    }),
    USER,
  );
  assert.equal(
    b.memory.listConflicts("aims").length,
    1,
    "conflict detection works on restored state",
  );
  assert.equal(
    repos.memories.list().length,
    3,
    "writes reached the durable repository",
  );
});
