import { SecurityEvent, ThreatRule, SecurityIncident } from "../../contracts/secops.js";

export class ThreatEngine {
  private events: SecurityEvent[] = [];
  private rules = new Map<string, ThreatRule[]>();
  private incidents = new Map<string, SecurityIncident>();

  registerRule(rule: ThreatRule) {
    const list = this.rules.get(rule.organizationId) || [];
    list.push(rule);
    this.rules.set(rule.organizationId, list);
  }

  logEvent(event: SecurityEvent) {
    this.events.push(event);
    this.evaluateThreats(event.organizationId, event.actor, event.timestamp);
  }

  private evaluateThreats(organizationId: string, actor: string, now: Date) {
    const orgRules = this.rules.get(organizationId)?.filter(r => r.status === "ACTIVE") || [];
    
    for (const rule of orgRules) {
      const windowStart = new Date(now.getTime() - rule.timeWindowSeconds * 1000);
      
      const relevantEvents = this.events.filter(e => 
        e.organizationId === organizationId && 
        e.actor === actor &&
        e.timestamp >= windowStart &&
        e.timestamp <= now &&
        this.eventMatchesCondition(e, rule.condition)
      );

      if (relevantEvents.length >= rule.threshold) {
        this.createIncident(organizationId, rule, relevantEvents.map(e => e.eventId));
      }
    }
  }

  private eventMatchesCondition(event: SecurityEvent, condition: ThreatRule["condition"]): boolean {
    if (condition === "RATE_LIMIT_EXCEEDED" && event.type === "API_ABUSE") return true;
    if (condition === "DLP_VIOLATION_SPIKE" && event.type === "DATA_EXFILTRATION_ATTEMPT") return true;
    if (condition === "GEO_FENCE_VIOLATION" && event.type === "SUSPICIOUS_IP") return true;
    return false;
  }

  private createIncident(organizationId: string, rule: ThreatRule, eventIds: string[]) {
    // Deduplicate if an open incident already covers these events loosely
    const openIncident = Array.from(this.incidents.values()).find(i => 
      i.organizationId === organizationId && i.status === "OPEN" && i.title.includes(rule.name)
    );

    if (openIncident) {
      // Just append events if not already there
      for (const eid of eventIds) {
        if (!openIncident.relatedEvents.includes(eid)) openIncident.relatedEvents.push(eid);
      }
      return;
    }

    const incident: SecurityIncident = {
      incidentId: `inc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      organizationId,
      title: `Threat Detected: ${rule.name}`,
      severity: rule.action === "BLOCK_USER" || rule.action === "IP_BAN" ? "CRITICAL" : "HIGH",
      status: "OPEN",
      relatedEvents: eventIds,
      createdAt: new Date()
    };

    this.incidents.set(incident.incidentId, incident);
    
    // Simulate taking the action
    if (rule.action === "BLOCK_USER") {
      console.log(`[SECOPS] Blocking user action triggered for incident ${incident.incidentId}`);
    }
  }

  getIncidents(organizationId: string): SecurityIncident[] {
    return Array.from(this.incidents.values()).filter(i => i.organizationId === organizationId);
  }

  getEvents(organizationId: string): SecurityEvent[] {
    return this.events.filter(e => e.organizationId === organizationId);
  }
}
