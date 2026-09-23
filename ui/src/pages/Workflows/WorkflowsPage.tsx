import { useMemo, useState } from "react";
import { EmptyState, ErrorState, Pagination, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { useWorkflows } from "../../features/workflows";
import { WorkflowFilters } from "./components/WorkflowFilters";
import { WorkflowRegistry } from "./components/WorkflowRegistry";
import { workflowDisplayStatus } from "./components/workflowStatus";
import { useI18n } from "../../i18n";
import "../Tasks/TasksPage.css";
import "./WorkflowsPage.css";

const PAGE_SIZE = 6;

const statusOptions = [
  "all",
  "running",
  "paused",
  "awaiting_approval",
  "blocked",
  "planned",
  "created",
  "completed",
  "failed",
  "cancelled",
] as const;

function WorkflowsHeader() {
  const { t } = useI18n();
  return (
    <PageHeader
      eyebrow={t("common.brand")}
      title={t("workflows.title")}
      description={t("workflows.description")}
    />
  );
}

export default function WorkflowsPage() {
  const { t } = useI18n();
  const { data, status, refetch } = useWorkflows();
  const workflows = useMemo(() => data?.items ?? [], [data]);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [page, setPage] = useState(1);

  const summary = useMemo(() => {
    const active = workflows.filter(
      (w) => !w.paused && (w.status === "running" || w.status === "awaiting_approval"),
    ).length;
    const attention = workflows.filter(
      (w) => w.paused || w.pendingApprovals > 0 || w.status === "blocked",
    ).length;
    const failed = workflows.filter((w) => w.status === "failed").length;
    return { total: data?.total ?? workflows.length, active, attention, failed };
  }, [workflows, data]);

  const projectOptions = useMemo(
    () => [...new Set(workflows.map((w) => w.projectId))].sort(),
    [workflows],
  );

  const filteredWorkflows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return workflows.filter((workflow) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [workflow.name, workflow.description, workflow.workflowId, ...workflow.participatingAgents]
          .some((val) => val.toLowerCase().includes(normalizedQuery));
      const matchesStatus =
        statusFilter === "all" || workflowDisplayStatus(workflow) === statusFilter;
      const matchesProject = projectFilter === "all" || workflow.projectId === projectFilter;

      return matchesQuery && matchesStatus && matchesProject;
    });
  }, [workflows, query, statusFilter, projectFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredWorkflows.length / PAGE_SIZE));
  const pagedWorkflows = filteredWorkflows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (status === "loading") {
    return (
      <PageContainer>
        <WorkflowsHeader />
        <div className="tasks-loading" role="status" aria-live="polite" aria-label={t("workflows.loading")}>
          <div className="tasks-loading__metrics">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="tasks-loading__metric">
                <Skeleton height={16} width="50%" />
                <Skeleton height={32} width="36%" />
              </div>
            ))}
          </div>
          <div className="tasks-loading__table">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="tasks-loading__row">
                <Skeleton height={20} width="30%" />
                <Skeleton height={20} width="14%" />
                <Skeleton height={20} width="18%" />
                <Skeleton height={20} width="14%" />
                <Skeleton height={20} width="10%" />
              </div>
            ))}
          </div>
        </div>
      </PageContainer>
    );
  }

  if (status === "error" || status === "unauthorized" || status === "degraded") {
    return (
      <PageContainer>
        <WorkflowsHeader />
        <ErrorState
          title={status === "unauthorized" ? t("workflows.unauthorizedTitle") : t("workflows.errorTitle")}
          description={
            status === "unauthorized"
              ? t("workflows.unauthorizedDescription")
              : t("workflows.errorDescription")
          }
          onRetry={refetch}
          retryLabel={t("common.retry")}
        />
      </PageContainer>
    );
  }

  if (status === "empty") {
    return (
      <PageContainer>
        <WorkflowsHeader />
        <EmptyState
          title={t("workflows.emptyTitle")}
          description={t("workflows.emptyDescription")}
        />
      </PageContainer>
    );
  }

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setProjectFilter("all");
    setPage(1);
  };

  return (
    <PageContainer>
      <WorkflowsHeader />

      <div className="tasks-page">
        <div className="tasks-summary" aria-label={t("workflows.summary")}>
          <div className="tasks-summary__metric">
            <span className="tasks-summary__label">{t("workflows.total")}</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="tasks-summary__metric">
            <span className="tasks-summary__label">{t("workflows.active")}</span>
            <strong>{summary.active}</strong>
          </div>
          <div className="tasks-summary__metric">
            <span className="tasks-summary__label">{t("workflows.attention")}</span>
            <strong>{summary.attention}</strong>
          </div>
          <div className="tasks-summary__metric">
            <span className="tasks-summary__label">{t("workflows.failed")}</span>
            <strong>{summary.failed}</strong>
          </div>
        </div>

        <PageSection>
          <WorkflowFilters
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            statusFilter={statusFilter}
            onStatusFilterChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            projectFilter={projectFilter}
            onProjectFilterChange={(value) => {
              setProjectFilter(value);
              setPage(1);
            }}
            statusOptions={statusOptions}
            projectOptions={projectOptions}
          />
        </PageSection>

        <PageSection
          title={t("workflows.registry")}
          description={t("workflows.registryDescription")}
        >
          {filteredWorkflows.length === 0 ? (
            <EmptyState
              title={t("workflows.emptyFilteredTitle")}
              description={t("workflows.emptyFilteredDescription")}
              primaryAction={
                <button type="button" onClick={clearFilters} className="ui-button primary">
                  {t("common.clearFilters")}
                </button>
              }
            />
          ) : (
            <>
              <WorkflowRegistry workflows={pagedWorkflows} />
              {filteredWorkflows.length > PAGE_SIZE ? (
                <div className="tasks-pagination" style={{ marginTop: "1.5rem" }}>
                  <Pagination current={page} total={totalPages} onChange={setPage} />
                </div>
              ) : null}
            </>
          )}
        </PageSection>
      </div>
    </PageContainer>
  );
}
