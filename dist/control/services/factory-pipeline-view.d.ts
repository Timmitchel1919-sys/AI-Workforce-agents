/**
 * UI Layer 5 — Software Factory development pipeline, as it ACTUALLY exists in
 * this deployment. Each stage's mode is derived from what is composed and what
 * the release/runner capabilities report; nothing is presented as automated
 * unless a real component performs it.
 */
import type { ControlPlaneContext } from "../context.js";
export declare const FACTORY_STAGES: readonly ["mission_intake", "requirements_analysis", "planning", "agent_model_selection", "environment_allocation", "implementation", "testing", "code_review", "security_review", "build", "pull_request", "human_approval", "deployment", "production_verification"];
export type FactoryStage = (typeof FACTORY_STAGES)[number];
export type StageMode = "automated" | "manual" | "awaiting_approval" | "not_configured" | "unavailable";
export interface FactoryStageView {
    stage: FactoryStage;
    mode: StageMode;
    /** Short, operator-safe reason code the UI localizes. */
    reason: string;
}
export declare function factoryPipeline(ctx: ControlPlaneContext): {
    stages: FactoryStageView[];
    runners: {
        family: string;
        status: string;
        realRunners: number;
    }[];
};
