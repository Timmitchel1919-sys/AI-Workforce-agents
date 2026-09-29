export interface AnalyticsEvent {
  eventId: string;
  timestamp: string;
  source: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface DataDomain {
  id: string;
  name: string;
  description: string;
}

export interface Metric {
  id: string;
  name: string;
  value: number;
  timestamp: string;
}

export const AnalyticsDomains = {
  PROJECT: 'project',
  WORKFORCE: 'workforce',
  EXECUTION: 'execution',
  QUALITY: 'quality',
  COST: 'cost',
  RELIABILITY: 'reliability',
  SECURITY: 'security'
};
