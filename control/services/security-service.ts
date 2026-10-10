import type { Repository } from "../../contracts/persistence.js";
import {
  operatorCanAccessProject,
  type OperatorPrincipal,
} from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";
import type {
  ZTNSecurityEvent,
  ZeroTrustPolicy,
  ThreatIntelligenceReport,
} from "../../contracts/security.js";
import type {
  CanonicalSecurityEvent,
  SecurityEventQuery,
} from "../../contracts/security-event.js";
import type { SecurityEventStore } from "../../core/security/security-event-store.js";

export class SecurityControlService {
  constructor(
    private readonly events: Repository<ZTNSecurityEvent>,
    private readonly policies: Repository<ZeroTrustPolicy>,
    private readonly threatIntel: Repository<ThreatIntelligenceReport>,
    private readonly canonicalEvents?: SecurityEventStore,
  ) {}

  private enforceAdmin(operator: OperatorPrincipal) {
    if (operator.role !== "admin") {
      throw new ValidationError(
        "Unauthorized. Requires admin role for Security operations.",
      );
    }
  }

  async listEvents(operator: OperatorPrincipal): Promise<ZTNSecurityEvent[]> {
    this.enforceAdmin(operator);
    return this.events.list();
  }

  async logEvent(
    event: Omit<ZTNSecurityEvent, "id" | "eventId" | "status" | "createdAt">,
  ): Promise<ZTNSecurityEvent> {
    const newEvent: ZTNSecurityEvent = {
      ...event,
      id: `sec_evt_${Date.now()}`,
      eventId: `sec_evt_${Date.now()}`,
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };
    this.events.upsert(newEvent);
    return newEvent;
  }

  async listPolicies(operator: OperatorPrincipal): Promise<ZeroTrustPolicy[]> {
    this.enforceAdmin(operator);
    return this.policies.list();
  }

  async listCanonicalEvents(
    operator: OperatorPrincipal,
    query: SecurityEventQuery = {},
  ): Promise<CanonicalSecurityEvent[]> {
    this.enforceAdmin(operator);
    if (query.projectId && !operatorCanAccessProject(operator, query.projectId))
      return [];
    if (operator.allowedProjects !== "*" && !query.projectId) return [];
    return this.canonicalEvents?.query(query) ?? [];
  }
}
