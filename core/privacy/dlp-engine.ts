import type { DlpAction, DlpPolicy } from "../../contracts/privacy.js";

export interface ScanResult {
  action: DlpAction;
  matches: string[];
  redactedText: string;
  confidence: number;
}

export class DlpEngine {
  private policies = new Map<string, DlpPolicy[]>();

  registerPolicy(policy: DlpPolicy) {
    const list = this.policies.get(policy.organizationId) || [];
    list.push(policy);
    this.policies.set(policy.organizationId, list);
  }

  getPolicies(organizationId: string): DlpPolicy[] {
    return this.policies.get(organizationId) || [];
  }

  scanText(organizationId: string, text: string): ScanResult {
    const orgPolicies = this.getPolicies(organizationId).filter(
      (p) => p.status === "ACTIVE",
    );
    let redactedText = text;
    let highestAction: DlpAction = "AUDIT_ONLY";
    const matches: string[] = [];

    const actionPriority = { BLOCK: 3, REDACT: 2, WARN: 1, AUDIT_ONLY: 0 };

    for (const policy of orgPolicies) {
      for (const rule of policy.rules) {
        if ((rule.type === "REGEX" || rule.type === "KEYWORD") && rule.pattern) {
          const regex = new RegExp(rule.pattern, "g");
          let match;
          while ((match = regex.exec(text)) !== null) {
            matches.push(rule.target);
            if (actionPriority[policy.action] > actionPriority[highestAction]) {
              highestAction = policy.action;
            }
            // A global regex that can match an empty string otherwise never advances.
            if (match[0].length === 0) {
              regex.lastIndex += 1;
            }
          }
          if (policy.action === "REDACT" && matches.length > 0) {
            const replaceRegex = new RegExp(rule.pattern, "g");
            redactedText = redactedText.replace(replaceRegex, "[REDACTED]");
          }
        }
      }
    }

    return {
      action: highestAction,
      matches: Array.from(new Set(matches)),
      redactedText: highestAction === "BLOCK" ? text : redactedText,
      confidence: matches.length > 0 ? 1 : 0,
    };
  }
}
