import type { DecisionMatrix, DecisionMatrixCriteriaWeights, SimulationInput, SimulationOption, SimulationResult } from "../../contracts/simulation.js";
export declare class SimulationEngine {
    /**
     * Evaluates a proposed what-if simulation and generates projected effects,
     * identified risks, decision matrix rankings, and recommendations.
     */
    simulate(input: SimulationInput): SimulationResult;
    /**
     * Deterministically scores and ranks options across cost, quality, speed, risk, and reversibility.
     */
    buildDecisionMatrix(options: readonly SimulationOption[], weights?: DecisionMatrixCriteriaWeights): DecisionMatrix;
    /** What-If: Model switch cost, quality, and latency comparison. */
    simulateModelSwitch(input: {
        currentModel: string;
        proposedModel: string;
        monthlyTaskVolume: number;
        avgTokensPerTask: number;
        projectId?: string;
    }): SimulationResult;
    /** What-If: Cross-project priority reallocation (e.g. AIMS vs Money Mind). */
    simulateProjectPrioritization(input: {
        primaryProject: string;
        secondaryProject: string;
        totalAgentCapacity: number;
        primaryBacklogSize: number;
        secondaryBacklogSize: number;
    }): SimulationResult;
    private synthesizeDefaultOptions;
    private projectEffects;
    private identifyRisks;
}
