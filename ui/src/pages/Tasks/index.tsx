import { PlaceholderPage } from "../PlaceholderPage";
import { QueryStatePanel } from "../_smoke/QueryStatePanel";
import { useTasks } from "../../features/tasks";

export function TasksPage() {
  const query = useTasks();
  return (
    <PlaceholderPage title="Tasks" description="Task queue with filters.">
      <QueryStatePanel
        label="GET /api/tasks"
        query={query}
        count={(d) => d.items.length}
      />
    </PlaceholderPage>
  );
}
