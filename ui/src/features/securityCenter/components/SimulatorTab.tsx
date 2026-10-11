import { useState, type FormEvent } from "react";
import { Button, Input, Select } from "../../../components/ui";
import type { ProjectOption } from "../../projectScope/projectScope";
import { useSimulation, useTrustData } from "../hooks/useTrust";
import { useT } from "../lib/useT";
import { ACTION_CLASSES, ENVIRONMENTS, type SimPolicy, type SimulationDecision, type SimulationRequest } from "../types";
import { DefList, ErrorPanel, Notice, Readable, RiskTag, Skeleton, Tag } from "./common";

function PolicyList({ title, policies }: { title: string; policies: readonly SimPolicy[] }) {
  const { tt, label } = useT();
  return (
    <div className="sc-sub">
      <h3 className="sc-sub__title">{title}</h3>
      {policies.length === 0 ? <p className="sc-muted">{tt("common.none")}</p> : (
        <ul className="sc-list">
          {policies.map((p) => (
            <li key={p.policyId}>
              <strong>{p.name}</strong> <span className="sc-muted">{label("layer", p.layer)} · {label("effect", p.effect)}{p.builtin ? ` · ${tt("policies.builtin")}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Result({ decision, executed }: { decision: SimulationDecision; executed: boolean }) {
  const { tt, label } = useT();
  const o = decision.obligations;
  const yesNo = (v: unknown) => (typeof v === "boolean" ? (v ? tt("common.yes") : tt("common.no")) : <Readable value={v} />);
  return (
    <section className="sc-panel" aria-labelledby="sc-sim-result" data-testid="sim-result">
      <h2 id="sc-sim-result" className="sc-panel__title">{tt("simulator.resultTitle")}</h2>
      {executed ? <Notice tone="warning">{tt("simulator.unexpectedExecuted")}</Notice> : <Notice tone="success"><span data-testid="sim-note">{tt("simulator.notExecuted")}</span></Notice>}
      <p className="sc-inline">
        <Tag tone={decision.effect === "DENY" ? "danger" : decision.effect === "ALLOW" ? "success" : "warning"}>{tt("simulator.decision")}: {label("effect", decision.effect)}</Tag>
        <RiskTag value={decision.risk.level} />
      </p>
      <div className="sc-sub">
        <h3 className="sc-sub__title">{tt("simulator.explanation")}</h3>
        <p className="sc-text" data-testid="sim-explanation">{decision.explanation}</p>
      </div>
      <div className="sc-sub">
        <h3 className="sc-sub__title">{tt("simulator.reasons")}</h3>
        {decision.reasons.length === 0 ? <p className="sc-muted">{tt("common.none")}</p> : <ul className="sc-list">{decision.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      </div>
      <div className="sc-sub">
        <h3 className="sc-sub__title">{tt("simulator.riskTitle")}</h3>
        <DefList
          items={[
            { label: tt("simulator.riskScore"), value: `${label("risk", decision.risk.level)} (${decision.risk.score})` },
            { label: tt("simulator.blastRadius"), value: <span className="sc-text">{decision.risk.blastRadius}</span> },
            { label: tt("simulator.reversible"), value: decision.risk.reversible ? tt("common.yes") : tt("common.no") },
          ]}
        />
        <ul className="sc-list" aria-label={tt("simulator.factors")}>
          {decision.risk.factors.map((f, i) => <li key={i}><strong>{f.factor}</strong> (+{f.points}) <span className="sc-muted">{f.detail}</span></li>)}
        </ul>
      </div>
      <DefList
        items={[
          { label: tt("simulator.action"), value: label("action", decision.action) },
          { label: tt("simulator.environment"), value: label("environment", decision.environment) },
          { label: tt("simulator.resource"), value: `${decision.resource.label} (${decision.resource.kind}, ${decision.resource.ref})` },
          { label: tt("simulator.dataClass"), value: label("dataClass", decision.resource.dataClass) },
          { label: tt("simulator.production"), value: decision.resource.production ? tt("common.yes") : tt("common.no") },
          ...(decision.agentTrust ? [{ label: tt("simulator.agentTrust"), value: label("trustState", decision.agentTrust) }] : []),
        ]}
      />
      <PolicyList title={tt("simulator.matched")} policies={decision.policies} />
      <PolicyList title={tt("simulator.overruled")} policies={decision.overruled} />
      <div className="sc-sub">
        <h3 className="sc-sub__title">{tt("simulator.obligations")}</h3>
        <DefList
          items={[
            { label: tt("simulator.approvalRequired"), value: yesNo(o.approval) },
            { label: tt("simulator.reviewRequired"), value: yesNo(o.review) },
            { label: tt("simulator.securityReviewRequired"), value: yesNo(o.securityReview) },
          ]}
        />
        {decision.approval ? <Readable value={decision.approval} /> : null}
      </div>
    </section>
  );
}

export function SimulatorTab({ projectId, projects }: { projectId: string | undefined; projects: readonly ProjectOption[] }) {
  const { tt, label } = useT();
  const trust = useTrustData();
  const [form, setForm] = useState<SimulationRequest>({
    projectId: projectId ?? projects[0]?.projectId ?? "", action: "READ", resource: "", agentId: "", taskType: "", environment: "", count: "", toolId: "",
  });
  const [submitted, setSubmitted] = useState<SimulationRequest | null>(null);
  const sim = useSimulation(submitted);
  const set = (key: keyof SimulationRequest) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted({ ...form });
  };
  const ready = form.projectId !== "" && form.resource.trim() !== "";
  return (
    <div className="sc-stack">
      <section className="sc-panel" aria-labelledby="sc-sim-title">
        <h2 id="sc-sim-title" className="sc-panel__title">{tt("simulator.title")}</h2>
        <p className="sc-muted">{tt("simulator.explained")}</p>
        <form className="sc-form" onSubmit={submit}>
          <div className="sc-filters">
            <Select label={tt("simulator.project")} value={form.projectId} onChange={(e) => set("projectId")(e.target.value)}>
              <option value="">{tt("simulator.selectProject")}</option>
              {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
            </Select>
            <Select label={tt("simulator.action")} value={form.action} onChange={(e) => set("action")(e.target.value)}>
              {ACTION_CLASSES.map((a) => <option key={a} value={a}>{label("action", a)}</option>)}
            </Select>
            <Input label={tt("simulator.resource")} value={form.resource} onChange={(e) => set("resource")(e.target.value)} />
            <Select label={tt("simulator.agent")} value={form.agentId} onChange={(e) => set("agentId")(e.target.value)}>
              <option value="">{tt("common.none")}</option>
              {(trust.data?.agents ?? []).map((a) => <option key={a.id} value={a.agentId}>{a.agentId}</option>)}
            </Select>
            <Input label={tt("simulator.taskType")} value={form.taskType} onChange={(e) => set("taskType")(e.target.value)} />
            <Select label={tt("simulator.environment")} value={form.environment} onChange={(e) => set("environment")(e.target.value)}>
              <option value="">{tt("common.any")}</option>
              {ENVIRONMENTS.map((e) => <option key={e} value={e}>{label("environment", e)}</option>)}
            </Select>
            <Input label={tt("simulator.count")} type="number" min={0} value={form.count} onChange={(e) => set("count")(e.target.value)} />
            <Select label={tt("simulator.tool")} value={form.toolId} onChange={(e) => set("toolId")(e.target.value)}>
              <option value="">{tt("common.none")}</option>
              {(trust.data?.tools ?? []).map((t) => <option key={t.id} value={t.toolId}>{t.name}</option>)}
            </Select>
          </div>
          <div className="sc-actions"><Button type="submit" variant="primary" disabled={!ready} loading={sim.isFetching}>{tt("simulator.run")}</Button></div>
        </form>
      </section>
      {sim.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
      {sim.isError ? <ErrorPanel error={sim.error} /> : null}
      {sim.data ? <Result decision={sim.data.decision} executed={(sim.data.executed as boolean) !== false} /> : null}
    </div>
  );
}
