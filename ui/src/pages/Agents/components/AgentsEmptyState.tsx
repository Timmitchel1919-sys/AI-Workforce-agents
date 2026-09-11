import { Button, EmptyState } from "../../../components/ui";
import { Bot } from "../../../components/ui/icons";

/**
 * Empty state for the Agents registry. Distinguishes "no agents are registered"
 * from "the current filters match nothing" — the two need different operator
 * action. There is no Create Agent route in the Control Center yet, so no
 * fabricated creation CTA is shown.
 */
export function AgentsEmptyState({
  filtered,
  onClearFilters,
}: {
  /** True when a filter/search is narrowing an otherwise non-empty registry. */
  filtered: boolean;
  onClearFilters?: () => void;
}) {
  if (filtered) {
    return (
      <EmptyState
        icon={Bot}
        title="No agents match these filters"
        detail="No registered agent matches the current search and filter selection."
        action={
          onClearFilters ? (
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <EmptyState
      icon={Bot}
      title="No agents found"
      detail="No agents are registered with the Control Plane yet. Agents appear here once the workforce registers them."
    />
  );
}
