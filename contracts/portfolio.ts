import type { Entity } from "./persistence.js";

export interface StrategicObjective extends Entity {
  objectiveId: string;
  organizationId: string;
  name: string;
  description: string;
  status: "DRAFT" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
  ownerRef: string;
  targetDate: string;
  progressPercentage: number;
}

export interface EnterprisePortfolio extends Entity {
  portfolioId: string;
  organizationId: string;
  name: string;
  description: string;
  ownerRef: string;
  budgetAllocated: number;
  budgetConsumed: number;
  status: "PROPOSED" | "ACTIVE" | "ARCHIVED";
}

export interface PortfolioProgram extends Entity {
  programId: string;
  portfolioRef: string;
  name: string;
  description: string;
  status: "PLANNING" | "EXECUTING" | "PAUSED" | "COMPLETED";
  sponsorRef: string;
  associatedProjectRefs: string[];
  strategicObjectiveRefs: string[];
}
