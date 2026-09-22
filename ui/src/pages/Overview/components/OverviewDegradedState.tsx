import { Alert } from '../../../components/ui';

export function OverviewDegradedState() {
  return (
    <Alert
      className="overview-state-banner"
      variant="warning"
      title="Workforce partially available"
      aria-live="polite"
    >
      Some operational data is temporarily unavailable. Available information may be incomplete.
    </Alert>
  );
}

export default OverviewDegradedState;
