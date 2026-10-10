import { useOverview } from "../hooks/useKnowledge";
import { useT } from "../lib/useT";
import type { Finding, KnowledgeHealth } from "../types";
import { Empty, ErrorPanel, Notice, Skeleton, Tag } from "./common";

export function HealthCards({ health }: { health: KnowledgeHealth }) {
  const { tt } = useT();
  const cards: [string, number][] = [
    ["total", health.total],
    ["active", health.byStatus?.ACTIVE ?? 0],
    ["superseded", health.byStatus?.SUPERSEDED ?? 0],
    ["potentiallyStale", health.potentiallyStale],
    ["conflicts", health.conflicts],
    ["unverified", health.unverified],
    ["drafts", health.drafts],
    ["expiringSoon", health.expiringSoon],
    ["documents", health.documents],
    ["relationships", health.edges],
  ];
  return (
    <ul className="kn-cards" aria-label={tt("health.label")}>
      {cards.map(([key, value]) => (
        <li key={key} className="kn-card" data-health={key}>
          <span className="kn-card__label">{tt(`health.${key}`)}</span>
          <strong className="kn-card__value">{value}</strong>
        </li>
      ))}
    </ul>
  );
}

export function FindingsList({ findings }: { findings: readonly Finding[] }) {
  const { tt, label } = useT();
  if (findings.length === 0) return <Empty title={tt("findings.emptyTitle")} body={tt("findings.emptyBody")} />;
  return (
    <ul className="kn-findings">
      {findings.map((finding) => (
        <li key={finding.findingId} className="kn-finding" data-severity={finding.severity}>
          <div className="kn-row__meta">
            <Tag tone={finding.severity === "high" ? "danger" : finding.severity === "medium" ? "warning" : "info"}>
              {label("severity", finding.severity)}
            </Tag>
            <strong>{label("rule", finding.ruleId.replace(/^knowledge\./, ""))}</strong>
            <code className="kn-inline-code">{finding.subjectId}</code>
          </div>
          <p className="kn-text">{finding.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function CapabilityNotes({ embeddings, pdfExtraction, canWrite, retrieval }: { embeddings: boolean; pdfExtraction: boolean; canWrite: boolean; retrieval: string }) {
  const { tt } = useT();
  return (
    <div className="kn-stack">
      <p className="kn-muted">{tt("capabilities.retrieval", { mode: retrieval })}</p>
      {!embeddings ? <Notice title={tt("capabilities.embeddingsOffTitle")}>{tt("capabilities.embeddingsOff")}</Notice> : null}
      {!pdfExtraction ? <Notice title={tt("capabilities.pdfOffTitle")}>{tt("capabilities.pdfOff")}</Notice> : null}
      {!canWrite ? <Notice tone="warning" title={tt("capabilities.readOnlyTitle")}>{tt("capabilities.readOnly")}</Notice> : null}
    </div>
  );
}

export function OverviewTab({ projectId }: { projectId: string | undefined }) {
  const { tt, formatTime } = useT();
  const query = useOverview(projectId);
  if (query.error && !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <Skeleton label={tt("overview.loading")} />;
  const data = query.data;
  return (
    <div className="kn-stack">
      <section className="kn-panel" aria-labelledby="kn-health-heading">
        <h2 id="kn-health-heading" className="kn-panel__title">{tt("overview.healthTitle")}</h2>
        <HealthCards health={data.health} />
        <p className="kn-muted">{tt("overview.generated", { when: formatTime(data.generatedAt) })}</p>
      </section>
      <section className="kn-panel" aria-labelledby="kn-findings-heading">
        <h2 id="kn-findings-heading" className="kn-panel__title">{tt("overview.findingsTitle")}</h2>
        <FindingsList findings={data.findings} />
      </section>
      <section className="kn-panel" aria-labelledby="kn-capabilities-heading">
        <h2 id="kn-capabilities-heading" className="kn-panel__title">{tt("overview.capabilitiesTitle")}</h2>
        <CapabilityNotes {...data.capabilities} />
      </section>
    </div>
  );
}
