import { EmptyState } from "../../../components/ui";
import { useI18n } from "../../../i18n";

export interface AgentsEmptyStateProps {
  reason?: "empty" | "filters";
  onClearFilters?: () => void;
  /**
   * True when the roster is explicitly-labelled sample data. The empty state
   * then has to say so, because a sample roster that looks identical to a real
   * one is a false statement about the deployment.
   */
  sampleData?: boolean;
}

export function AgentsEmptyState({ reason = "empty", onClearFilters, sampleData = false }: AgentsEmptyStateProps) {
  const { t } = useI18n();
  const isFilteredState = reason === "filters";

  return (
    <EmptyState
      title={isFilteredState ? t("agents.emptyFilteredTitle") : t("agents.emptyTitle")}
      description={
        isFilteredState ? t("agents.emptyFilteredDescription") : t("agents.emptyDescription")
      }
      primaryAction={
        isFilteredState && onClearFilters ? (
          <button type="button" onClick={onClearFilters} className="agents-empty-state__button">
            {t("common.clearFilters")}
          </button>
        ) : undefined
      }
      secondaryMessage={sampleData ? `${t("agents.sampleDataNotice")}: ${t("agents.sampleDataDescription")}` : undefined}
    />
  );
}

export default AgentsEmptyState;
