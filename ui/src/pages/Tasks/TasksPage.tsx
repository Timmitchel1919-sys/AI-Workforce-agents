import { useMemo, useState } from "react";
import { translatePriority, translateStatus, useI18n } from "../../i18n";
import { Pagination } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { useTasks } from "../../features/tasks";
import { TaskRegistry } from "./components/TaskRegistry";
import { TaskFilters } from "./components/TaskFilters";
import { TaskEmptyState } from "./components/TaskEmptyState";
import { TaskErrorState } from "./components/TaskErrorState";
import { TaskLoadingState } from "./components/TaskLoadingState";
import "./TasksPage.css";

const PAGE_SIZE = 6;

const statusOptions = [
  "all",
  "running",
  "completed",
  "failed",
  "pending",
  "queued",
  "paused",
  "blocked",
  "cancelled",
] as const;

const priorityOptions = ["all", "low", "medium", "high", "critical", "urgent"] as const;

export default function TasksPage() {
  const { t } = useI18n();
  const { data, status, refetch } = useTasks();
  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const summary = useMemo(
    () =>
      data?.summary ?? {
        total: 0,
        running: 0,
        completed: 0,
        failed: 0,
        pending: 0,
      },
    [data],
  );

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [page, setPage] = useState(1);

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tasks.filter((task) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [task.title, task.description, task.agentName, task.projectName, task.type]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(normalizedQuery));

      const matchesStatus = statusFilter === "all" || task.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;

      return matchesQuery && matchesStatus && matchesPriority;
    });
  }, [tasks, query, statusFilter, priorityFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const pagedTasks = filteredTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (status === "loading") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("tasks.title")}
          description={t("tasks.description")}
        />
        <TaskLoadingState />
      </PageContainer>
    );
  }

  if (status === "error" || status === "unauthorized" || status === "degraded") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("tasks.title")}
          description={t("tasks.description")}
        />
        <TaskErrorState
          title={status === "unauthorized" ? t("tasks.unauthorizedTitle") : t("tasks.errorTitle")}
          description={
            status === "unauthorized"
              ? t("tasks.unauthorizedDescription")
              : t("tasks.errorDescription")
          }
          onRetry={refetch}
        />
      </PageContainer>
    );
  }

  if (status === "empty") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("tasks.title")}
          description={t("tasks.description")}
        />
        <TaskEmptyState />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("tasks.title")}
        description={t("tasks.description")}
      />

      <div className="tasks-page">
        <div className="tasks-summary" aria-label={t("tasks.summary")}>
          <div className="tasks-summary__metric">
            <span className="tasks-summary__label">{t("tasks.total")}</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="tasks-summary__metric">
            <span className="tasks-summary__label">{t("status.running")}</span>
            <strong>{summary.running}</strong>
          </div>
          <div className="tasks-summary__metric">
            <span className="tasks-summary__label">{t("status.completed")}</span>
            <strong>{summary.completed}</strong>
          </div>
          <div className="tasks-summary__metric">
            <span className="tasks-summary__label">{t("tasks.failedPending")}</span>
            <strong>{summary.failed + summary.pending}</strong>
          </div>
        </div>

        <PageSection>
          <TaskFilters
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
            priorityFilter={priorityFilter}
            onPriorityFilterChange={(value) => {
              setPriorityFilter(value);
              setPage(1);
            }}
            statusOptions={statusOptions}
            priorityOptions={priorityOptions}
            formatStatus={(value) => (value === "all" ? t("common.allStatuses") : translateStatus(t, value))}
            formatPriority={(value) => (value === "all" ? t("common.allPriorities") : translatePriority(t, value))}
          />
        </PageSection>

        <PageSection
          title={t("tasks.registry")}
          description={t("tasks.registryDescription")}
        >
          {filteredTasks.length === 0 ? (
            <TaskEmptyState
              reason="filters"
              onClearFilters={() => {
                setQuery("");
                setStatusFilter("all");
                setPriorityFilter("all");
                setPage(1);
              }}
            />
          ) : (
            <>
              <TaskRegistry tasks={pagedTasks} />
              {filteredTasks.length > PAGE_SIZE ? (
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

