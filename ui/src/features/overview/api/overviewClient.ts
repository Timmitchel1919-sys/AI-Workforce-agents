import { ApiError } from '../../../api/errors';
import { apiRequest } from '../../../api/client';
import { getDevelopmentOverviewFallback } from './overviewDevelopmentAdapter';
import type {
  OverviewApiPayload,
  OverviewMetric,
  OverviewRecentActivityItem,
  OverviewSnapshot,
  OverviewSummaryCard,
} from './overviewTypes';

const OVERVIEW_PATH = import.meta.env.VITE_OVERVIEW_PATH;

export class OverviewClientError extends Error {
  readonly code: 'UNAUTHORIZED' | 'DEGRADED' | 'NETWORK' | 'EMPTY' | 'UNKNOWN';
  readonly retryable: boolean;

  constructor(
    code: 'UNAUTHORIZED' | 'DEGRADED' | 'NETWORK' | 'EMPTY' | 'UNKNOWN',
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = 'OverviewClientError';
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeMetric(value: unknown): OverviewMetric | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id : 'metric';
  const label = typeof value.label === 'string' ? value.label : 'Metric';
  const valueNumber = typeof value.value === 'number' ? value.value : Number(value.value ?? 0);
  const context = typeof value.context === 'string' ? value.context : '';
  const status = value.status === 'positive' || value.status === 'warning' ? value.status : 'neutral';
  const trend = typeof value.trend === 'number' ? value.trend : 0;
  const trendDirection = value.trendDirection === 'down' ? 'down' : value.trendDirection === 'up' ? 'up' : 'neutral';
  const linkTo = typeof value.linkTo === 'string' ? value.linkTo : undefined;

  return {
    id,
    label,
    value: Number.isFinite(valueNumber) ? valueNumber : 0,
    context,
    status,
    trend,
    trendDirection,
    linkTo,
  };
}

function normalizeSummaryCard(value: unknown): OverviewSummaryCard | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id : 'summary';
  const title = typeof value.title === 'string' ? value.title : 'Summary';
  const metricValue = typeof value.value === 'string' ? value.value : String(value.value ?? '');
  const detail = typeof value.detail === 'string' ? value.detail : '';
  const status = value.status === 'running' || value.status === 'pending' || value.status === 'failed' || value.status === 'paused' || value.status === 'completed' ? value.status : 'active';
  const linkTo = typeof value.linkTo === 'string' ? value.linkTo : undefined;

  return {
    id,
    title,
    value: metricValue,
    detail,
    status,
    linkTo,
  };
}

function normalizeActivity(value: unknown): OverviewRecentActivityItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id : 'activity';
  const type = value.type === 'agent' || value.type === 'task' || value.type === 'workflow' || value.type === 'approval' ? value.type : 'system';
  const title = typeof value.title === 'string' ? value.title : 'Activity';
  const description = typeof value.description === 'string' ? value.description : '';
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : 'Recent';
  const status = value.status === 'running' || value.status === 'pending' || value.status === 'failed' || value.status === 'paused' || value.status === 'completed' ? value.status : 'active';
  const actor = typeof value.actor === 'string' ? value.actor : undefined;
  const project = typeof value.project === 'string' ? value.project : undefined;
  const linkTo = typeof value.linkTo === 'string' ? value.linkTo : undefined;

  return {
    id,
    type,
    title,
    description,
    timestamp,
    status,
    actor,
    project,
    linkTo,
  };
}

function parseOverviewPayload(payload: OverviewApiPayload): OverviewSnapshot | null {
  if (!payload) {
    return null;
  }

  const candidate = isRecord(payload.data) ? payload.data : payload;
  const metrics = Array.isArray(candidate.metrics)
    ? candidate.metrics.map((metric) => normalizeMetric(metric)).filter((metric): metric is OverviewMetric => metric !== null)
    : [];
  const summaryCards = Array.isArray(candidate.summaryCards)
    ? candidate.summaryCards.map((item) => normalizeSummaryCard(item)).filter((item): item is OverviewSummaryCard => item !== null)
    : [];
  const activity = Array.isArray(candidate.activity)
    ? candidate.activity.map((item) => normalizeActivity(item)).filter((item): item is OverviewRecentActivityItem => item !== null)
    : [];

  if (metrics.length === 0 && summaryCards.length === 0 && activity.length === 0) {
    return null;
  }

  return {
    metrics,
    summaryCards,
    activity,
  };
}

export async function getOverviewSnapshot(accessToken?: string | null): Promise<OverviewSnapshot> {
  if (!OVERVIEW_PATH) {
    if (import.meta.env.DEV) {
      return getDevelopmentOverviewFallback();
    }

    throw new OverviewClientError(
      'NETWORK',
      'The Overview Control Plane route is not configured.',
      true,
    );
  }

  try {
    const payload = await apiRequest<OverviewApiPayload>(OVERVIEW_PATH, {
      method: 'GET',
      accessToken,
    });

    const normalized = parseOverviewPayload(payload);
    if (normalized) {
      return normalized;
    }

    if (import.meta.env.DEV) {
      return getDevelopmentOverviewFallback();
    }

    throw new OverviewClientError('EMPTY', 'No workforce overview data is available.', false);
  } catch (error) {
    if (error instanceof OverviewClientError) {
      throw error;
    }

    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        throw new OverviewClientError('UNAUTHORIZED', 'You do not have permission to view workforce operational data.', false);
      }

      if (error.status === 404) {
        if (import.meta.env.DEV) {
          return getDevelopmentOverviewFallback();
        }

        throw new OverviewClientError('NETWORK', 'The Overview Control Plane resource is not available.', true);
      }

      if (error.status === 503 || error.status === 502 || error.status === 500) {
        throw new OverviewClientError('DEGRADED', 'Some operational data is temporarily unavailable. Available information may be incomplete.', true);
      }

      throw new OverviewClientError('NETWORK', 'The Control Plane could not retrieve the latest workforce data.', true);
    }

    throw new OverviewClientError('NETWORK', 'Unable to communicate with the Control Plane API.', true);
  }
}
