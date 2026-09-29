import { AnalyticsEvent } from './DomainModel.js';
export declare class DataQualityEngine {
    validate(event: AnalyticsEvent): boolean;
    checkLineage(event: AnalyticsEvent): boolean;
}
