export class ThreatEngine {
    incidentRepository;
    eventRepository;
    events = [];
    rules = new Map();
    incidents = new Map();
    constructor(incidentRepository, eventRepository) {
        this.incidentRepository = incidentRepository;
        this.eventRepository = eventRepository;
        for (const incident of incidentRepository?.list() ?? [])
            this.incidents.set(incident.incidentId, incident);
        this.events.push(...(eventRepository?.list() ?? []));
    }
    registerRule(rule) {
        const list = this.rules.get(rule.organizationId) || [];
        list.push(rule);
        this.rules.set(rule.organizationId, list);
    }
    logEvent(event) {
        this.events.push(event);
        this.eventRepository?.upsert({ ...event, id: event.eventId });
        this.evaluateThreats(event.organizationId, event.actor, event.timestamp);
    }
    evaluateThreats(organizationId, actor, now) {
        const orgRules = this.rules.get(organizationId)?.filter((r) => r.status === "ACTIVE") ||
            [];
        for (const rule of orgRules) {
            const windowStart = new Date(now.getTime() - rule.timeWindowSeconds * 1000);
            const relevantEvents = this.events.filter((e) => e.organizationId === organizationId &&
                e.actor === actor &&
                e.timestamp >= windowStart &&
                e.timestamp <= now &&
                this.eventMatchesCondition(e, rule.condition));
            if (relevantEvents.length >= rule.threshold) {
                this.createIncident(organizationId, rule, relevantEvents.map((e) => e.eventId));
            }
        }
    }
    eventMatchesCondition(event, condition) {
        if (condition === "RATE_LIMIT_EXCEEDED" && event.type === "API_ABUSE")
            return true;
        if (condition === "DLP_VIOLATION_SPIKE" &&
            event.type === "DATA_EXFILTRATION_ATTEMPT")
            return true;
        if (condition === "GEO_FENCE_VIOLATION" && event.type === "SUSPICIOUS_IP")
            return true;
        return false;
    }
    createIncident(organizationId, rule, eventIds) {
        // Deduplicate if an open incident already covers these events loosely
        const openIncident = Array.from(this.incidents.values()).find((i) => i.organizationId === organizationId &&
            i.status === "OPEN" &&
            i.title.includes(rule.name));
        if (openIncident) {
            // Just append events if not already there
            for (const eid of eventIds) {
                if (!openIncident.relatedEvents.includes(eid))
                    openIncident.relatedEvents.push(eid);
            }
            return;
        }
        const incident = {
            incidentId: `inc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            organizationId,
            title: `Threat Detected: ${rule.name}`,
            severity: rule.action === "BLOCK_USER" || rule.action === "IP_BAN"
                ? "CRITICAL"
                : "HIGH",
            status: "OPEN",
            relatedEvents: eventIds,
            createdAt: new Date(),
        };
        this.incidents.set(incident.incidentId, incident);
        this.incidentRepository?.upsert({ ...incident, id: incident.incidentId });
        // Detection is deliberately side-effect free. Containment is a governed
        // destructive action and must be requested, approved and executed by the
        // incident-response service; threat detection may never block a user or
        // revoke a key autonomously.
    }
    getIncidents(organizationId) {
        return Array.from(this.incidents.values()).filter((i) => i.organizationId === organizationId);
    }
    getEvents(organizationId) {
        return this.events.filter((e) => e.organizationId === organizationId);
    }
}
