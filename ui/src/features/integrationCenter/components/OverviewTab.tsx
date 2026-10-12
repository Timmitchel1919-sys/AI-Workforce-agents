import { Link } from "react-router-dom";
import { useCanManage, useIsAdmin, useOverview } from "../hooks/useIntegrations";
import { connectionNote, isWorking } from "../lib/logic";
import { useT } from "../lib/useT";
import type { Connector, Overview } from "../types";
import { ConnectorActions } from "./ConnectorActions";
import { DefList, Empty, ErrorPanel, ModeTag, Notice, OutcomeTag, Skeleton, StatusTag, Tag } from "./common";

export function ConnectorCard({ connector, canStoreCredentials, search }: { connector: Connector; canStoreCredentials: boolean; search: string }) {
  const { tt, label, formatTime } = useT();
  const h = connector.health;
  const note = connectionNote(connector);
  const working = isWorking(connector.status);
  const noteTone = connector.status === "HEALTHY" ? "success" : connector.status === "DEGRADED" ? "warning" : "info";
  const caps = connector.capabilities;
  const last = connector.lastActivity;
  return (
    <li className="ic-connector" data-connector-id={connector.connectorId} data-status={connector.status}>
      <div className="ic-row__head">
        <h3 className="ic-connector__name">{connector.name}</h3>
        <StatusTag status={connector.status} />
      </div>
      <p className="ic-muted">{connector.description}</p>
      <div className="ic-row__meta">
        <ModeTag mode={connector.mode} />
        <Tag tone={connector.trust === "TRUSTED" ? "success" : connector.trust === "LIMITED" ? "info" : "warning"}>{tt("card.trust")}: {label("trust", connector.trust)}</Tag>
        <Tag tone={connector.enabled ? "success" : "neutral"}>{tt("card.enabled")}: {connector.enabled ? tt("common.yes") : tt("common.no")}</Tag>
      </div>
      <Notice tone={working || connector.status === "CONNECTED" ? noteTone : "info"}>
        <span data-testid={`note-${connector.connectorId}`}>{tt(`card.note.${note}`)}</span>
      </Notice>
      <DefList
        items={[
          { label: tt("card.provider"), value: connector.provider },
          { label: tt("card.authentication"), value: (
            <span>
              {label("authMethod", connector.auth.method)}{" "}
              {connector.auth.method === "none" ? null : (
                <Tag tone={connector.auth.credentialConfigured ? "success" : "warning"}>{connector.auth.credentialConfigured ? tt("card.credentialStored") : tt("card.credentialMissing")}</Tag>
              )}
            </span>
          ) },
          { label: tt("card.capabilities"), value: tt("card.capabilityCounts", { available: caps.available, total: caps.total, reads: caps.reads, sideEffects: caps.sideEffects }) },
          { label: tt("card.lastActivity"), value: last ? (
            <span>{tt("card.activityLine", { capability: last.capability, outcome: label("outcome", last.outcome), at: formatTime(last.at) })}</span>
          ) : <span className="ic-muted">{tt("card.noActivity")}</span> },
          { label: tt("card.health"), value: (
            <ul className="ic-list" data-testid={`health-${connector.connectorId}`}>
              <li>{h.latencyMs !== undefined ? tt("card.latency", { ms: h.latencyMs }) : tt("card.latencyUnknown")}</li>
              <li>{tt("card.errors", { errors: h.recentErrors, calls: h.recentCalls })}</li>
              <li>{h.lastError ? tt("card.lastError", { message: h.lastError.message }) : tt("card.noError")}</li>
              <li className="ic-muted">{h.checkedAt ? tt("card.checkedAt", { at: formatTime(h.checkedAt) }) : tt("card.neverChecked")}</li>
            </ul>
          ) },
        ]}
      />
      <div className="ic-actions">
        <Link className="ic-link" to={`/integration-center/overview/${encodeURIComponent(connector.connectorId)}${search}`} aria-label={tt("card.viewDetails", { name: connector.name })}>
          {tt("card.details")}
        </Link>
      </div>
      <ConnectorActions connector={connector} canStoreCredentials={canStoreCredentials} />
    </li>
  );
}

const SUMMARY: [keyof Overview["summary"], string][] = [
  ["connectors", "connectors"], ["healthy", "healthy"], ["degraded", "degraded"], ["error", "error"], ["disconnected", "disconnected"],
  ["disabled", "disabled"], ["waitingApproval", "waitingApproval"], ["blocked24h", "blocked"], ["queued", "queued"],
];

export function OverviewContent({ overview, search }: { overview: Overview; search: string }) {
  const { tt, label, formatTime } = useT();
  const manage = useCanManage();
  const admin = useIsAdmin();
  return (
    <div className="ic-stack">
      {manage ? (admin ? null : <Notice>{tt("common.needsAdmin")}</Notice>) : <Notice>{tt("common.readOnly")}</Notice>}
      <section className="ic-panel" aria-labelledby="ic-summary-title">
        <h2 id="ic-summary-title" className="ic-panel__title">{tt("overview.summaryTitle")}</h2>
        <ul className="ic-cards" aria-label={tt("overview.summaryTitle")}>
          {SUMMARY.map(([key, labelKey]) => (
            <li key={key} className="ic-card" data-card={key}>
              <span className="ic-card__label">{tt(`overview.${labelKey}`)}</span>
              <strong className="ic-card__value">{overview.summary[key]}</strong>
            </li>
          ))}
        </ul>
        <p className="ic-muted">{tt("overview.summaryNote")}</p>
        <p className="ic-muted">{tt("overview.generatedAt", { at: formatTime(overview.generatedAt) })}</p>
      </section>

      <section className="ic-panel" aria-labelledby="ic-vault-title">
        <h2 id="ic-vault-title" className="ic-panel__title">{tt("overview.vaultTitle")}</h2>
        <Notice tone={overview.vault.canStoreCredentials ? "info" : "warning"}><span data-testid="vault-note">{overview.vault.note}</span></Notice>
        <p className="ic-muted">{tt("overview.vaultCapabilities", { mcp: overview.capabilities.mcp, oauth: overview.capabilities.oauthProviders })}</p>
      </section>

      <section className="ic-panel" aria-labelledby="ic-grid-title">
        <h2 id="ic-grid-title" className="ic-panel__title">{tt("overview.gridTitle")}</h2>
        {overview.connectors.length === 0 ? <Empty title={tt("overview.noConnectors")} body={tt("overview.noConnectorsBody")} /> : (
          <ul className="ic-connectors" data-testid="connector-grid">
            {overview.connectors.map((c) => (
              <ConnectorCard key={c.connectorId} connector={c} canStoreCredentials={overview.vault.canStoreCredentials} search={search} />
            ))}
          </ul>
        )}
      </section>

      <section className="ic-panel" aria-labelledby="ic-recent-title">
        <h2 id="ic-recent-title" className="ic-panel__title">{tt("overview.activityTitle")}</h2>
        {overview.recentActivity.length === 0 ? <Empty title={tt("overview.noActivity")} /> : (
          <ul className="ic-rows">
            {overview.recentActivity.map((a) => (
              <li key={a.id} className="ic-row">
                <div className="ic-row__head">
                  <span className="ic-row__title">{a.capability}</span>
                  <span className="ic-muted">{formatTime(a.at)}</span>
                </div>
                <div className="ic-row__meta">
                  <OutcomeTag value={a.outcome} />
                  <span className="ic-muted">{a.provider ?? a.connectorId ?? ""}</span>
                  <span className="ic-muted">{a.projectId}</span>
                  {a.operation ? <span className="ic-muted">{label("operation", a.operation)}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function OverviewTab({ projectId, search }: { projectId: string | undefined; search: string }) {
  const { tt } = useT();
  const query = useOverview(projectId);
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  return <OverviewContent overview={query.data} search={search} />;
}
