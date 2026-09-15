import { Button, EmptyState } from "../../../components/ui";
import { Workflow } from "../../../components/ui/icons";

export function WorkflowsEmptyState({
  filtered,
  onClearFilters,
}: {
  filtered: boolean;
  onClearFilters?: () => void;
}) {
  return (
    <EmptyState
      icon={Workflow}
      title={
        filtered ? "No workflows match these filters" : "No workflows found"
      }
      detail={
        filtered
          ? "Try changing the search, status, or project filter."
          : "Workflows appear here when the Control Plane has registered an orchestrated process."
      }
      action={
        filtered && onClearFilters ? (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}
