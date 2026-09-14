import { EmptyState } from "../../../components/ui";
import { ListChecks } from "../../../components/ui/icons";

export function TasksEmptyState() {
  return (
    <EmptyState
      icon={ListChecks}
      title="No tasks found"
      detail="The workforce has not created any tasks yet. New tasks appear here when they enter the governed queue."
    />
  );
}
