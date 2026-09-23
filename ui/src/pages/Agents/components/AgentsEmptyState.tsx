import { EmptyState } from "../../../components/ui";
import { useI18n } from "../../../i18n";

export interface AgentsEmptyStateProps {
  reason?: "empty" | "filters";
  onClearFilters?: () => void;
}

export function AgentsEmptyState({ reason = "empty", onClearFilters }: AgentsEmptyStateProps) {
  const { t } = useI18n();
  const isFilteredState = reason === "filters";

  return (
    <EmptyState
      title={isFilteredState ? t("agents.emptyFilteredTitle") : t("agents.emptyTitle")}
      description={
        isFilteredState
          ? t("agents.emptyFilteredDescription")
          : t("agents.emptyDescription")
      }
      primaryAction={
        onClearFilters ? (
          <button type="button" onClick={onClearFilters} className="agents-empty-state__button">{t("common.clearFilters")}</button>
        ) : undefined
      }
    />
  );
}

export default AgentsEmptyState;
