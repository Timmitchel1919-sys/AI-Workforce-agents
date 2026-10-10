import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";
import type {
  ZTNSecurityEvent,
  ZeroTrustPolicy,
  ThreatIntelligenceReport,
} from "../../contracts/security.js";

export class SecurityControlService {
  constructor(
    private readonly events: Repository<ZTNSecurityEvent>,
    private readonly policies: Repository<ZeroTrustPolicy>,
    private readonly threatIntel: Repository<ThreatIntelligenceReport>
  ) {}

  private enforceAdmin(operator: OperatorPrincipal) {
    if (operator.role !== "admin") {
      throw new ValidationError("Unauthorized. Requires admin role for Security operations.");
    }
  }

  async listEvents(): Promise<ZTNSecurityEvent[]> {
    return this.events.list();
  }

  async logEvent(
    event: Omit<ZTNSecurityEvent, "id" | "eventId" | "status" | "createdAt">
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

  async listPolicies(): Promise<ZeroTrustPolicy[]> {
    return this.policies.list();
  }
}
