import { UnauthorizedState } from '../../../components/states';
import { useI18n } from "../../../i18n";

export function OverviewUnauthorizedState() {
  const { t } = useI18n();
  return (
    <UnauthorizedState
      title={t("overview.unauthorizedTitle")}
      description={t("overview.unauthorizedDescription")}
    />
  );
}

export default OverviewUnauthorizedState;
