import { IncidentCommunication } from "../../contracts/customer.js";

export class IncidentService {
  private incidents = new Map<string, IncidentCommunication>();

  createIncident(
    title: string,
    severity: IncidentCommunication["severity"],
    affectedServices: string[],
  ): IncidentCommunication {
    const incident: IncidentCommunication = {
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

  getActiveIncidents(): IncidentCommunication[] {
    return Array.from(this.incidents.values()).filter(
      (inc) => inc.status !== "RESOLVED",
    );
  }

  addUpdate(
    incidentId: string,
    status: IncidentCommunication["status"],
    message: string,
  ) {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new Error("Incident not found");

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
