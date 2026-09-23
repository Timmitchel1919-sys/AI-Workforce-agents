import { ErrorState } from '../../../components/states';
import { useI18n } from "../../../i18n";

export interface OverviewErrorStateProps {
  onRetry?: () => void;
}

export function OverviewErrorState({ onRetry }: OverviewErrorStateProps) {
  const { t } = useI18n();
  return (
    <ErrorState
      title={t("overview.errorTitle")}
      description={t("overview.errorDescription")}
      onRetry={onRetry}
      retryLabel={t("common.retry")}
    />
  );
}

export default OverviewErrorState;
