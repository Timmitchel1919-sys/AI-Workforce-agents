import { Link } from "react-router-dom";
import type { TaskView } from "../../../api/contracts";
import {
  Badge,
  Card,
  CardBody,
  KeyValue,
  StatusBadge,
  Timestamp,
} from "../../../components/ui";
import { priorityTone } from "../tasksView";

export function TaskCard({ task }: { task: TaskView }) {
  return (
    <Card>
      <CardBody>
        <div className="task-card__head">
          <Link
            to={`/tasks/${encodeURIComponent(task.taskId)}`}
            className="task-card__title link"
          >
            {task.description}
          </Link>
          <StatusBadge status={task.status} />
        </div>
        <KeyValue
          rows={[
            { key: "Type", value: task.type },
            { key: "Project", value: task.projectId },
            { key: "Agent", value: task.assignedAgentId ?? "Unassigned" },
            {
              key: "Priority",
              value: (
                <Badge tone={priorityTone(task.priority)}>
                  {task.priority}
                </Badge>
              ),
            },
            {
              key: "Updated",
              value: <Timestamp value={task.updatedAt} relative />,
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}
