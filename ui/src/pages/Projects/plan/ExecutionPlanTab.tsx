import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { History, Info, Lock, Plus } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "../../../components/ui";
import { useAuth } from "../../../auth/useAuth";
import { useAgentNames, usePlan, type PlanUiState } from "../../../features/executionPlans";
import { useI18n } from "../../../i18n";
import { CreatePlanDialog } from "./CreatePlanDialog";
import { PlanActions, type ActionNotice } from "./PlanActions";
import { PlanComparison, PlanHistory } from "./PlanHistory";
import { PlanPipeline, PlanSummary } from "./PlanOverview";
import {
  AgentSection,
  ApprovalSection,
  ArchitectureSection,
  BlockersPanel,
  BuildSection,
  DependencySection,
  DeploymentSection,
  EnvironmentSection,
  ModelSection,
  SecuritySection,
  TechnologySection,
  TestSection,
} from "./PlanSections";

function readSelection(params: URLSearchParams): { planId: string; version: number } | undefined {
  const planId = params.get("plan");
  const version = Number(params.get("version"));
  return planId && Number.isInteger(version) && version > 0 ? { planId, version } : undefined;
}

/**
 * Projects → Project Detail → Execution Plan. Shows the current plan (or a
 * historical revision via `?plan=&version=`), exactly as the Control Plane
 * returned it. Planning only — there is no execute or deploy control.
 */
export function ExecutionPlanTab({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const [params] = useSearchParams();
  const selection = readSelection(params);
  const { status, plan, refetch } = usePlan(projectId, selection);
  const names = useAgentNames();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const capabilities = accessDetails.capabilities;
  const base = `/projects/${encodeURIComponent(projectId)}/execution-plan`;

  if (status !== "ready" || !plan) {
    return (
      <PlanState
        status={status}
        projectId={projectId}
        canCreate={capabilities.includes("create_execution_plan") && !selection}
        onCreate={() => setCreating(true)}
        onRetry={() => void refetch()}
        creating={creating}
        onCloseCreate={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setNotice({ tone: "ok", text: t("plans.actionDone") });
        }}
        notice={notice}
      />
    );
  }

  const historical = !plan.current;

  return (
    <div className="plan-detail">
      <p className="plan-notice" role="note">
        <Info size={16} aria-hidden />
        {t("plans.executionUnavailable")}
      </p>

      {historical ? (
        <div className="plan-historical" role="status">
          <History size={18} aria-hidden />
          <span>
            {t("plans.historicalBanner", {
              version: plan.supersededBy ? Number(plan.supersededBy.split("@v")[1]) || "?" : "?",
            })}
          </span>
          <Link to={base} className="ui-button">
            {t("plans.viewCurrent")}
          </Link>
        </div>
      ) : null}

      {notice ? (
        <p className={`plan-notice plan-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      <PlanSummary plan={plan} projectName={projectName} />
      {!historical ? (
        <PlanActions plan={plan} projectName={projectName} capabilities={capabilities} onNotice={setNotice} />
      ) : null}
      <BlockersPanel plan={plan} />
      <PlanPipeline plan={plan} />

      <div className="plan-grid">
        <ArchitectureSection plan={plan} />
        <TechnologySection plan={plan} />
      </div>
      <EnvironmentSection plan={plan} />
      <AgentSection plan={plan} names={names} />
      <ModelSection plan={plan} />
      <div className="plan-grid">
        <DependencySection plan={plan} />
        <BuildSection plan={plan} />
        <TestSection plan={plan} />
        <SecuritySection plan={plan} />
        <DeploymentSection plan={plan} />
        <ApprovalSection plan={plan} />
      </div>
      {!historical ? <PlanComparison plan={plan} names={names} /> : null}
      <PlanHistory plan={plan} />
    </div>
  );
}

function PlanState({
  status,
  projectId,
  canCreate,
  onCreate,
  onRetry,
  creating,
  onCloseCreate,
  onCreated,
  notice,
}: {
  status: PlanUiState;
  projectId: string;
  canCreate: boolean;
  onCreate: () => void;
  onRetry: () => void;
  creating: boolean;
  onCloseCreate: () => void;
  onCreated: () => void;
  notice: ActionNotice | null;
}) {
  const { t } = useI18n();
  if (status === "loading") {
    return (
      <div className="plan-detail" role="status" aria-label={t("plans.loading")}>
        <Skeleton height={120} width="100%" />
        <Skeleton height={240} width="100%" />
      </div>
    );
  }
  if (status === "unauthenticated" || status === "forbidden") {
    return (
      <ErrorState
        icon={<Lock size={28} />}
        title={t(status === "forbidden" ? "plans.forbiddenTitle" : "plans.unauthenticatedTitle")}
        description={t(status === "forbidden" ? "plans.forbiddenDescription" : "plans.unauthenticatedDescription")}
      />
    );
  }
  if (status === "not_found") {
    return <ErrorState title={t("plans.notFoundTitle")} description={t("plans.notFoundDescription", { id: projectId })} />;
  }
  if (status === "conflict") {
    return (
      <ErrorState
        title={t("plans.conflictTitle")}
        description={t("plans.conflictDescription")}
        onRetry={onRetry}
        retryLabel={t("common.retry")}
      />
    );
  }
  if (status === "error") {
    return (
      <ErrorState title={t("plans.errorTitle")} description={t("plans.errorDescription")} onRetry={onRetry} retryLabel={t("common.retry")} />
    );
  }
  return (
    <>
      {notice ? (
        <p className={`plan-notice plan-notice--${notice.tone}`} role="status">
          {notice.text}
        </p>
      ) : null}
      <EmptyState
        title={t("plans.emptyTitle")}
        description={
          <>
            {t("plans.emptyDescription")}
            {canCreate ? (
              <>
                <br />
                {t("plans.createHint")}
              </>
            ) : null}
          </>
        }
        primaryAction={
          canCreate ? (
            <button type="button" className="ui-button primary" onClick={onCreate}>
              <Plus size={16} aria-hidden /> {t("plans.createPlan")}
            </button>
          ) : undefined
        }
      />
      {creating ? <CreatePlanDialog projectId={projectId} onClose={onCloseCreate} onCreated={onCreated} /> : null}
    </>
  );
}
