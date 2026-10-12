/**
 * Measures the KPI metrics the platform can compute from its own data. A metric with nothing to
 * measure returns `value: null` (never a made-up number).
 */
import type { UsageRecord } from "../../contracts/cost-center.js";
import type { ExecutionRun, RunStatus } from "../../contracts/execution-orchestration.js";
import type { MeasuredMetric, Measurement } from "../../contracts/business-layer.js";
export interface MeasureInputs {
    runs: ExecutionRun[];
    deriveRunStatus: (run: ExecutionRun) => RunStatus;
    usage: UsageRecord[];
    alerts: {
        projectId?: string;
        status: string;
    }[];
}
export declare function measureMetric(metric: MeasuredMetric, projectId: string | undefined, i: MeasureInputs): Measurement;
