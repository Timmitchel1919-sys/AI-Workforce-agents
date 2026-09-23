import { Link } from "react-router-dom";
import { Card, StatusBadge } from "../../../components/ui";
import type { WorkflowStage } from "../../../features/workflows";
import { mapStageStatusToBadge } from "./workflowStatus";
import { translateStatus, useI18n } from "../../../i18n";

export interface WorkflowStagesProps {
  stages: readonly WorkflowStage[];
  currentSpecId?: string;
}

export function WorkflowStages({ stages, currentSpecId }: WorkflowStagesProps) {
  const { t } = useI18n();
  return (
    <Card className="workflow-stages-card">
      <div className="task-card-header">
        <h2>{t("workflows.stages")}</h2>
      </div>

      {stages.length === 0 ? (
        <p className="task-row__muted">{t("workflows.noStages")}</p>
      ) : (
        <ol className="workflow-stages">
          {stages.map((stage, index) => {
            const isCurrent = stage.specId === currentSpecId;
            return (
              <li
                key={stage.specId}
                className={[
                  "workflow-stage",
                  `workflow-stage--${stage.status}`,
                  isCurrent ? "workflow-stage--current" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span className="workflow-stage__index" aria-hidden>
                  {index + 1}
                </span>
                <div className="workflow-stage__body">
                  <div className="workflow-stage__header">
                    <span className="workflow-stage__id">{stage.specId}</span>
                    <StatusBadge status={mapStageStatusToBadge(stage.status)}>
                      {translateStatus(t, stage.status)}
                    </StatusBadge>
                    {isCurrent ? <span className="workflow-stage__current">{t("workflows.current")}</span> : null}
                  </div>
                  <p className="workflow-stage__description">{stage.description}</p>
                  <div className="workflow-stage__meta">
                    <span>{t("workflows.stageType", { type: stage.type })}</span>
                    <span>
                      {t("workflows.stageAgent")}{" "}
                      {stage.assignedAgentId ? (
                        <Link to={`/agents/${stage.assignedAgentId}`} className="task-row__agent-link">
                          {stage.assignedAgentId}
                        </Link>
                      ) : (
                        t("common.unassigned")
                      )}
                    </span>
                    {stage.retryCount > 0 ? <span>{t("workflows.retries", { count: stage.retryCount })}</span> : null}
                  </div>
                  {stage.error ? (
                    <p className="workflow-stage__error" role="alert">
                      {stage.error}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

export default WorkflowStages;
