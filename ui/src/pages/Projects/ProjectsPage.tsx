import { Link } from "react-router-dom";
import { ArrowRight, Lock } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useProjects } from "../../features/executionPlans";
import { useI18n } from "../../i18n";
import "./ExecutionPlan.css";

export default function ProjectsPage() {
  const { t } = useI18n();
  const { status, projects, refetch } = useProjects();

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("plans.projectsTitle")}
        description={t("plans.projectsDescription")}
      />

      {status === "loading" ? (
        <div className="plan-list" role="status" aria-label={t("plans.projectsLoading")}>
          <Skeleton height={64} width="100%" />
          <Skeleton height={64} width="100%" />
        </div>
      ) : null}

      {status === "empty" ? (
        <EmptyState
          title={t("plans.projectsEmptyTitle")}
          description={t("plans.projectsEmptyDescription")}
        />
      ) : null}

      {status === "unauthenticated" || status === "forbidden" ? (
        <ErrorState
          icon={<Lock size={28} />}
          title={t(status === "forbidden" ? "plans.forbiddenTitle" : "plans.unauthenticatedTitle")}
          description={t(
            status === "forbidden" ? "plans.forbiddenDescription" : "plans.unauthenticatedDescription",
          )}
        />
      ) : null}

      {status === "error" || status === "not_found" ? (
        <ErrorState
          title={t("plans.projectsErrorTitle")}
          description={t("plans.projectsErrorDescription")}
          onRetry={() => void refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {status === "ready" ? (
        <ul className="plan-list">
          {projects.map((project) => (
            <li key={project.projectId}>
              <Link
                className="plan-project-link"
                to={`/projects/${encodeURIComponent(project.projectId)}/execution-plan`}
              >
                <span className="plan-project-link__name">{project.displayName}</span>
                <span className="plan-project-link__id">{project.projectId}</span>
                <span className="plan-project-link__cta">
                  {t("plans.openPlan")}
                  <ArrowRight size={16} aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </PageContainer>
  );
}
