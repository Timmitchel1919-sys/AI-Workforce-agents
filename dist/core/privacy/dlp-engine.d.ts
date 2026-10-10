import type { DlpAction, DlpPolicy } from "../../contracts/privacy.js";
export interface ScanResult {
    action: DlpAction;
    matches: string[];
    redactedText: string;
    confidence: number;
}
export declare class DlpEngine {
    private policies;
    registerPolicy(policy: DlpPolicy): void;
    getPolicies(organizationId: string): DlpPolicy[];
    scanText(organizationId: string, text: string): ScanResult;
}
