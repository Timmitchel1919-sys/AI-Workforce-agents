export interface ProjectObjective {
    id: string;
    projectId: string;
    description: string;
    successCriteria: string[];
    createdAt: Date;
}
export interface ExecutionPlan {
    id: string;
    objectiveId: string;
    projectId: string;
    phases: string[];
    approved: boolean;
    createdAt: Date;
}
export interface DeliveryPlan {
    id: string;
    planId: string;
    projectId: string;
    tasks: string[];
    assignedAgents: string[];
    createdAt: Date;
}
export interface ChangeSet {
    id: string;
    deliveryPlanId: string;
    projectId: string;
    filesChanged: string[];
    diff: string;
    createdAt: Date;
}
export interface Verification {
    id: string;
    changeSetId: string;
    projectId: string;
    testsPassed: boolean;
    qualityScore: number;
    createdAt: Date;
}
export interface ReleaseRecord {
    id: string;
    verificationId: string;
    projectId: string;
    deployedEnvironment: string;
    createdAt: Date;
}
export declare class ExecutionOrchestrator {
    private objectives;
    private executionPlans;
    private deliveryPlans;
    private changeSets;
    private verifications;
    private releaseRecords;
    createObjective(projectId: string, description: string, successCriteria: string[]): ProjectObjective;
    createExecutionPlan(objectiveId: string, phases: string[]): ExecutionPlan;
    approveExecutionPlan(planId: string): void;
    createDeliveryPlan(planId: string, tasks: string[], assignedAgents: string[]): DeliveryPlan;
    createChangeSet(deliveryPlanId: string, filesChanged: string[], diff: string): ChangeSet;
    createVerification(changeSetId: string, testsPassed: boolean, qualityScore: number): Verification;
    createReleaseRecord(verificationId: string, deployedEnvironment: string): ReleaseRecord;
}
