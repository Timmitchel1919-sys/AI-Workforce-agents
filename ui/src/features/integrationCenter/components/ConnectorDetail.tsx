import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button, Input, Select } from "../../../components/ui";
import type { ProjectOption } from "../../projectScope/projectScope";
import { useCanAdminister, useCanManage, useConnector, useIntegrationCommand, useOverview } from "../hooks/useIntegrations";
import { sandboxKey, sandboxSubstitute } from "../lib/logic";
import { useT } from "../lib/useT";
import { ENVIRONMENTS, MAPPING_ROLES, type ConnectorDetail as Detail } from "../types";
import { CommandDialog } from "./CommandDialog";
import { ConnectorActions } from "./ConnectorActions";
import { CredentialDialog } from "./CredentialDialog";
import { DefList, Empty, ErrorPanel, EventStatusTag, ModeTag, OutcomeTag, RiskTag, Skeleton, StatusTag, Tag, TextList } from "./common";
import { useReport } from "./report";

function Installation({ detail }: { detail: Detail }) {
  const { tt, label, formatTime } = useT();
  return (
    <section className="ic-panel" aria-labelledby="ic-install-title">
      <h2 id="ic-install-title" className="ic-panel__title">{tt("detail.installTitle")}</h2>
      <p className="ic-muted">{tt("detail.installNote")}</p>
      <ol className="ic-steps" data-testid="install-steps">
        {detail.installation.map((s) => (
          <li key={s.step} className="ic-step" data-step={s.step} data-step-status={s.status}>
            <span className="ic-row__title">{label("step", s.step)}</span>
            <Tag tone={s.status === "DONE" ? "success" : s.status === "FAILED" ? "danger" : "neutral"}>{label("stepStatus", s.status)}</Tag>
            {s.at ? <span className="ic-muted">{formatTime(s.at)}</span> : null}
            {s.note ? <span className="ic-muted">{s.note}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SandboxText({ raw }: { raw: string }) {
  const { tt } = useT();
  const key = sandboxKey(raw);
  if (key) return <>{tt(`sandbox.${key}`)}</>;
  const sub = sandboxSubstitute(raw);
  return <>{sub ? tt("sandbox.substitute", { capability: sub }) : raw}</>;
}

function Capabilities({ detail }: { detail: Detail }) {
  const { tt, label } = useT();
  return (
    <section className="ic-panel" aria-labelledby="ic-caps-title">
      <h2 id="ic-caps-title" className="ic-panel__title">{tt("detail.capabilitiesTitle")}</h2>
      {detail.capabilityList.length === 0 ? <Empty title={tt("detail.noCapabilities")} /> : (
        <div className="ic-table-wrap">
          <table className="ic-table" data-testid="capability-table">
            <caption className="ic-visually-hidden">{tt("detail.capabilitiesTitle")}</caption>
            <thead>
              <tr>
                <th scope="col">{tt("detail.capName")}</th>
                <th scope="col">{tt("detail.capOperation")}</th>
                <th scope="col">{tt("detail.capRisk")}</th>
                <th scope="col">{tt("detail.capApproval")}</th>
                <th scope="col">{tt("detail.capSandbox")}</th>
                <th scope="col">{tt("detail.capAvailability")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.capabilityList.map((c) => (
                <tr key={c.capability} data-capability={c.capability}>
                  <th scope="row" className="ic-cell-wrap"><span className="ic-inline-code">{c.capability}</span><br /><span className="ic-muted">{c.description}</span></th>
                  <td>{label("operation", c.operation)}</td>
                  <td><RiskTag value={c.risk} /></td>
                  <td>{label("approval", c.approval)}</td>
                  <td className="ic-cell-wrap"><SandboxText raw={c.sandbox} /></td>
                  <td className="ic-cell-wrap">
                    {c.unavailable ? <Tag tone="warning">{tt("detail.capUnavailable", { reason: c.unavailable })}</Tag> : <Tag tone="success">{tt("detail.capAvailable")}</Tag>}
                    {c.queueable ? <span className="ic-muted"> {tt("detail.capQueueable")}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Mappings({ detail, projects }: { detail: Detail; projects: readonly ProjectOption[] }) {
  const { tt, label } = useT();
  const manage = useCanManage();
  const { report } = useReport();
  const map = useIntegrationCommand();
  const unmap = useIntegrationCommand();
  const [projectId, setProjectId] = useState("");
  const [resource, setResource] = useState("");
  const [environment, setEnvironment] = useState("");
  const [role, setRole] = useState("PRIMARY");
  const name = (id: string) => projects.find((p) => p.projectId === id)?.displayName || id;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    map.mutate(
      {
        command: "integration_map_project",
        body: { projectId, connectorId: detail.connectorId, resource: resource.trim(), ...(environment ? { environment } : {}), role },
      },
      { onSuccess: () => { setResource(""); report({ tone: "success", message: tt("detail.mapAdded") }); } },
    );
  };
  return (
    <section className="ic-panel" aria-labelledby="ic-map-title">
      <h2 id="ic-map-title" className="ic-panel__title">{tt("detail.mappingsTitle")}</h2>
      <p className="ic-muted">{tt("detail.mappingsNote")}</p>
      {detail.mappings.length === 0 ? <Empty title={tt("detail.noMappings")} /> : (
        <ul className="ic-rows" data-testid="mapping-list">
          {detail.mappings.map((m) => (
            <li key={m.id} className="ic-row" data-mapping-id={m.id}>
              <div className="ic-row__head">
                <span className="ic-row__title">{name(m.projectId)}</span>
                <Tag tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status}</Tag>
              </div>
              <DefList
                items={[
                  { label: tt("detail.mapResource"), value: <span className="ic-inline-code">{m.resource}</span> },
                  { label: tt("detail.mapRole"), value: label("mappingRole", m.role) },
                  { label: tt("detail.mapEnvironment"), value: m.environment ? label("environment", m.environment) : tt("common.any") },
                  { label: tt("detail.mapSource"), value: m.source },
                ]}
              />
              {manage ? (
                <div className="ic-actions">
                  <Button
                    type="button" size="small" loading={unmap.isPending && unmap.variables?.body["mappingId"] === m.id}
                    aria-label={tt("detail.mapRemoveFor", { resource: m.resource, project: name(m.projectId) })}
                    onClick={() => unmap.mutate({ command: "integration_unmap_project", body: { mappingId: m.id } }, { onSuccess: () => report({ tone: "success", message: tt("detail.mapRemoved") }) })}
                  >
                    {tt("detail.mapRemove")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {unmap.isError ? <ErrorPanel error={unmap.error} /> : null}
      {manage ? (
        <form className="ic-form" onSubmit={submit} aria-label={tt("detail.mapAdd")}>
          <div className="ic-filters">
            <Select label={tt("detail.mapProject")} value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
              <option value="">{tt("detail.selectProject")}</option>
              {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
            </Select>
            <Input label={tt("detail.mapResource")} description={tt("detail.mapResourceHint")} value={resource} onChange={(e) => setResource(e.target.value)} required />
            <Select label={tt("detail.mapEnvironment")} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
              <option value="">{tt("common.any")}</option>
              {ENVIRONMENTS.map((e) => <option key={e} value={e}>{label("environment", e)}</option>)}
            </Select>
            <Select label={tt("detail.mapRole")} value={role} onChange={(e) => setRole(e.target.value)}>
              {MAPPING_ROLES.map((r) => <option key={r} value={r}>{label("mappingRole", r)}</option>)}
            </Select>
          </div>
          {map.isError ? <ErrorPanel error={map.error} /> : null}
          <div className="ic-actions">
            <Button type="submit" variant="primary" loading={map.isPending} disabled={projectId === "" || resource.trim() === ""}>{tt("detail.mapAdd")}</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Credentials({ detail, canStore }: { detail: Detail; canStore: boolean }) {
  const { tt, label, formatTime } = useT();
  const admin = useCanAdminister();
  const [dialog, setDialog] = useState<null | "webhook" | "revoke" | "revokeWebhook">(null);
  const close = () => setDialog(null);
  const hasPrimary = detail.credentials.some((c) => c.kind !== "webhook_secret");
  const need = admin ? undefined : tt("common.needsAdmin");
  return (
    <section className="ic-panel" aria-labelledby="ic-cred-title">
      <h2 id="ic-cred-title" className="ic-panel__title">{tt("detail.credentialsTitle")}</h2>
      <p className="ic-muted">{tt("detail.credentialsNote")}</p>
      {detail.credentials.length === 0 ? <Empty title={tt("detail.noCredentials")} /> : (
        <ul className="ic-rows" data-testid="credential-list">
          {detail.credentials.map((c) => (
            <li key={c.ref} className="ic-row">
              <DefList
                items={[
                  { label: tt("detail.credRef"), value: <span className="ic-inline-code">{c.ref}</span> },
                  { label: tt("detail.credKind"), value: label("credentialKind", c.kind) },
                  { label: tt("detail.credCreated"), value: formatTime(c.createdAt) },
                  { label: tt("detail.credUpdated"), value: formatTime(c.updatedAt) },
                  { label: tt("detail.credExpires"), value: c.expiresAt ? formatTime(c.expiresAt) : tt("common.none") },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="ic-actions">
        <Button type="button" variant="danger" size="small" disabled={!admin || !hasPrimary} title={need} aria-label={tt("credential.revokeFor", { name: detail.name })} onClick={() => setDialog("revoke")}>
          {tt("credential.revoke")}
        </Button>
      </div>

      <div className="ic-sub">
        <h3 className="ic-sub__title">{tt("detail.webhookTitle")}</h3>
        <DefList
          items={[
            { label: tt("detail.webhookEndpoint"), value: <span className="ic-inline-code" data-testid="webhook-endpoint">{detail.webhook.endpoint}</span> },
            {
              label: tt("detail.webhookSecret"),
              value: <Tag tone={detail.webhook.configured ? "success" : "warning"}>{detail.webhook.configured ? tt("detail.webhookSet") : tt("detail.webhookNotSet")}</Tag>,
            },
          ]}
        />
        <div className="ic-actions">
          <Button type="button" size="small" disabled={!admin} title={need} onClick={() => setDialog("webhook")}>{tt("detail.webhookStore")}</Button>
          <Button type="button" variant="danger" size="small" disabled={!admin || !detail.webhook.configured} title={need} onClick={() => setDialog("revokeWebhook")}>
            {tt("credential.revokeWebhook")}
          </Button>
        </div>
      </div>

      {dialog === "webhook" ? (
        <CredentialDialog connectorId={detail.connectorId} connectorName={detail.name} purpose="webhook" canStore={canStore} oauthConnector={false} onClose={close} />
      ) : null}
      {dialog === "revoke" ? (
        <CommandDialog
          title={tt("credential.revokeTitle")}
          description={tt("credential.revokeBody", { name: detail.name })}
          submitLabel={tt("credential.revoke")}
          danger
          command="integration_revoke_credential"
          getBody={() => ({ connectorId: detail.connectorId, purpose: "primary" })}
          successMessage={tt("credential.revoked", { name: detail.name })}
          onClose={close}
        />
      ) : null}
      {dialog === "revokeWebhook" ? (
        <CommandDialog
          title={tt("credential.revokeTitle")}
          description={tt("credential.revokeWebhookBody", { name: detail.name })}
          submitLabel={tt("credential.revokeWebhook")}
          danger
          command="integration_revoke_credential"
          getBody={() => ({ connectorId: detail.connectorId, purpose: "webhook" })}
          successMessage={tt("credential.revoked", { name: detail.name })}
          onClose={close}
        />
      ) : null}
    </section>
  );
}

function SecurityValidation({ detail }: { detail: Detail }) {
  const { tt } = useT();
  const v = detail.securityValidation;
  return (
    <section className="ic-panel" aria-labelledby="ic-sec-title">
      <h2 id="ic-sec-title" className="ic-panel__title">{tt("detail.securityTitle")}</h2>
      <p className="ic-muted">{tt("detail.securityNote")}</p>
      <p><Tag tone={v.ok ? "success" : "warning"}>{v.ok ? tt("detail.securityOk") : tt("detail.securityFailed")}</Tag></p>
      <ul className="ic-list" data-testid="security-checks">
        {v.checks.map((c) => (
          <li key={c.check} data-check-ok={c.ok}>
            <Tag tone={c.ok ? "success" : "danger"}>{c.ok ? tt("report.checkPassed") : tt("report.checkFailed")}</Tag> <strong>{c.check}</strong> <span className="ic-muted">{c.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Recent({ detail }: { detail: Detail }) {
  const { tt, formatTime } = useT();
  return (
    <>
      <section className="ic-panel" aria-labelledby="ic-dact-title">
        <h2 id="ic-dact-title" className="ic-panel__title">{tt("detail.activityTitle")}</h2>
        {detail.activity.length === 0 ? <Empty title={tt("detail.noActivity")} /> : (
          <ul className="ic-rows">
            {detail.activity.map((a) => (
              <li key={a.id} className="ic-row">
                <div className="ic-row__head"><span className="ic-row__title">{a.capability}</span><span className="ic-muted">{formatTime(a.at)}</span></div>
                <div className="ic-row__meta"><OutcomeTag value={a.outcome} /><span className="ic-muted">{a.projectId}</span></div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ic-panel" aria-labelledby="ic-devt-title">
        <h2 id="ic-devt-title" className="ic-panel__title">{tt("detail.eventsTitle")}</h2>
        {detail.events.length === 0 ? <Empty title={tt("detail.noEvents")} /> : (
          <ul className="ic-rows">
            {detail.events.map((e) => (
              <li key={e.id} className="ic-row">
                <div className="ic-row__head"><span className="ic-row__title">{e.type}</span><span className="ic-muted">{formatTime(e.receivedAt)}</span></div>
                <div className="ic-row__meta"><EventStatusTag value={e.status} /></div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function DetailBody({ detail, canStore, projects }: { detail: Detail; canStore: boolean; projects: readonly ProjectOption[] }) {
  const { tt, label, formatTime } = useT();
  return (
    <div className="ic-stack" data-testid="connector-detail" data-connector-id={detail.connectorId}>
      <section className="ic-panel" aria-labelledby="ic-about-title">
        <div className="ic-row__head">
          <h2 id="ic-about-title" className="ic-panel__title">{detail.name}</h2>
          <StatusTag status={detail.status} />
        </div>
        <div className="ic-row__meta"><ModeTag mode={detail.mode} /><Tag tone="info">{tt("card.trust")}: {label("trust", detail.trust)}</Tag></div>
        <DefList
          items={[
            { label: tt("detail.description"), value: detail.description },
            { label: tt("card.provider"), value: detail.provider },
            { label: tt("detail.kind"), value: detail.kind },
            { label: tt("detail.family"), value: detail.family },
            { label: tt("detail.version"), value: `${detail.version} (API ${detail.providerApiVersion})` },
            { label: tt("detail.authMethod"), value: label("authMethod", detail.auth.method) },
            { label: tt("detail.scopes"), value: <TextList items={detail.auth.scopes} /> },
            { label: tt("detail.baseUrl"), value: detail.config.baseUrl ?? tt("common.unavailable") },
            { label: tt("detail.connectedAt"), value: detail.auth.connectedAt ? formatTime(detail.auth.connectedAt) : tt("common.none") },
            { label: tt("detail.expiresAt"), value: detail.auth.expiresAt ? formatTime(detail.auth.expiresAt) : tt("common.none") },
            { label: tt("detail.costClass"), value: detail.costClass === "FREE" || detail.costClass === "METERED" ? tt(`detail.cost.${detail.costClass}`) : detail.costClass },
            { label: tt("detail.environments"), value: <TextList items={detail.environments.map((e) => label("environment", e))} /> },
          ]}
        />
        <ConnectorActions connector={detail} canStoreCredentials={canStore} />
      </section>
      <Installation detail={detail} />
      <Capabilities detail={detail} />
      <Mappings detail={detail} projects={projects} />
      <Credentials detail={detail} canStore={canStore} />
      <SecurityValidation detail={detail} />
      <Recent detail={detail} />
    </div>
  );
}

export function ConnectorDetail({ connectorId, projectId, search, projects }: { connectorId: string; projectId: string | undefined; search: string; projects: readonly ProjectOption[] }) {
  const { tt } = useT();
  const query = useConnector(connectorId);
  const overview = useOverview(projectId);
  return (
    <div className="ic-stack">
      <p>
        <Link className="ic-link ic-back" to={`/integration-center${search}`}><ArrowLeft size={14} aria-hidden /> {tt("common.back")}</Link>
      </p>
      {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
      {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? <DetailBody detail={query.data} canStore={overview.data?.vault.canStoreCredentials ?? false} projects={projects} /> : null}
    </div>
  );
}
