import { useSecrets } from "../hooks/useTrust";
import { useT } from "../lib/useT";
import { Empty, ErrorPanel, Notice, Readable, Skeleton, Tag } from "./common";

/** Shows detections, protections and which credentials are configured (names and yes/no only; values are never sent or shown). */
export function SecretsTab() {
  const { tt, formatTime } = useT();
  const query = useSecrets();
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  const d = query.data;
  return (
    <div className="sc-stack">
      <section className="sc-panel" aria-labelledby="sc-secrets-title">
        <h2 id="sc-secrets-title" className="sc-panel__title">{tt("secrets.title")}</h2>
        <ul className="sc-cards">
          <li className="sc-card" data-card="detectionsThisProcess"><span className="sc-card__label">{tt("secrets.thisProcess")}</span><strong className="sc-card__value">{d.detectionsThisProcess}</strong></li>
          <li className="sc-card" data-card="detections7d"><span className="sc-card__label">{tt("secrets.days7")}</span><strong className="sc-card__value">{d.detections7d}</strong></li>
        </ul>
        <Notice>{d.note}</Notice>
      </section>
      <section className="sc-panel" aria-labelledby="sc-protections-title">
        <h2 id="sc-protections-title" className="sc-panel__title">{tt("secrets.protections")}</h2>
        {d.protections.length === 0 ? <Empty title={tt("common.none")} /> : <ul className="sc-list">{d.protections.map((p) => <li key={p}>{p}</li>)}</ul>}
      </section>
      <section className="sc-panel" aria-labelledby="sc-configured-title">
        <h2 id="sc-configured-title" className="sc-panel__title">{tt("secrets.configured")}</h2>
        <p className="sc-muted">{tt("secrets.neverShown")}</p>
        <ul className="sc-list" data-testid="configured-credentials">
          {d.configured.map((c) => (
            <li key={c.name}><span className="sc-inline-code">{c.name}</span> <Tag tone={c.configured ? "success" : "warning"}>{c.configured ? tt("secrets.configuredYes") : tt("secrets.configuredNo")}</Tag></li>
          ))}
        </ul>
      </section>
      <section className="sc-panel" aria-labelledby="sc-recent-title">
        <h2 id="sc-recent-title" className="sc-panel__title">{tt("secrets.recent")}</h2>
        {d.recent.length === 0 ? <Empty title={tt("secrets.noRecent")} /> : (
          <ul className="sc-rows">
            {d.recent.map((e) => (
              <li key={e.id} className="sc-row">
                <div className="sc-row__head"><span className="sc-row__title">{e.operation}</span><span className="sc-muted">{formatTime(e.at)}</span></div>
                <div className="sc-row__meta"><span className="sc-muted">{e.actor}</span><span className="sc-muted">{e.result}</span></div>
                <Readable value={e.detail} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
