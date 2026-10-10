export interface AnalyticsEvent {
    id: string;
    projectId: string;
    eventType: string;
    payload: Record<string, any>;
    timestamp: Date;
}
export interface OutcomeRecord {
    id: string;
    projectId: string;
    objectiveId: string;
    status: "SUCCESS" | "FAILURE" | "PARTIAL";
    metrics: Record<string, number>;
    recordedAt: Date;
}
export declare class AnalyticsTracker {
    private events;
    private outcomes;
    trackEvent(projectId: string, eventType: string, payload: Record<string, any>): AnalyticsEvent;
    recordOutcome(projectId: string, objectiveId: string, status: "SUCCESS" | "FAILURE" | "PARTIAL", metrics: Record<string, number>): OutcomeRecord;
    getEventsByProject(projectId: string): AnalyticsEvent[];
    getOutcomesByProject(projectId: string): OutcomeRecord[];
}
