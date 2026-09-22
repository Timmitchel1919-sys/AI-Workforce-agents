import { EmptyState } from "../../../components/ui";

export interface TaskEmptyStateProps {
  reason?: "empty" | "filters";
  onClearFilters?: () => void;
}

export function TaskEmptyState({ reason = "empty", onClearFilters }: TaskEmptyStateProps) {
  const isFilteredState = reason === "filters";

  return (
    <EmptyState
      title={isFilteredState ? "No tasks match your filters" : "No tasks found"}
      description={
        isFilteredState
          ? "Try clearing the current filters or broadening the search criteria to restore the task view."
          : "There are currently no tasks registered in this workforce."
      }
      primaryAction={
        onClearFilters ? (
          <button type="button" onClick={onClearFilters} className="ui-button primary">
            Clear filters
          </button>
        ) : undefined
      }
    />
  );
}

export default TaskEmptyState;

