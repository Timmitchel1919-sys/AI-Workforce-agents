import { Table } from "../../../components/ui";
import { useI18n } from "../../../i18n";
import type { AgentListItem } from "../../../features/agents";
import { AgentRow } from "./AgentRow";

export function AgentRegistry({ agents }: { agents: AgentListItem[] }) {
  const { t } = useI18n();
  return (
    <div className="agents-registry">
      <Table caption={t("agents.registry")}>
        <thead>
          <tr>
            <th scope="col">{t("agents.colAgent")}</th>
            <th scope="col">{t("common.status")}</th>
            <th scope="col">{t("agents.colModel")}</th>
            <th scope="col">{t("agents.colCapabilities")}</th>
            <th scope="col">{t("agents.colTasks")}</th>
            <th scope="col">{t("agents.colHealth")}</th>
            <th scope="col">{t("common.updated")}</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default AgentRegistry;
