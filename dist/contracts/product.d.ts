import type { Entity } from "./persistence.js";
export interface ProductPortfolio extends Entity {
    portfolioId: string;
    organizationId: string;
    name: string;
    description: string;
    ownerRef: string;
    status: "ACTIVE" | "ARCHIVED";
}
export interface ProductDefinition extends Entity {
    productId: string;
    portfolioRef: string;
    name: string;
    vision: string;
    strategy: string;
    lifecycleStage: "DISCOVERY" | "VALIDATION" | "BUILD" | "LAUNCH" | "SCALE" | "MATURE" | "SUNSET";
    ownerRef: string;
}
export interface CustomerProblem extends Entity {
    problemId: string;
    productRef: string;
    description: string;
    impactScore: number;
    frequencyScore: number;
    status: "OPEN" | "VALIDATED" | "INVALIDATED" | "SOLVED";
}
export interface ProductOpportunity extends Entity {
    opportunityId: string;
    problemRef: string;
    description: string;
    potentialValue: number;
    status: "CONSIDERING" | "SELECTED" | "DISCARDED";
}
export interface ProductFeature extends Entity {
    featureId: string;
    opportunityRef: string;
    name: string;
    description: string;
    status: "BACKLOG" | "IN_PROGRESS" | "RELEASED";
}
