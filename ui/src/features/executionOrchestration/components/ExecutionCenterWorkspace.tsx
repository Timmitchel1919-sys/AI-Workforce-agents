import { useParams } from "react-router-dom";
import { useCanOrchestrate, useRunList } from "../hooks/useOrchestration";
import { useT } from "../lib/useT";
import { Notice } from "./common";
import { PlanFromRequest } from "./PlanFromRequest";
import { RunDetail } from "./RunDetail";
import { RunList } from "./RunList";

/** `/execution-center` lists runs and plans new ones; `/execution-center/:runId` shows one run. */
export function ExecutionCenterWorkspace() {
  const { runId } = useParams();
  const { tt } = useT();
  const canControl = useCanOrchestrate();
  const list = useRunList();

  if (runId) {
    return (
      <div className="eo-workspace">
        <RunDetail key={runId} runId={runId} />
      </div>
    );
  }
  return (
    <div className="eo-workspace">
      {canControl ? <PlanFromRequest /> : <Notice title={tt("access.readOnlyTitle")}>{tt("access.readOnlyBody")}</Notice>}
      <RunList runs={list.runs} isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} />
    </div>
  );
}
