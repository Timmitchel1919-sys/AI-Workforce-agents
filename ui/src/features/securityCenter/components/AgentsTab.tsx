import { useState } from "react";
import { Button } from "../../../components/ui";
import { useCanManage, useTrustData } from "../hooks/useTrust";
import { useT } from "../lib/useT";
import type { AgentTrust, TrustState } from "../types";
import { CommandDialog } from "./CommandDialog";
import { Empty, ErrorPanel, Notice, RiskTag, Skeleton, Tag } from "./common";

type Target = "TRUSTED" | "LIMITED" | "REVIEW_REQUIRED" | "SUSPENDED";
const ACTIONS: { target: Target; key: string; reasonRequired: boolean; danger: boolean }[] = [
  { target: "SUSPENDED", key: "suspend", reasonRequired: true, danger: true },
  { target: "LIMITED", key: "limit", reasonRequired: false, danger: false },
  { target: "REVIEW_REQUIRED", key: "requireReview", reasonRequired: false, danger: false },
  { target: "TRUSTED", key: "restore", reasonRequired: false, danger: false },
];

export function TrustStateTag({ state }: { state: TrustState | string }) {
  const { label } = useT();
  const tone = state === "TRUSTED" ? "success" : state === "LIMITED" || state === "REVIEW_REQUIRED" ? "warning" : state === "SUSPENDED" ? "danger" : "neutral";
  return <Tag tone={tone}>{label("trustState", state)}</Tag>;
}

export function AgentsTab() {
  const { tt, formatTime } = useT();
  const query = useTrustData();
  const canManage = useCanManage();
  const [pending, setPending] = useState<{ agent: AgentTrust; action: (typeof ACTIONS)[number] } | null>(null);
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  const agents = query.data.agents;
  return (
    <section className="sc-panel" aria-labelledby="sc-agents-title">
      <h2 id="sc-agents-title" className="sc-panel__title">{tt("agents.title")}</h2>
      <p className="sc-muted">{tt("agents.explained")}</p>
      {!canManage ? <Notice>{tt("common.readOnly")}</Notice> : null}
      {agents.length === 0 ? <Empty title={tt("agents.empty")} /> : (
        <div className="sc-table-wrap">
          <table className="sc-table">
            <caption className="sc-visually-hidden">{tt("agents.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{tt("agents.agent")}</th>
                <th scope="col">{tt("agents.state")}</th>
                <th scope="col">{tt("agents.risk")}</th>
                <th scope="col">{tt("agents.reason")}</th>
                <th scope="col">{tt("agents.updated")}</th>
                <th scope="col">{tt("agents.history")}</th>
                {canManage ? <th scope="col">{tt("common.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} data-agent={agent.agentId}>
                  <th scope="row" className="sc-cell-wrap">{agent.agentId}</th>
                  <td><TrustStateTag state={agent.state} /></td>
                  <td><RiskTag value={agent.riskLevel} /></td>
                  <td className="sc-cell-wrap">{agent.reason ?? <span className="sc-muted">{tt("common.none")}</span>}</td>
                  <td>{formatTime(agent.updatedAt)}<br /><span className="sc-muted">{agent.updatedBy}</span></td>
                  <td className="sc-cell-wrap">
                    <details>
                      <summary>{tt("agents.historyCount", { count: agent.history.length })}</summary>
                      <ol className="sc-list">
                        {agent.history.map((h, i) => (
                          <li key={`${h.at}-${i}`}>
                            <TrustStateTag state={h.state} /> <span className="sc-muted">{formatTime(h.at)} · {h.by}</span>
                            {h.reason ? <span className="sc-text"> {h.reason}</span> : null}
                          </li>
                        ))}
                      </ol>
                    </details>
                  </td>
                  {canManage ? (
                    <td>
                      {agent.state === "DISABLED" ? (
                        <span className="sc-muted">{tt("agents.disabledReadOnly")}</span>
                      ) : (
                        <div className="sc-actions">
                          {ACTIONS.filter((a) => a.target !== agent.state).map((action) => (
                            <Button key={action.target} type="button" size="small" variant={action.danger ? "danger" : "secondary"} onClick={() => setPending({ agent, action })}>
                              {tt(`agents.action.${action.key}`)} <span className="sc-visually-hidden">{agent.agentId}</span>
                            </Button>
                          ))}
                        </div>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pending ? (
        <CommandDialog
          title={`${tt(`agents.action.${pending.action.key}`)}: ${pending.agent.agentId}`}
          description={pending.action.target === "TRUSTED" ? tt("agents.restoreBody") : tt("agents.setBody", { state: tt(`trustState.${pending.action.target}`) })}
          confirmLabel={tt(`agents.action.${pending.action.key}`)}
          command="security_set_agent_trust"
          buildBody={(note) => ({ agentId: pending.agent.agentId, state: pending.action.target, ...(note ? { reason: note } : {}) })}
          danger={pending.action.danger}
          noteLabel={pending.action.reasonRequired ? tt("agents.reasonRequired") : tt("agents.reasonOptional")}
          noteRequired={pending.action.reasonRequired}
          onClose={() => setPending(null)}
        />
      ) : null}
    </section>
  );
}
