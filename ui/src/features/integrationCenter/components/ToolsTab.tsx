import { useMemo, useState, type FormEvent } from "react";
import { Button, Input, Select, Textarea } from "../../../components/ui";
import type { ProjectOption } from "../../projectScope/projectScope";
import { useCanManage, useCapabilities, useIntegrationCommand } from "../hooks/useIntegrations";
import { groupCapabilities, parseParams, sandboxKey, sandboxSubstitute, type ExplorerEntry } from "../lib/logic";
import { useDebounced } from "../lib/useDebounced";
import { useT } from "../lib/useT";
import { OPERATION_CLASSES, type SimulationDetails } from "../types";
import { DefList, Empty, ErrorPanel, Notice, RiskTag, Skeleton, StatusTag, Tag } from "./common";

function SandboxLabel({ raw }: { raw: unknown }) {
  const { tt } = useT();
  const key = sandboxKey(raw);
  if (key) return <>{tt(`sandbox.${key}`)}</>;
  const sub = sandboxSubstitute(raw);
  return <>{sub ? tt("sandbox.substitute", { capability: sub }) : tt("common.unavailable")}</>;
}

function EntryRow({ entry }: { entry: ExplorerEntry }) {
  const { tt, label } = useT();
  return (
    <li className="ic-row" data-capability={entry.capability}>
      <div className="ic-row__head">
        <span className="ic-row__title ic-inline-code">{entry.capability}</span>
        <span className="ic-inline">
          {entry.mcp ? <Tag tone="info">{tt("tools.mcpTag")}</Tag> : null}
          {entry.available ? null : <Tag tone="warning">{tt("tools.unavailable")}</Tag>}
        </span>
      </div>
      <p className="ic-muted">{entry.description}</p>
      <div className="ic-row__meta">
        <Tag>{label("operation", entry.operation)}</Tag>
        <RiskTag value={entry.risk} />
        <Tag tone={entry.approval === "none" ? "success" : "warning"}>{tt("tools.approvalLabel")}: {label("approval", entry.approval)}</Tag>
        {entry.mapped === null ? <span className="ic-muted">{tt("tools.mappedUnknown")}</span> : (
          <Tag tone={entry.mapped ? "success" : "neutral"} title={entry.mapped ? undefined : tt("tools.notMapped")}>{entry.mapped ? tt("tools.mapped") : tt("tools.notMapped")}</Tag>
        )}
      </div>
      <DefList
        items={[
          {
            label: tt("tools.providedBy"),
            value: (
              <ul className="ic-list" data-testid={`providers-${entry.capability}`}>
                {entry.providers.map((p) => (
                  <li key={p.connectorId}>
                    <strong>{p.provider}</strong> <StatusTag status={p.status} />{" "}
                    <span className="ic-muted">{label("mode", p.mode)}</span>
                    {p.status === "HEALTHY" ? null : <span className="ic-muted"> ({tt("tools.notWorking")})</span>}
                    {p.unavailable ? <span className="ic-muted"> {tt("tools.unavailableReason", { provider: p.provider, reason: p.unavailable })}</span> : null}
                  </li>
                ))}
              </ul>
            ),
          },
          ...(entry.providers[0]?.sandbox ? [{ label: tt("tools.sandboxLabel"), value: <SandboxLabel raw={entry.providers[0].sandbox} /> }] : []),
        ]}
      />
    </li>
  );
}

function SimResult({ details }: { details: SimulationDetails }) {
  const { tt, label } = useT();
  return (
    <section className="ic-panel" aria-labelledby="ic-sim-result" data-testid="sim-result">
      <h3 id="ic-sim-result" className="ic-panel__title">{tt("simulator.resultTitle")}</h3>
      {details.executed ? <Notice tone="warning">{tt("simulator.unexpectedExecuted")}</Notice> : <Notice tone="success"><span data-testid="sim-note">{tt("simulator.notExecuted")}</span></Notice>}
      <p className="ic-inline">
        <Tag tone={details.success ? "success" : "warning"}>{details.success ? tt("simulator.wouldProceed") : tt("simulator.wouldNotProceed")}</Tag>
      </p>
      <DefList
        items={[
          { label: tt("simulator.connector"), value: details.connectorId ?? tt("simulator.noConnector") },
          ...(details.decision ? [
            { label: tt("simulator.effect"), value: <span data-testid="sim-effect">{details.decision.effect}</span> },
            { label: tt("simulator.risk"), value: <RiskTag value={details.decision.risk} /> },
            { label: tt("simulator.explanation"), value: <span className="ic-text" data-testid="sim-explanation">{details.decision.explanation}</span> },
          ] : []),
        ]}
      />
      <div className="ic-sub">
        <h4 className="ic-sub__title">{tt("simulator.selection")}</h4>
        {details.selection.length === 0 ? <p className="ic-muted">{tt("simulator.noSelection")}</p> : (
          <ul className="ic-list" data-testid="sim-selection">{details.selection.map((r, i) => <li key={i}>{r}</li>)}</ul>
        )}
      </div>
      {details.error ? (
        <div className="ic-sub" data-testid="sim-error">
          <h4 className="ic-sub__title">{tt("simulator.error")}</h4>
          <DefList
            items={[
              { label: tt("simulator.errorKind"), value: details.error.kind },
              { label: tt("simulator.explanation"), value: <span className="ic-text">{details.error.message}</span> },
              { label: tt("simulator.retryable"), value: details.error.retryable ? tt("common.yes") : tt("common.no") },
            ]}
          />
        </div>
      ) : null}
      <p className="ic-muted">{label("outcome", "SIMULATED")}</p>
    </section>
  );
}

export function Simulator({ projectId, projects, entries }: { projectId: string | undefined; projects: readonly ProjectOption[]; entries: readonly ExplorerEntry[] }) {
  const { tt } = useT();
  const manage = useCanManage();
  const run = useIntegrationCommand();
  const [form, setForm] = useState({ projectId: projectId ?? projects[0]?.projectId ?? "", capability: "", resource: "", params: "" });
  const [paramsInvalid, setParamsInvalid] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseParams(form.params);
    if (!parsed.ok) {
      setParamsInvalid(true);
      return;
    }
    setParamsInvalid(false);
    run.mutate({
      command: "integration_simulate",
      body: {
        projectId: form.projectId, capability: form.capability, parameters: parsed.value,
        ...(form.resource.trim() ? { resource: form.resource.trim() } : {}),
      },
    });
  };
  const ready = manage && form.projectId !== "" && form.capability !== "";
  const details = run.data?.details as unknown as SimulationDetails | undefined;
  return (
    <section className="ic-panel" aria-labelledby="ic-sim-title">
      <h2 id="ic-sim-title" className="ic-panel__title">{tt("simulator.title")}</h2>
      <Notice>{tt("simulator.explained")}</Notice>
      {manage ? null : <Notice>{tt("simulator.needsManage")}</Notice>}
      <form className="ic-form" onSubmit={submit}>
        <div className="ic-filters">
          <Select label={tt("simulator.project")} value={form.projectId} onChange={(e) => set("projectId")(e.target.value)} disabled={!manage}>
            <option value="">{tt("simulator.selectProject")}</option>
            {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
          </Select>
          <Select label={tt("simulator.capability")} value={form.capability} onChange={(e) => set("capability")(e.target.value)} disabled={!manage}>
            <option value="">{tt("simulator.selectCapability")}</option>
            {entries.map((e) => <option key={e.capability} value={e.capability}>{e.capability}</option>)}
          </Select>
          <Input label={tt("simulator.resource")} value={form.resource} onChange={(e) => set("resource")(e.target.value)} disabled={!manage} />
        </div>
        <Textarea
          label={tt("simulator.params")}
          value={form.params}
          rows={4}
          spellCheck={false}
          autoComplete="off"
          disabled={!manage}
          onChange={(e) => { set("params")(e.target.value); setParamsInvalid(false); }}
        />
        <p className="ic-muted">{tt("simulator.paramsHint")}</p>
        {paramsInvalid ? <p role="alert" className="ic-field-error" data-testid="params-invalid">{tt("simulator.paramsInvalid")}</p> : null}
        <div className="ic-actions"><Button type="submit" variant="primary" disabled={!ready} loading={run.isPending}>{tt("simulator.run")}</Button></div>
      </form>
      <div aria-live="polite">
        {run.isError ? <ErrorPanel error={run.error} /> : null}
        {details ? <SimResult details={details} /> : null}
      </div>
    </section>
  );
}

export function ToolsTab({ projectId, projects }: { projectId: string | undefined; projects: readonly ProjectOption[] }) {
  const { tt } = useT();
  const [q, setQ] = useState("");
  const [operation, setOperation] = useState("");
  const [mappedOnly, setMappedOnly] = useState(false);
  const debounced = useDebounced(q.trim());
  const query = useCapabilities(debounced, projectId);
  const entries = useMemo(
    () => (query.data ? groupCapabilities(query.data.capabilities ?? [], query.data.mcp ?? [], projectId !== undefined) : []),
    [query.data, projectId],
  );
  const shown = entries.filter((e) => (operation === "" || e.operation === operation) && (!mappedOnly || projectId === undefined || e.mapped === true));
  return (
    <div className="ic-stack">
      <section className="ic-panel" aria-labelledby="ic-tools-title">
        <h2 id="ic-tools-title" className="ic-panel__title">{tt("tools.title")}</h2>
        <p className="ic-muted">{tt("tools.explained")}</p>
        <div className="ic-filters">
          <Input label={tt("tools.search")} description={tt("tools.searchHint")} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select label={tt("tools.operation")} value={operation} onChange={(e) => setOperation(e.target.value)}>
            <option value="">{tt("common.any")}</option>
            {OPERATION_CLASSES.map((o) => <option key={o} value={o}>{tt(`operation.${o}`)}</option>)}
          </Select>
          <label className="ic-check">
            <input type="checkbox" checked={mappedOnly} disabled={projectId === undefined} onChange={(e) => setMappedOnly(e.target.checked)} />
            {tt("tools.mappedOnly")}
          </label>
        </div>
        {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
        {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data ? (
          shown.length === 0 ? <Empty title={tt("tools.noResults")} body={tt("tools.noResultsBody")} /> : (
            <>
              <p className="ic-muted" role="status" data-testid="tool-count">{tt("tools.count", { count: shown.length })}</p>
              <ul className="ic-rows" data-testid="tool-list">{shown.map((e) => <EntryRow key={e.capability} entry={e} />)}</ul>
            </>
          )
        ) : null}
      </section>
      <Simulator projectId={projectId} projects={projects} entries={entries} />
    </div>
  );
}
