import { useState, type FormEvent } from "react";
import { Button, Input } from "../../../components/ui";
import type { ProjectOption } from "../../projectScope/projectScope";
import { useCanAdminister, useCanManage, useIntegrationCommand, useMcp } from "../hooks/useIntegrations";
import { splitList } from "../lib/logic";
import { useT } from "../lib/useT";
import type { McpServer } from "../types";
import { DefList, Empty, ErrorPanel, Notice, RiskTag, Skeleton, Tag, TextList } from "./common";
import { useReport } from "./report";

function ServerRow({ server, projects }: { server: McpServer; projects: readonly ProjectOption[] }) {
  const { tt, label, formatTime } = useT();
  const admin = useCanAdminister();
  const manage = useCanManage();
  const { report } = useReport();
  const status = useIntegrationCommand();
  const discover = useIntegrationCommand();
  const names = server.projects.map((id) => projects.find((p) => p.projectId === id)?.displayName || id);
  const need = admin ? undefined : tt("common.needsAdmin");
  const setStatus = (next: string) =>
    status.mutate(
      { command: "integration_set_mcp_status", body: { serverId: server.serverId, status: next } },
      { onSuccess: () => report({ tone: "success", message: tt("log.mcpStatusChanged") }) },
    );
  return (
    <li className="ic-row" data-server-id={server.serverId} data-status={server.status}>
      <div className="ic-row__head">
        <h3 className="ic-row__title">{server.name}</h3>
        <Tag tone={server.status === "ENABLED" ? "success" : server.status === "PENDING_REVIEW" ? "warning" : "neutral"}>{label("mcpStatus", server.status)}</Tag>
      </div>
      <DefList
        items={[
          { label: tt("log.mcpServer"), value: <span className="ic-inline-code">{server.serverId}</span> },
          { label: tt("card.provider"), value: `${server.provider} ${server.version}` },
          { label: tt("log.mcpTrust"), value: label("trust", server.trust) },
          { label: tt("log.risk"), value: <RiskTag value={server.risk} /> },
          { label: tt("log.mcpTransport"), value: `${server.config.transport}${server.config.url ? ` ${server.config.url}` : ""}` },
          { label: tt("log.mcpProjects"), value: names.length === 0 ? <span className="ic-muted">{tt("log.mcpNoProjects")}</span> : <TextList items={names} /> },
          {
            label: tt("log.mcpTools"),
            value: server.tools.length === 0 ? tt("common.none") : (
              <span>
                {tt("log.mcpToolCount", { count: server.tools.length })}: <span className="ic-text">{server.tools.map((t) => t.name).join(", ")}</span>
              </span>
            ),
          },
          {
            label: tt("log.mcpHealth"),
            value: (
              <span>
                {server.health.status}{server.health.checkedAt ? ` (${formatTime(server.health.checkedAt)})` : ""}
                {server.health.error ? <span className="ic-text"> {server.health.error}</span> : null}
              </span>
            ),
          },
        ]}
      />
      <div className="ic-actions" role="group" aria-label={`${server.name}: ${tt("common.actions")}`}>
        {server.status === "ENABLED" ? null : (
          <Button type="button" size="small" disabled={!admin} title={need} loading={status.isPending} aria-label={tt("log.mcpEnableFor", { name: server.name })} onClick={() => setStatus("ENABLED")}>
            {tt("log.mcpEnable")}
          </Button>
        )}
        {server.status === "DISABLED" ? null : (
          <Button type="button" size="small" disabled={!admin} title={need} loading={status.isPending} aria-label={tt("log.mcpDisableFor", { name: server.name })} onClick={() => setStatus("DISABLED")}>
            {tt("log.mcpDisable")}
          </Button>
        )}
        {server.status === "PENDING_REVIEW" ? null : (
          <Button type="button" size="small" disabled={!admin} title={need} loading={status.isPending} aria-label={tt("log.mcpReviewFor", { name: server.name })} onClick={() => setStatus("PENDING_REVIEW")}>
            {tt("log.mcpReview")}
          </Button>
        )}
        <Button
          type="button" size="small" disabled={!manage} title={manage ? undefined : tt("common.needsManage")} loading={discover.isPending}
          aria-label={tt("log.mcpDiscoverFor", { name: server.name })}
          onClick={() => discover.mutate(
            { command: "integration_discover_mcp", body: { serverId: server.serverId } },
            {
              onSuccess: (r) => report({ tone: "success", message: tt("report.discovered", { tools: typeof r.details["tools"] === "number" ? r.details["tools"] : 0, name: server.name }) }),
              onError: (error: unknown) => report({ tone: "danger", title: tt("report.failedTitle"), message: error instanceof Error ? error.message : String(error) }),
            },
          )}
        >
          {tt("log.mcpDiscover")}
        </Button>
      </div>
      {status.isError ? <ErrorPanel error={status.error} /> : null}
    </li>
  );
}

function RegisterForm({ projects }: { projects: readonly ProjectOption[] }) {
  const { tt } = useT();
  const admin = useCanAdminister();
  const { report } = useReport();
  const register = useIntegrationCommand();
  const [form, setForm] = useState({ serverId: "", name: "", url: "", permissions: "", readOnlyTools: "" });
  const [allowed, setAllowed] = useState<string[]>([]);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const ready = admin && form.serverId.trim() !== "" && form.name.trim() !== "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    register.mutate(
      {
        command: "integration_register_mcp",
        body: {
          serverId: form.serverId.trim(), name: form.name.trim(), ...(form.url.trim() ? { url: form.url.trim() } : {}),
          permissions: splitList(form.permissions), projects: allowed, readOnlyTools: splitList(form.readOnlyTools),
        },
      },
      {
        onSuccess: () => {
          setForm({ serverId: "", name: "", url: "", permissions: "", readOnlyTools: "" });
          setAllowed([]);
          report({ tone: "success", message: tt("log.registered") });
        },
      },
    );
  };
  return (
    <form className="ic-form" onSubmit={submit} aria-labelledby="ic-register-title">
      <h3 id="ic-register-title" className="ic-sub__title">{tt("log.registerTitle")}</h3>
      {admin ? null : <Notice>{tt("log.registerAdminOnly")}</Notice>}
      <fieldset className="ic-fieldset" disabled={!admin}>
        <div className="ic-filters">
          <Input label={tt("log.serverId")} value={form.serverId} onChange={(e) => set("serverId")(e.target.value)} required />
          <Input label={tt("log.serverName")} value={form.name} onChange={(e) => set("name")(e.target.value)} required />
          <Input label={tt("log.url")} type="url" value={form.url} onChange={(e) => set("url")(e.target.value)} />
          <Input label={tt("log.permissions")} value={form.permissions} onChange={(e) => set("permissions")(e.target.value)} />
          <Input label={tt("log.readOnlyTools")} description={tt("log.readOnlyHint")} value={form.readOnlyTools} onChange={(e) => set("readOnlyTools")(e.target.value)} />
        </div>
        <fieldset className="ic-fieldset" disabled={!admin}>
          <legend>{tt("log.projects")}</legend>
          {projects.map((p) => (
            <label key={p.projectId} className="ic-check">
              <input
                type="checkbox"
                checked={allowed.includes(p.projectId)}
                onChange={(e) => setAllowed((list) => (e.target.checked ? [...list, p.projectId] : list.filter((x) => x !== p.projectId)))}
              />
              {p.displayName || p.projectId}
            </label>
          ))}
        </fieldset>
      </fieldset>
      {register.isError ? <ErrorPanel error={register.error} /> : null}
      <div className="ic-actions"><Button type="submit" variant="primary" loading={register.isPending} disabled={!ready}>{tt("log.register")}</Button></div>
    </form>
  );
}

export function McpSection({ projects }: { projects: readonly ProjectOption[] }) {
  const { tt } = useT();
  const query = useMcp();
  return (
    <section className="ic-panel" aria-labelledby="ic-mcp-title">
      <h2 id="ic-mcp-title" className="ic-panel__title">{tt("log.mcpTitle")}</h2>
      <p className="ic-muted">{tt("log.mcpExplained")}</p>
      {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        query.data.length === 0 ? <Empty title={tt("log.noMcp")} body={tt("log.noMcpBody")} /> : (
          <ul className="ic-rows" data-testid="mcp-list">
            {query.data.map((s) => <ServerRow key={s.serverId} server={s} projects={projects} />)}
          </ul>
        )
      ) : null}
      <RegisterForm projects={projects} />
    </section>
  );
}
