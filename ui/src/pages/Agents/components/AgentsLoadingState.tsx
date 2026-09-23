import { Skeleton } from "../../../components/ui";
import { useI18n } from "../../../i18n";

export function AgentsLoadingState() {
  const { t } = useI18n();
  return (
    <div className="agents-loading" role="status" aria-live="polite" aria-label={t("agents.loading")}>
      <div className="agents-loading__header">
        <Skeleton height={22} width="26%" />
        <Skeleton height={14} width="42%" />
      </div>

      <div className="agents-loading__metrics">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="agents-loading__metric">
            <Skeleton height={16} width="50%" />
            <Skeleton height={32} width="36%" />
          </div>
        ))}
      </div>

      <div className="agents-loading__toolbar">
        <Skeleton height={42} width="100%" />
        <div className="agents-loading__toolbar-filters">
          <Skeleton height={42} width="30%" />
          <Skeleton height={42} width="30%" />
          <Skeleton height={42} width="30%" />
        </div>
      </div>

      <div className="agents-loading__table">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="agents-loading__row">
            <Skeleton height={20} width="30%" />
            <Skeleton height={20} width="14%" />
            <Skeleton height={20} width="18%" />
            <Skeleton height={20} width="22%" />
            <Skeleton height={20} width="12%" />
            <Skeleton height={20} width="13%" />
            <Skeleton height={20} width="18%" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default AgentsLoadingState;
