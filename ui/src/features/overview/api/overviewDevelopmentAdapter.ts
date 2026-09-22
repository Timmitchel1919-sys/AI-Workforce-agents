import {
  overviewMetrics as fallbackMetrics,
  overviewSummaryCards as fallbackSummaryCards,
  recentActivity as fallbackActivity,
} from '../../../pages/Overview/overviewData';
import type { OverviewSnapshot } from './overviewTypes';

/**
 * DEVELOPMENT FALLBACK ONLY.
 * This is not production data. It exists only to preserve local UI behavior until the
 * Control Plane exposes a real Overview contract.
 */
export function getDevelopmentOverviewFallback(): OverviewSnapshot {
  return {
    metrics: fallbackMetrics,
    summaryCards: fallbackSummaryCards,
    activity: fallbackActivity,
  };
}
