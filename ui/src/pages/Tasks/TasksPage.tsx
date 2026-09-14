import { useMemo } from "react";
import { PageFrame, Section, Stack } from "../../components/layout";
import { Button } from "../../components/ui";
import { RefreshCw } from "../../components/ui/icons";
import { useTasks } from "../../features/tasks";
import { formatRelativeTime } from "../../lib/time";
import { TaskRegistry } from "./components/TaskRegistry";
import { TasksEmptyState } from "./components/TasksEmptyState";
import { TasksErrorState } from "./components/TasksErrorState";
import { TasksLoadingState } from "./components/TasksLoadingState";
import { TasksSummary } from "./components/TasksSummary";
import { summarizeTasks } from "./tasksView";
import "./tasks.css";

/** Read-only task operations overview. Commands and detail arrive later. */
export function TasksPage() {
  const query = useTasks();
  const { data, isPending, isError, error, isFetching, dataUpdatedAt } = query;
  const tasks = useMemo(() => data?.items ?? [], [data]);
  const summary = useMemo(
    () => summarizeTasks(tasks, data?.total ?? tasks.length),
    [data?.total, tasks],
  );

  const lastUpdated = dataUpdatedAt
    ? formatRelativeTime(new Date(dataUpdatedAt).toISOString())
    : null;

  const refreshAction = (
    <div className="ui-inline" style={{ gap: "var(--space-sm)" }}>
      {lastUpdated && !isPending ? (
        <span className="text-caption" aria-live="polite">
          {isFetching ? "Refreshing…" : `Updated ${lastUpdated}`}
        </span>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        iconLeft={RefreshCw}
        onClick={() => void query.refetch()}
        loading={isFetching}
        disabled={isPending}
      >
        Refresh
      </Button>
    </div>
  );

  return (
    <PageFrame
      title="Tasks"
      description="Monitor the governed work queue and execution state across projects."
      actions={refreshAction}
    >
      {isPending ? (
        <TasksLoadingState />
      ) : isError ? (
        <TasksErrorState error={error} onRetry={() => void query.refetch()} />
      ) : tasks.length === 0 ? (
        <TasksEmptyState />
      ) : (
        <Stack gap="lg">
          <Section title="Queue summary">
            <TasksSummary summary={summary} />
          </Section>
          <Section title="Task registry">
            <TaskRegistry tasks={tasks} />
          </Section>
        </Stack>
      )}
    </PageFrame>
  );
}
