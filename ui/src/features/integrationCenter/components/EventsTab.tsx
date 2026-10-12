import { useId, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button, Input, Select, Textarea } from "../../../components/ui";
import type { ProjectOption } from "../../projectScope/projectScope";
import { useCanManage, useEvents, useIntegrationCommand, useOverview } from "../hooks/useIntegrations";
import { parseConditions, summaryValue } from "../lib/logic";
import { useT } from "../lib/useT";
import { EVENT_STATUSES, type EventFilters, type HubEvent, type Subscription } from "../types";
import { DefList, Empty, ErrorPanel, EventStatusTag, Notice, Skeleton, Tag } from "./common";
import { useReport } from "./report";

const NO_FILTERS: EventFilters = { provider: "", type: "", status: "", since: "" };

function EventRow({ event, projects }: { event: HubEvent; projects: readonly ProjectOption[] }) {
  const { tt, formatTime } = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const entries = Object.entries(event.summary ?? {});
  const project = event.projectId ? (projects.find((p) => p.projectId === event.projectId)?.displayName || event.projectId) : tt("common.none");
  return (
    <>
      <tr data-event-id={event.eventId}>
        <td>{formatTime(event.receivedAt)}</td>
        <td className="ic-cell-wrap">{event.provider}</td>
        <td className="ic-cell-wrap"><span className="ic-inline-code">{event.type}</span></td>
        <td><EventStatusTag value={event.status} /></td>
        <td className="ic-cell-wrap">{project}</td>
        <td className="ic-cell-wrap">
          <button
            type="button"
            className="ic-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={tt(open ? "events.hidePayload" : "events.showPayload", { id: event.eventId })}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />} {tt("events.payload")}
          </button>
        </td>
      </tr>
      {open ? (
        <tr id={panelId} className="ic-expand" data-testid={`payload-${event.eventId}`}>
          <td colSpan={6}>
            <DefList
              items={[
                { label: tt("events.delivery"), value: <span className="ic-inline-code">{event.deliveryId}</span> },
                { label: tt("events.resource"), value: event.resource ?? tt("common.none") },
                { label: tt("events.reason"), value: event.reason ?? tt("common.none") },
                { label: tt("events.triggered"), value: event.triggered.length === 0 ? tt("common.none") : event.triggered.join(", ") },
              ]}
            />
            <h4 className="ic-sub__title">{tt("events.payload")}</h4>
            {entries.length === 0 ? <p className="ic-muted">{tt("events.noPayload")}</p> : (
              <DefList items={entries.map(([k, v]) => ({ label: k, value: <span className="ic-text">{summaryValue(v)}</span> }))} />
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SubscriptionRow({ sub, projects }: { sub: Subscription; projects: readonly ProjectOption[] }) {
  const { tt, formatTime } = useT();
  const manage = useCanManage();
  const { report } = useReport();
  const toggle = useIntegrationCommand();
  const project = projects.find((p) => p.projectId === sub.projectId)?.displayName || sub.projectId;
  return (
    <li className="ic-row" data-subscription-id={sub.subscriptionId}>
      <div className="ic-row__head">
        <span className="ic-row__title">{sub.name}</span>
        <Tag tone={sub.enabled ? "success" : "neutral"}>{sub.enabled ? tt("events.enabled") : tt("events.disabledState")}</Tag>
      </div>
      <DefList
        items={[
          { label: tt("events.provider"), value: sub.provider },
          { label: tt("events.eventType"), value: <span className="ic-inline-code">{sub.eventType}</span> },
          { label: tt("events.project"), value: project },
          ...(sub.resourcePattern ? [{ label: tt("events.resourcePattern"), value: sub.resourcePattern }] : []),
          { label: tt("events.conditions"), value: sub.conditions.length === 0 ? tt("common.none") : sub.conditions.map((c) => `${c.field}=${String(c.equals)}`).join(", ") },
          { label: tt("events.request"), value: <span className="ic-text">{sub.action.request}</span> },
        ]}
      />
      <p className="ic-muted">
        {tt("events.fires", { count: sub.fires })} · {sub.lastFiredAt ? tt("events.lastFired", { at: formatTime(sub.lastFiredAt) }) : tt("events.neverFired")}
      </p>
      {manage ? (
        <div className="ic-actions">
          <Button
            type="button" size="small" loading={toggle.isPending}
            aria-label={tt(sub.enabled ? "events.disableFor" : "events.enableFor", { name: sub.name })}
            onClick={() => toggle.mutate(
              { command: "integration_set_subscription", body: { subscriptionId: sub.subscriptionId, enabled: !sub.enabled } },
              { onSuccess: () => report({ tone: "success", message: tt("events.updated") }) },
            )}
          >
            {sub.enabled ? tt("events.disable") : tt("events.enable")}
          </Button>
        </div>
      ) : null}
      {toggle.isError ? <ErrorPanel error={toggle.error} /> : null}
    </li>
  );
}

function CreateSubscription({ projectId, projects, providers }: { projectId: string | undefined; projects: readonly ProjectOption[]; providers: readonly string[] }) {
  const { tt } = useT();
  const { report } = useReport();
  const create = useIntegrationCommand();
  const [form, setForm] = useState({ name: "", provider: "", eventType: "", projectId: projectId ?? "", request: "", pattern: "", conditions: "" });
  const [badConditions, setBadConditions] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const ready = form.name.trim() !== "" && form.provider !== "" && form.eventType.trim() !== "" && form.projectId !== "" && form.request.trim() !== "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const conditions = parseConditions(form.conditions);
    if (conditions === null) {
      setBadConditions(true);
      return;
    }
    setBadConditions(false);
    create.mutate(
      {
        command: "integration_create_subscription",
        body: {
          name: form.name.trim(), provider: form.provider, eventType: form.eventType.trim(), projectId: form.projectId,
          request: form.request.trim(), conditions, ...(form.pattern.trim() ? { resourcePattern: form.pattern.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          setForm((f) => ({ ...f, name: "", eventType: "", request: "", pattern: "", conditions: "" }));
          report({ tone: "success", message: tt("events.created") });
        },
      },
    );
  };
  return (
    <form className="ic-form" onSubmit={submit} aria-labelledby="ic-create-sub">
      <h3 id="ic-create-sub" className="ic-sub__title">{tt("events.createTitle")}</h3>
      <div className="ic-filters">
        <Input label={tt("events.name")} value={form.name} onChange={(e) => set("name")(e.target.value)} required />
        <Select label={tt("events.provider")} value={form.provider} onChange={(e) => set("provider")(e.target.value)} required>
          <option value="">{tt("events.selectProvider")}</option>
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Input label={tt("events.eventType")} value={form.eventType} onChange={(e) => set("eventType")(e.target.value)} required />
        <Select label={tt("events.project")} value={form.projectId} onChange={(e) => set("projectId")(e.target.value)} required>
          <option value="">{tt("events.selectProject")}</option>
          {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
        </Select>
        <Input label={tt("events.patternOptional")} value={form.pattern} onChange={(e) => set("pattern")(e.target.value)} />
      </div>
      <Textarea label={tt("events.requestText")} description={tt("events.requestHint")} rows={3} value={form.request} onChange={(e) => set("request")(e.target.value)} required />
      <Textarea label={tt("events.conditionsLabel")} rows={3} spellCheck={false} value={form.conditions} onChange={(e) => { set("conditions")(e.target.value); setBadConditions(false); }} />
      {badConditions ? <p role="alert" className="ic-field-error" data-testid="conditions-invalid">{tt("events.conditionsInvalid")}</p> : null}
      <p className="ic-muted">{tt("events.proposeOnly")}</p>
      {create.isError ? <ErrorPanel error={create.error} /> : null}
      <div className="ic-actions"><Button type="submit" variant="primary" loading={create.isPending} disabled={!ready}>{tt("events.create")}</Button></div>
    </form>
  );
}

export function EventsTab({ projectId, projects }: { projectId: string | undefined; projects: readonly ProjectOption[] }) {
  const { tt } = useT();
  const manage = useCanManage();
  const [draft, setDraft] = useState<EventFilters>(NO_FILTERS);
  const [applied, setApplied] = useState<EventFilters>(NO_FILTERS);
  const query = useEvents(applied, projectId);
  const overview = useOverview(projectId);
  const providers = [...new Set((overview.data?.connectors ?? []).map((c) => c.provider))].sort();
  const set = (key: keyof EventFilters) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setApplied(draft);
  };
  return (
    <div className="ic-stack">
      <section className="ic-panel" aria-labelledby="ic-events-title">
        <h2 id="ic-events-title" className="ic-panel__title">{tt("events.title")}</h2>
        <Notice tone="warning"><span data-testid="propose-note">{tt("events.explained")}</span></Notice>
        <form className="ic-form" onSubmit={apply} aria-label={tt("events.title")}>
          <div className="ic-filters">
            <Select label={tt("events.provider")} value={draft.provider} onChange={(e) => set("provider")(e.target.value)}>
              <option value="">{tt("common.any")}</option>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Input label={tt("events.type")} value={draft.type} onChange={(e) => set("type")(e.target.value)} />
            <Select label={tt("events.status")} value={draft.status} onChange={(e) => set("status")(e.target.value)}>
              <option value="">{tt("common.any")}</option>
              {EVENT_STATUSES.map((s) => <option key={s} value={s}>{tt(`eventStatus.${s}`)}</option>)}
            </Select>
            <Input label={tt("events.since")} type="date" value={draft.since} onChange={(e) => set("since")(e.target.value)} />
          </div>
          <div className="ic-actions">
            <Button type="submit" variant="primary">{tt("common.apply")}</Button>
            <Button type="button" onClick={() => { setDraft(NO_FILTERS); setApplied(NO_FILTERS); }}>{tt("common.reset")}</Button>
          </div>
        </form>
        {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
        {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data ? (
          query.data.events.length === 0 ? <Empty title={tt("events.noEvents")} body={tt("events.noEventsBody")} /> : (
            <div className="ic-table-wrap">
              <table className="ic-table" data-testid="event-table">
                <caption className="ic-visually-hidden">{tt("events.tableTitle")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{tt("events.time")}</th>
                    <th scope="col">{tt("events.provider")}</th>
                    <th scope="col">{tt("events.type")}</th>
                    <th scope="col">{tt("events.status")}</th>
                    <th scope="col">{tt("events.project")}</th>
                    <th scope="col">{tt("events.summary")}</th>
                  </tr>
                </thead>
                <tbody>{query.data.events.map((e) => <EventRow key={e.eventId} event={e} projects={projects} />)}</tbody>
              </table>
            </div>
          )
        ) : null}
      </section>

      <section className="ic-panel" aria-labelledby="ic-subs-title">
        <h2 id="ic-subs-title" className="ic-panel__title">{tt("events.subsTitle")}</h2>
        <p className="ic-muted">{tt("events.subsExplained")}</p>
        {query.data ? (
          query.data.subscriptions.length === 0 ? <Empty title={tt("events.noSubs")} body={tt("events.noSubsBody")} /> : (
            <ul className="ic-rows" data-testid="subscription-list">
              {query.data.subscriptions.map((s) => <SubscriptionRow key={s.subscriptionId} sub={s} projects={projects} />)}
            </ul>
          )
        ) : null}
        {manage ? <CreateSubscription projectId={projectId} projects={projects} providers={providers} /> : <Notice>{tt("common.readOnly")}</Notice>}
      </section>
    </div>
  );
}
