import type { DlpPolicy } from "../../contracts/privacy.js";
export interface ScanResult {
    action: "BLOCK" | "REDACT" | "WARN" | "AUDIT_ONLY";
    matches: string[];
    redactedText: string;
    confidence: number;
}
export declare class DlpEngine {
    private policies;
    registerPolicy(policy: DlpPolicy): void;
    scanText(organizationId: string, text: string): ScanResult;
}
