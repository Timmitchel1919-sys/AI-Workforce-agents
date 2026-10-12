import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Select } from "../../../components/ui";
import { useCanAdminister, useCanManage, useGet } from "../hooks/useCommand";
import { useRunner } from "../hooks/useRunner";
import { useT } from "../lib/useT";
import { healthTone, stateTone } from "../lib/tones";
import type { BusinessOverview, BusinessObjective, DecisionRecord, Department, Initiative, KpiStatus, ObjectiveDetail, OrgNode, PlanProposal } from "../types";
import { Empty, Notice, Tag } from "./common";
import { FieldsDialog, type FieldSpec } from "./FieldsDialog";
import { Async, Btn, Cards, DataTable, Panel } from "./kit";

const CAP = "manage_business" as const;
const BASE = "/business-layer";
const FUNCTIONS = ["STRATEGY", "OPERATIONS", "FINANCE", "TECHNOLOGY", "PRODUCT", "SECURITY"];
const LEVELS = ["STRATEGIC", "OPERATIONAL", "PROJECT"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"];
const STATUSES = ["DRAFT", "ACTIVE", "ACHIEVED", "ON_HOLD", "CANCELLED"];
const METRICS = ["PROJECT_COMPLETION", "TASK_SUCCESS_RATE", "RUN_FAILURE_RATE", "AI_COST_USD", "OPEN_SECURITY_ALERTS", "DEPLOYMENT_SUCCESS_RATE"];

function useDialog() {
  const [node, setNode] = useState<ReactNode>(null);
  return { node, open: setNode, close: () => setNode(null) };
}

function KpiChip({ k }: { k: KpiStatus }) {
  const { tt, label } = useT();
  const text = k.state === "NO_DATA" ? tt("biz.noData") : `${k.current}${k.unit ? ` ${k.unit}` : ""} → ${k.target} (${k.attainmentPercent}%)`;
  return (
    <span className="pc-inline" data-kpi-state={k.state}>
      <Tag tone={healthTone(k.state)} title={k.note}>
        {label("kpi", k.state)}
      </Tag>
      <span className="pc-muted">
        {k.name}: {text}
      </span>
    </span>
  );
}

/* --------------------------------- Board --------------------------------- */

export function BoardTab() {
  const { tt, label } = useT();
  const query = useGet<BusinessOverview>("/business-layer/overview");
  const admin = useCanAdminister(CAP);
  const dlg = useDialog();
  return (
    <Async query={query}>
      {(data) => {
        const b = data.board;
        return (
          <div className="pc-stack">
            <Panel
              title={b.business.name}
              actions={
                <Btn disabled={!admin} onClick={() => dlg.open(<FieldsDialog title={tt("biz.editBusiness")} submitLabel={tt("common.save")} command="business_configure" fields={[{ key: "name", label: tt("biz.name"), required: true }, { key: "mission", label: tt("biz.mission"), type: "textarea" }]} initial={{ name: b.business.name, mission: b.business.mission }} successMessage={tt("biz.msg.saved")} onClose={dlg.close} />)}>
                  {tt("biz.editBusiness")}
                </Btn>
              }
            >
              <p className="pc-text">{b.business.mission || tt("biz.noMission")}</p>
              {!admin ? <p className="pc-muted">{tt("common.needsAdmin")}</p> : null}
            </Panel>
            <Panel title={tt("biz.performance")}>
              <Cards
                items={[
                  { label: tt("biz.kpis"), value: b.performance.kpis },
                  { label: tt("biz.withData"), value: b.performance.withData },
                  { label: label("kpi", "ON_TRACK"), value: b.performance.onTrack },
                  { label: label("kpi", "AT_RISK"), value: b.performance.atRisk },
                  { label: label("kpi", "OFF_TRACK"), value: b.performance.offTrack },
                  { label: label("kpi", "ACHIEVED"), value: b.performance.achieved },
                ]}
              />
            </Panel>
            <Panel title={tt("biz.objectives")}>
              <DataTable
                caption={tt("biz.objectives")}
                rows={b.objectives}
                rowKey={(o) => o.objectiveId}
                empty={tt("biz.noObjectives")}
                columns={[
                  { key: "t", header: tt("biz.col.title"), wrap: true, render: (o) => <Link className="pc-link" to={`${BASE}/objectives/${o.objectiveId}`}>{o.title}</Link> },
                  { key: "l", header: tt("biz.col.level"), render: (o) => label("level", o.level) },
                  { key: "p", header: tt("biz.col.priority"), render: (o) => label("priority", o.priority) },
                  { key: "s", header: tt("biz.col.status"), render: (o) => <Tag tone={stateTone(o.status)}>{label("objStatus", o.status)}</Tag> },
                  { key: "f", header: tt("biz.col.function"), render: (o) => label("function", o.ownerFunction) },
                  { key: "k", header: tt("biz.col.kpis"), wrap: true, render: (o) => (o.kpis.length === 0 ? <span className="pc-muted">{tt("biz.noKpi")}</span> : <span className="pc-stack">{o.kpis.map((k) => <KpiChip key={k.kpiId} k={k} />)}</span>) },
                ]}
              />
            </Panel>
            <Panel title={tt("biz.risks")}>
              {b.risks.length === 0 ? (
                <p className="pc-muted">{tt("biz.noRisks")}</p>
              ) : (
                <ul className="pc-list">
                  {b.risks.map((r, i) => (
                    <li key={`${r.ref}-${i}`}>
                      <Tag tone="warning">{label("riskKind", r.kind)}</Tag> {r.message}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={tt("biz.recentDecisions")}>
              <DataTable caption={tt("biz.recentDecisions")} rows={b.recentDecisions} rowKey={(d) => d.decisionId} empty={tt("common.none")} columns={[{ key: "t", header: tt("biz.col.title"), wrap: true, render: (d) => d.title }, { key: "s", header: tt("biz.col.status"), render: (d) => <Tag tone={stateTone(d.status)}>{label("decisionStatus", d.status)}</Tag> }, { key: "d", header: tt("biz.col.decided"), render: (d) => d.decidedAt.slice(0, 10) }]} />
            </Panel>
            {dlg.node}
          </div>
        );
      }}
    </Async>
  );
}

/* ------------------------------ Organization ------------------------------ */

function Tree({ node }: { node: OrgNode }) {
  const { label } = useT();
  return (
    <li>
      <span className="pc-inline">
        <Tag>{label("orgKind", node.kind)}</Tag> <strong>{node.name}</strong>
      </span>
      {node.children.length > 0 ? (
        <ul className="pc-tree">
          {node.children.map((c) => (
            <Tree key={`${c.kind}-${c.id}`} node={c} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function OrganizationTab() {
  const { tt } = useT();
  const query = useGet<BusinessOverview>("/business-layer/overview");
  return (
    <Async query={query}>
      {(data) => (
        <Panel title={tt("biz.org")}>
          <p className="pc-muted">{tt("biz.orgHelp")}</p>
          <ul className="pc-tree" aria-label={tt("biz.org")}>
            <Tree node={data.organization} />
          </ul>
        </Panel>
      )}
    </Async>
  );
}

/* ------------------------------- Departments ------------------------------- */

export function DepartmentsTab() {
  const { tt, label } = useT();
  const query = useGet<BusinessOverview>("/business-layer/overview");
  const manage = useCanManage(CAP);
  const admin = useCanAdminister(CAP);
  const dlg = useDialog();
  const f = (key: string, labelText: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label: labelText, ...extra });
  const opt = (list: string[], group: string) => list.map((v) => ({ value: v, label: label(group, v) }));
  return (
    <Async query={query}>
      {(data) => (
        <Panel
          title={tt("biz.departments")}
          actions={
            <Btn variant="primary" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.newDepartment")} submitLabel={tt("common.create")} command="business_create_department" fields={[f("name", tt("biz.name"), { required: true }), f("description", tt("biz.description"), { type: "textarea" }), f("executiveFunction", tt("biz.col.function"), { type: "select", options: opt(FUNCTIONS, "function") })]} successMessage={tt("biz.msg.created")} onClose={dlg.close} />)}>
              {tt("biz.newDepartment")}
            </Btn>
          }
        >
          {!manage ? <Notice>{tt("common.readOnly")}</Notice> : null}
          <DataTable
            caption={tt("biz.departments")}
            rows={data.departments}
            rowKey={(d: Department) => d.departmentId}
            empty={tt("common.none")}
            columns={[
              { key: "n", header: tt("biz.col.title"), wrap: true, render: (d) => <span><strong>{d.name}</strong><br /><span className="pc-muted">{d.description}</span></span> },
              { key: "f", header: tt("biz.col.function"), render: (d) => label("function", d.executiveFunction) },
              { key: "m", header: tt("biz.manager"), render: (d) => (d.manager ? `${d.manager.kind === "USER" ? tt("biz.owner") : tt("biz.agent")}: ${d.manager.ref}` : tt("common.none")) },
              { key: "a", header: tt("biz.workforce"), wrap: true, render: (d) => (d.agentIds.length ? d.agentIds.join(", ") : tt("common.none")) },
              { key: "p", header: tt("biz.projects"), wrap: true, render: (d) => (d.projectIds.length ? d.projectIds.join(", ") : tt("common.none")) },
              {
                key: "x",
                header: tt("common.actions"),
                render: (d) => (
                  <span className="pc-inline">
                    <Btn size="small" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.assignAgent")} submitLabel={tt("biz.assignAgent")} command="business_assign_agent" fixed={{ departmentId: d.departmentId }} fields={[f("agentId", tt("biz.agentId"), { required: true })]} successMessage={tt("biz.msg.updated")} onClose={dlg.close} />)}>{tt("biz.assignAgent")}</Btn>
                    {d.agentIds.length > 0 ? <Btn size="small" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.unassignAgent")} submitLabel={tt("biz.unassignAgent")} command="business_unassign_agent" fixed={{ departmentId: d.departmentId }} fields={[f("agentId", tt("biz.agentId"), { type: "select", options: d.agentIds.map((a) => ({ value: a, label: a })) })]} successMessage={tt("biz.msg.updated")} onClose={dlg.close} />)}>{tt("biz.unassignAgent")}</Btn> : null}
                    <Btn size="small" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.setManager")} submitLabel={tt("common.save")} command="business_set_manager" fixed={{ departmentId: d.departmentId }} fields={[f("kind", tt("biz.managerKind"), { type: "select", options: [{ value: "USER", label: tt("biz.owner") }, { value: "AGENT", label: tt("biz.agent") }] }), f("ref", tt("biz.managerRef"), { required: true }), f("responsibilities", tt("biz.responsibilities"), { type: "lines" })]} successMessage={tt("biz.msg.updated")} onClose={dlg.close} />)}>{tt("biz.setManager")}</Btn>
                    <Btn size="small" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.linkProject")} submitLabel={tt("biz.linkProject")} command="business_link_department_project" fixed={{ departmentId: d.departmentId }} fields={[f("projectId", tt("biz.projectId"), { required: true })]} successMessage={tt("biz.msg.updated")} onClose={dlg.close} />)}>{tt("biz.linkProject")}</Btn>
                    <Btn size="small" variant="danger" disabled={!admin} onClick={() => dlg.open(<FieldsDialog title={tt("biz.archiveDepartment")} description={<p>{tt("biz.archiveBody")}</p>} submitLabel={tt("biz.archiveDepartment")} danger command="business_archive_department" fixed={{ departmentId: d.departmentId }} fields={[]} successMessage={tt("biz.msg.archived")} onClose={dlg.close} />)}>{tt("biz.archiveDepartment")}</Btn>
                  </span>
                ),
              },
            ]}
          />
          {dlg.node}
        </Panel>
      )}
    </Async>
  );
}

/* -------------------------------- Objectives -------------------------------- */

export function ObjectivesTab({ itemId, search }: { itemId: string | undefined; search: string }) {
  if (itemId) return <ObjectiveDetailView id={itemId} />;
  return <ObjectiveList search={search} />;
}

function ObjectiveList({ search }: { search: string }) {
  const { tt, label } = useT();
  const manage = useCanManage(CAP);
  const [status, setStatus] = useState("");
  const query = useGet<{ objectives: BusinessObjective[] }>("/business-layer/objectives", { status: status || undefined });
  const dlg = useDialog();
  void search;
  return (
    <Panel
      title={tt("biz.objectives")}
      actions={
        <Btn variant="primary" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.newObjective")} submitLabel={tt("common.create")} command="business_create_objective" fields={[{ key: "title", label: tt("biz.col.title"), required: true }, { key: "description", label: tt("biz.description"), type: "textarea" }, { key: "strategy", label: tt("biz.strategy"), type: "textarea" }, { key: "level", label: tt("biz.col.level"), type: "select", options: LEVELS.map((v) => ({ value: v, label: label("level", v) })) }, { key: "priority", label: tt("biz.col.priority"), type: "select", options: PRIORITIES.map((v) => ({ value: v, label: label("priority", v) })), }, { key: "ownerFunction", label: tt("biz.col.function"), type: "select", options: FUNCTIONS.map((v) => ({ value: v, label: label("function", v) })) }, { key: "projectId", label: tt("biz.projectId"), help: tt("biz.projectIdHelp") }, { key: "targetDate", label: tt("biz.targetDate"), placeholder: "2026-12-31" }]} successMessage={tt("biz.msg.created")} onClose={dlg.close} />)}>
          {tt("biz.newObjective")}
        </Btn>
      }
    >
      <Select label={tt("biz.col.status")} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">{tt("common.any")}</option>
        {STATUSES.map((s) => <option key={s} value={s}>{label("objStatus", s)}</option>)}
      </Select>
      <Async query={query}>
        {(data) => (
          <DataTable
            caption={tt("biz.objectives")}
            rows={data.objectives}
            rowKey={(o) => o.objectiveId}
            empty={tt("biz.noObjectives")}
            columns={[
              { key: "t", header: tt("biz.col.title"), wrap: true, render: (o) => <Link className="pc-link" to={`${BASE}/objectives/${o.objectiveId}${search}`}>{o.title}</Link> },
              { key: "l", header: tt("biz.col.level"), render: (o) => label("level", o.level) },
              { key: "s", header: tt("biz.col.status"), render: (o) => <Tag tone={stateTone(o.status)}>{label("objStatus", o.status)}</Tag> },
              { key: "k", header: tt("biz.col.kpis"), wrap: true, render: (o) => (o.kpiStatus.length === 0 ? <span className="pc-muted">{tt("biz.noKpi")}</span> : <span className="pc-stack">{o.kpiStatus.map((k) => <KpiChip key={k.kpiId} k={k} />)}</span>) },
            ]}
          />
        )}
      </Async>
      {dlg.node}
    </Panel>
  );
}

function ObjectiveDetailView({ id }: { id: string }) {
  const { tt, label } = useT();
  const query = useGet<ObjectiveDetail>(`/business-layer/objective/${encodeURIComponent(id)}`);
  const manage = useCanManage(CAP);
  const { run, pending } = useRunner();
  const dlg = useDialog();
  return (
    <Async query={query}>
      {(o) => (
        <div className="pc-stack">
          <Panel title={o.title} actions={<Link className="pc-link" to={`${BASE}/objectives`}>{tt("biz.back")}</Link>} testId="objective-detail">
            <p className="pc-text">{o.description || tt("biz.noDescription")}</p>
            <div className="pc-inline">
              <Tag tone={stateTone(o.status)}>{label("objStatus", o.status)}</Tag>
              <Tag>{label("level", o.level)}</Tag>
              <Tag>{label("priority", o.priority)}</Tag>
              <Tag>{label("function", o.ownerFunction)}</Tag>
              {o.projectId ? <Tag>{o.projectId}</Tag> : null}
              {o.targetDate ? <span className="pc-muted">{tt("biz.targetDate")}: {o.targetDate.slice(0, 10)}</span> : null}
            </div>
            {o.strategy ? <p className="pc-text"><strong>{tt("biz.strategy")}:</strong> {o.strategy}</p> : null}
            <div className="pc-actions">
              {STATUSES.filter((s) => s !== o.status).map((s) => (
                <Btn key={s} size="small" disabled={!manage || pending} onClick={() => run("business_set_objective_status", { objectiveId: o.objectiveId, status: s }, tt("biz.msg.updated"))}>{label("objStatus", s)}</Btn>
              ))}
            </div>
          </Panel>
          <Panel title={tt("biz.col.kpis")} actions={<Btn variant="primary" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.addKpi")} submitLabel={tt("biz.addKpi")} command="business_add_kpi" fixed={{ objectiveId: o.objectiveId }} fields={[{ key: "name", label: tt("biz.name"), required: true }, { key: "sourceKind", label: tt("biz.kpiSource"), type: "select", options: [{ value: "MANUAL", label: tt("biz.kpiManual") }, { value: "MEASURED", label: tt("biz.kpiMeasured") }] }, { key: "metric", label: tt("biz.metric"), type: "select", options: METRICS.map((m) => ({ value: m, label: label("metric", m) })), help: tt("biz.metricHelp") }, { key: "direction", label: tt("biz.direction"), type: "select", options: [{ value: "HIGHER_IS_BETTER", label: tt("biz.higher") }, { value: "LOWER_IS_BETTER", label: tt("biz.lower") }] }, { key: "target", label: tt("biz.target"), type: "number", required: true }, { key: "baseline", label: tt("biz.baseline"), type: "number" }, { key: "unit", label: tt("biz.unit") }]} successMessage={tt("biz.msg.updated")} onClose={dlg.close} />)}>{tt("biz.addKpi")}</Btn>}>
            <DataTable
              caption={tt("biz.col.kpis")}
              rows={o.kpiStatus}
              rowKey={(k) => k.kpiId}
              empty={tt("biz.noKpi")}
              columns={[
                { key: "n", header: tt("biz.name"), wrap: true, render: (k) => k.name },
                { key: "s", header: tt("biz.col.status"), render: (k) => <Tag tone={healthTone(k.state)} title={k.note}>{label("kpi", k.state)}</Tag> },
                { key: "c", header: tt("biz.current"), render: (k) => (k.current === null ? <span className="pc-muted">{tt("biz.noData")}</span> : `${k.current}${k.unit ? ` ${k.unit}` : ""}`) },
                { key: "t", header: tt("biz.target"), render: (k) => k.target },
                { key: "a", header: tt("biz.attainment"), render: (k) => (k.attainmentPercent === null ? "—" : `${k.attainmentPercent}%`) },
                { key: "x", header: tt("common.actions"), render: (k) => (o.kpis.find((x) => x.kpiId === k.kpiId)?.source.kind === "MANUAL" ? <Btn size="small" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.recordReading")} submitLabel={tt("biz.recordReading")} command="business_record_kpi_reading" fixed={{ objectiveId: o.objectiveId, kpiId: k.kpiId }} fields={[{ key: "value", label: tt("biz.value"), type: "number", required: true }, { key: "note", label: tt("biz.note") }]} successMessage={tt("biz.msg.updated")} onClose={dlg.close} />)}>{tt("biz.recordReading")}</Btn> : <span className="pc-muted">{tt("biz.measuredAuto")}</span>) },
              ]}
            />
          </Panel>
          <Panel title={tt("biz.initiatives")} actions={<Btn disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.newInitiative")} submitLabel={tt("common.create")} command="business_create_initiative" fixed={{ objectiveId: o.objectiveId }} fields={[{ key: "title", label: tt("biz.col.title"), required: true }, { key: "strategy", label: tt("biz.strategy"), type: "textarea" }, { key: "projectIds", label: tt("biz.projectIds"), type: "lines", help: tt("biz.projectIdsHelp") }]} successMessage={tt("biz.msg.created")} onClose={dlg.close} />)}>{tt("biz.newInitiative")}</Btn>}>
            <DataTable caption={tt("biz.initiatives")} rows={o.initiatives} rowKey={(i) => i.initiativeId} empty={tt("common.none")} columns={[{ key: "t", header: tt("biz.col.title"), wrap: true, render: (i) => i.title }, { key: "s", header: tt("biz.col.status"), render: (i) => <Tag tone={stateTone(i.status)}>{label("initStatus", i.status)}</Tag> }, { key: "p", header: tt("biz.projects"), render: (i) => (i.projectIds.length ? i.projectIds.join(", ") : tt("common.none")) }, { key: "n", header: tt("biz.plans"), render: (i) => i.plans.length }]} />
          </Panel>
          <Panel title={tt("biz.decisions")}>
            <DataTable caption={tt("biz.decisions")} rows={o.decisions} rowKey={(d) => d.decisionId} empty={tt("common.none")} columns={[{ key: "t", header: tt("biz.col.title"), wrap: true, render: (d) => d.title }, { key: "s", header: tt("biz.col.status"), render: (d) => <Tag tone={stateTone(d.status)}>{label("decisionStatus", d.status)}</Tag> }]} />
          </Panel>
          {dlg.node}
        </div>
      )}
    </Async>
  );
}

/* ---------------------------------- Plans ---------------------------------- */

function PlanCard({ initiative, plan }: { initiative: Initiative; plan: PlanProposal }) {
  const { tt, label } = useT();
  const admin = useCanAdminister(CAP);
  const { run, pending } = useRunner();
  const [copied, setCopied] = useState(false);
  return (
    <li className="pc-row" data-plan-status={plan.status}>
      <div className="pc-row__head">
        <span className="pc-row__title">{plan.workflow.name}</span>
        <Tag tone={stateTone(plan.status)}>{label("planStatus", plan.status)}</Tag>
      </div>
      {plan.needsProject ? <Notice tone="warning" title={tt("biz.needsProject")}>{tt("biz.needsProjectBody")}</Notice> : <p className="pc-muted">{tt("biz.planProject", { id: plan.projectId ?? "" })}</p>}
      <DataTable
        caption={tt("biz.planTasks")}
        rows={plan.tasks}
        rowKey={(t) => t.taskKey}
        empty={tt("common.none")}
        columns={[
          { key: "k", header: tt("biz.stage"), render: (t) => t.taskKey },
          { key: "t", header: tt("biz.col.title"), wrap: true, render: (t) => t.title },
          { key: "y", header: tt("biz.taskType"), render: (t) => t.taskType },
          { key: "d", header: tt("biz.dependsOn"), render: (t) => (t.dependsOn.length ? t.dependsOn.join(", ") : "—") },
          { key: "a", header: tt("biz.suggestedAgents"), render: (t) => (t.suggestedAgentIds.length ? t.suggestedAgentIds.join(", ") : "—") },
          { key: "p", header: tt("biz.approval"), render: (t) => (t.requiresApproval ? <Tag tone="warning">{tt("common.required")}</Tag> : "—") },
        ]}
      />
      <Notice title={tt("biz.handoffTitle")}>{tt("biz.handoffBody")}</Notice>
      <p className="pc-text" data-testid="prompt-objective">{plan.promptObjective}</p>
      <div className="pc-actions">
        <Btn size="small" onClick={() => { void navigator.clipboard?.writeText(plan.promptObjective); setCopied(true); }}>{copied ? tt("biz.copied") : tt("biz.copy")}</Btn>
        {plan.status === "PROPOSED" ? (
          <>
            <Btn size="small" variant="primary" disabled={!admin || pending} onClick={() => run("business_decide_plan", { initiativeId: initiative.initiativeId, planId: plan.planId, decision: "APPROVED" }, tt("biz.msg.planApproved"))}>{tt("common.approve")}</Btn>
            <Btn size="small" disabled={!admin || pending} onClick={() => run("business_decide_plan", { initiativeId: initiative.initiativeId, planId: plan.planId, decision: "REJECTED" }, tt("biz.msg.planRejected"))}>{tt("common.reject")}</Btn>
            {!admin ? <span className="pc-muted">{tt("common.needsAdmin")}</span> : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

export function PlansTab() {
  const { tt, label } = useT();
  const manage = useCanManage(CAP);
  const { run, pending } = useRunner();
  const query = useGet<{ initiatives: Initiative[] }>("/business-layer/initiatives");
  return (
    <Async query={query}>
      {(data) =>
        data.initiatives.length === 0 ? (
          <Empty title={tt("biz.noInitiatives")} body={tt("biz.noInitiativesBody")} />
        ) : (
          <div className="pc-stack">
            <Notice title={tt("biz.plansNoticeTitle")}>{tt("biz.plansNotice")}</Notice>
            {data.initiatives.map((i) => (
              <Panel key={i.initiativeId} title={i.title} actions={<Btn variant="primary" disabled={!manage || pending} onClick={() => run("business_propose_plan", { initiativeId: i.initiativeId }, tt("biz.msg.planProposed"))}>{tt("biz.proposePlan")}</Btn>}>
                <div className="pc-inline"><Tag tone={stateTone(i.status)}>{label("initStatus", i.status)}</Tag><span className="pc-muted">{i.strategy}</span></div>
                {i.plans.length === 0 ? <p className="pc-muted">{tt("biz.noPlans")}</p> : <ul className="pc-rows">{i.plans.map((p) => <PlanCard key={p.planId} initiative={i} plan={p} />)}</ul>}
              </Panel>
            ))}
          </div>
        )
      }
    </Async>
  );
}

/* -------------------------------- Decisions -------------------------------- */

export function DecisionsTab() {
  const { tt, label } = useT();
  const manage = useCanManage(CAP);
  const admin = useCanAdminister(CAP);
  const { run, pending } = useRunner();
  const dlg = useDialog();
  const query = useGet<{ decisions: DecisionRecord[] }>("/business-layer/decisions");
  const base: FieldSpec[] = [
    { key: "title", label: tt("biz.col.title"), required: true },
    { key: "decision", label: tt("biz.decision"), type: "textarea", required: true },
    { key: "context", label: tt("biz.context"), type: "textarea" },
    { key: "alternatives", label: tt("biz.alternatives"), type: "lines" },
    { key: "rationale", label: tt("biz.rationale"), type: "textarea" },
    { key: "actions", label: tt("biz.actions"), type: "lines" },
  ];
  return (
    <Panel title={tt("biz.decisions")} actions={<Btn variant="primary" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("biz.recordDecision")} submitLabel={tt("biz.recordDecision")} command="business_record_decision" fields={[...base, { key: "objectiveId", label: tt("biz.objectiveId") }, { key: "projectId", label: tt("biz.projectId") }]} successMessage={tt("biz.msg.created")} onClose={dlg.close} />)}>{tt("biz.recordDecision")}</Btn>}>
      <Notice>{tt("biz.decisionsHelp")}</Notice>
      <Async query={query}>
        {(data) => (
          <ul className="pc-rows">
            {data.decisions.length === 0 ? <li><Empty title={tt("common.none")} /></li> : null}
            {data.decisions.map((d) => (
              <li key={d.decisionId} className="pc-row" data-decision-status={d.status}>
                <div className="pc-row__head"><span className="pc-row__title">{d.title}</span><Tag tone={stateTone(d.status)}>{label("decisionStatus", d.status)}</Tag></div>
                <p className="pc-text">{d.decision}</p>
                {d.rationale ? <p className="pc-muted">{tt("biz.rationale")}: {d.rationale}</p> : null}
                {d.alternatives.length ? <p className="pc-muted">{tt("biz.alternatives")}: {d.alternatives.join("; ")}</p> : null}
                <p className="pc-muted">{d.owner} · {d.decidedAt.slice(0, 10)}{d.supersedes ? ` · ${tt("biz.supersedes", { id: d.supersedes })}` : ""}{d.supersededBy ? ` · ${tt("biz.supersededBy", { id: d.supersededBy })}` : ""}</p>
                <div className="pc-actions">
                  {d.status === "PROPOSED" ? <Btn size="small" variant="primary" disabled={!admin || pending} onClick={() => run("business_adopt_decision", { decisionId: d.decisionId }, tt("biz.msg.adopted"))}>{tt("biz.adopt")}</Btn> : null}
                  {d.status === "ADOPTED" ? <Btn size="small" disabled={!admin} onClick={() => dlg.open(<FieldsDialog title={tt("biz.supersede")} description={<p>{tt("biz.supersedeBody")}</p>} submitLabel={tt("biz.supersede")} command="business_supersede_decision" nestUnder="replacement" fixed={{ decisionId: d.decisionId }} fields={[{ key: "title", label: tt("biz.col.title"), required: true }, { key: "decision", label: tt("biz.decision"), type: "textarea", required: true }, { key: "rationale", label: tt("biz.rationale"), type: "textarea" }]} successMessage={tt("biz.msg.superseded")} onClose={dlg.close} />)}>{tt("biz.supersede")}</Btn> : null}
                  {!admin && d.status !== "SUPERSEDED" ? <span className="pc-muted">{tt("common.needsAdmin")}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Async>
      {dlg.node}
    </Panel>
  );
}
