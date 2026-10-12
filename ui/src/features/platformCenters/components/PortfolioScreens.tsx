import { useState, type ReactNode } from "react";
import { Input } from "../../../components/ui";
import { useCanManage, useGet } from "../hooks/useCommand";
import { useRunner } from "../hooks/useRunner";
import { useT } from "../lib/useT";
import { healthTone, num, qualityTone, usd } from "../lib/tones";
import type { PortfolioAnswer, PortfolioDashboard, PriorityRank, ProjectDependency, ProjectSummary, ResourceClaim, ResourceConflict, ReusableKnowledge, CostFigure } from "../types";
import { Empty, Notice, Tag } from "./common";
import { FieldsDialog } from "./FieldsDialog";
import { Async, Btn, Cards, DataTable, Panel } from "./kit";

const CAP = "manage_portfolio" as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"];
const KINDS = ["DEPENDS_ON", "ORCHESTRATES", "CONSUMES"];
const RES_KINDS = ["ENVIRONMENT", "AGENT", "MODEL", "TOOL", "COMPUTE"];

function useDialog() {
  const [node, setNode] = useState<ReactNode>(null);
  return { node, open: setNode, close: () => setNode(null) };
}

/** A null cost is "not priced", never $0. */
function Cost({ cost }: { cost: CostFigure }) {
  const { tt } = useT();
  const amount = usd(cost.spentUsd);
  return (
    <span data-testid="cost">
      {amount ?? <span className="pc-muted">{tt("pf.notPriced")}</span>} · {num(cost.tokens)} {tt("pf.tokens")}
      {cost.unpriced > 0 ? <span className="pc-muted"> · {tt("pf.unpriced", { n: cost.unpriced })}</span> : null}
    </span>
  );
}

function HealthTag({ s }: { s: ProjectSummary }) {
  const { label } = useT();
  return (
    <Tag tone={healthTone(s.health.state)} title={s.health.reasons.join("; ")}>
      {label("health", s.health.state)}
    </Tag>
  );
}

/* -------------------------------- Dashboard -------------------------------- */

export function DashboardTab() {
  const { tt, label } = useT();
  const query = useGet<PortfolioDashboard>("/portfolio-intelligence/dashboard", {}, { refetchMs: 30_000 });
  return (
    <Async query={query}>
      {(d) => (
        <div className="pc-stack">
          <Panel title={tt("pf.summary")}>
            <Cards
              items={[
                { label: tt("pf.cards.projects"), value: d.counts.projects },
                { label: tt("pf.cards.active"), value: d.counts.active },
                { label: label("health", "HEALTHY"), value: d.counts.healthy },
                { label: label("health", "AT_RISK"), value: d.counts.atRisk },
                { label: label("health", "CRITICAL"), value: d.counts.critical },
                { label: label("health", "BLOCKED"), value: d.counts.blocked },
                { label: label("health", "UNKNOWN"), value: d.counts.unknown },
              ]}
            />
          </Panel>
          <Panel title={tt("pf.blocked")}>
            {d.blockedProjects.length === 0 ? (
              <p className="pc-muted">{tt("pf.noBlocked")}</p>
            ) : (
              <ul className="pc-list">
                {d.blockedProjects.map((b) => (
                  <li key={b.projectId}>
                    <strong>{b.projectId}</strong>: {b.reasons.join("; ")}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={tt("pf.deployments")}>
            <DataTable caption={tt("pf.deployments")} rows={d.deployments} rowKey={(x) => x.projectId} empty={tt("common.none")} columns={[{ key: "p", header: tt("pf.col.project"), render: (x) => x.projectId }, { key: "t", header: tt("pf.col.total"), render: (x) => x.total }, { key: "f", header: tt("pf.col.failed"), render: (x) => x.failed }, { key: "l", header: tt("pf.col.last"), render: (x) => x.lastAt?.slice(0, 16).replace("T", " ") ?? "—" }]} />
          </Panel>
          <Panel title={tt("pf.failures")}>
            <DataTable caption={tt("pf.failures")} rows={d.failures} rowKey={(x) => x.projectId} empty={tt("pf.noFailures")} columns={[{ key: "p", header: tt("pf.col.project"), render: (x) => x.projectId }, { key: "t", header: tt("pf.col.failedTasks"), render: (x) => x.failedTasks }, { key: "r", header: tt("pf.col.failedRuns"), render: (x) => x.failedRuns }]} />
          </Panel>
          <Panel title={tt("pf.security")}>
            <DataTable caption={tt("pf.security")} rows={d.security} rowKey={(x) => x.projectId} empty={tt("pf.noSecurity")} columns={[{ key: "p", header: tt("pf.col.project"), render: (x) => x.projectId }, { key: "o", header: tt("pf.col.openAlerts"), render: (x) => x.openAlerts }, { key: "c", header: tt("pf.col.highCritical"), render: (x) => x.critical }]} />
          </Panel>
          <Panel title={tt("pf.costs")}>
            <DataTable caption={tt("pf.costs")} rows={d.costs} rowKey={(x) => x.projectId} empty={tt("common.none")} columns={[{ key: "p", header: tt("pf.col.project"), render: (x) => x.projectId }, { key: "c", header: tt("pf.col.cost"), render: (x) => <Cost cost={x} /> }]} />
          </Panel>
          <Panel title={tt("pf.upcoming")}>
            <DataTable caption={tt("pf.upcoming")} rows={d.upcomingActions} rowKey={(x) => `${x.projectId}:${x.kind}`} empty={tt("pf.noUpcoming")} columns={[{ key: "p", header: tt("pf.col.project"), render: (x) => x.projectId }, { key: "k", header: tt("pf.col.kind"), render: (x) => label("upcoming", x.kind) }, { key: "n", header: tt("pf.col.count"), render: (x) => x.count }]} />
          </Panel>
          <Panel title={tt("pf.relations")}>
            <p className="pc-muted">{tt("pf.dependencyCount", { n: d.dependencies.length })} · {tt("pf.conflictCount", { n: d.conflicts.length })}</p>
          </Panel>
        </div>
      )}
    </Async>
  );
}

/* --------------------------------- Projects --------------------------------- */

export function ProjectsTab() {
  const { tt, label } = useT();
  const manage = useCanManage(CAP);
  const { run, pending } = useRunner();
  const [archived, setArchived] = useState(false);
  const query = useGet<{ projects: ProjectSummary[] }>("/portfolio-intelligence/projects", { archived: archived || undefined });
  const dlg = useDialog();
  return (
    <Panel title={tt("pf.projects")} actions={<label className="pc-check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> {tt("pf.showArchived")}</label>}>
      {!manage ? <Notice>{tt("common.readOnly")}</Notice> : null}
      <Async query={query}>
        {(data) =>
          data.projects.length === 0 ? (
            <Empty title={tt("pf.noProjects")} />
          ) : (
            <ul className="pc-rows">
              {data.projects.map((s) => (
                <li key={s.projectId} className="pc-row" data-project-id={s.projectId} data-health={s.health.state}>
                  <div className="pc-row__head">
                    <span className="pc-row__title">{s.name}</span>
                    <span className="pc-inline"><HealthTag s={s} />{s.archived ? <Tag>{tt("pf.archived")}</Tag> : null}</span>
                  </div>
                  <p className="pc-muted">{[s.repository, s.branch && `branch ${s.branch}`, s.environment, s.deploymentTarget, s.firebaseProject && `Firebase ${s.firebaseProject}`].filter(Boolean).join(" · ") || tt("pf.noRepository")}</p>
                  <p className="pc-text">{tt("pf.stack")}: {s.stack.length ? s.stack.join(", ") : tt("common.none")}</p>
                  <div className="pc-inline">
                    <Tag>{label("priority", s.priority)}</Tag>
                    <span className="pc-muted">{tt("pf.importance")} {s.strategicImportance}/5 · {tt("pf.urgency")} {s.urgency}/5 · {tt("pf.declaredRisk")} {s.declaredRisk}/5</span>
                  </div>
                  <p className="pc-text">{tt("pf.workflows", { active: s.workflows.active, total: s.workflows.total })} · <Cost cost={s.cost} /> · {tt("pf.agents")}: {s.agents.length ? s.agents.join(", ") : tt("common.none")}</p>
                  <details>
                    <summary>{tt("pf.evidence", { n: s.health.evidenceCount })}</summary>
                    <ul className="pc-list">
                      {s.health.signals.map((g) => (
                        <li key={g.name}><Tag tone={healthTone(g.status)}>{label("signal", g.status)}</Tag> <strong>{g.name}</strong>: {g.detail}</li>
                      ))}
                    </ul>
                  </details>
                  {s.dependsOn.length || s.dependedOnBy.length ? (
                    <p className="pc-muted">{s.dependsOn.length ? `${tt("pf.dependsOn")}: ${s.dependsOn.map((d) => `${d.projectId} (${label("depKind", d.kind)})`).join(", ")}` : ""} {s.dependedOnBy.length ? `${tt("pf.dependedOnBy")}: ${s.dependedOnBy.map((d) => d.projectId).join(", ")}` : ""}</p>
                  ) : null}
                  <div className="pc-actions">
                    <Btn size="small" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("pf.editProfile")} submitLabel={tt("common.save")} command="portfolio_set_profile" fixed={{ projectId: s.projectId }} initial={{ priority: s.priority, strategicImportance: String(s.strategicImportance), urgency: String(s.urgency), declaredRisk: String(s.declaredRisk), stack: s.stack.join("\n"), deploymentTarget: s.deploymentTarget ?? "", firebaseProject: s.firebaseProject ?? "", environment: s.environment ?? "", objectives: s.objectives.join("\n") }} fields={[{ key: "priority", label: tt("pf.priority"), type: "select", options: PRIORITIES.map((p) => ({ value: p, label: label("priority", p) })) }, { key: "strategicImportance", label: tt("pf.importance"), type: "number", help: "1–5" }, { key: "urgency", label: tt("pf.urgency"), type: "number", help: "1–5" }, { key: "declaredRisk", label: tt("pf.declaredRisk"), type: "number", help: "1–5" }, { key: "stack", label: tt("pf.stack"), type: "lines" }, { key: "deploymentTarget", label: tt("pf.deploymentTarget") }, { key: "firebaseProject", label: tt("pf.firebaseProject") }, { key: "environment", label: tt("pf.environment") }, { key: "objectives", label: tt("pf.objectives"), type: "lines" }]} successMessage={tt("pf.msg.saved")} onClose={dlg.close} />)}>{tt("pf.editProfile")}</Btn>
                    <Btn size="small" disabled={!manage || pending} onClick={() => run(s.archived ? "portfolio_restore_project" : "portfolio_archive_project", { projectId: s.projectId }, s.archived ? tt("pf.msg.restored") : tt("pf.msg.archivedProject"))}>{s.archived ? tt("pf.restore") : tt("pf.archive")}</Btn>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
      {dlg.node}
    </Panel>
  );
}

/* -------------------------------- Priorities -------------------------------- */

export function PrioritiesTab() {
  const { tt } = useT();
  const query = useGet<{ ranking: PriorityRank[]; note: string }>("/portfolio-intelligence/priorities");
  return (
    <Panel title={tt("pf.priorities")}>
      <Notice title={tt("pf.recommendationOnly")}>{tt("pf.prioritiesNote")}</Notice>
      <Async query={query}>
        {(data) =>
          data.ranking.length === 0 ? (
            <Empty title={tt("pf.noProjects")} />
          ) : (
            <ol className="pc-rows">
              {data.ranking.map((r) => (
                <li key={r.projectId} className="pc-row" data-rank={r.rank}>
                  <div className="pc-row__head"><span className="pc-row__title">#{r.rank} {r.projectId}</span><Tag>{tt("pf.score", { n: r.score })}</Tag></div>
                  {r.waitFor.length ? <Notice tone="warning">{tt("pf.waitFor", { list: r.waitFor.join(", ") })}</Notice> : null}
                  <DataTable caption={tt("pf.breakdown")} rows={r.breakdown} rowKey={(b) => b.factor} empty={tt("common.none")} columns={[{ key: "f", header: tt("pf.factor"), render: (b) => b.factor }, { key: "d", header: tt("common.detail"), render: (b) => b.detail }, { key: "p", header: tt("pf.points"), render: (b) => b.points }]} />
                </li>
              ))}
            </ol>
          )
        }
      </Async>
    </Panel>
  );
}

/* --------------------------- Dependencies & resources --------------------------- */

export function RelationsTab() {
  const { tt, label } = useT();
  const manage = useCanManage(CAP);
  const { run, pending } = useRunner();
  const deps = useGet<{ dependencies: ProjectDependency[] }>("/portfolio-intelligence/dependencies");
  const conflicts = useGet<{ conflicts: ResourceConflict[]; claims: ResourceClaim[] }>("/portfolio-intelligence/conflicts");
  const dlg = useDialog();
  return (
    <div className="pc-stack">
      <Panel title={tt("pf.dependencies")} actions={<Btn variant="primary" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("pf.addDependency")} description={<p>{tt("pf.dependencyHelp")}</p>} submitLabel={tt("pf.addDependency")} command="portfolio_add_dependency" fields={[{ key: "from", label: tt("pf.from"), required: true }, { key: "kind", label: tt("pf.col.kind"), type: "select", options: KINDS.map((k) => ({ value: k, label: label("depKind", k) })) }, { key: "to", label: tt("pf.to"), required: true }, { key: "weight", label: tt("pf.weight"), type: "number", help: "1–5" }, { key: "note", label: tt("biz.note") }]} successMessage={tt("pf.msg.saved")} onClose={dlg.close} />)}>{tt("pf.addDependency")}</Btn>}>
        <Async query={deps}>
          {(d) => (
            <DataTable caption={tt("pf.dependencies")} rows={d.dependencies} rowKey={(x) => x.id} empty={tt("pf.noDependencies")} columns={[{ key: "f", header: tt("pf.from"), render: (x) => x.from }, { key: "k", header: tt("pf.col.kind"), render: (x) => label("depKind", x.kind) }, { key: "t", header: tt("pf.to"), render: (x) => x.to }, { key: "w", header: tt("pf.weight"), render: (x) => x.weight }, { key: "a", header: tt("common.actions"), render: (x) => <Btn size="small" disabled={!manage || pending} onClick={() => run("portfolio_remove_dependency", { dependencyId: x.id }, tt("pf.msg.saved"))}>{tt("common.remove")}</Btn> }]} />
          )}
        </Async>
      </Panel>
      <Panel title={tt("pf.conflicts")} actions={<Btn variant="primary" disabled={!manage} onClick={() => dlg.open(<FieldsDialog title={tt("pf.claim")} submitLabel={tt("pf.claim")} command="portfolio_claim_resource" fields={[{ key: "projectId", label: tt("pf.col.project"), required: true }, { key: "kind", label: tt("pf.col.kind"), type: "select", options: RES_KINDS.map((k) => ({ value: k, label: label("resKind", k) })) }, { key: "resourceId", label: tt("pf.resource"), required: true }, { key: "exclusive", label: tt("pf.exclusive"), type: "checkbox" }]} successMessage={tt("pf.msg.saved")} onClose={dlg.close} />)}>{tt("pf.claim")}</Btn>}>
        <Async query={conflicts}>
          {(c) => (
            <>
              {c.conflicts.length === 0 ? <p className="pc-muted">{tt("pf.noConflicts")}</p> : (
                <ul className="pc-list">{c.conflicts.map((x) => (
                  <li key={`${x.kind}:${x.resourceId}`} data-severity={x.severity}><Tag tone={healthTone(x.severity === "CONFLICT" ? "CONFLICT" : x.severity === "WARNING" ? "WARN" : "OK")}>{label("severity", x.severity)}</Tag> <Tag>{x.source === "declared" ? tt("pf.declared") : tt("pf.observed")}</Tag> {x.explanation}</li>
                ))}</ul>
              )}
              <DataTable caption={tt("pf.claims")} rows={c.claims} rowKey={(x) => x.id} empty={tt("common.none")} columns={[{ key: "p", header: tt("pf.col.project"), render: (x) => x.projectId }, { key: "k", header: tt("pf.col.kind"), render: (x) => label("resKind", x.kind) }, { key: "r", header: tt("pf.resource"), render: (x) => x.resourceId }, { key: "e", header: tt("pf.exclusive"), render: (x) => (x.exclusive ? tt("common.yes") : tt("common.no")) }, { key: "a", header: tt("common.actions"), render: (x) => <Btn size="small" disabled={!manage || pending} onClick={() => run("portfolio_release_resource", { claimId: x.id }, tt("pf.msg.saved"))}>{tt("pf.release")}</Btn> }]} />
            </>
          )}
        </Async>
      </Panel>
      {dlg.node}
    </div>
  );
}

/* ------------------------------------ Ask ------------------------------------ */

const EXAMPLES = ["attention", "blocked", "ai", "deploy", "shared"] as const;

export function AskTab() {
  const { tt, label } = useT();
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState("");
  const query = useGet<PortfolioAnswer>("/portfolio-intelligence/ask", { q: asked }, { enabled: asked.trim() !== "" });
  return (
    <Panel title={tt("pf.ask")}>
      <p className="pc-muted">{tt("pf.askHelp")}</p>
      <div className="pc-chips">
        {EXAMPLES.map((k) => (
          <button key={k} type="button" className="pc-chip" onClick={() => { setDraft(tt(`pf.example.${k}`)); setAsked(tt(`pf.example.${k}`)); }}>{tt(`pf.example.${k}`)}</button>
        ))}
      </div>
      <form className="pc-searchbar" onSubmit={(e) => { e.preventDefault(); setAsked(draft); }}>
        <Input label={tt("pf.question")} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Btn variant="primary" onClick={() => setAsked(draft)} disabled={draft.trim() === ""}>{tt("pf.askButton")}</Btn>
      </form>
      {asked ? (
        <Async query={query}>
          {(a) => (
            <div className="pc-sub" data-testid="answer">
              <p className="pc-text"><strong>{a.answer}</strong></p>
              <div className="pc-inline"><Tag tone={qualityTone(a.confidence)}>{label("quality", a.confidence)}</Tag><span className="pc-muted">{tt("pf.basis")}: {a.basis.length ? a.basis.join(", ") : tt("common.none")}</span></div>
              {a.intent === "unsupported" ? <Notice tone="warning">{tt("pf.unsupported")}</Notice> : null}
              {Array.isArray(a.data) && a.data.length > 0 ? <pre className="pc-pre" aria-label={tt("pf.data")}>{JSON.stringify(a.data, null, 2)}</pre> : null}
            </div>
          )}
        </Async>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------- Knowledge ---------------------------------- */

export function KnowledgeTab() {
  const { tt, label } = useT();
  const query = useGet<{ items: ReusableKnowledge[] }>("/portfolio-intelligence/knowledge");
  return (
    <Panel title={tt("pf.knowledge")}>
      <Notice title={tt("pf.suggestionsOnly")}>{tt("pf.knowledgeNote")}</Notice>
      <Async query={query}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty title={tt("pf.noKnowledge")} />
          ) : (
            <ul className="pc-rows">
              {data.items.map((i) => (
                <li key={`${i.kind}:${i.title}`} className="pc-row">
                  <div className="pc-row__head"><span className="pc-row__title">{i.title}</span><Tag>{label("knowledgeKind", i.kind)}</Tag></div>
                  {i.projects.length ? <p className="pc-muted">{tt("pf.inProjects", { list: i.projects.join(", ") })}</p> : null}
                  <p className="pc-muted">{i.note}</p>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </Panel>
  );
}
