/**
 * Safe Control Plane views of execution plans. Credential references are
 * reduced to their kind, and every view states that execution is unavailable:
 * EO-3.1 plans work, it does not execute work.
 */
import type { ExecutionPlan, ExecutionPlanSummaryView, ExecutionPlanView } from "../contracts/index.js";
export declare const EXECUTION_UNAVAILABLE_REASON = "Plan execution is not available yet (EO-4). Planning only.";
export declare function executionPlanSummaryView(plan: ExecutionPlan, current: boolean): ExecutionPlanSummaryView;
export declare function executionPlanView(plan: ExecutionPlan, current: boolean): ExecutionPlanView;
