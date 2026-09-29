import {
  type AuditEvent,
  type AuditSink,
  type DataReadinessAssessment,
  type DataReadinessRequest,
  type OperationalEvent,
  type OperationalOutcome,
  type Repository,
  ValidationError,
  validateOperationalEvent,
  validateOperationalOutcome,
} from "../../contracts/index.js";

export interface OperationalDataSystemDeps {
  events: Repository<OperationalEvent>;
  outcomes: Repository<OperationalOutcome>;
  clock?: () => string;
}

/**
 * Append-only operational facts and outcomes. The system deliberately does
 * not produce forecasts; consumers must first ask `assessReadiness`.
 */
export class OperationalDataSystem {
  private readonly clock: () => string;

  constructor(private readonly deps: OperationalDataSystemDeps) {
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  recordEvent(event: OperationalEvent): OperationalEvent {
    validateOperationalEvent(event);
    if (this.deps.events.findById(event.id)) {
      throw new ValidationError(`operational event ${event.id} is immutable`);
    }
    this.deps.events.upsert(event);
    return structuredClone(event);
  }

  recordOutcome(outcome: OperationalOutcome): OperationalOutcome {
    validateOperationalOutcome(outcome);
    if (this.deps.outcomes.findById(outcome.id)) {
      throw new ValidationError(
        `operational outcome ${outcome.id} is immutable`,
      );
    }
    this.deps.outcomes.upsert(outcome);
    return structuredClone(outcome);
  }

  eventsForProject(projectId: string): OperationalEvent[] {
    return this.deps.events
      .list()
      .filter((event) => event.projectId === projectId);
  }

  outcomesForProject(projectId: string): OperationalOutcome[] {
    return this.deps.outcomes
      .list()
      .filter((outcome) => outcome.projectId === projectId);
  }

  assessReadiness(request: DataReadinessRequest): DataReadinessAssessment {
    const assessedAt = request.now ?? this.clock();
    const policy = request.policy;
    const events = this.eventsForProject(request.projectId);
    const outcomes = this.outcomesForProject(request.projectId).filter(
      (outcome) => outcome.domain === request.domain,
    );
    const reasons: string[] = [];

    if (!policy) {
      return {
        projectId: request.projectId,
        domain: request.domain,
        status: "unknown",
        assessedAt,
        eventCount: events.length,
        outcomeCount: outcomes.length,
        reasons: ["no domain-specific readiness policy has been defined"],
      };
    }

    if (events.length === 0)
      reasons.push("no project-scoped operational events");
    if ((policy.requireOutcomes ?? true) && outcomes.length === 0) {
      reasons.push("no observed outcomes for this domain");
    }
    if (policy.minEvents !== undefined && events.length < policy.minEvents) {
      reasons.push(
        `event sample below policy minimum (${events.length}/${policy.minEvents})`,
      );
    }
    if (
      policy.minOutcomes !== undefined &&
      outcomes.length < policy.minOutcomes
    ) {
      reasons.push(
        `outcome sample below policy minimum (${outcomes.length}/${policy.minOutcomes})`,
      );
    }

    const times = [
      ...events.map((event) => Date.parse(event.observedAt)),
      ...outcomes.map((outcome) => Date.parse(outcome.occurredAt)),
    ];
    const earliest = times.length > 0 ? Math.min(...times) : undefined;
    const historyMs =
      earliest === undefined ? undefined : Date.parse(assessedAt) - earliest;
    if (
      policy.minHistoryMs !== undefined &&
      (historyMs === undefined || historyMs < policy.minHistoryMs)
    ) {
      reasons.push("history window below policy minimum");
    }

    const status =
      reasons.length === 0
        ? "ready"
        : events.length > 0 || outcomes.length > 0
          ? "limited"
          : "not_ready";
    return {
      projectId: request.projectId,
      domain: request.domain,
      status,
      assessedAt,
      eventCount: events.length,
      outcomeCount: outcomes.length,
      ...(historyMs === undefined ? {} : { historyMs }),
      reasons,
    };
  }
}

/**
 * Translates existing audit records into redacted operational observations.
 * Audit remains authoritative; this sink never turns an observation into a
 * prediction and ignores records without a project boundary.
 */
export class OperationalAuditSink implements AuditSink {
  constructor(private readonly data: OperationalDataSystem) {}

  write(event: AuditEvent): void {
    if (!event.projectId) return;
    const dimensions: Record<string, string | number | boolean> = {
      auditType: event.type,
    };
    if (event.taskId) dimensions.taskPresent = true;
    if (event.agentId) dimensions.agentPresent = true;
    this.data.recordEvent({
      id: `operation_${event.id}`,
      projectId: event.projectId,
      kind: "audit_observation",
      observedAt: event.timestamp,
      recordedAt: event.timestamp,
      provenance: { source: "workforce", sourceId: event.id },
      dimensions,
    });
  }
}
