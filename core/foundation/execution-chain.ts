import * as crypto from 'crypto';

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

export class ExecutionOrchestrator {
  private objectives = new Map<string, ProjectObjective>();
  private executionPlans = new Map<string, ExecutionPlan>();
  private deliveryPlans = new Map<string, DeliveryPlan>();
  private changeSets = new Map<string, ChangeSet>();
  private verifications = new Map<string, Verification>();
  private releaseRecords = new Map<string, ReleaseRecord>();

  createObjective(projectId: string, description: string, successCriteria: string[]): ProjectObjective {
    const obj: ProjectObjective = {
      id: crypto.randomUUID(),
      projectId,
      description,
      successCriteria,
      createdAt: new Date(),
    };
    this.objectives.set(obj.id, obj);
    return obj;
  }

  createExecutionPlan(objectiveId: string, phases: string[]): ExecutionPlan {
    const obj = this.objectives.get(objectiveId);
    if (!obj) throw new Error('Objective not found');
    const plan: ExecutionPlan = {
      id: crypto.randomUUID(),
      objectiveId,
      projectId: obj.projectId,
      phases,
      approved: false,
      createdAt: new Date(),
    };
    this.executionPlans.set(plan.id, plan);
    return plan;
  }

  approveExecutionPlan(planId: string): void {
    const plan = this.executionPlans.get(planId);
    if (plan) plan.approved = true;
  }

  createDeliveryPlan(planId: string, tasks: string[], assignedAgents: string[]): DeliveryPlan {
    const plan = this.executionPlans.get(planId);
    if (!plan) throw new Error('ExecutionPlan not found');
    if (!plan.approved) throw new Error('ExecutionPlan must be approved');
    const delivery: DeliveryPlan = {
      id: crypto.randomUUID(),
      planId,
      projectId: plan.projectId,
      tasks,
      assignedAgents,
      createdAt: new Date(),
    };
    this.deliveryPlans.set(delivery.id, delivery);
    return delivery;
  }

  createChangeSet(deliveryPlanId: string, filesChanged: string[], diff: string): ChangeSet {
    const delivery = this.deliveryPlans.get(deliveryPlanId);
    if (!delivery) throw new Error('DeliveryPlan not found');
    const changeSet: ChangeSet = {
      id: crypto.randomUUID(),
      deliveryPlanId,
      projectId: delivery.projectId,
      filesChanged,
      diff,
      createdAt: new Date(),
    };
    this.changeSets.set(changeSet.id, changeSet);
    return changeSet;
  }

  createVerification(changeSetId: string, testsPassed: boolean, qualityScore: number): Verification {
    const changeSet = this.changeSets.get(changeSetId);
    if (!changeSet) throw new Error('ChangeSet not found');
    const verification: Verification = {
      id: crypto.randomUUID(),
      changeSetId,
      projectId: changeSet.projectId,
      testsPassed,
      qualityScore,
      createdAt: new Date(),
    };
    this.verifications.set(verification.id, verification);
    return verification;
  }

  createReleaseRecord(verificationId: string, deployedEnvironment: string): ReleaseRecord {
    const verification = this.verifications.get(verificationId);
    if (!verification) throw new Error('Verification not found');
    if (!verification.testsPassed) throw new Error('Verification must pass to release');
    const release: ReleaseRecord = {
      id: crypto.randomUUID(),
      verificationId,
      projectId: verification.projectId,
      deployedEnvironment,
      createdAt: new Date(),
    };
    this.releaseRecords.set(release.id, release);
    return release;
  }
}
