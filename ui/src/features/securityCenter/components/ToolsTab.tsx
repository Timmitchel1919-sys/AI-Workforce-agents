import { useState } from "react";
import { Button, Input, Select } from "../../../components/ui";
import { useCanAdminister, useTrustData } from "../hooks/useTrust";
import { splitList } from "../lib/logic";
import { useT } from "../lib/useT";
import { ENABLE_STATUSES, TOOL_APPROVALS, type ToolTrust } from "../types";
import { Empty, ErrorPanel, Notice, RiskTag, Skeleton, Tag, TextList } from "./common";
import { FormDialog } from "./FormDialog";

function ToolEditDialog({ tool, onClose }: { tool: ToolTrust; onClose: () => void }) {
  const { tt, label } = useT();
  const [approval, setApproval] = useState(tool.approval);
  const [status, setStatus] = useState(tool.status);
  const [agents, setAgents] = useState(tool.allowedAgents.join(", "));
  return (
    <FormDialog
      title={tt("tools.editTitle", { tool: tool.name })}
      submitLabel={tt("common.save")}
      command="security_set_tool_trust"
      getBody={() => ({ toolId: tool.toolId, approval, status, allowedAgents: splitList(agents) })}
      onClose={onClose}
    >
      <Select label={tt("tools.approval")} value={approval} onChange={(e) => setApproval(e.target.value)}>
        {[...new Set([...TOOL_APPROVALS as readonly string[], tool.approval])].map((a) => <option key={a} value={a}>{label("toolApproval", a)}</option>)}
      </Select>
      <Select label={tt("common.status")} value={status} onChange={(e) => setStatus(e.target.value)}>
        {[...new Set([...ENABLE_STATUSES as readonly string[], tool.status])].map((s) => <option key={s} value={s}>{label("enableStatus", s)}</option>)}
      </Select>
      <Input label={tt("tools.allowedAgents")} description={tt("tools.allowedAgentsHint")} value={agents} onChange={(e) => setAgents(e.target.value)} />
    </FormDialog>
  );
}

export function ToolsTab() {
  const { tt, label } = useT();
  const query = useTrustData();
  const admin = useCanAdminister();
  const [editing, setEditing] = useState<ToolTrust | null>(null);
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  const tools = query.data.tools;
  return (
    <section className="sc-panel" aria-labelledby="sc-tools-title">
      <h2 id="sc-tools-title" className="sc-panel__title">{tt("tools.title")}</h2>
      <p className="sc-muted">{tt("tools.explained")}</p>
      {!admin ? <Notice>{tt("tools.adminOnly")}</Notice> : null}
      {tools.length === 0 ? <Empty title={tt("tools.empty")} /> : (
        <div className="sc-table-wrap">
          <table className="sc-table">
            <caption className="sc-visually-hidden">{tt("tools.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{tt("tools.tool")}</th>
                <th scope="col">{tt("tools.risk")}</th>
                <th scope="col">{tt("tools.approval")}</th>
                <th scope="col">{tt("tools.environments")}</th>
                <th scope="col">{tt("tools.allowedAgents")}</th>
                <th scope="col">{tt("common.status")}</th>
                {admin ? <th scope="col">{tt("common.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.id} data-tool={tool.toolId}>
                  <th scope="row" className="sc-cell-wrap">{tool.name}<br /><span className="sc-muted">{tool.toolId}</span></th>
                  <td><RiskTag value={tool.risk} /></td>
                  <td>{label("toolApproval", tool.approval)}</td>
                  <td className="sc-cell-wrap"><TextList items={tool.environments} /></td>
                  <td className="sc-cell-wrap"><TextList items={tool.allowedAgents} /></td>
                  <td><Tag tone={tool.status === "ENABLED" ? "success" : "neutral"}>{label("enableStatus", tool.status)}</Tag></td>
                  {admin ? <td><Button type="button" size="small" onClick={() => setEditing(tool)}>{tt("common.edit")} <span className="sc-visually-hidden">{tool.name}</span></Button></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <ToolEditDialog tool={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
