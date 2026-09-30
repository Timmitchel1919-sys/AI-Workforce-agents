import * as crypto from 'crypto';
export class AnalyticsTracker {
    events = new Map();
    outcomes = new Map();
    trackEvent(projectId, eventType, payload) {
        const event = {
            id: crypto.randomUUID(),
            projectId,
            eventType,
            payload,
            timestamp: new Date(),
        };
        if (!this.events.has(projectId)) {
            this.events.set(projectId, []);
        }
        this.events.get(projectId).push(event);
        return event;
    }
    recordOutcome(projectId, objectiveId, status, metrics) {
        const outcome = {
            id: crypto.randomUUID(),
            projectId,
            objectiveId,
            status,
            metrics,
            recordedAt: new Date(),
        };
        if (!this.outcomes.has(projectId)) {
            this.outcomes.set(projectId, []);
        }
        this.outcomes.get(projectId).push(outcome);
        return outcome;
    }
    getEventsByProject(projectId) {
        return this.events.get(projectId) || [];
    }
    getOutcomesByProject(projectId) {
        return this.outcomes.get(projectId) || [];
    }
}
