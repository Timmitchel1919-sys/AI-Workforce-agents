import type { DlpPolicy } from "../../contracts/privacy.js";

export interface ScanResult {
  action: "BLOCK" | "REDACT" | "WARN" | "AUDIT_ONLY";
  matches: string[];
  redactedText: string;
  confidence: number;
}

export class DlpEngine {
  private policies: DlpPolicy[] = [];

  registerPolicy(policy: DlpPolicy): void {
    this.policies = this.policies.filter(p => p.policyId !== policy.policyId);
    this.policies.push(policy);
  }

  scanText(organizationId: string, text: string): ScanResult {
    const orgPolicies = this.policies.filter(p => p.organizationId === organizationId && p.status === "ACTIVE");
    const matches: string[] = [];
    let action: "BLOCK" | "REDACT" | "WARN" | "AUDIT_ONLY" = "AUDIT_ONLY";
    let redactedText = text;

    // Check for SSN patterns
    const ssnRegex = /\d{3}-\d{2}-\d{4}/g;
    if (ssnRegex.test(text)) {
      matches.push("SSN");
      redactedText = redactedText.replace(ssnRegex, "[REDACTED]");
    }

    // Check for credit card patterns
    const ccRegex = /\b(?:\d[ -]*?){13,16}\b/g;
    if (ccRegex.test(text)) {
      matches.push("CREDIT_CARD");
      redactedText = redactedText.replace(ccRegex, "[REDACTED]");
    }

    // Determine action priority
    for (const policy of orgPolicies) {
      for (const rule of policy.rules) {
        if (matches.includes(rule.target)) {
          if (policy.action === "BLOCK") {
            action = "BLOCK";
          } else if (policy.action === "REDACT" && action !== "BLOCK") {
            action = "REDACT";
          } else if (policy.action === "WARN" && action !== "BLOCK" && action !== "REDACT") {
            action = "WARN";
          }
        }
      }
    }

    if (matches.length > 0 && action === "AUDIT_ONLY") {
      // default based on what matched
      action = matches.includes("SSN") ? "BLOCK" : "REDACT";
    }

    return {
      action,
      matches: Array.from(new Set(matches)),
      redactedText: action === "BLOCK" ? text : redactedText,
      confidence: matches.length > 0 ? 1 : 0,
    };
  }
}
