export interface AnalyticsEvent {
    eventId: string;
    timestamp: string;
    source: string;
    eventType: string;
    payload: Record<string, any>;
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
export declare const AnalyticsDomains: {
    PROJECT: string;
    WORKFORCE: string;
    EXECUTION: string;
    QUALITY: string;
    COST: string;
    RELIABILITY: string;
    SECURITY: string;
};
