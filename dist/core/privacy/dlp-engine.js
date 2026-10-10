export class DlpEngine {
    policies = new Map();
    registerPolicy(policy) {
        const list = this.policies.get(policy.organizationId) || [];
        list.push(policy);
        this.policies.set(policy.organizationId, list);
    }
    getPolicies(organizationId) {
        return this.policies.get(organizationId) || [];
    }
    scanText(organizationId, text) {
        const orgPolicies = this.getPolicies(organizationId).filter((p) => p.status === "ACTIVE");
        let redactedText = text;
        let highestAction = "AUDIT_ONLY";
        const matches = [];
        const actionPriority = { BLOCK: 3, REDACT: 2, WARN: 1, AUDIT_ONLY: 0 };
        for (const policy of orgPolicies) {
            for (const rule of policy.rules) {
                if (rule.type === "REGEX" && rule.pattern) {
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
        return { action: highestAction, matches, redactedText };
    }
}
