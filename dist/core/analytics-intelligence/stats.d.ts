/** Small, dependency-free statistics. All of them state their own uncertainty. */
import type { DataQuality, Rate } from "../../contracts/analytics-intelligence.js";
export declare const rate: (numerator: number, denominator: number) => Rate;
export declare function median(values: number[]): number | null;
export declare const mean: (values: number[]) => number | null;
/** Wilson score interval (95%): a range for a proportion that stays honest at small samples. */
export declare function wilson(successes: number, n: number): [number, number];
export declare function quality(sample: number, established?: number): DataQuality;
/** Ordinary least squares over (0..n-1, y). Returns slope/intercept and the residual spread. */
export declare function linearTrend(ys: number[]): {
    slope: number;
    intercept: number;
    residual: number;
} | null;
/** Monday 00:00 UTC of the week containing `iso`. */
export declare function weekStart(iso: string): string;
export declare function lastWeeks(nowIso: string, count: number): string[];
export declare const ms: (a?: string, b?: string) => number | null;
