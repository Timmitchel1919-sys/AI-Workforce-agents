import { useOverview } from "../hooks/useTrust";
import { riskTone } from "../lib/logic";
import { useT } from "../lib/useT";
import type { AuditorFinding, Dashboard, LedgerEntry, LedgerVerification, Overview, TrustScore } from "../types";
import { EmergencyPanel } from "./EmergencyPanel";
import { Empty, ErrorPanel, Notice, RiskTag, Skeleton, Tag } from "./common";

export function LedgerIndicator({ ledger }: { ledger: LedgerVerification }) {
  const { tt } = useT();
  return (
    <p className="sc-inline" data-testid="ledger-status" data-ok={ledger.ok}>
      <Tag tone={ledger.ok ? "success" : "danger"}>
        {ledger.ok ? tt("ledger.verified", { count: ledger.entries }) : tt("ledger.failed", { entry: ledger.brokenAt ?? 0 })}
      </Tag>
    </p>
  );
}

function TrustScorePanel({ score }: { score: TrustScore }) {
  const { tt } = useT();
  return (
    <section className="sc-panel" aria-labelledby="sc-score-title" data-testid="trust-score">
      <h2 id="sc-score-title" className="sc-panel__title">{tt("score.title")}</h2>
      <p className="sc-inline">
        <strong className="sc-score__value" data-testid="trust-score-value">{score.score}</strong>
        <Tag tone="info">{score.label}</Tag>
      </p>
      {score.factors.length === 0 ? <p className="sc-muted">{tt("score.noFactors")}</p> : (
        <ul className="sc-list" aria-label={tt("score.factors")}>
          {score.factors.map((f) => (
            <li key={f.factor}>{tt("score.factor", { factor: f.factor, count: f.count, points: f.points })}</li>
          ))}
        </ul>
      )}
      <Notice tone="warning" title={tt("score.disclaimerTitle")}><span data-testid="trust-disclaimer">{score.disclaimer}</span></Notice>
    </section>
  );
}

function DashboardCards({ dashboard }: { dashboard: Dashboard }) {
  const { tt, label, formatTime } = useT();
  const vulns = dashboard.dependencyVulnerabilities;
  const cards: [string, string | number][] = [
    ["openAlerts", dashboard.openAlerts],
    ["criticalAlerts", dashboard.criticalAlerts],
    ["blockedActions24h", dashboard.blockedActions24h],
    ["pendingApprovals", dashboard.pendingApprovals],
    ["policyViolations7d", dashboard.policyViolations7d],
    ["suspendedAgents", dashboard.suspendedAgents],
    ["configChanges", dashboard.configChangesUnacknowledged],
    [
      "dependencyVulnerabilities",
      vulns ? tt("dashboard.vulnCounts", { critical: vulns.critical, high: vulns.high, moderate: vulns.moderate, low: vulns.low }) : tt("dashboard.notScanned"),
    ],
  ];
  const tone = dashboard.status === "NOMINAL" ? "success" : dashboard.status === "ATTENTION" ? "warning" : "danger";
  return (
    <section className="sc-panel" aria-labelledby="sc-dash-title">
      <div className="sc-header-row">
        <h2 id="sc-dash-title" className="sc-panel__title">{tt("dashboard.title")}</h2>
        <span data-testid="dashboard-status"><Tag tone={tone}>{label("dashboardStatus", dashboard.status)}</Tag></span>
      </div>
      <ul className="sc-cards" aria-label={tt("dashboard.title")}>
        {cards.map(([key, value]) => (
          <li key={key} className="sc-card" data-card={key}>
            <span className="sc-card__label">{tt(`dashboard.${key}`)}</span>
            <strong className="sc-card__value">{value}</strong>
          </li>
        ))}
      </ul>
      <p className="sc-muted">{tt("dashboard.generatedAt", { at: formatTime(dashboard.generatedAt) })}</p>
    </section>
  );
}

function RecentEvents({ events }: { events: readonly LedgerEntry[] }) {
  const { tt, formatTime } = useT();
  return (
    <section className="sc-panel" aria-labelledby="sc-events-title">
      <h2 id="sc-events-title" className="sc-panel__title">{tt("events.title")}</h2>
      {events.length === 0 ? <Empty title={tt("events.empty")} /> : (
        <ul className="sc-rows">
          {events.map((e) => (
            <li key={e.id} className="sc-row">
              <div className="sc-row__head">
                <span className="sc-row__title">{e.operation}</span>
                <span className="sc-muted">{formatTime(e.at)}</span>
              </div>
              <div className="sc-row__meta">
                {e.severity ? <RiskTag value={e.severity} /> : null}
                <span className="sc-muted">{e.actor}</span>
                {e.action ? <span className="sc-muted">{e.action}</span> : null}
                {e.resource ? <span className="sc-muted">{e.resource}</span> : null}
                <span className="sc-muted">{e.result}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Findings({ findings }: { findings: readonly AuditorFinding[] }) {
  const { tt, label } = useT();
  return (
    <section className="sc-panel" aria-labelledby="sc-findings-title">
      <h2 id="sc-findings-title" className="sc-panel__title">{tt("findings.title")}</h2>
      {findings.length === 0 ? <Empty title={tt("findings.empty")} /> : (
        <ul className="sc-findings">
          {findings.map((f) => (
            <li key={f.findingId} className="sc-finding" data-severity={f.severity}>
              <div className="sc-row__meta">
                <Tag tone={riskTone(f.severity.toUpperCase())}>{label("findingSeverity", f.severity)}</Tag>
                <strong>{f.ruleId}</strong>
                <span className="sc-muted">{f.subjectId}</span>
              </div>
              <p className="sc-text">{f.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OverviewContent({ overview }: { overview: Overview }) {
  const { tt } = useT();
  const caps = overview.capabilities;
  return (
    <div className="sc-stack">
      <TrustScorePanel score={overview.trustScore} />
      <DashboardCards dashboard={overview.dashboard} />
      <section className="sc-panel" aria-labelledby="sc-ledger-title">
        <h2 id="sc-ledger-title" className="sc-panel__title">{tt("ledger.title")}</h2>
        <LedgerIndicator ledger={overview.ledger} />
        <p className="sc-muted">{tt("ledger.explained")}</p>
      </section>
      <EmergencyPanel emergency={overview.emergency} showHistory={false} />
      <RecentEvents events={overview.dashboard.recentEvents} />
      <Findings findings={overview.auditorFindings} />
      <section className="sc-panel" aria-labelledby="sc-caps-title">
        <h2 id="sc-caps-title" className="sc-panel__title">{tt("capabilities.title")}</h2>
        <ul className="sc-list">
          <li>{tt("capabilities.policyEngine", { state: caps.policyEngine ? tt("common.yes") : tt("common.no") })}</li>
          <li>{caps.dependencyScanning ? tt("capabilities.dependencyOn") : tt("capabilities.dependencyOff")}</li>
          <li>{caps.outboundNetworkDetection ? tt("capabilities.networkOn") : tt("capabilities.networkOff")}</li>
        </ul>
      </section>
    </div>
  );
}

export function OverviewTab({ projectId }: { projectId: string | undefined }) {
  const { tt } = useT();
  const query = useOverview(projectId);
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  return <OverviewContent overview={query.data} />;
}
