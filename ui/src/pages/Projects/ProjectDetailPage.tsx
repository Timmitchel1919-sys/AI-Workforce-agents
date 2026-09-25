import { NavLink, useLocation, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../auth/useAuth";
import { useProject, type ProjectDetail } from "../../features/executionPlans";
import { useI18n } from "../../i18n";
import { ExecutionPlanTab } from "./plan/ExecutionPlanTab";
import { OperationsTab } from "./operations/OperationsTab";
import { SessionDetail } from "./operations/SessionDetail";
import "./ExecutionPlan.css";

/**
 * Projects → Project Detail. Tabs are real routes, so a plan view (and a
 * historical revision) and every execution session (Operations) is linkable. The Execution Plan tab is shown to users
 * whose role may view planning data — UX only; the Control Plane decides.
 */
export default function ProjectDetailPage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId?: string }>();
  const pathname = useLocation().pathname;
  const tab = pathname.endsWith("/execution-plan")
    ? "execution-plan"
    : pathname.includes("/operations")
      ? "operations"
      : "overview";
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const { status, project, refetch } = useProject(projectId);
  const canViewPlans = accessDetails.capabilities.includes("view");
  const base = `/projects/${encodeURIComponent(projectId ?? "")}`;

  let body;
  if (status === "loading") {
    body = (
      <div className="plan-detail" role="status" aria-label={t("plans.projectLoading")}>
        <Skeleton height={96} width="100%" />
      </div>
    );
  } else if (status === "unauthenticated" || status === "forbidden") {
    body = (
      <ErrorState
        icon={<Lock size={28} />}
        title={t(status === "forbidden" ? "plans.forbiddenTitle" : "plans.unauthenticatedTitle")}
        description={t(status === "forbidden" ? "plans.forbiddenDescription" : "plans.unauthenticatedDescription")}
      />
    );
  } else if (status !== "ready" || !project) {
    body =
      status === "not_found" ? (
        <ErrorState title={t("plans.projectNotFoundTitle")} description={t("plans.projectNotFoundDescription", { id: projectId ?? "" })} />
      ) : (
        <ErrorState title={t("plans.errorTitle")} description={t("plans.errorDescription")} onRetry={() => void refetch()} retryLabel={t("common.retry")} />
      );
  } else {
    body = (
      <>
        <nav className="plan-tabs" aria-label={t("plans.projectTabs")}>
          <NavLink to={base} end className="plan-tab">
            {t("plans.tabOverview")}
          </NavLink>
          {canViewPlans ? (
            <NavLink to={`${base}/execution-plan`} className="plan-tab">
              {t("plans.tabPlan")}
            </NavLink>
          ) : null}
          {canViewPlans ? (
            <NavLink to={`${base}/operations`} className="plan-tab">
              {t("operations.tab")}
            </NavLink>
          ) : null}
        </nav>
        {tab === "execution-plan" && canViewPlans ? (
          <ExecutionPlanTab projectId={project.projectId} projectName={project.displayName} />
        ) : tab === "operations" && canViewPlans ? (
          sessionId ? (
            <SessionDetail projectId={project.projectId} sessionId={sessionId} />
          ) : (
            <OperationsTab projectId={project.projectId} />
          )
        ) : (
          <ProjectOverview project={project} />
        )}
      </>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("plans.projectsTitle")}
        title={project?.displayName ?? projectId ?? ""}
        description={tab === "execution-plan" ? t("plans.description") : undefined}
      />
      {body}
    </PageContainer>
  );
}

function ProjectOverview({ project }: { project: ProjectDetail }) {
  const { t } = useI18n();
  return (
    <section className="plan-section" aria-labelledby="project-overview-title">
      <h3 id="project-overview-title">{t("plans.tabOverview")}</h3>
      <dl className="plan-metrics">
        <div className="plan-metric">
          <dt>{t("plans.projectStatus")}</dt>
          <dd>{project.status}</dd>
        </div>
        <div className="plan-metric">
          <dt>{t("plans.adapterStatus")}</dt>
          <dd>{project.adapterStatus}</dd>
        </div>
        <div className="plan-metric">
          <dt>{t("plans.connectedAgents")}</dt>
          <dd>{project.connectedAgents.length}</dd>
        </div>
        <div className="plan-metric">
          <dt>{t("plans.activeWorkflows")}</dt>
          <dd>{project.activeWorkflows}</dd>
        </div>
      </dl>
      <h4>{t("plans.projectCapabilities")}</h4>
      {project.capabilities.length === 0 ? (
        <p className="plan-muted">{t("plans.noCapabilities")}</p>
      ) : (
        <ul className="plan-rows">
          {project.capabilities.map((c) => (
            <li key={c.operation} className="plan-row">
              <code>{c.operation}</code>
              <span className="plan-muted">{c.description}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
