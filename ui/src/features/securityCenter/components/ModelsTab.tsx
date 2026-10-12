import { useState } from "react";
import { Button, Input, Select, Textarea } from "../../../components/ui";
import { useCanAdminister, useTrustData } from "../hooks/useTrust";
import { splitList } from "../lib/logic";
import { useT } from "../lib/useT";
import { DATA_CLASSES, ENABLE_STATUSES, type ModelTrust } from "../types";
import { Empty, ErrorPanel, Notice, RiskTag, Skeleton, Tag, TextList } from "./common";
import { FormDialog } from "./FormDialog";

function ModelEditDialog({ model, onClose }: { model: ModelTrust; onClose: () => void }) {
  const { tt, label } = useT();
  const [maxDataClass, setMaxDataClass] = useState(model.maxDataClass);
  const [tasks, setTasks] = useState(model.approvedTaskTypes.join(", "));
  const [external, setExternal] = useState(model.external);
  const [dataHandling, setDataHandling] = useState(model.dataHandling);
  const [status, setStatus] = useState<string>(model.status);
  return (
    <FormDialog
      title={tt("models.editTitle", { model: `${model.provider}/${model.model}` })}
      submitLabel={tt("common.save")}
      command="security_set_model_trust"
      getBody={() => ({
        provider: model.provider, model: model.model, maxDataClass, approvedTaskTypes: splitList(tasks), external,
        dataHandling: dataHandling.trim(), status,
      })}
      onClose={onClose}
    >
      <Select label={tt("models.maxDataClass")} value={maxDataClass} onChange={(e) => setMaxDataClass(e.target.value)}>
        {[...new Set([...DATA_CLASSES as readonly string[], model.maxDataClass])].map((d) => <option key={d} value={d}>{label("dataClass", d)}</option>)}
      </Select>
      <Input label={tt("models.tasksLabel")} description={tt("models.tasksHint")} value={tasks} onChange={(e) => setTasks(e.target.value)} />
      <label className="sc-check"><input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} />{tt("models.externalLabel")}</label>
      <Textarea label={tt("models.dataHandling")} rows={3} value={dataHandling} onChange={(e) => setDataHandling(e.target.value)} />
      <Select label={tt("common.status")} value={status} onChange={(e) => setStatus(e.target.value)}>
        {ENABLE_STATUSES.map((s) => <option key={s} value={s}>{label("enableStatus", s)}</option>)}
      </Select>
    </FormDialog>
  );
}

function ModelTable({ models, admin, onEdit, caption }: { models: readonly ModelTrust[]; admin: boolean; onEdit: (m: ModelTrust) => void; caption: string }) {
  const { tt, label } = useT();
  return (
    <div className="sc-table-wrap">
      <table className="sc-table">
        <caption className="sc-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{tt("models.model")}</th>
            <th scope="col">{tt("models.external")}</th>
            <th scope="col">{tt("models.maxDataClass")}</th>
            <th scope="col">{tt("models.tasks")}</th>
            <th scope="col">{tt("models.riskClass")}</th>
            <th scope="col">{tt("common.status")}</th>
            <th scope="col">{tt("models.dataHandling")}</th>
            {admin ? <th scope="col">{tt("common.actions")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id} data-model={`${m.provider}/${m.model}`}>
              <th scope="row" className="sc-cell-wrap">{m.provider}/{m.model}</th>
              <td>{m.external ? <Tag tone="warning">{tt("models.externalYes")}</Tag> : <Tag tone="success">{tt("models.externalNo")}</Tag>}</td>
              <td>{label("dataClass", m.maxDataClass)}</td>
              <td className="sc-cell-wrap"><TextList items={m.approvedTaskTypes} /></td>
              <td><RiskTag value={m.riskClass} /></td>
              <td><Tag tone={m.status === "ENABLED" ? "success" : "neutral"}>{label("enableStatus", m.status)}</Tag></td>
              <td className="sc-cell-wrap"><span className="sc-text">{m.dataHandling}</span></td>
              {admin ? <td><Button type="button" size="small" onClick={() => onEdit(m)}>{tt("common.edit")} <span className="sc-visually-hidden">{m.provider}/{m.model}</span></Button></td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ModelsTab() {
  const { tt } = useT();
  const query = useTrustData();
  const admin = useCanAdminister();
  const [editing, setEditing] = useState<ModelTrust | null>(null);
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  const { models, defaultModelPolicy } = query.data;
  return (
    <div className="sc-stack">
      <section className="sc-panel" aria-labelledby="sc-models-title">
        <h2 id="sc-models-title" className="sc-panel__title">{tt("models.title")}</h2>
        <p className="sc-muted">{tt("models.explained")}</p>
        {!admin ? <Notice>{tt("models.adminOnly")}</Notice> : null}
        {models.length === 0 ? <Empty title={tt("models.empty")} /> : <ModelTable models={models} admin={admin} onEdit={setEditing} caption={tt("models.title")} />}
      </section>
      <section className="sc-panel" aria-labelledby="sc-default-model-title">
        <h2 id="sc-default-model-title" className="sc-panel__title">{tt("models.defaultTitle")}</h2>
        <p className="sc-muted">{tt("models.defaultExplained")}</p>
        <ModelTable models={[defaultModelPolicy]} admin={false} onEdit={setEditing} caption={tt("models.defaultTitle")} />
      </section>
      {editing ? <ModelEditDialog model={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
