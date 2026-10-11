import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Input, Select, Textarea } from "../../../components/ui";
import { useCanAdminister, useCanManage, useGet } from "../hooks/useCommand";
import { useRunner } from "../hooks/useRunner";
import { useT } from "../lib/useT";
import { healthTone, riskTone } from "../lib/tones";
import type { ExtensionDetail, ExtensionsOverview, ExtensionView } from "../types";
import { CommandDialog } from "./CommandDialog";
import { Empty, Notice, Tag } from "./common";
import { Async, Btn, Cards, DataTable, Guarded, Panel } from "./kit";

const CAP = "manage_extensions" as const;
const BASE = "/extension-platform";

const SAMPLE = JSON.stringify(
  {
    id: "skill.my-skill",
    name: "My skill",
    description: "What this skill teaches the platform.",
    version: "1.0.0",
    type: "SKILL",
    author: "me",
    capabilities: ["my.capability"],
    dependencies: [],
    permissions: [],
    spec: {
      capability: "my.capability",
      instructions: "Step-by-step guidance.",
      prerequisites: [],
      tools: [],
      expectedOutputs: ["A result"],
      validation: ["Tests pass"],
      appliesTo: { keywords: ["my"] },
    },
  },
  null,
  2,
);

function HealthTag({ view }: { view: ExtensionView }) {
  const { label } = useT();
  return (
    <Tag tone={healthTone(view.health)} title={view.healthReason}>
      {label("health", view.health)}
    </Tag>
  );
}

export function RegistryTab({ search }: { search: string }) {
  const { tt, label } = useT();
  const query = useGet<ExtensionsOverview>("/extensions-platform/overview");
  return (
    <Async query={query}>
      {(data) => (
        <div className="pc-stack">
          <Panel title={tt("ext.summary")}>
            <Cards
              items={[
                { label: tt("ext.cards.total"), value: data.summary.total },
                { label: label("health", "ACTIVE"), value: data.summary.active },
                { label: label("health", "INSTALLED"), value: data.summary.installed },
                { label: label("health", "DISABLED"), value: data.summary.disabled },
                { label: label("health", "INCOMPATIBLE"), value: data.summary.incompatible },
                { label: label("health", "FAILED"), value: data.summary.failed },
                { label: label("health", "UPDATE_AVAILABLE"), value: data.summary.updateAvailable },
              ]}
            />
          </Panel>
          <Panel title={tt("ext.registry")}>
            <DataTable
              caption={tt("ext.registry")}
              rows={data.extensions}
              rowKey={(e) => e.extensionId}
              empty={tt("ext.empty")}
              columns={[
                {
                  key: "name",
                  header: tt("ext.col.name"),
                  wrap: true,
                  render: (e) => (
                    <Link className="pc-link" to={`${BASE}/detail/${encodeURIComponent(e.extensionId)}${search}`}>
                      {e.name}
                    </Link>
                  ),
                },
                {
                  key: "type",
                  header: tt("ext.col.type"),
                  render: (e) => (
                    <span className="pc-inline">
                      {label("types", e.type)}
                      {e.supportLevel === "REGISTRY_ONLY" ? (
                        <Tag tone="warning" title={e.effect}>
                          {tt("ext.registryOnly")}
                        </Tag>
                      ) : null}
                    </span>
                  ),
                },
                { key: "version", header: tt("ext.col.version"), render: (e) => `${e.activeVersion ?? "—"} / ${e.latestVersion}` },
                { key: "health", header: tt("ext.col.health"), render: (e) => <HealthTag view={e} /> },
                { key: "source", header: tt("ext.col.source"), render: (e) => tt(`ext.source.${e.source}`) },
                { key: "perm", header: tt("ext.col.permissions"), render: (e) => `${e.grantedPermissions.length}/${e.requestedPermissions.length}` },
              ]}
            />
          </Panel>
          <Panel title={tt("ext.recentAudit")}>
            <DataTable
              caption={tt("ext.recentAudit")}
              rows={data.recentAudit}
              rowKey={(e) => e.id}
              empty={tt("common.none")}
              columns={[
                { key: "at", header: tt("common.time"), render: (e) => e.at.slice(0, 19).replace("T", " ") },
                { key: "ext", header: tt("ext.col.name"), render: (e) => e.extensionId },
                { key: "action", header: tt("common.action"), render: (e) => e.action },
                { key: "actor", header: tt("common.actor"), render: (e) => e.actor },
                { key: "detail", header: tt("common.detail"), wrap: true, render: (e) => e.detail },
              ]}
            />
          </Panel>
        </div>
      )}
    </Async>
  );
}

export function DetailTab({ id }: { id: string | undefined }) {
  const { tt } = useT();
  if (!id) return <Empty title={tt("ext.pickOne")} body={tt("ext.pickOneBody")} />;
  return <DetailView id={id} />;
}

function DetailView({ id }: { id: string }) {
  const { tt, label } = useT();
  const query = useGet<ExtensionDetail>(`/extensions-platform/extension/${encodeURIComponent(id)}`);
  const overview = useGet<ExtensionsOverview>("/extensions-platform/overview");
  const manage = useCanManage(CAP);
  const admin = useCanAdminister(CAP);
  const { run, pending } = useRunner();
  const [breaking, setBreaking] = useState<{ version: string; reason: string } | null>(null);
  const [rollbackTo, setRollbackTo] = useState("");
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState(false);
  const risks = useMemo(() => new Map((overview.data?.permissions ?? []).map((p) => [p.scope, p])), [overview.data]);
  const needManage = tt("common.needsManage");
  const needAdmin = tt("common.needsAdmin");

  return (
    <Async query={query}>
      {(e) => {
        const enable = (version: string, acknowledgeBreaking = false) =>
          run("extension_enable", { extensionId: e.extensionId, version, acknowledgeBreaking }, tt("ext.msg.enabled"), {
            onRefused: (reason) => {
              if (/breaking changes/i.test(reason) && !acknowledgeBreaking) {
                setBreaking({ version, reason });
                return true;
              }
              return false;
            },
          });
        const older = e.versions.filter((v) => e.activeVersion && v.version < e.activeVersion);
        const schema = e.manifests.find((m) => m.version === (e.activeVersion ?? e.latestVersion))?.manifest.configSchema ?? {};
        return (
          <div className="pc-stack">
            <Panel
              title={e.name}
              actions={
                <Link className="pc-link" to={BASE}>
                  {tt("ext.back")}
                </Link>
              }
              testId="ext-detail"
            >
              <p className="pc-text">{e.description}</p>
              <div className="pc-inline">
                <Tag tone={healthTone(e.health)} title={e.healthReason}>
                  {label("health", e.health)}
                </Tag>
                <Tag>{label("types", e.type)}</Tag>
                <Tag>{tt(`ext.source.${e.source}`)}</Tag>
                <span className="pc-muted">{e.healthReason}</span>
              </div>
              {e.supportLevel === "REGISTRY_ONLY" ? (
                <Notice tone="warning" title={tt("ext.registryOnly")}>
                  {e.effect}
                </Notice>
              ) : (
                <Notice>{e.effect}</Notice>
              )}
              {!manage ? <Notice>{tt("ext.readOnly")}</Notice> : null}
            </Panel>

            <Panel title={tt("ext.lifecycle")}>
              <ol className="pc-steps">
                {e.lifecycle.map((s) => (
                  <li key={s.step} className="pc-step" data-step-status={s.status}>
                    <Tag tone={s.status === "DONE" ? "success" : s.status === "BLOCKED" ? "danger" : "neutral"}>{label("lifecycle", s.step)}</Tag>
                    <span className="pc-muted">
                      {label("stepStatus", s.status)}
                      {s.note ? ` — ${s.note}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title={tt("ext.versions")}>
              <DataTable
                caption={tt("ext.versions")}
                rows={e.versions}
                rowKey={(v) => v.version}
                empty={tt("common.none")}
                columns={[
                  { key: "v", header: tt("ext.col.version"), render: (v) => <span>{v.version}{v.version === e.activeVersion ? ` (${tt("ext.active")})` : ""}</span> },
                  {
                    key: "t",
                    header: tt("ext.col.tested"),
                    render: (v) => (v.tested === null ? <Tag>{tt("ext.notRun")}</Tag> : <Tag tone={v.tested ? "success" : "danger"}>{v.tested ? tt("common.passed") : tt("common.failed")}</Tag>),
                  },
                  {
                    key: "r",
                    header: tt("ext.col.review"),
                    render: (v) =>
                      v.review ? (
                        <Tag tone={healthTone(v.review === "PASSED" || v.review === "APPROVED" ? "OK" : v.review === "NEEDS_APPROVAL" ? "WARN" : "BAD")}>{label("review", v.review)}</Tag>
                      ) : (
                        <Tag>{tt("ext.notRun")}</Tag>
                      ),
                  },
                  {
                    key: "a",
                    header: tt("common.actions"),
                    render: (v) => (
                      <span className="pc-inline">
                        <Btn size="small" disabled={!manage || pending} onClick={() => run("extension_test", { extensionId: e.extensionId, version: v.version }, tt("ext.msg.tested"))}>
                          {tt("ext.test")}
                        </Btn>
                        <Btn size="small" disabled={!manage || pending} onClick={() => run("extension_review", { extensionId: e.extensionId, version: v.version }, tt("ext.msg.reviewed"))}>
                          {tt("ext.review")}
                        </Btn>
                        {v.review === "NEEDS_APPROVAL" ? (
                          <Btn size="small" disabled={!admin || pending} onClick={() => run("extension_approve_review", { extensionId: e.extensionId, version: v.version }, tt("ext.msg.reviewApproved"))}>
                            {tt("ext.approveReview")}
                          </Btn>
                        ) : null}
                        <Btn size="small" variant="primary" disabled={!admin || pending || v.version === e.activeVersion} onClick={() => enable(v.version)}>
                          {e.activeVersion ? tt("ext.switchTo") : tt("ext.enable")}
                        </Btn>
                      </span>
                    ),
                  },
                ]}
              />
              {!admin ? <p className="pc-muted">{needAdmin}</p> : null}
              <div className="pc-actions">
                <Guarded allowed={manage} why={needManage}>
                  {(d) => (
                    <Btn disabled={d || pending || e.status !== "ENABLED"} onClick={() => run("extension_disable", { extensionId: e.extensionId }, tt("ext.msg.disabled"))}>
                      {tt("ext.disable")}
                    </Btn>
                  )}
                </Guarded>
                {older.length > 0 ? (
                  <span className="pc-inline">
                    <Select label={tt("ext.rollbackTo")} value={rollbackTo} onChange={(ev) => setRollbackTo(ev.target.value)}>
                      <option value="">—</option>
                      {older.map((v) => (
                        <option key={v.version} value={v.version}>
                          {v.version}
                        </option>
                      ))}
                    </Select>
                    <Btn disabled={!admin || !rollbackTo || pending} onClick={() => run("extension_rollback", { extensionId: e.extensionId, version: rollbackTo }, tt("ext.msg.rolledBack"))}>
                      {tt("ext.rollback")}
                    </Btn>
                  </span>
                ) : null}
                {e.source === "user" ? (
                  <Guarded allowed={admin} why={needAdmin}>
                    {(d) => (
                      <Btn variant="danger" disabled={d || pending || e.status === "ENABLED"} onClick={() => setRemoving(true)}>
                        {tt("ext.remove")}
                      </Btn>
                    )}
                  </Guarded>
                ) : null}
              </div>
            </Panel>

            <Panel title={tt("ext.permissions")}>
              <p className="pc-muted">{tt("ext.permissionsHelp")}</p>
              <DataTable
                caption={tt("ext.permissions")}
                rows={e.requestedPermissions}
                rowKey={(s) => s}
                empty={tt("ext.noPermissions")}
                columns={[
                  { key: "s", header: tt("ext.col.scope"), render: (s) => <span className="pc-inline-code">{s}</span> },
                  {
                    key: "risk",
                    header: tt("ext.col.risk"),
                    render: (s) => {
                      const p = risks.get(s);
                      return p ? <Tag tone={riskTone(p.risk)}>{label("risk", p.risk)}</Tag> : <Tag>—</Tag>;
                    },
                  },
                  { key: "g", header: tt("ext.col.granted"), render: (s) => (e.grantedPermissions.includes(s) ? <Tag tone="success">{tt("common.yes")}</Tag> : <Tag tone="warning">{tt("common.no")}</Tag>) },
                  {
                    key: "a",
                    header: tt("common.actions"),
                    render: (s) =>
                      e.grantedPermissions.includes(s) ? (
                        <Btn size="small" disabled={!manage || pending} onClick={() => run("extension_revoke_permission", { extensionId: e.extensionId, scope: s }, tt("ext.msg.revoked"))}>
                          {tt("ext.revoke")}
                        </Btn>
                      ) : (
                        <Btn size="small" variant="primary" disabled={!admin || pending} onClick={() => run("extension_grant_permission", { extensionId: e.extensionId, scope: s }, tt("ext.msg.granted"))}>
                          {tt("ext.grant")}
                        </Btn>
                      ),
                  },
                ]}
              />
            </Panel>

            <Panel title={tt("ext.dependencies")}>
              {e.dependencies.length === 0 ? (
                <p className="pc-muted">{tt("common.none")}</p>
              ) : (
                <ul className="pc-list">
                  {e.dependencies.map((d) => (
                    <li key={`${d.dependency.kind}:${d.dependency.id}`} data-satisfied={d.satisfied}>
                      <Tag tone={d.satisfied ? "success" : "danger"}>{d.satisfied ? tt("ext.satisfied") : tt("ext.unsatisfied")}</Tag>{" "}
                      <span className="pc-inline-code">
                        {d.dependency.kind}:{d.dependency.id}
                        {d.dependency.range ? ` ${d.dependency.range}` : ""}
                      </span>{" "}
                      — {d.reason}
                    </li>
                  ))}
                </ul>
              )}
              {e.dependents.length > 0 ? <p className="pc-muted">{tt("ext.dependents", { list: e.dependents.map((d) => d.extensionId).join(", ") })}</p> : null}
            </Panel>

            {Object.keys(schema).length > 0 ? (
              <Panel title={tt("ext.config")}>
                <p className="pc-muted">{tt("ext.configHelp")}</p>
                <div className="pc-form">
                  {Object.entries(schema).map(([key, def]) => (
                    <Input
                      key={key}
                      label={`${key}${def.description ? ` — ${def.description}` : ""}`}
                      value={configDraft[key] ?? String(e.config[key] ?? "")}
                      onChange={(ev) => setConfigDraft((d) => ({ ...d, [key]: ev.target.value }))}
                    />
                  ))}
                  <div className="pc-actions">
                    <Btn
                      variant="primary"
                      disabled={!manage || pending}
                      onClick={() => {
                        const cfg: Record<string, unknown> = {};
                        for (const [key, def] of Object.entries(schema))
                          if (configDraft[key] !== undefined) cfg[key] = def.type === "number" ? Number(configDraft[key]) : def.type === "boolean" ? configDraft[key] === "true" : configDraft[key];
                        run("extension_configure", { extensionId: e.extensionId, config: cfg }, tt("ext.msg.configured"));
                      }}
                    >
                      {tt("ext.saveConfig")}
                    </Btn>
                  </div>
                </div>
              </Panel>
            ) : null}

            <Panel title={tt("ext.audit")}>
              <DataTable
                caption={tt("ext.audit")}
                rows={e.audit}
                rowKey={(a) => a.id}
                empty={tt("common.none")}
                columns={[
                  { key: "at", header: tt("common.time"), render: (a) => a.at.slice(0, 19).replace("T", " ") },
                  { key: "action", header: tt("common.action"), render: (a) => a.action },
                  { key: "actor", header: tt("common.actor"), render: (a) => a.actor },
                  { key: "detail", header: tt("common.detail"), wrap: true, render: (a) => a.detail },
                ]}
              />
            </Panel>

            {breaking ? (
              <CommandDialog
                title={tt("ext.breakingTitle")}
                description={
                  <>
                    <p>{tt("ext.breakingBody")}</p>
                    <p className="pc-text" data-testid="breaking-reason">
                      {breaking.reason}
                    </p>
                  </>
                }
                submitLabel={tt("ext.breakingConfirm")}
                command="extension_enable"
                getBody={() => ({ extensionId: e.extensionId, version: breaking.version, acknowledgeBreaking: true })}
                successMessage={tt("ext.msg.enabled")}
                onClose={() => setBreaking(null)}
              />
            ) : null}
            {removing ? (
              <CommandDialog
                title={tt("ext.removeTitle")}
                description={<p>{tt("ext.removeBody")}</p>}
                submitLabel={tt("ext.remove")}
                danger
                command="extension_remove"
                getBody={() => ({ extensionId: e.extensionId })}
                successMessage={tt("ext.msg.removed")}
                onClose={() => setRemoving(false)}
              />
            ) : null}
          </div>
        );
      }}
    </Async>
  );
}

export function RegisterTab() {
  const { tt } = useT();
  const admin = useCanAdminister(CAP);
  const { run, pending } = useRunner();
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState("");
  const submit = (command: "extension_register" | "extension_register_version") => {
    let manifest: unknown;
    try {
      manifest = JSON.parse(text);
    } catch {
      setParseError(tt("ext.invalidJson"));
      return;
    }
    setParseError("");
    run(command, { manifest }, command === "extension_register" ? tt("ext.msg.registered") : tt("ext.msg.versionRegistered"));
  };
  return (
    <Panel title={tt("ext.registerTitle")}>
      <Notice title={tt("ext.declarativeTitle")}>{tt("ext.declarativeBody")}</Notice>
      {!admin ? <Notice tone="warning">{tt("common.needsAdmin")}</Notice> : null}
      <Textarea label={tt("ext.manifest")} className="pc-textarea" rows={16} value={text} onChange={(ev) => setText(ev.target.value)} />
      {parseError ? (
        <p className="pc-field-error" role="alert">
          {parseError}
        </p>
      ) : null}
      <div className="pc-actions">
        <Btn onClick={() => setText(SAMPLE)}>{tt("ext.useSample")}</Btn>
        <Btn variant="primary" disabled={!admin || pending || text.trim() === ""} onClick={() => submit("extension_register")}>
          {tt("ext.registerNew")}
        </Btn>
        <Btn disabled={!admin || pending || text.trim() === ""} onClick={() => submit("extension_register_version")}>
          {tt("ext.registerVersion")}
        </Btn>
      </div>
      <p className="pc-muted">{tt("ext.flowHelp")}</p>
    </Panel>
  );
}

export function CatalogueTab() {
  const { tt, label } = useT();
  const query = useGet<ExtensionsOverview>("/extensions-platform/overview");
  return (
    <Async query={query}>
      {(data) => (
        <div className="pc-stack">
          <Panel title={tt("ext.typesTitle")}>
            <DataTable
              caption={tt("ext.typesTitle")}
              rows={data.types}
              rowKey={(t) => t.type}
              empty={tt("common.none")}
              columns={[
                { key: "t", header: tt("ext.col.type"), render: (t) => label("types", t.type) },
                { key: "l", header: tt("ext.col.support"), render: (t) => <Tag tone={t.level === "ACTIVE" ? "success" : "warning"}>{t.level === "ACTIVE" ? tt("ext.supportActive") : tt("ext.registryOnly")}</Tag> },
                { key: "e", header: tt("ext.col.effect"), wrap: true, render: (t) => t.effect },
              ]}
            />
          </Panel>
          <Panel title={tt("ext.permCatalogue")}>
            <DataTable
              caption={tt("ext.permCatalogue")}
              rows={data.permissions}
              rowKey={(p) => p.scope}
              empty={tt("common.none")}
              columns={[
                { key: "s", header: tt("ext.col.scope"), render: (p) => <span className="pc-inline-code">{p.scope}</span> },
                { key: "r", header: tt("ext.col.risk"), render: (p) => <Tag tone={riskTone(p.risk)}>{label("risk", p.risk)}</Tag> },
                { key: "g", header: tt("ext.col.grantable"), render: (p) => (p.grantable ? <Tag tone="success">{tt("common.yes")}</Tag> : <Tag tone="danger">{tt("ext.neverGranted")}</Tag>) },
                { key: "d", header: tt("common.detail"), wrap: true, render: (p) => p.description },
              ]}
            />
          </Panel>
        </div>
      )}
    </Async>
  );
}
