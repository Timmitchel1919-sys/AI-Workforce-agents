export type OverviewMetricStatus = "positive" | "neutral" | "warning";
export type OverviewTrendDirection = "up" | "down" | "neutral";
export type OverviewActivityType = "agent" | "task" | "workflow" | "approval" | "system";
export type OverviewActivityStatus = "active" | "completed" | "running" | "pending" | "failed" | "paused";

export interface OverviewMetric {
  id: string;
  label: string;
  value: number;
  context: string;
  status: OverviewMetricStatus;
  trend: number;
  trendDirection: OverviewTrendDirection;
  linkTo?: string;
}

export interface OverviewSummaryCard {
  id: string;
  title: string;
  value: string;
  detail: string;
  status: OverviewActivityStatus;
  linkTo?: string;
}

export interface OverviewRecentActivityItem {
  id: string;
  type: OverviewActivityType;
  title: string;
  description: string;
  timestamp: string;
  status: OverviewActivityStatus;
  actor?: string;
  project?: string;
  linkTo?: string;
}

export interface OverviewSnapshot {
  metrics: OverviewMetric[];
  summaryCards: OverviewSummaryCard[];
  activity: OverviewRecentActivityItem[];
}

export interface OverviewError {
  code: "UNAUTHORIZED" | "DEGRADED" | "NETWORK" | "EMPTY" | "UNKNOWN";
  message: string;
  retryable: boolean;
}

export type OverviewApiPayload = Record<string, unknown> | null | undefined;
