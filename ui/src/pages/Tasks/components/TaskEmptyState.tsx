import { EmptyState } from "../../../components/ui";
import { useI18n } from "../../../i18n";

export interface TaskEmptyStateProps {
  reason?: "empty" | "filters";
  onClearFilters?: () => void;
}

export function TaskEmptyState({ reason = "empty", onClearFilters }: TaskEmptyStateProps) {
  const { t } = useI18n();
  const isFilteredState = reason === "filters";

  return (
    <EmptyState
      title={isFilteredState ? t("tasks.emptyFilteredTitle") : t("tasks.emptyTitle")}
      description={
        isFilteredState
          ? t("tasks.emptyFilteredDescription")
          : t("tasks.emptyDescription")
      }
      primaryAction={
        onClearFilters ? (
          <button type="button" onClick={onClearFilters} className="ui-button primary">
            {t("common.clearFilters")}
          </button>
        ) : undefined
      }
    />
  );
}

export default TaskEmptyState;

