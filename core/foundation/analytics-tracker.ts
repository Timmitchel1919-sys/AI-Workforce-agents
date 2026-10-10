import * as crypto from "crypto";

export interface AnalyticsEvent {
  id: string;
  projectId: string;
  eventType: string;
  payload: Record<string, unknown>;
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

export class AnalyticsTracker {
  private events = new Map<string, AnalyticsEvent[]>();
  private outcomes = new Map<string, OutcomeRecord[]>();

  trackEvent(
    projectId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): AnalyticsEvent {
    const event: AnalyticsEvent = {
      id: crypto.randomUUID(),
      projectId,
      eventType,
      payload,
      timestamp: new Date(),
    };

    if (!this.events.has(projectId)) {
      this.events.set(projectId, []);
    }
    this.events.get(projectId)!.push(event);

    return event;
  }

  recordOutcome(
    projectId: string,
    objectiveId: string,
    status: "SUCCESS" | "FAILURE" | "PARTIAL",
    metrics: Record<string, number>,
  ): OutcomeRecord {
    const outcome: OutcomeRecord = {
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
    this.outcomes.get(projectId)!.push(outcome);

    return outcome;
  }

  getEventsByProject(projectId: string): AnalyticsEvent[] {
    return this.events.get(projectId) || [];
  }

  getOutcomesByProject(projectId: string): OutcomeRecord[] {
    return this.outcomes.get(projectId) || [];
  }
}
