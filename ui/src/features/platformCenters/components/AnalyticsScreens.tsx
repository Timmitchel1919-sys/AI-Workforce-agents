import { useState, type ReactNode } from "react";
import { Select } from "../../../components/ui";
import type { Scope } from "../hooks/useScope";
import { useCanAdminister, useCanManage, useGet } from "../hooks/useCommand";
import { useRunner } from "../hooks/useRunner";
import { useT } from "../lib/useT";
import { healthTone, ms, num, pct, qualityTone, stateTone, usd } from "../lib/tones";
import type { AgentAnalytics, AnalyticsOverview, Bottleneck, CostIntelligence, Lesson, Prediction, ProjectAnalytics, Recommendation, WhatIfResult, WorkflowAnalytics } from "../types";
import { Empty, Notice, Tag } from "./common";
import { FieldsDialog } from "./FieldsDialog";
import { Async, Btn, Cards, DataTable, Panel, Quality } from "./kit";

const CAP = "manage_analytics" as const;

function useDialog() {
  const [node, setNode] = useState<ReactNode>(null);
  return { node, open: setNode, close: () => setNode(null) };
}

/** null money is "not priced", never $0. */
function Money({ value, unpriced }: { value: number | null; unpriced?: number }) {
  const { tt } = useT();
  const text = usd(value);
  return (
    <span data-testid="money">
      {text ?? <span className="pc-muted">{tt("an.notPriced")}</span>}
      {unpriced ? <span className="pc-muted"> · {tt("an.unpricedCalls", { n: unpriced })}</span> : null}
    </span>
  );
}

function BottleneckList({ items }: { items: Bottleneck[] }) {
  const { tt, label } = useT();
  if (items.length === 0) return <p className="pc-muted">{tt("an.noBottlenecks")}</p>;
  return (
    <ul className="pc-list">
      {items.map((b, i) => (
        <li key={`${b.kind}-${b.subject}-${i}`} data-severity={b.severity}>
          <Tag tone={healthTone(b.severity)}>{label("severity", b.severity)}</Tag> <strong>{label("bottleneck", b.kind)}</strong> — {b.subject}: {b.evidence}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ Predictions ------------------------------ */

function RangeBar({ range }: { range: [number, number] }) {
  const lo = Math.max(0, Math.min(1, range[0]));
  const hi = Math.max(lo, Math.min(1, range[1]));
  return (
    <span className="pc-range" aria-hidden>
      <span style={{ insetInlineStart: `${lo * 100}%`, inlineSize: `${Math.max((hi - lo) * 100, 1)}%` }} />
    </span>
  );
}

function PredictionRow({ p }: { p: Prediction }) {
  const { tt, label } = useT();
  const isProbability = p.unit === "probability";
  const text = p.range ? (isProbability ? `${Math.round(p.range[0] * 100)}% – ${Math.round(p.range[1] * 100)}%` : `${num(p.range[0])} – ${num(p.range[1])} ${p.unit ?? ""}`) : null;
  return (
    <li className="pc-row" data-label={p.label} data-testid="prediction">
      <div className="pc-row__head">
        <span className="pc-row__title">{label("predictionKind", p.kind)} · {p.subject}</span>
        <Tag tone={healthTone(p.label === "HIGH_RISK" ? "CRITICAL" : p.label === "LIKELY" ? "WARN" : "UNKNOWN")}>{label("predictionLabel", p.label)}</Tag>
      </div>
      <p className="pc-text">{p.statement}</p>
      {text ? <p className="pc-inline"><span data-testid="range">{tt("an.range")}: {text}</span>{isProbability && p.range ? <RangeBar range={p.range} /> : null}</p> : null}
      <p className="pc-muted">{tt("an.basis")}: {p.basis} · {tt("an.sample", { n: p.sample })}</p>
    </li>
  );
}

export function PredictionsTab() {
  const { tt } = useT();
  const query = useGet<{ predictions: Prediction[]; note: string }>("/analytics-intelligence/predictions");
  return (
    <Panel title={tt("an.predictions")}>
      <Notice title={tt("an.notCertainTitle")}>{tt("an.notCertain")}</Notice>
      <Async query={query}>{(d) => (d.predictions.length === 0 ? <Empty title={tt("an.noPredictions")} body={tt("an.noPredictionsBody")} /> : <ul className="pc-rows">{d.predictions.map((p, i) => <PredictionRow key={`${p.kind}-${p.subject}-${i}`} p={p} />)}</ul>)}</Async>
    </Panel>
  );
}

/* -------------------------------- Overview -------------------------------- */

export function OverviewTab() {
  const { tt } = useT();
  const query = useGet<AnalyticsOverview>("/analytics-intelligence/overview");
  return (
    <Async query={query}>
      {(o) => (
        <div className="pc-stack">
          <Notice title={tt("an.qualityTitle")}>{tt("an.qualityBody")}</Notice>
          <WorkflowCards w={o.workflows} />
          <Panel title={tt("an.autonomy")}>
            <Cards items={[{ label: tt("an.autonomyTotal"), value: o.autonomy.workflows }, { label: tt("an.autonomyCompleted"), value: o.autonomy.completed }, { label: tt("an.autonomyEscalated"), value: o.autonomy.escalated }, { label: tt("an.autonomyFailed"), value: o.autonomy.failed }, { label: tt("an.openRecs"), value: o.openRecommendations }]} />
          </Panel>
          <Panel title={tt("an.bottlenecks")}><BottleneckList items={o.bottlenecks} /></Panel>
          <Panel title={tt("an.predictions")}>{o.predictions.length === 0 ? <p className="pc-muted">{tt("an.noPredictions")}</p> : <ul className="pc-rows">{o.predictions.slice(0, 4).map((p, i) => <PredictionRow key={`${p.kind}-${i}`} p={p} />)}</ul>}</Panel>
        </div>
      )}
    </Async>
  );
}

function WorkflowCards({ w }: { w: WorkflowAnalytics }) {
  const { tt } = useT();
  return (
    <Panel title={tt("an.workflows")} actions={<Quality value={w.quality} />}>
      <Cards
        items={[
          { label: tt("an.runs"), value: w.runs },
          { label: tt("an.completionRate"), value: pct(w.completionRate), testId: "completion-rate" },
          { label: tt("an.failureRate"), value: pct(w.failureRate) },
          { label: tt("an.avgDuration"), value: ms(w.avgDurationMs) },
          { label: tt("an.medianDuration"), value: ms(w.medianDurationMs) },
          { label: tt("an.retryFrequency"), value: pct(w.retryFrequency) },
          { label: tt("an.approvalWait"), value: ms(w.approvalWait.avgMs) },
          { label: tt("an.pendingApprovals"), value: w.approvalWait.pending },
        ]}
      />
      <DataTable caption={tt("an.failurePoints")} rows={w.failurePoints} rowKey={(f) => `${f.taskType}:${f.title}`} empty={tt("an.noFailurePoints")} columns={[{ key: "t", header: tt("an.taskType"), render: (f) => f.taskType }, { key: "n", header: tt("an.task"), wrap: true, render: (f) => f.title }, { key: "c", header: tt("an.failures"), render: (f) => f.failures }]} />
    </Panel>
  );
}

/* --------------------------------- Agents --------------------------------- */

export function AgentsTab() {
  const { tt } = useT();
  const query = useGet<{ agents: AgentAnalytics[] }>("/analytics-intelligence/agents");
  return (
    <Panel title={tt("an.agents")}>
      <Async query={query}>
        {(d) => (
          <DataTable
            caption={tt("an.agents")}
            rows={d.agents}
            rowKey={(a) => a.agentId}
            empty={tt("an.noAgents")}
            columns={[
              { key: "a", header: tt("an.agent"), render: (a) => a.agentId },
              { key: "n", header: tt("an.assigned"), render: (a) => `${a.completed}/${a.failed}/${a.inProgress}` },
              { key: "s", header: tt("an.successRate"), render: (a) => <span data-testid="success-rate">{pct(a.successRate)}</span> },
              { key: "t", header: tt("an.avgExec"), render: (a) => ms(a.avgExecutionMs) },
              { key: "r", header: tt("an.retried"), render: (a) => `${a.retried} / ${a.correctionsRequested}` },
              { key: "k", header: tt("an.tokens"), render: (a) => num(a.tokens) },
              { key: "c", header: tt("an.cost"), render: (a) => <Money value={a.costUsd} unpriced={a.unpricedCalls} /> },
              { key: "m", header: tt("an.models"), wrap: true, render: (a) => a.models.map((m) => `${m.model} ×${m.calls}`).join(", ") || "—" },
              { key: "o", header: tt("an.tools"), wrap: true, render: (a) => a.tools.map((m) => `${m.tool} ×${m.calls}`).join(", ") || "—" },
              { key: "q", header: tt("an.dataQuality"), render: (a) => <Quality value={a.quality} /> },
            ]}
          />
        )}
      </Async>
    </Panel>
  );
}

/* ------------------------- Workflows & projects ------------------------- */

export function WorkflowsProjectsTab({ scope }: { scope: Scope }) {
  const { tt } = useT();
  const wf = useGet<WorkflowAnalytics>("/analytics-intelligence/workflows", { projectId: scope.projectId });
  const project = useGet<ProjectAnalytics>(`/analytics-intelligence/project/${encodeURIComponent(scope.projectId ?? "")}`, {}, { enabled: Boolean(scope.projectId) });
  return (
    <div className="pc-stack">
      <Async query={wf}>{(w) => <WorkflowCards w={w} />}</Async>
      {scope.projectId ? (
        <Async query={project}>
          {(p) => (
            <Panel title={tt("an.projectAnalytics", { id: scope.nameOf(p.projectId) })} actions={<Quality value={p.quality} />}>
              <Cards items={[{ label: tt("an.velocity"), value: p.velocityPerWeek === null ? tt("an.notEnoughData") : `${p.velocityPerWeek.toFixed(1)} / ${tt("an.perWeek")}` }, { label: tt("an.defectRate"), value: pct(p.defectRate) }, { label: tt("an.deploySuccess"), value: pct(p.deploymentSuccess) }, { label: tt("an.openAlerts"), value: p.securityIssues.open }, { label: tt("an.highAlerts"), value: p.securityIssues.highOrCritical }, { label: tt("an.cost"), value: <Money value={p.cost.usd} unpriced={p.cost.unpriced} /> }]} />
              <DataTable caption={tt("an.trend")} rows={p.completionTrend} rowKey={(w) => w.weekStart} empty={tt("common.none")} columns={[{ key: "w", header: tt("an.week"), render: (w) => w.weekStart }, { key: "c", header: tt("an.completedTasks"), render: (w) => <span className="pc-inline"><span className="pc-bar" aria-hidden><span style={{ inlineSize: `${Math.min(100, w.completed * 10)}%` }} /></span>{w.completed}</span> }]} />
              <DataTable caption={tt("an.blockers")} rows={p.blockers} rowKey={(b) => b.taskId} empty={tt("an.noBlockers")} columns={[{ key: "t", header: tt("an.task"), wrap: true, render: (b) => b.title }, { key: "r", header: tt("common.detail"), render: (b) => b.reason }]} />
            </Panel>
          )}
        </Async>
      ) : (
        <Notice>{tt("an.pickProject")}</Notice>
      )}
    </div>
  );
}

/* ----------------------------------- Cost ----------------------------------- */

export function CostTab({ scope }: { scope: Scope }) {
  const { tt } = useT();
  const query = useGet<CostIntelligence>("/analytics-intelligence/cost", { projectId: scope.projectId });
  return (
    <Async query={query}>
      {(c) => (
        <div className="pc-stack">
          <Notice>{c.note}</Notice>
          <Panel title={tt("an.cost")}>
            <Cards items={[{ label: tt("an.calls"), value: c.calls }, { label: tt("an.tokens"), value: num(c.totalTokens) }, { label: tt("an.pricedCost"), value: <Money value={c.pricedUsd} unpriced={c.unpricedCalls} /> }, { label: tt("an.perTask"), value: c.perTask.average === null ? "—" : `${num(Math.round(c.perTask.average))} ${tt("an.tokens")}` }]} />
          </Panel>
          <Panel title={tt("an.byProject")}><DataTable caption={tt("an.byProject")} rows={c.byProject} rowKey={(x) => x.projectId} empty={tt("common.none")} columns={[{ key: "p", header: tt("an.project"), render: (x) => x.projectId }, { key: "t", header: tt("an.tokens"), render: (x) => num(x.tokens) }, { key: "c", header: tt("an.cost"), render: (x) => <Money value={x.usd} unpriced={x.unpriced} /> }]} /></Panel>
          <Panel title={tt("an.byModel")}><DataTable caption={tt("an.byModel")} rows={c.byModel} rowKey={(x) => x.model} empty={tt("common.none")} columns={[{ key: "m", header: tt("an.model"), render: (x) => `${x.provider} / ${x.model}` }, { key: "n", header: tt("an.calls"), render: (x) => x.calls }, { key: "t", header: tt("an.tokens"), render: (x) => num(x.tokens) }, { key: "c", header: tt("an.cost"), render: (x) => <Money value={x.usd} unpriced={x.unpriced} /> }]} /></Panel>
          <Panel title={tt("an.byAgent")}><DataTable caption={tt("an.byAgent")} rows={c.byAgent} rowKey={(x) => x.agentId} empty={tt("common.none")} columns={[{ key: "a", header: tt("an.agent"), render: (x) => x.agentId }, { key: "t", header: tt("an.tokens"), render: (x) => num(x.tokens) }, { key: "c", header: tt("an.cost"), render: (x) => <Money value={x.usd} /> }]} /></Panel>
          <Panel title={tt("an.byWorkflow")}><DataTable caption={tt("an.byWorkflow")} rows={c.byWorkflow} rowKey={(x) => x.runId} empty={tt("common.none")} columns={[{ key: "r", header: tt("an.run"), render: (x) => x.runId }, { key: "p", header: tt("an.project"), render: (x) => x.projectId }, { key: "t", header: tt("an.tokens"), render: (x) => num(x.tokens) }, { key: "c", header: tt("an.cost"), render: (x) => <Money value={x.usd} /> }]} /></Panel>
          <Panel title={tt("an.weekly")}><DataTable caption={tt("an.weekly")} rows={c.weekly} rowKey={(x) => x.weekStart} empty={tt("common.none")} columns={[{ key: "w", header: tt("an.week"), render: (x) => x.weekStart }, { key: "t", header: tt("an.tokens"), render: (x) => <span className="pc-inline"><span className="pc-bar" aria-hidden><span style={{ inlineSize: `${Math.min(100, (x.tokens / Math.max(1, ...c.weekly.map((y) => y.tokens))) * 100)}%` }} /></span>{num(x.tokens)}</span> }, { key: "c", header: tt("an.cost"), render: (x) => <Money value={x.usd} /> }]} /></Panel>
        </div>
      )}
    </Async>
  );
}

/* ---------------------------- Recommendations ---------------------------- */

function RecCard({ r }: { r: Recommendation }) {
  const { tt, label } = useT();
  const admin = useCanAdminister(CAP);
  const manage = useCanManage(CAP);
  const { run, pending } = useRunner();
  const dlg = useDialog();
  return (
    <li className="pc-row" data-rec-status={r.status} data-testid="recommendation">
      <div className="pc-row__head"><span className="pc-row__title">{label("area", r.area)}{r.projectId ? ` · ${r.projectId}` : ""}</span><span className="pc-inline"><Tag tone={stateTone(r.status)}>{label("recStatus", r.status)}</Tag><Tag tone={qualityTone(r.confidence)}>{label("quality", r.confidence)}</Tag></span></div>
      <p className="pc-text"><strong>{tt("an.observation")}:</strong> {r.observation}</p>
      <ul className="pc-list">{r.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
      <p className="pc-text"><strong>{tt("an.recommendation")}:</strong> {r.recommendation}</p>
      <Notice tone="warning" title={tt("an.tradeoff")} testId="tradeoff">{r.tradeoff}</Notice>
      {r.expectedBenefit ? <p className="pc-muted">{tt("an.expectedBenefit")}: {r.expectedBenefit}</p> : null}
      {r.appliedNote ? <p className="pc-muted">{tt("an.appliedNote")}: {r.appliedNote}</p> : null}
      {r.measurement ? (
        <p className="pc-inline" data-testid="measurement"><Tag tone={r.measurement.verdict === "IMPROVED" ? "success" : r.measurement.verdict === "WORSE" ? "danger" : "neutral"}>{label("verdict", r.measurement.verdict)}</Tag><span className="pc-muted">{tt("an.baselineValue", { base: r.metric?.baseline ?? "—", value: r.measurement.value ?? "—" })}</span></p>
      ) : null}
      <div className="pc-actions">
        {r.status === "OPEN" ? (
          <>
            <Btn size="small" variant="primary" disabled={!admin || pending} onClick={() => run("analytics_decide_recommendation", { recommendationId: r.recommendationId, decision: "APPROVED" }, tt("an.msg.approved"))}>{tt("common.approve")}</Btn>
            <Btn size="small" disabled={!admin || pending} onClick={() => run("analytics_decide_recommendation", { recommendationId: r.recommendationId, decision: "REJECTED" }, tt("an.msg.rejected"))}>{tt("common.reject")}</Btn>
          </>
        ) : null}
        {r.status === "APPROVED" ? <Btn size="small" variant="primary" disabled={!admin} onClick={() => dlg.open(<FieldsDialog title={tt("an.markApplied")} description={<p>{tt("an.appliedHelp")}</p>} submitLabel={tt("an.markApplied")} command="analytics_mark_applied" fixed={{ recommendationId: r.recommendationId }} fields={[{ key: "note", label: tt("an.appliedNote"), type: "textarea" }]} successMessage={tt("an.msg.applied")} onClose={dlg.close} />)}>{tt("an.markApplied")}</Btn> : null}
        {(r.status === "APPLIED" || r.status === "MEASURED") && r.metric ? <Btn size="small" disabled={!manage || pending} onClick={() => run("analytics_measure_recommendation", { recommendationId: r.recommendationId }, tt("an.msg.measured"))}>{tt("an.measure")}</Btn> : null}
        {!admin && (r.status === "OPEN" || r.status === "APPROVED") ? <span className="pc-muted">{tt("common.needsAdmin")}</span> : null}
      </div>
      {dlg.node}
    </li>
  );
}

export function RecommendationsTab() {
  const { tt } = useT();
  const manage = useCanManage(CAP);
  const { run, pending } = useRunner();
  const query = useGet<{ recommendations: Recommendation[] }>("/analytics-intelligence/recommendations");
  return (
    <Panel title={tt("an.recommendations")} actions={<Btn variant="primary" disabled={!manage || pending} onClick={() => run("analytics_refresh_recommendations", {}, (r) => tt("an.msg.refreshed", { n: String(r.details["count"] ?? 0) }))}>{tt("an.refresh")}</Btn>}>
      <Notice title={tt("an.governedTitle")}>{tt("an.governed")}</Notice>
      <Async query={query}>{(d) => (d.recommendations.length === 0 ? <Empty title={tt("an.noRecs")} body={tt("an.noRecsBody")} /> : <ul className="pc-rows">{d.recommendations.map((r) => <RecCard key={r.recommendationId} r={r} />)}</ul>)}</Async>
    </Panel>
  );
}

/* ---------------------------------- What-if ---------------------------------- */

type ScenarioKind = "PRIORITIZE" | "PAUSE_PROJECT" | "SWITCH_MODEL";

export function WhatIfTab({ scope }: { scope: Scope }) {
  const { tt, label } = useT();
  const manage = useCanManage(CAP);
  const { run, pending } = useRunner();
  const [kind, setKind] = useState<ScenarioKind>("PRIORITIZE");
  const [a, setA] = useState(scope.projectId ?? "");
  const [b, setB] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const projects = scope.projects;
  const scenario = kind === "PRIORITIZE" ? { kind, projectId: a, above: b } : kind === "PAUSE_PROJECT" ? { kind, projectId: a } : { kind, fromModel: from, toModel: to };
  const ready = kind === "PRIORITIZE" ? a && b && a !== b : kind === "PAUSE_PROJECT" ? Boolean(a) : Boolean(from && to);
  const projectSelect = (value: string, set: (v: string) => void, text: string) => (
    <Select label={text} value={value} onChange={(e) => set(e.target.value)}>
      <option value="">—</option>
      {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
    </Select>
  );
  return (
    <Panel title={tt("an.whatIf")}>
      <Notice title={tt("an.simulationTitle")}>{tt("an.simulationBody")}</Notice>
      <Select label={tt("an.scenario")} value={kind} onChange={(e) => { setKind(e.target.value as ScenarioKind); setResult(null); }}>
        {(["PRIORITIZE", "PAUSE_PROJECT", "SWITCH_MODEL"] as const).map((k) => <option key={k} value={k}>{label("scenario", k)}</option>)}
      </Select>
      {kind !== "SWITCH_MODEL" ? projectSelect(a, setA, kind === "PRIORITIZE" ? tt("an.prioritize") : tt("an.project")) : null}
      {kind === "PRIORITIZE" ? projectSelect(b, setB, tt("an.above")) : null}
      {kind === "SWITCH_MODEL" ? (
        <div className="pc-form">
          <label className="pc-field"><span>{tt("an.fromModel")}</span><input className="ui-input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="pc-field"><span>{tt("an.toModel")}</span><input className="ui-input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      ) : null}
      <div className="pc-actions">
        <Btn variant="primary" disabled={!manage || !ready || pending} onClick={() => run("analytics_run_what_if", { scenario }, tt("an.msg.simulated"), { onDone: (r) => setResult({ simulated: true, summary: String(r.details["summary"] ?? ""), impacts: (r.details["impacts"] as WhatIfResult["impacts"]) ?? [], assumptions: (r.details["assumptions"] as string[]) ?? [], confidence: (r.details["confidence"] as WhatIfResult["confidence"]) ?? "NO_DATA" }) })}>{tt("an.runSimulation")}</Btn>
        {!manage ? <span className="pc-muted">{tt("common.needsManage")}</span> : null}
      </div>
      {result ? (
        <div className="pc-sim" data-testid="simulation">
          <Tag tone="info">{tt("an.simulationLabel")}</Tag>
          <p className="pc-text"><strong>{result.summary}</strong></p>
          <ul className="pc-list">{result.impacts.map((i, n) => <li key={n}><Tag>{label("impactArea", i.area)}</Tag> {i.statement}{i.value !== undefined && i.value !== null ? ` (${i.value}${i.unit ? ` ${i.unit}` : ""})` : ""}</li>)}</ul>
          <p className="pc-muted">{tt("an.assumptions")}: {result.assumptions.join(" ")}</p>
          <Quality value={result.confidence} />
        </div>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------- Lessons ---------------------------------- */

export function LessonsTab() {
  const { tt, label } = useT();
  const manage = useCanManage(CAP);
  const { run, pending } = useRunner();
  const query = useGet<{ lessons: Lesson[] }>("/analytics-intelligence/lessons");
  return (
    <Panel title={tt("an.lessons")} actions={<Btn variant="primary" disabled={!manage || pending} onClick={() => run("analytics_capture_lessons", {}, (r) => tt("an.msg.captured", { n: String(r.details["created"] ?? 0) }))}>{tt("an.capture")}</Btn>}>
      <Notice>{tt("an.lessonsHelp")}</Notice>
      <Async query={query}>
        {(d) => (d.lessons.length === 0 ? <Empty title={tt("an.noLessons")} /> : (
          <ul className="pc-rows">{d.lessons.map((l) => (
            <li key={l.lessonId} className="pc-row">
              <div className="pc-row__head"><span className="pc-row__title">{l.title}</span><Tag tone={l.storedInKnowledge ? "success" : "warning"}>{l.storedInKnowledge ? tt("an.storedKnowledge") : tt("an.notStoredKnowledge")}</Tag></div>
              <p className="pc-text">{l.content}</p>
              <p className="pc-muted">{label("lessonKind", l.kind)}{l.projectId ? ` · ${l.projectId}` : ""} · {l.evidence.join(", ")}</p>
            </li>
          ))}</ul>
        ))}
      </Async>
    </Panel>
  );
}
