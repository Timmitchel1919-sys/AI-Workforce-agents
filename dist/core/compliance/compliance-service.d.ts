import type { ComplianceEvidence, ControlDefinition, ControlInstance, ControlTestRun, ControlStatus, EvidenceFreshness } from "../../contracts/compliance.js";
export declare class ComplianceService {
    private controlDefs;
    private controlInstances;
    private evidence;
    private testRuns;
    createControlDefinition(def: Omit<ControlDefinition, "controlId" | "createdAt" | "updatedAt">): ControlDefinition;
    getControlDefinition(controlId: string): ControlDefinition | undefined;
    listControlDefinitions(): ControlDefinition[];
    createControlInstance(inst: Omit<ControlInstance, "instanceId">): ControlInstance;
    getControlInstances(orgId: string): ControlInstance[];
    addEvidence(ev: Omit<ComplianceEvidence, "evidenceId">): ComplianceEvidence;
    getEvidence(orgId: string): ComplianceEvidence[];
    recordTestRun(tr: Omit<ControlTestRun, "testId">): ControlTestRun;
    getTestRuns(orgId: string): ControlTestRun[];
    updateControlInstanceStatus(instanceId: string, status: ControlStatus, effectiveness?: string, freshness?: EvidenceFreshness): ControlInstance;
}
