import { useState } from "react";
import { Button } from "../../../components/ui";
import { useCanAdminister, useCanManage, useProjectSecurity, useTrustCommand } from "../hooks/useTrust";
import { riskTone } from "../lib/logic";
import { useT } from "../lib/useT";
import type { SecurityCommandName } from "../types";
import { CommandDialog } from "./CommandDialog";
import { DefList, Empty, ErrorPanel, NeedsProject, Notice, Skeleton, Tag } from "./common";

export function ProjectSecurityTab({ projectId }: { projectId: string | undefined }) {
  const { tt, label, formatTime } = useT();
  const query = useProjectSecurity(projectId);
  const canManage = useCanManage();
  const canAdminister = useCanAdminister();
  const mutation = useTrustCommand();
  const [accepting, setAccepting] = useState(false);
  if (!projectId) return <NeedsProject />;
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  const d = query.data;
  const run = (command: SecurityCommandName) => mutation.mutate({ command, body: { projectId } });
  const base = d.configBaseline;
  const scan = d.dependencyScan;
  return (
    <div className="sc-stack">
      <section className="sc-panel" aria-labelledby="sc-proj-title">
        <h2 id="sc-proj-title" className="sc-panel__title">{tt("project.title")}</h2>
        <ul className="sc-cards">
          <li className="sc-card" data-card="openAlerts"><span className="sc-card__label">{tt("dashboard.openAlerts")}</span><strong className="sc-card__value">{d.openAlerts}</strong></li>
          <li className="sc-card" data-card="drift7d"><span className="sc-card__label">{tt("project.drift7d")}</span><strong className="sc-card__value">{d.drift7d}</strong></li>
        </ul>
        {canManage ? (
          <div className="sc-actions">
            <Button type="button" variant="secondary" loading={mutation.isPending} onClick={() => run("security_scan_config")}>{tt("project.scanConfig")}</Button>
            {canAdminister ? <Button type="button" variant="secondary" onClick={() => setAccepting(true)}>{tt("project.acceptBaseline")}</Button> : null}
            <Button type="button" variant="secondary" loading={mutation.isPending} onClick={() => run("security_scan_dependencies")}>{tt("project.scanDeps")}</Button>
          </div>
        ) : <Notice>{tt("common.readOnly")}</Notice>}
        {mutation.isError ? <ErrorPanel error={mutation.error} /> : null}
        {mutation.isSuccess ? <Notice tone="success"><span data-testid="command-reason">{mutation.data.reason}</span></Notice> : null}
      </section>

      <section className="sc-panel" aria-labelledby="sc-baseline-title">
        <h2 id="sc-baseline-title" className="sc-panel__title">{tt("project.baseline")}</h2>
        {!base ? <Empty title={tt("project.noBaseline")} body={tt("project.noBaselineBody")} /> : (
          <>
            <DefList
              items={[
                { label: tt("project.established"), value: formatTime(base.establishedAt) },
                { label: tt("project.files"), value: base.files },
                { label: tt("project.accepted"), value: base.acceptedAt ? formatTime(base.acceptedAt) : tt("project.notAccepted") },
              ]}
            />
            <h3 className="sc-sub__title">{tt("project.pending")}</h3>
            {base.pending.length === 0 ? <p className="sc-muted">{tt("project.noPending")}</p> : (
              <ul className="sc-rows">
                {base.pending.map((p) => (
                  <li key={`${p.path}-${p.at}`} className="sc-row">
                    <div className="sc-row__head"><span className="sc-inline-code">{p.path}</span><Tag tone={riskTone(p.severity.toUpperCase())}>{label("risk", p.severity.toUpperCase())}</Tag></div>
                    <div className="sc-row__meta"><span>{label("change", p.change)}</span><span className="sc-muted">{formatTime(p.at)}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="sc-panel" aria-labelledby="sc-deps-title">
        <h2 id="sc-deps-title" className="sc-panel__title">{tt("project.dependencies")}</h2>
        {!scan ? <Empty title={tt("project.notScanned")} body={tt("project.notScannedBody")} /> : (
          <>
            <DefList
              items={[
                { label: tt("project.scannedAt"), value: formatTime(scan.scannedAt) },
                { label: tt("project.source"), value: scan.source },
                { label: tt("project.counts"), value: tt("project.countsValue", { critical: scan.counts.critical, high: scan.counts.high, moderate: scan.counts.moderate, low: scan.counts.low, info: scan.counts.info, total: scan.counts.total }) },
              ]}
            />
            <h3 className="sc-sub__title">{tt("project.topPackages")}</h3>
            {scan.top.length === 0 ? <p className="sc-muted">{tt("common.none")}</p> : (
              <ul className="sc-list">
                {scan.top.map((p) => <li key={p.name}><strong>{p.name}</strong> <Tag tone={riskTone(p.severity.toUpperCase())}>{p.severity}</Tag> <span className="sc-muted">{p.fixAvailable ? tt("project.fixYes") : tt("project.fixNo")}</span></li>)}
              </ul>
            )}
          </>
        )}
      </section>

      {accepting ? (
        <CommandDialog
          title={tt("project.acceptBaseline")}
          description={tt("project.acceptBody")}
          confirmLabel={tt("project.acceptBaseline")}
          command="security_accept_config"
          buildBody={() => ({ projectId })}
          danger
          onClose={() => setAccepting(false)}
        />
      ) : null}
    </div>
  );
}
