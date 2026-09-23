import { Alert } from '../../../components/ui';
import { useI18n } from '../../../i18n';

export function OverviewDegradedState() {
  const { t } = useI18n();
  return (
    <Alert className="overview-state-banner" variant="warning" title={t('overview.degradedTitle')} aria-live="polite">
      {t('overview.degradedDescription')}
    </Alert>
  );
}

export default OverviewDegradedState;
