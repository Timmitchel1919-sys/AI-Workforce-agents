/**
 * AI Workforce OS — Layer 15: Simulation & Decision Intelligence Contracts
 *
 * Defines the decision-support layer between analysis and execution:
 * - What-if scenario modeling across projects, agents, costs, deployments, and security
 * - Decision matrices comparing alternatives (cost, quality, speed, risk, reversibility)
 * - Explicit assumptions and confidence ratings
 * - Reproducible simulation snapshots
 * - Guaranteed dry-run isolation (no production state mutation)
 */
export const SIMULATION_DOMAINS = [
    "project",
    "agent",
    "cost",
    "deployment",
    "security",
    "general",
];
export const SIMULATION_CONFIDENCE_LEVELS = ["high", "medium", "low"];
export const REVERSIBILITY_LEVELS = [
    "easy",
    "moderate",
    "difficult",
    "irreversible",
];
