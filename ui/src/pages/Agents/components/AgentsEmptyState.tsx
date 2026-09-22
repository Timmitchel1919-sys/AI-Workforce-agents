import { EmptyState } from "../../../components/ui";

export interface AgentsEmptyStateProps {
  reason?: "empty" | "filters";
  onClearFilters?: () => void;
}

export function AgentsEmptyState({ reason = "empty", onClearFilters }: AgentsEmptyStateProps) {
  const isFilteredState = reason === "filters";

  return (
    <EmptyState
      title={isFilteredState ? "No agents match your filters" : "No agents found"}
      description={
        isFilteredState
          ? "Try clearing the current filters or broadening the search criteria to restore the registry view."
          : "There are currently no agents registered in this workforce."
      }
      primaryAction={
        onClearFilters ? (
          <button type="button" onClick={onClearFilters} className="agents-empty-state__button">
            Clear filters
          </button>
        ) : undefined
      }
    />
  );
}

export default AgentsEmptyState;
