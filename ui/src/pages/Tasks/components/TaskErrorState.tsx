import { ErrorState } from "../../../components/ui";
import { useI18n } from "../../../i18n";

export interface TaskErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function TaskErrorState({
  title,
  description,
  onRetry,
}: TaskErrorStateProps) {
  const { t } = useI18n();
  return (
    <ErrorState
      title={title ?? t("tasks.errorTitle")}
      description={description ?? t("tasks.errorDescription")}
      onRetry={onRetry}
      retryLabel={t("common.retry")}
    />
  );
}

export default TaskErrorState;

