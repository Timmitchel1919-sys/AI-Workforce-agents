import { Fragment, useState, type FormEvent } from "react";
import { Button, Input, Select } from "../../../components/ui";
import { useLedger } from "../hooks/useTrust";
import { useT } from "../lib/useT";
import { ACTION_CLASSES, EMPTY_AUDIT_FILTERS, RISK_LEVELS, type AuditFilters, type AuditRow } from "../types";
import { Empty, ErrorPanel, Readable, RiskTag, Skeleton, TextList } from "./common";
import { LedgerIndicator } from "./OverviewTab";

function Row({ row }: { row: AuditRow }) {
  const { tt, formatTime } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr data-seq={row.seq}>
        <td>{formatTime(row.at)}</td>
        <td className="sc-cell-wrap">{row.who}</td>
        <td className="sc-cell-wrap">{row.what}<br /><span className="sc-muted">{row.operation}</span></td>
        <td>{row.risk ? <RiskTag value={row.risk} /> : <span className="sc-muted">{tt("common.none")}</span>}</td>
        <td className="sc-cell-wrap"><TextList items={row.policyIds} /></td>
        <td className="sc-cell-wrap">{row.result}</td>
        <td><button type="button" className="sc-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? tt("audit.hideDetail") : tt("audit.showDetail")}</button></td>
      </tr>
      {open ? (
        <tr data-detail-for={row.seq}>
          <td colSpan={7}>
            <Readable value={{
              ...(row.projectId ? { project: row.projectId } : {}), ...(row.agentId ? { agent: row.agentId } : {}),
              ...(row.taskId ? { task: row.taskId } : {}), ...(row.executionId ? { execution: row.executionId } : {}),
              ...(row.toolId ? { tool: row.toolId } : {}), ...(row.action ? { action: row.action } : {}),
              ...(row.resource ? { resource: row.resource } : {}), severity: row.severity, hash: row.hash, ...row.detail,
            }} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export function AuditTab({ projectId }: { projectId: string | undefined }) {
  const { tt, label } = useT();
  const [form, setForm] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const query = useLedger(projectId, applied);
  const text = (key: keyof AuditFilters, name: string) => (
    <Input label={name} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setApplied({ ...form });
  };
  return (
    <div className="sc-stack">
      <section className="sc-panel" aria-labelledby="sc-audit-title">
        <h2 id="sc-audit-title" className="sc-panel__title">{tt("audit.title")}</h2>
        <form className="sc-form" onSubmit={submit} aria-label={tt("audit.filters")}>
          <div className="sc-filters">
            {text("agentId", tt("audit.agent"))}
            {text("taskId", tt("audit.task"))}
            {text("toolId", tt("audit.tool"))}
            <Select label={tt("audit.action")} value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}>
              <option value="">{tt("common.any")}</option>
              {ACTION_CLASSES.map((a) => <option key={a} value={a}>{label("action", a)}</option>)}
            </Select>
            <Select label={tt("audit.risk")} value={form.risk} onChange={(e) => setForm((f) => ({ ...f, risk: e.target.value }))}>
              <option value="">{tt("common.any")}</option>
              {RISK_LEVELS.map((r) => <option key={r} value={r}>{label("risk", r)}</option>)}
            </Select>
            {text("policyId", tt("audit.policy"))}
            {text("result", tt("audit.result"))}
            {text("operation", tt("audit.operation"))}
            <Input label={tt("audit.since")} type="date" value={form.since} onChange={(e) => setForm((f) => ({ ...f, since: e.target.value }))} />
            <Input label={tt("audit.until")} type="date" value={form.until} onChange={(e) => setForm((f) => ({ ...f, until: e.target.value }))} />
          </div>
          <div className="sc-actions">
            <Button type="submit" variant="primary">{tt("common.apply")}</Button>
            <Button type="button" variant="secondary" onClick={() => { setForm(EMPTY_AUDIT_FILTERS); setApplied(EMPTY_AUDIT_FILTERS); }}>{tt("common.reset")}</Button>
          </div>
        </form>
      </section>
      {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        <section className="sc-panel" aria-labelledby="sc-ledger-res">
          <h2 id="sc-ledger-res" className="sc-panel__title">{tt("audit.entries", { count: query.data.entries.length })}</h2>
          <LedgerIndicator ledger={query.data.verification} />
          {query.data.entries.length === 0 ? <Empty title={tt("audit.empty")} /> : (
            <div className="sc-table-wrap">
              <table className="sc-table">
                <caption className="sc-visually-hidden">{tt("audit.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{tt("audit.when")}</th>
                    <th scope="col">{tt("audit.who")}</th>
                    <th scope="col">{tt("audit.what")}</th>
                    <th scope="col">{tt("audit.risk")}</th>
                    <th scope="col">{tt("audit.policy")}</th>
                    <th scope="col">{tt("audit.result")}</th>
                    <th scope="col">{tt("audit.detail")}</th>
                  </tr>
                </thead>
                <tbody>{query.data.entries.map((row) => <Row key={row.seq} row={row} />)}</tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
