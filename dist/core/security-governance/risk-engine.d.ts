/**
 * Risk Engine — deterministic, explainable, no model calls.
 *
 *   score = action + resource + environment + blast radius + reversibility
 *           + data sensitivity + agent trust
 *   0–1 LOW · 2–3 MEDIUM · 4–6 HIGH · ≥7 CRITICAL
 */
import { type ActionClass, type DataClass, type GovEnvironment, type ResourceInfo, type RiskAssessment, type GovRisk, type TrustState } from "../../contracts/security-governance.js";
export declare const levelOfScore: (score: number) => GovRisk;
export declare const riskRank: (r: GovRisk) => number;
export interface RiskInput {
    action: ActionClass;
    resource: ResourceInfo;
    environment: GovEnvironment;
    count?: number;
    reversible?: boolean;
    dataClass?: DataClass;
    agentTrust?: TrustState;
    external?: boolean;
}
export declare function assessRisk(input: RiskInput): RiskAssessment;
