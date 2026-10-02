import { DlpPolicy } from "../../contracts/privacy.js";
export declare class DlpEngine {
    private policies;
    registerPolicy(policy: DlpPolicy): void;
    getPolicies(organizationId: string): DlpPolicy[];
    scanText(organizationId: string, text: string): {
        action: DlpPolicy["action"];
        matches: string[];
        redactedText: string;
    };
}
