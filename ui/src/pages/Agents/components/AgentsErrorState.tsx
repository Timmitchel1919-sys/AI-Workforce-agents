import { ErrorState } from "../../../components/ui";
import { useI18n } from "../../../i18n";

export interface AgentsErrorStateProps {
  onRetry?: () => void;
}

export function AgentsErrorState({ onRetry }: AgentsErrorStateProps) {
  const { t } = useI18n();
  return (
    <ErrorState
      title={t("agents.errorTitle")}
      description={t("agents.errorDescription")}
      onRetry={onRetry}
      retryLabel={t("common.retry")}
    />
  );
}

export default AgentsErrorState;
