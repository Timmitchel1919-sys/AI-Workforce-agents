import type { Repository } from "../../contracts/persistence.js";
import {
  operatorCan,
  operatorCanAccessProject,
  type ControlCapability,
  type OperatorPrincipal,
} from "../../contracts/control.js";
import { PermissionDeniedError } from "../../contracts/index.js";
import type {
  ZTNSecurityEvent,
  ZeroTrustPolicy,
  ThreatIntelligenceReport,
} from "../../contracts/security.js";
import type {
  CanonicalSecurityEvent,
  AsyncSecurityEventStore,
  SecurityEventQuery,
} from "../../contracts/security-event.js";
import type { SecurityEventStore } from "../../core/security/security-event-store.js";

export class SecurityControlService {
  constructor(
    private readonly events: Repository<ZTNSecurityEvent>,
    private readonly policies: Repository<ZeroTrustPolicy>,
    private readonly threatIntel: Repository<ThreatIntelligenceReport>,
    private readonly canonicalEvents?:
      SecurityEventStore | AsyncSecurityEventStore,
  ) {}

  /**
   * Deny-by-default authorization. Each security action maps to a specific
   * {@link ControlCapability}; the role → capability table lives in
   * `contracts/control.ts`. Unknown capabilities never silently pass.
   */
  private requireCapability(
    operator: OperatorPrincipal,
    capability: ControlCapability,
  ): void {
    if (!operatorCan(operator, capability)) {
      throw new PermissionDeniedError(
        `Operator '${operator.id}' lacks required capability '${capability}'`,
      );
    }
  }

  /**
   * Legacy ZTN event listing. Reading detailed event evidence is a security
   * capability (not an admin-role check): operators with `view_security_events`
   * may read, viewers may not. Mutation of events is handled server-side by
   * `logEvent`, not through this method.
   */
  async listEvents(operator: OperatorPrincipal): Promise<ZTNSecurityEvent[]> {
    this.requireCapability(operator, "view_security_events");
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

  /**
   * Reading policy POSTURE (what is in force) is a read capability
   * (`view_security`). Mutating policy is a separate capability
   * (`manage_security_policy`) and is NOT exposed by this method.
   */
  async listPolicies(operator: OperatorPrincipal): Promise<ZeroTrustPolicy[]> {
    this.requireCapability(operator, "view_security");
    return this.policies.list();
  }

  /**
   * Detailed canonical security events. Authorization is capability-based
   * (`view_security_events`), but project scope is independently enforced:
   *
   * - A query filtered by `projectId` must satisfy
   *   {@link operatorCanAccessProject}; a wrong project returns `[]`.
   * - A project-scoped operator (not `allowedProjects === "*"`) issuing a
   *   query WITHOUT `projectId` receives no data. We never widen scoped
   *   operators into unbounded global reads here, even when the capability
   *   grants them access to detailed events in principle.
   *
   * Admin principals with wildcard scope receive the unfiltered store query.
   */
  async listCanonicalEvents(
    operator: OperatorPrincipal,
    query: SecurityEventQuery = {},
  ): Promise<CanonicalSecurityEvent[]> {
    this.requireCapability(operator, "view_security_events");
    if (query.projectId && !operatorCanAccessProject(operator, query.projectId))
      return [];
    if (operator.allowedProjects !== "*" && !query.projectId) return [];
    if (!this.canonicalEvents) return [];
    return await this.canonicalEvents.query(query);
  }
}
