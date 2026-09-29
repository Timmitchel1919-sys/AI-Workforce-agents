import { AnalyticsEvent } from './DomainModel.js';
export declare class AnalyticsIngestion {
    ingestEvent(event: AnalyticsEvent): Promise<boolean>;
    private normalizeEvent;
}
