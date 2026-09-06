import { type AuditEvent, type AuditEventType } from "../../contracts/index.js";
import { createId, now } from "../shared.js";
export class AuditLog {
  private readonly events: AuditEvent[] = [];
  record(type: AuditEventType, data: Omit<AuditEvent, "id" | "type" | "timestamp">): AuditEvent { const event = { id: createId("audit"), type, timestamp: now(), ...data }; this.events.push(event); return event; }
  list(): readonly AuditEvent[] { return [...this.events]; }
}
