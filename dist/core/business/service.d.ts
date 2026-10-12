import { type BoardView, type BusinessObjective, type BusinessPriority, type BusinessProfile, type DecisionRecord, type Department, type ExecutionPlanProposal, type Initiative, type Kpi, type KpiStatus, type Measurement, type MeasuredMetric, type ObjectiveLevel, type ObjectiveStatus, type OrgNode } from "../../contracts/business-layer.js";
import type { WorkflowStage } from "../../contracts/extension-platform.js";
import type { Repository } from "../../contracts/persistence.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";
export declare class BusinessError extends Error {
    readonly code: "invalid_request" | "not_found" | "invalid_state" | "conflict";
    constructor(code: "invalid_request" | "not_found" | "invalid_state" | "conflict", message: string);
}
export interface BusinessRepos {
    profile: Repository<BusinessProfile>;
    departments: Repository<Department>;
    objectives: Repository<BusinessObjective>;
    initiatives: Repository<Initiative>;
    decisions: Repository<DecisionRecord>;
}
export interface BusinessPorts {
    projectExists(projectId: string): boolean;
    agentExists(agentId: string): boolean;
    measure(metric: MeasuredMetric, projectId?: string): Measurement;
    workflowTemplates(): {
        extensionId: string;
        name: string;
        version: string;
        stages: WorkflowStage[];
    }[];
    projectHealth?(projectId: string): {
        state: string;
        reasons: string[];
    } | undefined;
    /** Optional: keep an adopted decision in the Knowledge layer. */
    remember?(decision: DecisionRecord): void;
    ledger: GovernanceLedger;
    clock: () => string;
}
export declare function kpiStatus(kpi: Kpi, m: Measurement | undefined): KpiStatus;
export declare class BusinessService {
    private readonly ports;
    private readonly profile;
    private readonly departments;
    private readonly objectives;
    private readonly initiatives;
    private readonly decisions;
    constructor(repos: BusinessRepos, ports: BusinessPorts);
    private now;
    private led;
    seedDefaults(by: string): void;
    getProfile(): BusinessProfile;
    configure(input: {
        name?: unknown;
        mission?: unknown;
    }, by: string): BusinessProfile;
    listDepartments(includeArchived?: boolean): Department[];
    department(departmentId: string): Department;
    createDepartment(input: Record<string, unknown>, by: string): Department;
    updateDepartment(departmentId: string, input: Record<string, unknown>, by: string): Department;
    /** Departments are archived, never deleted; a department with active objectives cannot be archived. */
    archiveDepartment(departmentId: string, by: string): Department;
    assignAgent(departmentId: string, agentId: string, by: string): Department;
    unassignAgent(departmentId: string, agentId: string, by: string): Department;
    setManager(departmentId: string, input: Record<string, unknown>, by: string): Department;
    linkProject(departmentId: string, projectId: string, by: string): Department;
    /** BUSINESS → BOARD → EXECUTIVE → DEPARTMENTS → MANAGERS → WORKFORCE → PROJECTS. */
    organization(): OrgNode;
    listObjectives(filter?: {
        status?: ObjectiveStatus;
        level?: ObjectiveLevel;
        projectId?: string;
    }): BusinessObjective[];
    objective(objectiveId: string): BusinessObjective;
    createObjective(input: Record<string, unknown>, by: string): BusinessObjective;
    updateObjective(objectiveId: string, input: Record<string, unknown>, by: string): BusinessObjective;
    setObjectiveStatus(objectiveId: string, status: unknown, by: string): BusinessObjective;
    addKpi(objectiveId: string, input: Record<string, unknown>, by: string): BusinessObjective;
    recordReading(objectiveId: string, kpiId: string, value: unknown, note: unknown, by: string): BusinessObjective;
    kpiStatuses(o: BusinessObjective): KpiStatus[];
    listInitiatives(objectiveId?: string): Initiative[];
    initiative(initiativeId: string): Initiative;
    createInitiative(input: Record<string, unknown>, by: string): Initiative;
    setInitiativeStatus(initiativeId: string, status: unknown, by: string): Initiative;
    /**
     * OBJECTIVE → STRATEGY → INITIATIVE → PROJECT → WORKFLOW → TASK → AGENT. Produces a PROPOSAL:
     * this layer never creates a project, a task or a run. Approving it only records the owner's
     * go-ahead and hands over the objective text for Prompt Intelligence.
     */
    proposePlan(initiativeId: string, input: Record<string, unknown>, by: string): ExecutionPlanProposal;
    decidePlan(initiativeId: string, planId: string, decision: "APPROVED" | "REJECTED", by: string): Initiative;
    listDecisions(filter?: {
        objectiveId?: string;
        projectId?: string;
    }): DecisionRecord[];
    decision(decisionId: string): DecisionRecord;
    recordDecision(input: Record<string, unknown>, by: string): DecisionRecord;
    adoptDecision(decisionId: string, by: string): DecisionRecord;
    /** A decision is never edited or deleted; a new one supersedes it and keeps the link. */
    supersedeDecision(decisionId: string, replacement: Record<string, unknown>, by: string): {
        old: DecisionRecord;
        next: DecisionRecord;
    };
    board(): BoardView;
}
export type { BusinessPriority };
