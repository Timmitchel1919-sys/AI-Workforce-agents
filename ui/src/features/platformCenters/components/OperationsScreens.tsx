import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Select } from "../../../components/ui";
import type { Scope } from "../hooks/useScope";
import { useCanAdminister, useCanManage, useGet } from "../hooks/useCommand";
import { useRunner } from "../hooks/useRunner";
import { useReport } from "./report";
import { useT } from "../lib/useT";
import { riskTone, stateTone } from "../lib/tones";
import type { AutonomyAuditEvent, AutonomyCatalog, OperationsView, StepGate, WorkflowInstance } from "../types";
import { Empty, Notice, Tag } from "./common";
import { FieldsDialog } from "./FieldsDialog";
import { Async, Btn, Cards, DataTable, Panel } from "./kit";

const CAP = "manage_autonomy" as const;
const BASE = "/operations-center";

function useDialog() {
  const [node, setNode] = useState<ReactNode>(null);
  return { node, open: setNode, close: () => setNode(null) };
}

/* -------------------------------- Overview -------------------------------- */

export function OverviewTab({ scope }: { scope: Scope }) {
  const { tt } = useT();
  const query = useGet<OperationsView>("/operations-center/overview", {}, { refetchMs: 20_000 });
  const catalog = useGet<AutonomyCatalog>("/operations-center/catalog");
  const manage = useCanManage(CAP);
  const admin = useCanAdminister(CAP);
  const { run, pending } = useRunner();
  const dlg = useDialog();
  return (
    <Async query={query}>
      {(o) => (
        <div className="pc-stack">
          {o.global.emergencyStop || o.global.paused ? (
            <div className="pc-banner" role="alert" data-testid="halt-banner">
              <div>
                <strong>{o.global.emergencyStop ? tt("ops.emergencyStop") : tt("ops.pausedTitle")}</strong>
                <span>{o.global.emergencyStop ? tt("ops.emergencyBody") : (o.global.reason ?? tt("ops.pausedBody"))}</span>
              </div>
              {o.global.paused ? <Btn variant="primary" disabled={!admin || pending} onClick={() => run("autonomy_resume_all", {}, tt("ops.msg.resumed"))}>{tt("ops.resumeAll")}</Btn> : null}
            </div>
          ) : (
            <Panel title={tt("ops.brake")}>
              <p className="pc-muted">{tt("ops.brakeHelp")}</p>
              <div className="pc-actions">
                <Btn variant="danger" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("ops.pauseAll")} description={<p>{tt("ops.pauseBody")}</p>} submitLabel={tt("ops.pauseAll")} danger command="autonomy_pause_all" fields={[{ key: "reason", label: tt("ops.reason") }]} successMessage={tt("ops.msg.paused")} onClose={dlg.close} />)}>{tt("ops.pauseAll")}</Btn>
                {!manage ? <span className="pc-muted">{tt("common.needsManage")}</span> : null}
              </div>
            </Panel>
          )}
          <Panel title={tt("ops.summary")} actions={
            <>
              <Btn disabled={!manage || pending} onClick={() => run("autonomy_tick", {}, (r) => tt("ops.msg.tick", { n: String(r.details["advanced"] ?? 0) }))}>{tt("ops.tick")}</Btn>
              <Btn variant="primary" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("ops.trigger")} submitLabel={tt("ops.trigger")} command="autonomy_trigger" fields={[{ key: "definitionId", label: tt("ops.workflow"), type: "select", options: (catalog.data?.definitions ?? []).map((d) => ({ value: d.definitionId, label: d.name })), required: true }, { key: "projectId", label: tt("ops.project"), type: "select", options: scope.projects.map((p) => ({ value: p.projectId, label: p.displayName || p.projectId })), required: true }, { key: "summary", label: tt("ops.summaryField") }]} initial={scope.projectId ? { projectId: scope.projectId } : {}} successMessage={tt("ops.msg.triggered")} onClose={dlg.close} />)}>{tt("ops.trigger")}</Btn>
            </>
          }>
            <Cards items={[
              { label: tt("ops.cards.active"), value: o.counts.active },
              { label: tt("ops.cards.queued"), value: o.counts.queued },
              { label: tt("ops.cards.waiting"), value: o.counts.waitingApproval },
              { label: tt("ops.cards.failed"), value: o.counts.failed },
              { label: tt("ops.cards.blocked"), value: o.counts.blocked },
              { label: tt("ops.cards.incidents"), value: o.counts.incidents },
              { label: tt("ops.cards.recoveries"), value: o.counts.recoveries },
              { label: tt("ops.cards.completed"), value: o.counts.completed },
            ]} />
            <p className="pc-muted">{tt("ops.tickHelp")}</p>
          </Panel>
          <Panel title={tt("ops.orchestration")}>
            <Cards items={[{ label: tt("ops.cards.active"), value: o.orchestration.active }, { label: tt("ops.cards.queued"), value: o.orchestration.queued }, { label: tt("ops.cards.waiting"), value: o.orchestration.waitingApproval }, { label: tt("ops.cards.failed"), value: o.orchestration.failed }]} />
            <p className="pc-muted">{tt("ops.orchestrationHelp")}</p>
          </Panel>
          <Panel title={tt("ops.autonomousActions")}>
            <DataTable caption={tt("ops.autonomousActions")} rows={o.autonomousActions} rowKey={(a) => `${a.instanceId}:${a.stepId}`} empty={tt("ops.noAutonomous")} columns={[{ key: "t", header: tt("common.time"), render: (a) => a.at.slice(0, 19).replace("T", " ") }, { key: "p", header: tt("ops.project"), render: (a) => a.projectId }, { key: "a", header: tt("ops.action"), render: (a) => a.actionId }, { key: "r", header: tt("common.status"), render: (a) => <Tag tone={stateTone(a.result)}>{a.result}</Tag> }]} />
          </Panel>
          <Panel title={tt("ops.active")}>
            <InstanceTable rows={o.active} />
          </Panel>
          <Panel title={tt("ops.queued")}>
            <InstanceTable rows={o.queued} />
          </Panel>
          {dlg.node}
        </div>
      )}
    </Async>
  );
}

function InstanceTable({ rows }: { rows: WorkflowInstance[] }) {
  const { tt, label } = useT();
  return (
    <DataTable
      caption={tt("ops.workflows")}
      rows={rows}
      rowKey={(i) => i.instanceId}
      empty={tt("common.none")}
      columns={[
        { key: "n", header: tt("ops.workflow"), wrap: true, render: (i) => <Link className="pc-link" to={`${BASE}/workflows/${i.instanceId}`}>{i.name}</Link> },
        { key: "p", header: tt("ops.project"), render: (i) => i.projectId },
        { key: "l", header: tt("ops.level"), render: (i) => i.level },
        { key: "s", header: tt("common.status"), render: (i) => <Tag tone={stateTone(i.state)} title={i.stateReason}>{label("instState", i.state)}</Tag> },
        { key: "t", header: tt("ops.trigger"), wrap: true, render: (i) => `${label("triggerSource", i.trigger.source)}: ${i.trigger.summary}` },
      ]}
    />
  );
}

/* -------------------------------- Approvals -------------------------------- */

function GateCard({ item }: { item: { instanceId: string; projectId: string; stepId: string; gate: StepGate } }) {
  const { tt, label } = useT();
  const admin = useCanAdminister(CAP);
  const manage = useCanManage(CAP);
  const { run, pending } = useRunner();
  const dlg = useDialog();
  const g = item.gate;
  const highRisk = g.risk === "HIGH" || g.risk === "CRITICAL";
  const approveBlocked = !manage || (highRisk && !admin);
  const body = (decision: string, extra: Record<string, unknown> = {}) => ({ instanceId: item.instanceId, stepId: item.stepId, decision, ...extra });
  return (
    <li className="pc-row" data-gate-risk={g.risk} data-testid="gate-card">
      <div className="pc-row__head">
        <span className="pc-row__title">{g.proposedAction}</span>
        <Tag tone={riskTone(g.risk)}>{label("risk", g.risk)}</Tag>
      </div>
      <dl className="pc-deflist">
        <div className="pc-deflist__row"><dt>{tt("ops.gate.reason")}</dt><dd>{g.reason}</dd></div>
        <div className="pc-deflist__row"><dt>{tt("ops.gate.resources")}</dt><dd>{g.affectedResources.join(", ")}</dd></div>
        <div className="pc-deflist__row"><dt>{tt("ops.gate.impact")}</dt><dd>{g.expectedImpact}</dd></div>
        <div className="pc-deflist__row"><dt>{tt("ops.gate.rollback")}</dt><dd>{g.rollback}</dd></div>
        <div className="pc-deflist__row"><dt>{tt("ops.project")}</dt><dd>{item.projectId}</dd></div>
      </dl>
      {approveBlocked && manage ? <Notice tone="warning">{tt("ops.gate.adminOnly")}</Notice> : null}
      <div className="pc-actions">
        <Btn variant="primary" disabled={approveBlocked || pending} onClick={() => run("autonomy_decide_step", body("APPROVE"), tt("ops.msg.approved"))}>{tt("common.approve")}</Btn>
        <Btn disabled={!manage || pending} onClick={() => run("autonomy_decide_step", body("REJECT"), tt("ops.msg.rejected"))}>{tt("common.reject")}</Btn>
        <Btn disabled={!manage || pending} onClick={() => dlg.open(<FieldsDialog title={tt("ops.gate.edit")} description={<p>{tt("ops.gate.editHelp")}</p>} submitLabel={tt("ops.gate.edit")} command="autonomy_decide_step" fixed={{ instanceId: item.instanceId, stepId: item.stepId, decision: "EDIT" }} fields={[{ key: "edit", label: tt("ops.gate.editParams"), type: "pairs", required: true, placeholder: "name=feature/safe" }]} successMessage={tt("ops.msg.edited")} onClose={dlg.close} />)}>{tt("ops.gate.edit")}</Btn>
        <Btn variant="danger" disabled={!manage || pending} onClick={() => run("autonomy_decide_step", body("CANCEL"), tt("ops.msg.cancelled"))}>{tt("common.cancel")}</Btn>
      </div>
      {dlg.node}
    </li>
  );
}

export function ApprovalsTab() {
  const { tt } = useT();
  const query = useGet<OperationsView>("/operations-center/overview", {}, { refetchMs: 15_000 });
  return (
    <Panel title={tt("ops.approvals")}>
      <Notice>{tt("ops.approvalsHelp")}</Notice>
      <Async query={query}>
        {(o) => (o.waitingApprovals.length === 0 ? <Empty title={tt("ops.noApprovals")} /> : <ul className="pc-rows">{o.waitingApprovals.map((w) => <GateCard key={`${w.instanceId}:${w.stepId}`} item={w} />)}</ul>)}
      </Async>
    </Panel>
  );
}

/* -------------------------------- Workflows -------------------------------- */

export function WorkflowsTab({ itemId, scope }: { itemId: string | undefined; scope: Scope }) {
  if (itemId) return <WorkflowDetail id={itemId} />;
  return <WorkflowList scope={scope} />;
}

function WorkflowList({ scope }: { scope: Scope }) {
  const { tt } = useT();
  const query = useGet<{ instances: WorkflowInstance[] }>("/operations-center/instances", { projectId: scope.projectId });
  return (
    <Panel title={tt("ops.workflows")}>
      <Async query={query}>{(d) => <InstanceTable rows={d.instances} />}</Async>
    </Panel>
  );
}

function WorkflowDetail({ id }: { id: string }) {
  const { tt, label, formatTime } = useT();
  const query = useGet<{ instance: WorkflowInstance; audit: AutonomyAuditEvent[] }>(`/operations-center/instance/${encodeURIComponent(id)}`, {}, { refetchMs: 10_000 });
  const manage = useCanManage(CAP);
  const admin = useCanAdminister(CAP);
  const { run, pending } = useRunner();
  const { report } = useReport();
  return (
    <Async query={query}>
      {({ instance: i, audit }) => (
        <div className="pc-stack">
          <Panel title={i.name} actions={<Link className="pc-link" to={`${BASE}/workflows`}>{tt("ops.back")}</Link>} testId="workflow-detail">
            <div className="pc-inline">
              <Tag tone={stateTone(i.state)}>{label("instState", i.state)}</Tag>
              <span className="pc-muted">{i.stateReason}</span>
            </div>
            <p className="pc-muted">{i.projectId} · {tt("ops.level")} {i.level} · {label("triggerSource", i.trigger.source)}: {i.trigger.summary}</p>
            <div className="pc-actions">
              {i.state === "PLANNED" || i.state === "AWAITING_PLAN_APPROVAL" ? <Btn variant="primary" disabled={!manage || pending || (i.state === "AWAITING_PLAN_APPROVAL" && !i.planApproved && i.level >= 3)} onClick={() => run("autonomy_start", { instanceId: i.instanceId }, tt("ops.msg.started"))}>{tt("ops.start")}</Btn> : null}
              {i.state === "AWAITING_PLAN_APPROVAL" ? <Btn disabled={!admin || pending} onClick={() => run("autonomy_approve_plan", { instanceId: i.instanceId }, tt("ops.msg.planApproved"))}>{tt("ops.approvePlan")}</Btn> : null}
              {!["COMPLETED", "FAILED", "ESCALATED", "REJECTED", "CANCELLED"].includes(i.state) ? <Btn variant="danger" disabled={!manage || pending} onClick={() => run("autonomy_cancel", { instanceId: i.instanceId }, tt("ops.msg.cancelled"))}>{tt("common.cancel")}</Btn> : null}
              <Btn disabled={!admin || pending} onClick={() => run("autonomy_rollback", { instanceId: i.instanceId }, tt("ops.msg.rollbackDone"), { onDone: (r) => {
                const results = (r.details["results"] as { stepId: string; outcome: string; detail: string }[] | undefined) ?? [];
                report({ tone: results.some((x) => x.outcome === "FAILED") ? "warning" : "success", message: tt("ops.msg.rollbackDone"), lines: results.map((x) => ({ key: x.stepId, tone: x.outcome === "ROLLED_BACK" ? "success" : x.outcome === "FAILED" ? "danger" : "warning", text: `${x.stepId}: ${label("rollback", x.outcome)} — ${x.detail}` })) });
              } })}>{tt("ops.rollback")}</Btn>
              {!admin ? <span className="pc-muted">{tt("common.needsAdmin")}</span> : null}
            </div>
          </Panel>
          <Panel title={tt("ops.plan")}>
            <dl className="pc-deflist">
              {([["objective", i.plan.objective], ["context", i.plan.context], ["agent", i.plan.agentHint], ["model", i.plan.modelPolicy], ["environment", i.plan.environment], ["expected", i.plan.expectedResult], ["rollback", i.plan.rollback]] as [string, string][]).map(([k, v]) => (
                <div key={k} className="pc-deflist__row"><dt>{tt(`ops.planField.${k}`)}</dt><dd>{v}</dd></div>
              ))}
              <div className="pc-deflist__row"><dt>{tt("ops.planField.tools")}</dt><dd>{i.plan.requiredTools.join(", ") || tt("common.none")}</dd></div>
              <div className="pc-deflist__row"><dt>{tt("ops.planField.risks")}</dt><dd>{i.plan.risks.length ? i.plan.risks.join("; ") : tt("common.none")}</dd></div>
              <div className="pc-deflist__row"><dt>{tt("ops.planField.maxRisk")}</dt><dd><Tag tone={riskTone(i.plan.maxRisk)}>{label("risk", i.plan.maxRisk)}</Tag> · {tt("ops.planField.counts", { auto: i.plan.autoSteps, approvals: i.plan.approvalsExpected })}</dd></div>
            </dl>
          </Panel>
          <Panel title={tt("ops.steps")}>
            <ol className="pc-steps" data-testid="steps">
              {i.steps.map((s) => (
                <li key={s.stepId} className="pc-step" data-step-status={s.state}>
                  <Tag tone={stateTone(s.state)}>{label("stepState", s.state)}</Tag>
                  <strong>{s.description}</strong>
                  <Tag tone={riskTone(s.risk)}>{label("risk", s.risk)}</Tag>
                  <span className="pc-muted">{s.actionId} · {s.automatic === true ? tt("ops.automatic") : s.approvedBy ? tt("ops.approvedBy", { by: s.approvedBy }) : tt("ops.notRun")} · {tt("ops.attempts", { n: s.attempts })}{s.notBefore ? ` · ${tt("ops.retryAt", { at: formatTime(s.notBefore) })}` : ""}</span>
                  {s.error ? <span className="pc-field-error">{s.error.kind}: {s.error.message}</span> : null}
                  {s.note && s.state === "BLOCKED" ? <span className="pc-muted">{s.note}</span> : null}
                  {s.output ? <span className="pc-pre">{s.output}</span> : null}
                </li>
              ))}
            </ol>
          </Panel>
          {i.report ? <Panel title={tt("ops.report")}><pre className="pc-pre" data-testid="report-text">{i.report}</pre></Panel> : null}
          <Panel title={tt("ops.audit")}><AuditTable rows={audit} /></Panel>
        </div>
      )}
    </Async>
  );
}

/* -------------------------------- Autonomy -------------------------------- */

export function AutonomyTab({ scope }: { scope: Scope }) {
  const { tt, label } = useT();
  const catalog = useGet<AutonomyCatalog>("/operations-center/catalog");
  const admin = useCanAdminister(CAP);
  const { run, pending } = useRunner();
  const dlg = useDialog();
  return (
    <Async query={catalog}>
      {(c) => {
        const levelOf = (projectId: string) => c.settings.find((s) => s.projectId === projectId)?.level;
        return (
          <div className="pc-stack">
            <Panel title={tt("ops.levels")}>
              <Notice title={tt("ops.alwaysApprovalTitle")}>{tt("ops.alwaysApproval")}</Notice>
              <DataTable caption={tt("ops.levels")} rows={c.levels} rowKey={(l) => String(l.level)} empty={tt("common.none")} columns={[{ key: "l", header: tt("ops.level"), render: (l) => l.level }, { key: "n", header: tt("common.name"), render: (l) => l.name }, { key: "d", header: tt("common.detail"), wrap: true, render: (l) => l.description }]} />
            </Panel>
            <Panel title={tt("ops.projectLevels")}>
              {!admin ? <Notice>{tt("ops.levelAdminOnly")}</Notice> : null}
              <DataTable
                caption={tt("ops.projectLevels")}
                rows={scope.projects}
                rowKey={(p) => p.projectId}
                empty={tt("common.none")}
                columns={[
                  { key: "p", header: tt("ops.project"), render: (p) => p.displayName || p.projectId },
                  { key: "l", header: tt("ops.level"), render: (p) => { const l = levelOf(p.projectId); return l === undefined ? <span className="pc-muted">{tt("ops.levelDefault")}</span> : l; } },
                  { key: "a", header: tt("common.actions"), render: (p) => <Btn size="small" disabled={!admin} onClick={() => dlg.open(<FieldsDialog title={tt("ops.setLevel")} description={<p>{tt("ops.setLevelBody")}</p>} submitLabel={tt("ops.setLevel")} command="autonomy_set_level" fixed={{ projectId: p.projectId }} initial={{ level: String(levelOf(p.projectId) ?? 1) }} fields={[{ key: "level", label: tt("ops.level"), type: "select", options: c.levels.map((l) => ({ value: String(l.level), label: `${l.level} — ${l.name}` })) }, { key: "confirmHighest", label: tt("ops.confirmHighest"), type: "checkbox" }]} successMessage={tt("ops.msg.levelSet")} onClose={dlg.close} />)}>{tt("ops.setLevel")}</Btn> },
                ]}
              />
            </Panel>
            <Panel title={tt("ops.rules")} actions={<Btn variant="primary" disabled={!admin} onClick={() => dlg.open(<FieldsDialog title={tt("ops.addRule")} submitLabel={tt("ops.addRule")} command="autonomy_add_rule" fields={[{ key: "projectId", label: tt("ops.project"), type: "select", options: scope.projects.map((p) => ({ value: p.projectId, label: p.displayName || p.projectId })), required: true }, { key: "source", label: tt("ops.source"), type: "select", options: ["github", "deployment", "test_failure", "security_finding", "data_change", "schedule", "integration", "user_command", "project_state", "monitoring"].map((s) => ({ value: s, label: label("triggerSource", s) })) }, { key: "eventType", label: tt("ops.eventType") }, { key: "definitionId", label: tt("ops.workflow"), type: "select", options: c.definitions.map((d) => ({ value: d.definitionId, label: d.name })) }]} successMessage={tt("ops.msg.ruleAdded")} onClose={dlg.close} />)}>{tt("ops.addRule")}</Btn>}>
              <DataTable caption={tt("ops.rules")} rows={c.rules} rowKey={(r) => r.ruleId} empty={tt("ops.noRules")} columns={[{ key: "p", header: tt("ops.project"), render: (r) => r.projectId }, { key: "s", header: tt("ops.source"), render: (r) => label("triggerSource", r.source) }, { key: "e", header: tt("ops.eventType"), render: (r) => r.eventType ?? "—" }, { key: "w", header: tt("ops.workflow"), render: (r) => r.definitionId }, { key: "x", header: tt("common.status"), render: (r) => <Tag tone={r.enabled ? "success" : "neutral"}>{r.enabled ? tt("common.enabled") : tt("common.disabled")}</Tag> }, { key: "a", header: tt("common.actions"), render: (r) => <Btn size="small" disabled={(!r.enabled && !admin) || pending} onClick={() => run("autonomy_set_rule_enabled", { ruleId: r.ruleId, enabled: !r.enabled }, tt("ops.msg.ruleChanged"))}>{r.enabled ? tt("common.disable") : tt("common.enable")}</Btn> }]} />
              <p className="pc-muted">{tt("ops.rulesHelp")}</p>
            </Panel>
            <Panel title={tt("ops.definitions")}>
              <DataTable caption={tt("ops.definitions")} rows={c.definitions} rowKey={(d) => d.definitionId} empty={tt("common.none")} columns={[{ key: "n", header: tt("common.name"), wrap: true, render: (d) => <span><strong>{d.name}</strong><br /><span className="pc-muted">{d.description}</span></span> }, { key: "s", header: tt("ops.steps"), wrap: true, render: (d) => d.steps.map((s) => s.actionId).join(" → ") }, { key: "b", header: tt("ops.boundary"), render: (d) => <Tag tone={riskTone(d.boundaries.maxRisk)}>{tt("ops.maxRisk", { risk: label("risk", d.boundaries.maxRisk) })}</Tag> }]} />
            </Panel>
            <Panel title={tt("ops.catalogue")}>
              <DataTable caption={tt("ops.catalogue")} rows={c.actions} rowKey={(a) => a.actionId} empty={tt("common.none")} columns={[{ key: "a", header: tt("ops.action"), render: (a) => <span className="pc-inline-code">{a.actionId}</span> }, { key: "r", header: tt("ops.risk"), render: (a) => <Tag tone={riskTone(a.risk)}>{label("risk", a.risk)}</Tag> }, { key: "x", header: tt("ops.restricted"), render: (a) => (a.restricted ? <Tag tone="danger">{tt("ops.restrictedYes")}</Tag> : tt("common.no")) }, { key: "i", header: tt("ops.idempotent"), render: (a) => (a.idempotent ? tt("common.yes") : tt("common.no")) }, { key: "b", header: tt("ops.reversal"), render: (a) => a.rollbackAction ?? tt("ops.noReversal") }, { key: "m", header: tt("ops.impact"), wrap: true, render: (a) => a.impact }]} />
            </Panel>
            {dlg.node}
          </div>
        );
      }}
    </Async>
  );
}

/* ------------------------------ Incidents & blocked ------------------------------ */

export function IncidentsTab() {
  const { tt, label, formatTime } = useT();
  const query = useGet<OperationsView>("/operations-center/overview");
  return (
    <Async query={query}>
      {(o) => (
        <div className="pc-stack">
          <Panel title={tt("ops.incidents")}>
            <DataTable caption={tt("ops.incidents")} rows={o.incidents} rowKey={(x) => x.instanceId} empty={tt("ops.noIncidents")} columns={[{ key: "t", header: tt("common.time"), render: (x) => formatTime(x.at) }, { key: "p", header: tt("ops.project"), render: (x) => x.projectId }, { key: "s", header: tt("common.status"), render: (x) => <Tag tone={stateTone(x.state)}>{label("instState", x.state)}</Tag> }, { key: "r", header: tt("common.detail"), wrap: true, render: (x) => <Link className="pc-link" to={`${BASE}/workflows/${x.instanceId}`}>{x.reason}</Link> }]} />
          </Panel>
          <Panel title={tt("ops.blocked")}>
            <DataTable caption={tt("ops.blocked")} rows={o.blockedOperations} rowKey={(x) => `${x.instanceId}:${x.stepId}`} empty={tt("ops.noBlocked")} columns={[{ key: "p", header: tt("ops.project"), render: (x) => x.projectId }, { key: "s", header: tt("ops.steps"), render: (x) => x.stepId ?? "—" }, { key: "r", header: tt("common.detail"), wrap: true, render: (x) => x.reason }]} />
          </Panel>
          <Panel title={tt("ops.recoveries")}>
            <DataTable caption={tt("ops.recoveries")} rows={o.recoveries} rowKey={(x) => `${x.at}:${x.detail}`} empty={tt("ops.noRecoveries")} columns={[{ key: "t", header: tt("common.time"), render: (x) => formatTime(x.at) }, { key: "k", header: tt("ops.recoveryKind"), render: (x) => label("recoveryKind", x.kind) }, { key: "d", header: tt("common.detail"), wrap: true, render: (x) => x.detail }]} />
          </Panel>
        </div>
      )}
    </Async>
  );
}

/* ----------------------------------- Audit ----------------------------------- */

function AuditTable({ rows }: { rows: AutonomyAuditEvent[] }) {
  const { tt, label, formatTime } = useT();
  return (
    <DataTable caption={tt("ops.audit")} rows={rows} rowKey={(e) => e.id} empty={tt("common.none")} columns={[{ key: "t", header: tt("common.time"), render: (e) => formatTime(e.at) }, { key: "k", header: tt("ops.auditKind"), render: (e) => label("auditKind", e.kind) }, { key: "a", header: tt("common.actor"), render: (e) => e.actor }, { key: "r", header: tt("ops.risk"), render: (e) => (e.risk ? <Tag tone={riskTone(e.risk)}>{label("risk", e.risk)}</Tag> : "—") }, { key: "d", header: tt("common.detail"), wrap: true, render: (e) => e.detail }]} />
  );
}

export function AuditTab({ scope }: { scope: Scope }) {
  const { tt, label } = useT();
  const [kind, setKind] = useState("");
  const query = useGet<{ events: AutonomyAuditEvent[] }>("/operations-center/audit", { projectId: scope.projectId, limit: 200 });
  return (
    <Panel title={tt("ops.audit")}>
      <Select label={tt("ops.auditKind")} value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="">{tt("common.any")}</option>
        {["TRIGGER", "PLAN", "AGENT", "MODEL", "TOOL", "ACTION", "APPROVAL", "RESULT", "FAILURE", "RECOVERY", "POLICY", "CONTROL"].map((k) => <option key={k} value={k}>{label("auditKind", k)}</option>)}
      </Select>
      <Async query={query}>{(d) => <AuditTable rows={d.events.filter((e) => !kind || e.kind === kind)} />}</Async>
    </Panel>
  );
}
