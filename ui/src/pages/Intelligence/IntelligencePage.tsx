import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { Skeleton } from "../../components/ui";
import { useAuth } from "../../auth/useAuth";
import { useAgents, type AgentListItem } from "../../features/agents";
import { useProjectCostReport, useProjectGovernancePolicy } from "../../features/costCenter";
import { useProjectRoutingDecisions } from "../../features/modelRouting/useModelRouting";
import { ProjectPicker } from "../../features/projectScope/ProjectPicker";
import { useActiveProject } from "../../features/projectScope/useActiveProject";
import {
  MIN_SAMPLE,
  agentPerformance,
  getModelRegistry,
  modelUsage,
  recommendations,
  routingSummary,
  type Rate,
} from "../../features/intelligence/intelligenceAnalytics";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "./IntelligencePage.css";

const TABS = ["agents", "models", "routing", "capabilities", "performance", "costs", "policies", "recommendations"] as const;
type Tab = (typeof TABS)[number];

/**
 * Intelligence Control Center (UI Layer 6). Every view reads an authoritative
 * Control Plane record. Agents, models, tools and environments are kept as
 * separate concepts; nothing is benchmarked, estimated or invented here, and
 * recommendations are advisory only (they never change a policy).
 */
export default function IntelligencePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("agents");
  const active = useActiveProject();
  const projectId = active.projectId ?? "";
  const agents = useAgents();

  return (
    <PageContainer variant="wide">
      <PageHeader eyebrow={t("common.brand")} title={t("intelligenceCenter.title")} description={t("intelligenceCenter.description")} />
      <div className="ic-scope">
        <ProjectPicker projects={active.projects} value={projectId} onChange={active.select} />
      </div>

      <div role="tablist" aria-label={t("intelligenceCenter.title")} className="ic-tabs">
        {TABS.map((id) => (
          <button
            key={id}
            id={`ic-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`ic-panel-${id}`}
            className={tab === id ? "is-active" : ""}
            onClick={() => setTab(id)}
          >
            {t(`intelligenceCenter.tabs.${id}` as MessageKey)}
          </button>
        ))}
      </div>

      <section role="tabpanel" id={`ic-panel-${tab}`} aria-labelledby={`ic-tab-${tab}`} className="ic-panel">
        {agents.data && !agents.data.authoritative ? <p className="ic-caveat">{t("intelligenceCenter.notAuthoritative")}</p> : null}
        {tab === "agents" ? <AgentsTab agents={agents.data?.agents} status={agents.status} /> : null}
        {tab === "models" ? <ModelsTab /> : null}
        {tab === "capabilities" ? <CapabilitiesTab agents={agents.data?.agents ?? []} /> : null}
        {["routing", "performance", "costs", "policies", "recommendations"].includes(tab) ? (
          projectId ? (
            <ProjectTabs key={projectId} tab={tab} projectId={projectId} agents={agents.data?.agents ?? []} />
          ) : (
            <p className="ic-muted">{t("intelligenceCenter.projectNeeded")}</p>
          )
        ) : null}
      </section>
    </PageContainer>
  );
}

function RateCell({ rate }: { rate: Rate }) {
  const { t } = useI18n();
  if (rate.value === null) return <span className="ic-muted">{t("intelligenceCenter.unknown")}</span>;
  return (
    <span>
      {Math.round(rate.value * 100)}% <span className="ic-muted">({t("intelligenceCenter.sample", { n: rate.sample })})</span>
      {rate.lowSample ? <span className="ic-flag"> {t("intelligenceCenter.lowSample")}</span> : null}
    </span>
  );
}

function AgentsTab({ agents, status }: { agents?: AgentListItem[]; status: string }) {
  const { t } = useI18n();
  if (status === "loading") return <Skeleton height={160} />;
  if (!agents) return <p role="alert">{t("intelligenceCenter.loadFailed")}</p>;
  if (agents.length === 0) return <p className="ic-muted">{t("intelligenceCenter.agents.empty")}</p>;
  return (
    <>
      <p className="ic-muted">{t("intelligenceCenter.agents.governedNote")}</p>
      <div className="ic-table-wrap">
        <table className="ic-table">
          <thead>
            <tr>
              {(["agent", "status", "capabilities", "projects", "model", "tasks"] as const).map((c) => (
                <th key={c} scope="col">{t(`intelligenceCenter.agents.columns.${c}` as MessageKey)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <th scope="row">
                  <Link to={`/agents/${encodeURIComponent(a.id)}`}>{a.name}</Link>
                  <div className="ic-muted ic-mono">{a.id}</div>
                </th>
                <td>{a.enabled ? t("intelligenceCenter.agents.enabled") : t("intelligenceCenter.agents.disabled")}</td>
                <td>{a.capabilities.join(", ") || "—"}</td>
                <td>{a.allowedProjects.includes("*") ? t("intelligenceCenter.agents.allProjects") : a.allowedProjects.join(", ") || "—"}</td>
                <td>
                  {a.specialist?.modelPolicy
                    ? `${a.specialist.modelPolicy.provider}${a.specialist.modelPolicy.model ? ` / ${a.specialist.modelPolicy.model}` : ""}`
                    : t("intelligenceCenter.agents.noModelPolicy")}
                </td>
                <td>{a.taskCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ModelsTab() {
  const { t } = useI18n();
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: ["intelligence", "models", accessToken ?? "anonymous"],
    queryFn: () => getModelRegistry(accessToken),
    retry: false,
  });
  if (query.isLoading) return <Skeleton height={120} />;
  if (query.error || !query.data) return <p role="alert">{t("intelligenceCenter.loadFailed")}</p>;
  if (!query.data.configured) return <p className="ic-muted">{t("intelligenceCenter.notConfigured")}</p>;
  const reg = query.data;
  return (
    <>
      <p className="ic-muted">{t("intelligenceCenter.models.intro")}</p>
      <ul className="ic-chips">
        <li>{t("intelligenceCenter.models.pricing")}</li>
        <li>{t("intelligenceCenter.models.benchmarks")}</li>
      </ul>
      {reg.profiles.length === 0 ? (
        <p className="ic-muted">{t("intelligenceCenter.models.empty")}</p>
      ) : (
        <div className="ic-table-wrap">
          <table className="ic-table">
            <thead>
              <tr>
                {(["profile", "provider", "model", "capabilities", "provider_registered"] as const).map((c) => (
                  <th key={c} scope="col">{t(`intelligenceCenter.models.columns.${c}` as MessageKey)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reg.profiles.map((p) => (
                <tr key={p.profileId}>
                  <th scope="row" className="ic-mono">{p.profileId}</th>
                  <td>{p.providerId}</td>
                  <td>{p.model ?? <span className="ic-muted">{t("intelligenceCenter.models.providerDefault")}</span>}</td>
                  <td>{p.capabilities.join(", ")}</td>
                  <td>{p.providerRegistered ? t("intelligenceCenter.models.registered") : t("intelligenceCenter.models.notRegistered")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ic-muted">{t("intelligenceCenter.models.credentials")}</p>
    </>
  );
}

function CapabilitiesTab({ agents }: { agents: readonly AgentListItem[] }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const map = new Map<string, { agents: string[]; projects: Set<string> }>();
    for (const a of agents)
      for (const c of a.capabilities) {
        const row = map.get(c) ?? { agents: [], projects: new Set<string>() };
        row.agents.push(a.name);
        a.allowedProjects.forEach((p) => row.projects.add(p));
        map.set(c, row);
      }
    const q = filter.trim().toLowerCase();
    return [...map]
      .filter(([c, r]) => !q || c.toLowerCase().includes(q) || r.agents.some((x) => x.toLowerCase().includes(q)) || [...r.projects].some((p) => p.toLowerCase().includes(q)))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [agents, filter]);
  return (
    <>
      <p className="ic-muted">{t("intelligenceCenter.capabilities.intro")}</p>
      <label className="ic-filter">
        <span className="visually-hidden">{t("intelligenceCenter.capabilities.filter")}</span>
        <input type="search" placeholder={t("intelligenceCenter.capabilities.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      {rows.length === 0 ? (
        <p className="ic-muted">{t("intelligenceCenter.capabilities.empty")}</p>
      ) : (
        <div className="ic-table-wrap">
          <table className="ic-table">
            <thead>
              <tr>
                {(["capability", "agents", "projects"] as const).map((c) => (
                  <th key={c} scope="col">{t(`intelligenceCenter.capabilities.columns.${c}` as MessageKey)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([cap, r]) => (
                <tr key={cap}>
                  <th scope="row" className="ic-mono">{cap}</th>
                  <td>{r.agents.join(", ")}</td>
                  <td>{[...r.projects].sort().join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ProjectTabs({ tab, projectId, agents }: { tab: Tab; projectId: string; agents: readonly AgentListItem[] }) {
  const { t, language } = useI18n();
  const routing = useProjectRoutingDecisions(projectId);
  const cost = useProjectCostReport(projectId);
  const policy = useProjectGovernancePolicy(projectId);

  const decisions = routing.data?.configured ? routing.data.decisions : [];
  const summary = routing.data?.configured ? routingSummary(decisions) : undefined;
  const usage = cost.data?.configured ? modelUsage(cost.data.usage) : [];
  const performance = agentPerformance(agents);

  if (tab === "routing") {
    if (routing.state === "loading") return <Skeleton height={120} />;
    if (routing.state !== "ready") return <p role="alert">{t("intelligenceCenter.loadFailed")}</p>;
    if (!summary) return <p className="ic-muted">{t("intelligenceCenter.notConfigured")}</p>;
    return (
      <>
        <p className="ic-muted">{t("intelligenceCenter.routing.intro")}</p>
        {summary.decisions === 0 ? (
          <p className="ic-muted">{t("intelligenceCenter.routing.empty")}</p>
        ) : (
          <>
            <dl className="ic-stats">
              <div><dt>{t("intelligenceCenter.routing.decisions")}</dt><dd>{summary.decisions}</dd></div>
              <div><dt>{t("intelligenceCenter.routing.selected")}</dt><dd>{summary.selected}</dd></div>
              <div><dt>{t("intelligenceCenter.routing.noModel")}</dt><dd>{summary.noModel}</dd></div>
              <div><dt>{t("intelligenceCenter.routing.fallbacks")}</dt><dd>{summary.fallbacks}</dd></div>
            </dl>
            <div className="ic-two">
              <div>
                <h3>{t("intelligenceCenter.routing.selections")}</h3>
                <ul>{summary.selections.map((s) => <li key={s.model}><span className="ic-mono">{s.model}</span> · {s.count}</li>)}</ul>
                {summary.selections.length === 0 ? <p className="ic-muted">{t("intelligenceCenter.routing.none")}</p> : null}
              </div>
              <div>
                <h3>{t("intelligenceCenter.routing.rejections")}</h3>
                <ul>{summary.rejectionReasons.map((r) => <li key={r.reason}><span className="ic-mono">{r.reason}</span> · {r.count}</li>)}</ul>
                {summary.rejectionReasons.length === 0 ? <p className="ic-muted">{t("intelligenceCenter.routing.none")}</p> : null}
              </div>
            </div>
            <h3>{t("intelligenceCenter.routing.recent")}</h3>
            <ul className="ic-list">
              {decisions.slice(0, 10).map((d) => (
                <li key={d.routingDecisionId}>
                  <Link to={`/projects/${encodeURIComponent(projectId)}/model-routing/${encodeURIComponent(d.routingDecisionId)}`}>
                    {formatDateTime(d.createdAt, language)}
                  </Link>{" "}
                  · {d.agentId} → {d.selectedProvider ? `${d.selectedProvider}/${d.selectedModel ?? "—"}` : t("intelligenceCenter.routing.noModel")}
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  if (tab === "performance") {
    return (
      <>
        <p className="ic-muted">{t("intelligenceCenter.performance.intro", { min: MIN_SAMPLE })}</p>
        <h3>{t("intelligenceCenter.performance.agentSuccess")}</h3>
        <div className="ic-table-wrap">
          <table className="ic-table">
            <thead>
              <tr>
                <th scope="col">{t("intelligenceCenter.performance.columns.agent")}</th>
                <th scope="col">{t("intelligenceCenter.performance.columns.success")}</th>
                <th scope="col">{t("intelligenceCenter.performance.columns.tasks")}</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((p) => (
                <tr key={p.agentId}>
                  <th scope="row">{p.name}</th>
                  <td><RateCell rate={p.success} /></td>
                  <td>{p.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>{t("intelligenceCenter.performance.modelUsage")}</h3>
        <UsageTable usage={usage} state={cost.state} configured={cost.data?.configured} />
      </>
    );
  }

  if (tab === "costs") {
    if (cost.state === "loading") return <Skeleton height={120} />;
    if (cost.state !== "ready" || !cost.data) return <p role="alert">{t("intelligenceCenter.loadFailed")}</p>;
    if (!cost.data.configured) return <p className="ic-muted">{t("intelligenceCenter.notConfigured")}</p>;
    const actual = usage.reduce((n, u) => n + u.pricedUsd, 0);
    const unpriced = usage.reduce((n, u) => n + u.unpricedCalls, 0);
    return (
      <>
        <p className="ic-muted">{t("intelligenceCenter.costs.intro")}</p>
        <dl className="ic-stats">
          <div><dt>{t("intelligenceCenter.costs.actualTotal")}</dt><dd>{usage.length ? `$${actual.toFixed(4)}` : t("intelligenceCenter.unknown")}</dd></div>
          <div><dt>{t("intelligenceCenter.costs.unpriced")}</dt><dd>{unpriced}</dd></div>
          <div><dt>{t("intelligenceCenter.costs.budget")}</dt><dd>{cost.data.evaluation.status}</dd></div>
        </dl>
        <Link to={`/cost?project=${encodeURIComponent(projectId)}`}>{t("intelligenceCenter.costs.openCostCenter")}</Link>
      </>
    );
  }

  if (tab === "policies") {
    if (policy.state === "loading") return <Skeleton height={100} />;
    if (policy.state !== "ready" || !policy.data) return <p role="alert">{t("intelligenceCenter.loadFailed")}</p>;
    if (!policy.data.configured || !policy.data.policy) return <p className="ic-muted">{t("intelligenceCenter.notConfigured")}</p>;
    const p = policy.data.policy;
    return (
      <>
        <p className="ic-muted">{t("intelligenceCenter.policies.intro")}</p>
        <dl className="ic-stats">
          <div><dt>{t("intelligenceCenter.policies.allowedProviders")}</dt><dd>{p.allowedProviders?.length ? p.allowedProviders.join(", ") : t("intelligenceCenter.policies.any")}</dd></div>
          <div><dt>{t("intelligenceCenter.policies.allowedModels")}</dt><dd>{p.allowedModels?.length ? p.allowedModels.join(", ") : t("intelligenceCenter.policies.any")}</dd></div>
          <div><dt>{t("intelligenceCenter.policies.approvalThreshold")}</dt><dd>{p.requireApprovalAboveUsd !== undefined ? `$${p.requireApprovalAboveUsd}` : t("intelligenceCenter.policies.none")}</dd></div>
        </dl>
        <Link to={`/projects/${encodeURIComponent(projectId)}/model-routing`}>{t("intelligenceCenter.policies.edit")}</Link>
      </>
    );
  }

  const recs = recommendations({ performance, routing: summary, usage });
  return (
    <>
      <p className="ic-muted">{t("intelligenceCenter.recommendations.intro")}</p>
      {recs.length === 0 ? (
        <p className="ic-muted">{t("intelligenceCenter.recommendations.empty")}</p>
      ) : (
        <ul className="ic-recs">
          {recs.map((r) => (
            <li key={`${r.kind}-${r.subject}`}>
              <p>{t(`intelligenceCenter.recommendations.kinds.${r.kind}` as MessageKey, { subject: r.subject, ...r.evidence })}</p>
              <p className="ic-muted">
                {t(`intelligenceCenter.recommendations.confidence.${r.confidence}` as MessageKey)} · {t("intelligenceCenter.recommendations.requiresApproval")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function UsageTable({ usage, state, configured }: { usage: ReturnType<typeof modelUsage>; state: string; configured?: boolean }) {
  const { t } = useI18n();
  if (state === "loading") return <Skeleton height={80} />;
  if (state !== "ready") return <p role="alert">{t("intelligenceCenter.loadFailed")}</p>;
  if (!configured) return <p className="ic-muted">{t("intelligenceCenter.notConfigured")}</p>;
  if (usage.length === 0) return <p className="ic-muted">{t("intelligenceCenter.performance.noUsage")}</p>;
  return (
    <div className="ic-table-wrap">
      <table className="ic-table">
        <thead>
          <tr>
            {(["model", "calls", "tokens", "actual", "unpriced"] as const).map((c) => (
              <th key={c} scope="col">{t(`intelligenceCenter.performance.columns.${c}` as MessageKey)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.key}>
              <th scope="row" className="ic-mono">{u.key}</th>
              <td>{u.calls}</td>
              <td>{u.totalTokens ?? t("intelligenceCenter.unknown")}</td>
              <td>{u.pricedCalls ? `$${u.pricedUsd.toFixed(4)}` : t("intelligenceCenter.unknown")}</td>
              <td>{u.unpricedCalls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
