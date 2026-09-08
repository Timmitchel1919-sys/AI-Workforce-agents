import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDashboardHtml,
  escapeHtml,
  renderAgents,
  renderApprovals,
  renderHealth,
  renderOverview,
  renderTasks,
  renderWorkflows,
} from "../control/index.js";
import {
  type ApprovalView,
  type DashboardSnapshot,
  type SystemHealth,
  type TaskView,
  type WorkflowView,
  type WorkforceStatus,
} from "../core/index.js";

const emptyStatus: WorkforceStatus = {
  status: "healthy",
  generatedAt: "2026-09-07T00:00:00.000Z",
  counts: {
    activeWorkflows: 0,
    queuedTasks: 0,
    runningTasks: 0,
    blockedTasks: 0,
    awaitingApproval: 0,
    failedTasks: 0,
    completedTasks: 0,
    cancelledTasks: 0,
    registeredAgents: 0,
    disabledAgents: 0,
    availableTools: 0,
    registeredProjects: 0,
  },
  recentActivity: [],
};

const emptyHealth: SystemHealth = {
  status: "degraded",
  generatedAt: "2026-09-07T00:00:00.000Z",
  components: [
    {
      name: "model-provider",
      status: "degraded",
      detail: "not checked",
      checkedAt: "2026-09-07T00:00:00.000Z",
    },
  ],
};

function snapshot(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    generatedAt: "2026-09-07T00:00:00.000Z",
    operator: { id: "op", role: "operator" },
    status: emptyStatus,
    health: emptyHealth,
    agents: [],
    workflows: [],
    tasks: [],
    approvals: [],
    projects: [],
    tools: [],
    recentAudit: [],
    ...over,
  };
}

test("dashboard: empty states render, not crashes", () => {
  assert.match(renderAgents([]), /No agents registered/);
  assert.match(renderWorkflows([]), /No workflows yet/);
  assert.match(renderTasks([]), /No tasks match/);
  assert.match(renderApprovals([]), /No approvals/);
});

test("dashboard: overview shows the real counts", () => {
  const html = renderOverview(
    { ...emptyStatus, counts: { ...emptyStatus.counts, runningTasks: 3 } },
    [],
  );
  assert.match(html, /Running tasks/);
  assert.match(html, />3</);
  assert.match(html, /No audit events/);
});

test("dashboard: approvals render Approve/Reject and confirm high risk", () => {
  const pending: ApprovalView = {
    approvalId: "ap_1",
    status: "requested",
    action: "tool:mm.run-tests:execute",
    risk: "high",
    requestedBy: "qa-agent",
    reason: "run the suite",
    toolId: "mm.run-tests",
    projectId: "money-mind",
    agentId: "qa-agent",
    requestedAt: "2026-09-07T00:00:00.000Z",
  };
  const html = renderApprovals([pending]);
  assert.match(html, /Pending \(1\)/);
  assert.match(html, /data-command="approve"/);
  assert.match(html, /data-command="reject"/);
  assert.match(html, /data-confirm="true"/);
  assert.match(html, /WHO/);
  assert.match(html, /WHY/);
});

test("dashboard: no pending approvals shows the explicit empty message", () => {
  const decided: ApprovalView = {
    approvalId: "ap_2",
    status: "approved",
    action: "tool:x:read",
    risk: "low",
    requestedBy: "a",
    reason: "r",
    requestedAt: "2026-09-07T00:00:00.000Z",
    decidedBy: "op",
    decidedAt: "2026-09-07T00:01:00.000Z",
  };
  const html = renderApprovals([decided]);
  assert.match(html, /No pending approvals/);
  assert.match(html, /Recent decisions/);
});

test("dashboard: workflow progress bar width tracks real state", () => {
  const wf: WorkflowView = {
    workflowId: "wf_1",
    name: "Pipeline",
    description: "d",
    projectId: "money-mind",
    status: "running",
    paused: false,
    progress: { completed: 1, total: 4, failed: 0, blocked: 0, fraction: 0.25 },
    pendingApprovals: 0,
    participatingAgents: ["research-agent"],
    stages: [
      {
        specId: "a",
        type: "research",
        description: "r",
        status: "completed",
        retryCount: 0,
      },
      {
        specId: "b",
        type: "qa",
        description: "q",
        status: "pending",
        retryCount: 0,
      },
    ],
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
  const html = renderWorkflows([wf]);
  assert.match(html, /width:25%/);
  assert.match(html, /1\/4 tasks \(25%\)/);
});

test("dashboard: task filtering by status", () => {
  const tasks: TaskView[] = [
    {
      taskId: "t1",
      type: "ops",
      description: "one",
      projectId: "money-mind",
      status: "failed",
      priority: "normal",
      dependsOn: [],
      retryCount: 1,
      createdAt: "x",
      updatedAt: "y",
    },
    {
      taskId: "t2",
      type: "ops",
      description: "two",
      projectId: "money-mind",
      status: "completed",
      priority: "normal",
      dependsOn: [],
      retryCount: 0,
      createdAt: "x",
      updatedAt: "y",
    },
  ];
  const failed = renderTasks(tasks, { status: "failed" });
  assert.match(failed, /t1/);
  assert.ok(!failed.includes(">t2<"));
});

test("dashboard: all interpolated values are HTML-escaped (XSS-safe)", () => {
  assert.equal(
    escapeHtml("<script>alert(1)</script>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;",
  );
  const tasks: TaskView[] = [
    {
      taskId: "t1",
      type: "<img src=x onerror=alert(1)>",
      description: "x",
      projectId: "p",
      status: "completed",
      priority: "normal",
      dependsOn: [],
      retryCount: 0,
      createdAt: "x",
      updatedAt: "y",
    },
  ];
  const html = renderTasks(tasks);
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;img src=x/);
});

test("dashboard: buildDashboardHtml is one self-contained document with every view", () => {
  const html = buildDashboardHtml(snapshot(), {
    commandEndpoint: "/api/control/command",
  });
  assert.match(html, /^<!doctype html>/);
  for (const view of [
    "overview",
    "agents",
    "workflows",
    "tasks",
    "approvals",
    "projects",
    "tools",
    "audit",
    "health",
  ]) {
    assert.ok(html.includes(`data-view="${view}"`), `missing view ${view}`);
  }
  assert.match(html, /noindex,nofollow/);
  assert.match(html, /\/api\/control\/command/);
  assert.ok(!html.includes("http://") && !html.includes("cdn"));
});

test("dashboard: an incomplete snapshot shows an error banner", () => {
  const html = buildDashboardHtml(
    snapshot({ error: "persistence unavailable" }),
  );
  assert.match(html, /banner--error/);
  assert.match(html, /persistence unavailable/);
});

test("dashboard: health view flags a degraded component", () => {
  const html = renderHealth(emptyHealth);
  assert.match(html, /model-provider/);
  assert.match(html, /badge--degraded/);
});
