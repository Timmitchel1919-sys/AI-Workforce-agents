export class IncidentService {
    incidents = new Map();
    createIncident(title, severity, affectedServices) {
        const incident = {
            incidentId: `inc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            title,
            severity,
            status: "INVESTIGATING",
            affectedServices,
            updates: [
                {
                    timestamp: new Date(),
                    message: "We are currently investigating this issue.",
                },
            ],
            startedAt: new Date(),
        };
        this.incidents.set(incident.incidentId, incident);
        return incident;
    }
    getActiveIncidents() {
        return Array.from(this.incidents.values()).filter((inc) => inc.status !== "RESOLVED");
    }
    addUpdate(incidentId, status, message) {
        const incident = this.incidents.get(incidentId);
        if (!incident)
            throw new Error("Incident not found");
        incident.status = status;
        incident.updates.push({
            timestamp: new Date(),
            message,
        });
        if (status === "RESOLVED") {
            incident.resolvedAt = new Date();
        }
    }
}
