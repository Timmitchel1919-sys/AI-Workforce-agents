import type { Entity } from "./persistence.js";
export interface OrganizationDepartment extends Entity {
    departmentId: string;
    organizationId: string;
    name: string;
    description: string;
    parentDepartmentId?: string;
    leaderRef?: string;
    status: "ACTIVE" | "INACTIVE";
}
export interface WorkforceTeam extends Entity {
    teamId: string;
    departmentRef: string;
    name: string;
    mission: string;
    status: "ACTIVE" | "INACTIVE";
}
export interface HumanAgent extends Entity {
    agentId: string;
    type: "HUMAN" | "AI";
    teamRef: string;
    name: string;
    roleRef: string;
    skills: string[];
    capacity: number;
    status: "ACTIVE" | "ON_LEAVE" | "OFFBOARDED";
}
export interface SkillDefinition extends Entity {
    skillId: string;
    name: string;
    category: string;
    level: "BEGINNER" | "INTERMEDIATE" | "EXPERT";
}
export interface ResourceAssignment extends Entity {
    assignmentId: string;
    agentRef: string;
    projectRef?: string;
    productRef?: string;
    allocationPercent: number;
    startDate: string;
    endDate?: string;
    status: "ACTIVE" | "COMPLETED" | "CANCELLED";
}
