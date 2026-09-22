import { ErrorState } from '../../../components/states';

export interface OverviewErrorStateProps {
  onRetry?: () => void;
}

export function OverviewErrorState({ onRetry }: OverviewErrorStateProps) {
  return (
    <ErrorState
      title="Unable to load workforce overview"
      description="The Control Center could not retrieve the latest workforce data."
      onRetry={onRetry}
      retryLabel="Retry"
    />
  );
}

export default OverviewErrorState;
