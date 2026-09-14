import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { TaskView } from "../../../api/contracts";
import { Stack } from "../../../components/layout";
import {
  Badge,
  DataTable,
  Identifier,
  StatusBadge,
  Timestamp,
  type Column,
} from "../../../components/ui";
import { useBreakpointUp } from "../../../theme/breakpoints";
import { priorityTone, sortTasksByUpdated } from "../tasksView";
import { TaskCard } from "./TaskCard";

export function TaskRegistry({ tasks }: { tasks: readonly TaskView[] }) {
  const navigate = useNavigate();
  const asTable = useBreakpointUp("sm");
  const wide = useBreakpointUp("lg");
  const rows = useMemo(() => sortTasksByUpdated(tasks), [tasks]);

  const columns = useMemo<Column<TaskView>[]>(() => {
    const base: Column<TaskView>[] = [
      {
        id: "task",
        header: "Task",
        cell: (task) => (
          <span className="task-row__identity">
            <Link
              to={`/tasks/${encodeURIComponent(task.taskId)}`}
              className="link task-row__description"
              onClick={(event) => event.stopPropagation()}
            >
              {task.description}
            </Link>
            <Identifier value={task.taskId} truncate copyable={false} />
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: (task) => <StatusBadge status={task.status} />,
      },
      {
        id: "priority",
        header: "Priority",
        cell: (task) => (
          <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
        ),
      },
      { id: "project", header: "Project", cell: (task) => task.projectId },
      {
        id: "agent",
        header: "Agent",
        cell: (task) => task.assignedAgentId ?? "Unassigned",
      },
      {
        id: "updated",
        header: "Updated",
        cell: (task) => <Timestamp value={task.updatedAt} relative />,
      },
    ];
    return wide
      ? base
      : base.filter((column) =>
          ["task", "status", "priority", "updated"].includes(column.id),
        );
  }, [wide]);

  if (!asTable) {
    return (
      <Stack gap="md" aria-label="Task registry">
        {rows.map((task) => (
          <TaskCard key={task.taskId} task={task} />
        ))}
      </Stack>
    );
  }

  return (
    <DataTable
      caption="Task registry"
      columns={columns}
      rows={rows}
      rowKey={(task) => task.taskId}
      onRowClick={(task) =>
        navigate(`/tasks/${encodeURIComponent(task.taskId)}`)
      }
    />
  );
}
