import type { OverviewState } from '../overviewState';
import { OverviewDegradedState } from './OverviewDegradedState';
import { OverviewEmptyState } from './OverviewEmptyState';
import { OverviewErrorState } from './OverviewErrorState';
import { OverviewLoadingState } from './OverviewLoadingState';
import { OverviewUnauthorizedState } from './OverviewUnauthorizedState';

export interface OverviewStateViewProps {
  state: OverviewState;
  onRetry?: () => void;
}

export function OverviewStateView({ state, onRetry }: OverviewStateViewProps) {
  switch (state) {
    case 'loading':
      return <OverviewLoadingState />;
    case 'empty':
      return <OverviewEmptyState />;
    case 'degraded':
      return <OverviewDegradedState />;
    case 'error':
      return <OverviewErrorState onRetry={onRetry} />;
    case 'unauthorized':
      return <OverviewUnauthorizedState />;
    case 'ready':
      return null;
    default:
      return null;
  }
}

export default OverviewStateView;
