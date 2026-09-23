import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../../../components/ui';
import { useI18n } from '../../../i18n';

export function OverviewEmptyState() {
  const { t } = useI18n();
  return (
    <EmptyState
      title={t('overview.emptyTitle')}
      description={t('overview.emptyDescription')}
      primaryAction={
        <Link to="/agents">
          <Button type="button" variant="primary">
            {t('overview.emptyAction')}
          </Button>
        </Link>
      }
    />
  );
}

export default OverviewEmptyState;
