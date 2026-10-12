/**
 * Intent Analyzer (Phase 3) — rule-based, deterministic, bilingual (NL/EN).
 *
 * Turns a natural-language request into a typed `IntentAnalysis`. It is
 * deliberately NOT model-assisted: an analysis that feeds destructive-action
 * and approval decisions must be explainable and reproducible. The
 * `IntentAnalyzer` port lets a model-assisted analyzer be added later; the
 * validator re-checks whatever any analyzer returns.
 *
 * Nothing is guessed silently: what cannot be determined is reported as
 * ambiguity, low-risk gaps get a recorded safe default, high-risk gaps need
 * a human.
 */
import type { IntentAnalysis } from "../../contracts/prompt-intelligence.js";
export interface ProjectCandidate {
    projectId: string;
    displayName: string;
    code?: string;
}
export interface IntentAnalyzerInput {
    request: string;
    /** Only projects the principal may access — never a wider list. */
    projects: readonly ProjectCandidate[];
    /** Explicit selection (e.g. the Command Center project picker). */
    explicitProjectId?: string;
}
export interface IntentAnalyzer {
    analyze(input: IntentAnalyzerInput): IntentAnalysis;
}
export declare function extractExplicitConstraints(request: string): string[];
export declare class RuleBasedIntentAnalyzer implements IntentAnalyzer {
    analyze(input: IntentAnalyzerInput): IntentAnalysis;
}
