import { IncidentCommunication } from "../../contracts/customer.js";
export declare class IncidentService {
    private incidents;
    createIncident(title: string, severity: IncidentCommunication["severity"], affectedServices: string[]): IncidentCommunication;
    getActiveIncidents(): IncidentCommunication[];
    addUpdate(incidentId: string, status: IncidentCommunication["status"], message: string): void;
}
