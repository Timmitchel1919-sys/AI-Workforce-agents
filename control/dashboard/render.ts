/**
 * Pure HTML rendering for the operations console. No framework, no DOM, no
 * network — each function takes a piece of a `DashboardSnapshot` and returns an
 * HTML string. Deterministic and unit-testable. Every interpolated value is
 * HTML-escaped.
 *
 * `buildDashboardHtml` (build-html.ts) assembles these into one self-contained
 * document. The real data always comes from `WorkforceQueryService`.
 */
import {
  type AgentView,
  type ApprovalView,
  type AuditEventView,
  type DashboardSnapshot,
  type ProjectView,
  type SystemHealth,
  type TaskView,
  type ToolView,
  type WorkforceStatus,
  type WorkflowView,
} from "../../contracts/index.js";

export const DASHBOARD_VIEWS = [
  "overview",
  "agents",
  "workflows",
  "tasks",
  "approvals",
  "projects",
  "tools",
  "audit",
  "health",
] as const;
export type DashboardViewId = (typeof DASHBOARD_VIEWS)[number];

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const esc = escapeHtml;

function empty(message: string): string {
  return `<p class="empty">${esc(message)}</p>`;
}

function badge(text: string): string {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return `<span class="badge badge--${esc(slug)}">${esc(text)}</span>`;
}

function table(headers: readonly string[], rows: readonly string[][]): string {
  if (rows.length === 0) return empty("Nothing to show.");
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function statTile(label: string, value: number | string): string {
  return `<div class="tile"><div class="tile__value">${esc(value)}</div><div class="tile__label">${esc(label)}</div></div>`;
}

/* ------------------------------------------------------------------ */

export function renderOverview(
  status: WorkforceStatus,
  recent: readonly AuditEventView[],
): string {
  const c = status.counts;
  const tiles = [
    statTile("Active workflows", c.activeWorkflows),
    statTile("Running tasks", c.runningTasks),
    statTile("Pending approvals", c.awaitingApproval),
    statTile("Blocked tasks", c.blockedTasks),
    statTile("Failed tasks", c.failedTasks),
    statTile("Registered agents", c.registeredAgents),
    statTile("Registered projects", c.registeredProjects),
    statTile("Available tools", c.availableTools),
  ].join("");
  return `
    <h2>Workforce status ${badge(status.status)}</h2>
    <div class="tiles">${tiles}</div>
    <h3>Recent activity</h3>
    ${renderAuditRows(recent)}
  `;
}

export function renderAgents(agents: readonly AgentView[]): string {
  if (agents.length === 0) return empty("No agents registered.");
  const rows = agents.map((a) => [
    esc(a.name),
    esc(a.role),
    badge(a.status),
    a.enabled ? "yes" : `no — ${esc(a.disabledReason ?? "disabled")}`,
    esc(a.capabilities.join(", ")),
    a.currentTaskId ? esc(a.currentTaskId) : "—",
    a.stats.successRate === null
      ? "—"
      : `${Math.round(a.stats.successRate * 100)}% (${a.stats.completed}/${a.stats.completed + a.stats.failed})`,
    a.lastActivityAt ? esc(a.lastActivityAt) : "—",
  ]);
  return table(
    [
      "Name",
      "Role",
      "Status",
      "Enabled",
      "Capabilities",
      "Current task",
      "Success",
      "Last activity",
    ],
    rows,
  );
}

export function renderWorkflows(workflows: readonly WorkflowView[]): string {
  if (workflows.length === 0) return empty("No workflows yet.");
  return workflows
    .map((w) => {
      const pct =
        w.progress.total === 0
          ? 0
          : Math.round((w.progress.completed / w.progress.total) * 100);
      const stages = w.stages
        .map(
          (s) =>
            `<li class="stage stage--${esc(s.status)}">${esc(s.type)} <small>${esc(s.status)}</small>${s.error ? `<div class="stage__err">${esc(s.error)}</div>` : ""}</li>`,
        )
        .join("");
      return `
        <article class="wf">
          <h3>${esc(w.name)} ${badge(w.status)}${w.paused ? badge("paused") : ""}</h3>
          <p class="muted">${esc(w.projectId)} · ${w.progress.completed}/${w.progress.total} tasks (${pct}%) · ${w.pendingApprovals} pending approval(s)</p>
          <div class="progress"><div class="progress__bar" style="width:${pct}%"></div></div>
          <ol class="stages">${stages}</ol>
          ${w.error ? `<p class="err">${esc(w.error)}</p>` : ""}
        </article>`;
    })
    .join("");
}

export function renderTasks(
  tasks: readonly TaskView[],
  filter: { status?: string; projectId?: string } = {},
): string {
  let shown = tasks;
  if (filter.status) shown = shown.filter((t) => t.status === filter.status);
  if (filter.projectId)
    shown = shown.filter((t) => t.projectId === filter.projectId);
  if (shown.length === 0) return empty("No tasks match the current filter.");
  const rows = shown.map((t) => [
    esc(t.taskId),
    esc(t.type),
    esc(t.projectId),
    badge(t.status),
    esc(t.priority),
    t.assignedAgentId ? esc(t.assignedAgentId) : "—",
    t.workflowId ? esc(t.workflowId) : "—",
    String(t.retryCount),
    t.failureReason ? esc(t.failureReason) : "—",
    esc(t.updatedAt),
  ]);
  return table(
    [
      "Task",
      "Type",
      "Project",
      "Status",
      "Priority",
      "Agent",
      "Workflow",
      "Retries",
      "Failure",
      "Updated",
    ],
    rows,
  );
}

export function renderApprovals(approvals: readonly ApprovalView[]): string {
  const pending = approvals.filter((a) => a.status === "requested");
  if (pending.length === 0 && approvals.length === 0) {
    return empty("No approvals.");
  }
  const card = (a: ApprovalView, actionable: boolean): string => `
    <article class="approval approval--${esc(a.risk)}">
      <header><strong>WHAT</strong> ${esc(a.action)} ${badge(a.risk + " risk")} ${badge(a.status)}</header>
      <dl>
        <dt>WHO</dt><dd>${esc(a.agentId ?? a.requestedBy)}</dd>
        <dt>WHERE</dt><dd>${esc(a.projectId ?? "—")}</dd>
        <dt>WHY</dt><dd>${esc(a.reason)}${a.taskId ? ` (task ${esc(a.taskId)})` : ""}${a.workflowId ? ` (workflow ${esc(a.workflowId)})` : ""}</dd>
        <dt>WHEN</dt><dd>requested ${esc(a.requestedAt)}${a.expiresAt ? `, expires ${esc(a.expiresAt)}` : ""}</dd>
      </dl>
      ${
        actionable
          ? `<div class="actions">
               <button data-command="approve" data-approval="${esc(a.approvalId)}"${a.risk === "high" ? ' data-confirm="true"' : ""}>Approve</button>
               <button data-command="reject" data-approval="${esc(a.approvalId)}" class="danger">Reject</button>
             </div>`
          : `<p class="muted">Decided ${esc(a.decidedAt ?? "")} by ${esc(a.decidedBy ?? "")}</p>`
      }
    </article>`;
  const parts: string[] = [];
  if (pending.length > 0) {
    parts.push(
      `<h3>Pending (${pending.length})</h3>`,
      pending.map((a) => card(a, true)).join(""),
    );
  } else {
    parts.push(empty("No pending approvals."));
  }
  const decided = approvals.filter((a) => a.status !== "requested");
  if (decided.length > 0) {
    parts.push(
      `<h3>Recent decisions</h3>`,
      decided
        .slice(0, 20)
        .map((a) => card(a, false))
        .join(""),
    );
  }
  return parts.join("");
}

export function renderProjects(projects: readonly ProjectView[]): string {
  if (projects.length === 0) {
    return empty("No project adapters registered.");
  }
  return projects
    .map(
      (p) => `
      <article class="project">
        <h3>${esc(p.displayName)} ${badge(p.status)} <small>adapter ${esc(p.adapterStatus)}</small></h3>
        <p class="muted">${esc(p.projectId)} · ${p.activeWorkflows} active workflow(s) · ${p.connectedAgents.length} connected agent(s)</p>
        <details><summary>${p.capabilities.length} capabilities</summary>
          <ul>${p.capabilities.map((c) => `<li><code>${esc(c.operation)}</code> — ${esc(c.description)} <em>(${esc(c.action)})</em></li>`).join("")}</ul>
        </details>
        <h4>Recent activity</h4>${renderAuditRows(p.recentActivity)}
      </article>`,
    )
    .join("");
}

export function renderTools(tools: readonly ToolView[]): string {
  if (tools.length === 0) return empty("No tools registered.");
  const rows = tools.map((t) => [
    esc(t.toolId),
    esc(t.version),
    esc(t.capabilities.join(", ")),
    esc(t.allowedAgents.join(", ")),
    esc(t.allowedProjects.join(", ")),
    esc(t.requiredPermission),
    t.approvalRequired ? "yes" : "no",
    `${t.stats.completed}✓ / ${t.stats.failed}✗ / ${t.stats.denied}⛔`,
  ]);
  return table(
    [
      "Tool",
      "Version",
      "Capabilities",
      "Allowed agents",
      "Allowed projects",
      "Permission",
      "Approval",
      "Executions",
    ],
    rows,
  );
}

export function renderAuditRows(events: readonly AuditEventView[]): string {
  if (events.length === 0) return empty("No audit events.");
  const rows = events.map((e) => [
    esc(e.timestamp),
    esc(e.type),
    e.actor ? esc(e.actor) : "—",
    esc(
      [e.projectId, e.workflowId, e.taskId, e.toolId]
        .filter(Boolean)
        .join(" / ") || "—",
    ),
    e.outcome ? badge(e.outcome) : "—",
  ]);
  return table(["Time", "Event", "Actor", "Resource", "Outcome"], rows);
}

export function renderAudit(page: {
  items: readonly AuditEventView[];
  total: number;
  nextCursor: string | null;
}): string {
  return `
    <p class="muted">${page.items.length} of ${page.total} events${page.nextCursor ? " (more available)" : ""}</p>
    ${renderAuditRows(page.items)}
  `;
}

export function renderHealth(health: SystemHealth): string {
  const rows = health.components.map((c) => [
    esc(c.name),
    badge(c.status),
    esc(c.detail),
    esc(c.checkedAt),
  ]);
  return `
    <h2>System health ${badge(health.status)}</h2>
    ${table(["Component", "Status", "Detail", "Checked"], rows)}
  `;
}

/* ------------------------------------------------------------------ */

export function renderSnapshotBody(snapshot: DashboardSnapshot): string {
  const sections: Record<DashboardViewId, string> = {
    overview: renderOverview(snapshot.status, snapshot.recentAudit),
    agents: renderAgents(snapshot.agents),
    workflows: renderWorkflows(snapshot.workflows),
    tasks: renderTasks(snapshot.tasks),
    approvals: renderApprovals(snapshot.approvals),
    projects: renderProjects(snapshot.projects),
    tools: renderTools(snapshot.tools),
    audit: renderAuditRows(snapshot.recentAudit),
    health: renderHealth(snapshot.health),
  };
  const banner = snapshot.error
    ? `<div class="banner banner--error">Snapshot incomplete: ${esc(snapshot.error)}</div>`
    : "";
  return (
    banner +
    DASHBOARD_VIEWS.map(
      (view, i) =>
        `<section id="view-${view}" data-view="${view}"${i === 0 ? "" : " hidden"}>
           <h1>${esc(view[0]!.toUpperCase() + view.slice(1))}</h1>
           ${sections[view]}
         </section>`,
    ).join("")
  );
}
