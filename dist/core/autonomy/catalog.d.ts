/**
 * The action catalogue and the autonomy decision function. The decision is deterministic and
 * fail-closed: an action that is not in the catalogue is CRITICAL and restricted.
 */
import type { AutonomousAction, AutonomousWorkflowDef, OpsAutonomyLevel, AutonomyRetryPolicy } from "../../contracts/autonomy.js";
import type { GovRisk } from "../../contracts/security-governance.js";
export declare const ACTIONS: AutonomousAction[];
export declare const actionOf: (actionId: string) => AutonomousAction | undefined;
/** Unknown actions are treated as the worst case. */
export declare const UNKNOWN_ACTION: AutonomousAction;
export declare const RISK_ORDER: Record<GovRisk, number>;
export declare const maxRisk: (a: GovRisk, b: GovRisk) => GovRisk;
export declare const DEFAULT_RETRY: AutonomyRetryPolicy;
export type StepDecision = {
    outcome: "AUTO";
    reason: string;
} | {
    outcome: "NEEDS_APPROVAL";
    reason: string;
} | {
    outcome: "REFUSED";
    reason: string;
};
/**
 * Decide whether a step may run without the owner. The level only ever affects LOW/MEDIUM steps;
 * HIGH, CRITICAL and restricted actions always need explicit approval.
 */
export declare function decideStep(input: {
    action: AutonomousAction;
    risk: GovRisk;
    level: OpsAutonomyLevel;
    planApproved: boolean;
    boundaries: AutonomousWorkflowDef["boundaries"];
    /** The owner started this workflow by hand (vs. a trigger). */
    startedByOwner: boolean;
}): StepDecision;
export declare const BUILTIN_DEFINITIONS: Omit<AutonomousWorkflowDef, "createdAt" | "createdBy" | "id">[];
