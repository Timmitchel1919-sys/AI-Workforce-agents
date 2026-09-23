import { Table } from "../../../components/ui";
import { useI18n } from "../../../i18n";
import type { WorkflowView } from "../../../features/workflows";
import { WorkflowRow } from "./WorkflowRow";

export function WorkflowRegistry({ workflows }: { workflows: readonly WorkflowView[] }) {
  const { t } = useI18n();
  return (
    <div className="workflows-registry">
      <Table caption={t("workflows.registry")}>
        <thead>
          <tr>
            <th scope="col">{t("workflows.colWorkflow")}</th>
            <th scope="col">{t("common.status")}</th>
            <th scope="col">{t("workflows.colProgress")}</th>
            <th scope="col">{t("workflows.colAgents")}</th>
            <th scope="col">{t("common.project")}</th>
            <th scope="col">{t("common.updated")}</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((workflow) => (
            <WorkflowRow key={workflow.workflowId} workflow={workflow} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default WorkflowRegistry;
