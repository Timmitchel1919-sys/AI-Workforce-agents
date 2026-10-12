import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button, Dialog, Input, Select, Textarea } from "../../../components/ui";
import type { ProjectOption } from "../../projectScope/projectScope";
import { useCanManage, usePolicies, usePolicy } from "../hooks/useTrust";
import { mergeConditions, scopeText, splitList } from "../lib/logic";
import { useT } from "../lib/useT";
import { ACTION_CLASSES, AUTHORABLE_EFFECTS, ENVIRONMENTS, POLICY_LAYERS, RISK_LEVELS, type Policy } from "../types";
import { CommandDialog } from "./CommandDialog";
import { DefList, Empty, ErrorPanel, Notice, Readable, Skeleton, Tag } from "./common";
import { FormDialog } from "./FormDialog";

function PolicyBadges({ policy }: { policy: Policy }) {
  const { tt } = useT();
  return (
    <span className="sc-inline">
      {policy.builtin ? <Tag tone="info" title={tt("policies.builtinWhy")}>{tt("policies.builtin")}</Tag> : null}
      {policy.critical ? <Tag tone="danger" title={tt("policies.criticalWhy")}>{tt("policies.critical")}</Tag> : null}
    </span>
  );
}

function PolicyForm({ policy, layers, projects, onClose }: { policy?: Policy; layers: readonly string[]; projects: readonly ProjectOption[]; onClose: () => void }) {
  const { tt, label } = useT();
  const c = policy?.conditions;
  const [name, setName] = useState(policy?.name ?? "");
  const [description, setDescription] = useState(policy?.description ?? "");
  const [layer, setLayer] = useState(policy?.layer ?? layers[0] ?? POLICY_LAYERS[0]);
  const [effect, setEffect] = useState(policy && policy.effect !== "ALLOW" ? policy.effect : "REQUIRE_APPROVAL");
  const [priority, setPriority] = useState(String(policy?.priority ?? 50));
  const [projectId, setProjectId] = useState(policy?.scope.projectId ?? "");
  const [taskType, setTaskType] = useState(policy?.scope.taskType ?? "");
  const [agentId, setAgentId] = useState(policy?.scope.agentId ?? "");
  const [actions, setActions] = useState<string[]>(c?.actions ?? []);
  const [envs, setEnvs] = useState<string[]>(c?.environments ?? []);
  const [includes, setIncludes] = useState((c?.resourceIncludes ?? []).join(", "));
  const [minCount, setMinCount] = useState(c?.minCount !== undefined ? String(c.minCount) : "");
  const [minRisk, setMinRisk] = useState(c?.minRisk ?? "");
  const [critical, setCritical] = useState(policy?.critical ?? false);
  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const getBody = () => {
    const scope: Record<string, string> = { ...(policy?.scope.workflowId ? { workflowId: policy.scope.workflowId } : {}) };
    if (projectId) scope["projectId"] = projectId;
    if (taskType.trim()) scope["taskType"] = taskType.trim();
    if (agentId.trim()) scope["agentId"] = agentId.trim();
    const p = Number(priority);
    return {
      ...(policy ? { policyId: policy.policyId } : {}),
      name: name.trim(),
      description: description.trim(),
      layer,
      effect,
      ...(Number.isFinite(p) && priority.trim() !== "" ? { priority: p } : {}),
      scope,
      conditions: mergeConditions(c, { actions, environments: envs, resourceIncludes: splitList(includes), minCount, minRisk }),
      ...(policy ? {} : { critical }),
    };
  };
  const layerOptions = [...new Set([...(layers.length > 0 ? layers : POLICY_LAYERS), layer])];

  return (
    <FormDialog
      title={policy ? tt("policies.editTitle", { name: policy.name }) : tt("policies.createTitle")}
      submitLabel={policy ? tt("common.save") : tt("policies.create")}
      command={policy ? "security_update_policy" : "security_create_policy"}
      getBody={getBody}
      canSubmit={name.trim().length > 0}
      onClose={onClose}
    >
      <Notice>{tt("policies.restrictOnly")}</Notice>
      <Input label={tt("policies.name")} value={name} required onChange={(e) => setName(e.target.value)} />
      <Textarea label={tt("policies.description")} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      <Select label={tt("policies.layer")} value={layer} onChange={(e) => setLayer(e.target.value)}>
        {layerOptions.map((l) => <option key={l} value={l}>{label("layer", l)}</option>)}
      </Select>
      <Select label={tt("policies.effect")} value={effect} onChange={(e) => setEffect(e.target.value)}>
        {AUTHORABLE_EFFECTS.map((e) => <option key={e} value={e}>{label("effect", e)}</option>)}
      </Select>
      <Input label={tt("policies.priority")} type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
      <fieldset className="sc-fieldset">
        <legend>{tt("policies.scope")}</legend>
        <Select label={tt("policies.scopeProject")} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">{tt("policies.anyProject")}</option>
          {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.displayName || p.projectId}</option>)}
        </Select>
        <Input label={tt("policies.scopeTaskType")} value={taskType} onChange={(e) => setTaskType(e.target.value)} />
        <Input label={tt("policies.scopeAgent")} value={agentId} onChange={(e) => setAgentId(e.target.value)} />
      </fieldset>
      <fieldset className="sc-fieldset">
        <legend>{tt("policies.conditions")}</legend>
        <fieldset className="sc-fieldset">
          <legend>{tt("policies.condActions")}</legend>
          {ACTION_CLASSES.map((a) => (
            <label key={a} className="sc-check"><input type="checkbox" checked={actions.includes(a)} onChange={() => toggle(actions, setActions, a)} />{label("action", a)}</label>
          ))}
        </fieldset>
        <fieldset className="sc-fieldset">
          <legend>{tt("policies.condEnvironments")}</legend>
          {ENVIRONMENTS.map((e) => (
            <label key={e} className="sc-check"><input type="checkbox" checked={envs.includes(e)} onChange={() => toggle(envs, setEnvs, e)} />{label("environment", e)}</label>
          ))}
        </fieldset>
        <Input label={tt("policies.condIncludes")} description={tt("policies.condIncludesHint")} value={includes} onChange={(e) => setIncludes(e.target.value)} />
        <Input label={tt("policies.condMinCount")} type="number" min={0} value={minCount} onChange={(e) => setMinCount(e.target.value)} />
        <Select label={tt("policies.condMinRisk")} value={minRisk} onChange={(e) => setMinRisk(e.target.value)}>
          <option value="">{tt("common.any")}</option>
          {RISK_LEVELS.map((r) => <option key={r} value={r}>{label("risk", r)}</option>)}
        </Select>
      </fieldset>
      {!policy ? (
        <>
          <label className="sc-check"><input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />{tt("policies.criticalLabel")}</label>
          <p className="sc-muted">{tt("policies.criticalWhy")}</p>
        </>
      ) : null}
    </FormDialog>
  );
}

function PolicyView({ policyId, search, layers, projects }: { policyId: string; search: string; layers: readonly string[]; projects: readonly ProjectOption[] }) {
  const { tt, label, formatTime } = useT();
  const navigate = useNavigate();
  const canManage = useCanManage();
  const query = usePolicy(policyId);
  const [mode, setMode] = useState<"edit" | "toggle" | null>(null);
  const close = () => void navigate(`/security-center/policies${search}`);
  const policy = query.data;
  return (
    <Dialog open onClose={close} title={policy?.name ?? tt("policies.viewTitle")}>
      <div className="sc-stack" data-testid="policy-view">
        {query.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
        {query.isError ? <ErrorPanel error={query.error} onRetry={() => void query.refetch()} /> : null}
        {policy ? (
          <>
            <p className="sc-text">{policy.description}</p>
            <PolicyBadges policy={policy} />
            <DefList
              items={[
                { label: tt("policies.layer"), value: label("layer", policy.layer) },
                { label: tt("policies.effect"), value: label("effect", policy.effect) },
                { label: tt("policies.priority"), value: policy.priority },
                { label: tt("common.status"), value: label("enableStatus", policy.status) },
                { label: tt("policies.scope"), value: scopeText(policy.scope) || tt("policies.everywhere") },
                { label: tt("policies.version"), value: policy.version },
                { label: tt("policies.updated"), value: `${formatTime(policy.updatedAt)} · ${policy.updatedBy}` },
                ...(policy.approvalRequirement ? [{ label: tt("policies.approvalRequirement"), value: policy.approvalRequirement }] : []),
                ...(policy.securityRequirement ? [{ label: tt("policies.securityRequirement"), value: policy.securityRequirement }] : []),
              ]}
            />
            <div className="sc-sub">
              <h3 className="sc-sub__title">{tt("policies.conditions")}</h3>
              <Readable value={policy.conditions} />
            </div>
            {policy.builtin ? <Notice>{tt("policies.builtinWhy")}</Notice> : null}
            {policy.critical ? <Notice tone="warning">{tt("policies.criticalWhy")}</Notice> : null}
            {canManage && !policy.builtin ? (
              <div className="sc-actions">
                <Button type="button" variant="primary" onClick={() => setMode("edit")}>{tt("common.edit")}</Button>
                <Button type="button" variant="secondary" onClick={() => setMode("toggle")}>
                  {policy.status === "ENABLED" ? tt("policies.disable") : tt("policies.enable")}
                </Button>
              </div>
            ) : null}
            <div className="sc-actions"><Button type="button" variant="secondary" onClick={close}>{tt("common.close")}</Button></div>
            {mode === "edit" ? <PolicyForm policy={policy} layers={layers} projects={projects} onClose={() => setMode(null)} /> : null}
            {mode === "toggle" ? (
              <CommandDialog
                title={policy.status === "ENABLED" ? tt("policies.disable") : tt("policies.enable")}
                description={tt(policy.status === "ENABLED" ? "policies.disableBody" : "policies.enableBody", { name: policy.name })}
                confirmLabel={policy.status === "ENABLED" ? tt("policies.disable") : tt("policies.enable")}
                command="security_set_policy_status"
                buildBody={() => ({ policyId: policy.policyId, status: policy.status === "ENABLED" ? "DISABLED" : "ENABLED" })}
                danger={policy.status === "ENABLED"}
                onClose={() => setMode(null)}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

export function PoliciesTab({ search, projects, policyId }: { search: string; projects: readonly ProjectOption[]; policyId: string | undefined }) {
  const { tt, label, formatTime } = useT();
  const query = usePolicies();
  const canManage = useCanManage();
  const [creating, setCreating] = useState(false);
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  const { layers, policies } = query.data;
  return (
    <div className="sc-stack">
      <section className="sc-panel" aria-labelledby="sc-layers-title">
        <h2 id="sc-layers-title" className="sc-panel__title">{tt("policies.precedenceTitle")}</h2>
        <p className="sc-muted">{tt("policies.precedenceExplained")}</p>
        <ol className="sc-chips" data-testid="policy-layers">
          {layers.map((layer) => <li key={layer} className="sc-tag sc-tag--neutral">{label("layer", layer)}</li>)}
        </ol>
      </section>
      <section className="sc-panel" aria-labelledby="sc-policies-title">
        <div className="sc-header-row">
          <h2 id="sc-policies-title" className="sc-panel__title">{tt("policies.title")}</h2>
          {canManage ? <Button type="button" variant="primary" onClick={() => setCreating(true)}>{tt("policies.new")}</Button> : null}
        </div>
        {policies.length === 0 ? <Empty title={tt("policies.empty")} /> : (
          <div className="sc-table-wrap">
            <table className="sc-table">
              <caption className="sc-visually-hidden">{tt("policies.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{tt("policies.name")}</th>
                  <th scope="col">{tt("policies.layer")}</th>
                  <th scope="col">{tt("policies.effect")}</th>
                  <th scope="col">{tt("common.status")}</th>
                  <th scope="col">{tt("policies.scope")}</th>
                  <th scope="col">{tt("policies.version")}</th>
                  <th scope="col">{tt("policies.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.policyId} data-policy={p.policyId} data-builtin={p.builtin}>
                    <th scope="row" className="sc-cell-wrap">
                      <Link className="sc-link" to={`/security-center/policies/${encodeURIComponent(p.policyId)}${search}`}>{p.name}</Link>
                      <br /><PolicyBadges policy={p} />
                      {p.builtin ? <span className="sc-muted"> <Lock size={12} aria-hidden /> {tt("policies.readOnly")}</span> : null}
                    </th>
                    <td>{label("layer", p.layer)}</td>
                    <td>{label("effect", p.effect)}</td>
                    <td><Tag tone={p.status === "ENABLED" ? "success" : "neutral"}>{label("enableStatus", p.status)}</Tag></td>
                    <td className="sc-cell-wrap">{scopeText(p.scope) || tt("policies.everywhere")}</td>
                    <td>{p.version}</td>
                    <td>{formatTime(p.updatedAt)}<br /><span className="sc-muted">{p.updatedBy}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {policyId ? <PolicyView key={policyId} policyId={policyId} search={search} layers={layers} projects={projects} /> : null}
      {creating ? <PolicyForm layers={layers} projects={projects} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
