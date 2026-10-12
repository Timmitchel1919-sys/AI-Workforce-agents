import type { SecretAccessDecision, SecretAccessRequest, SecretReference } from "../../contracts/secrets.js";
export interface SecretPolicyEvaluationContext {
    request: SecretAccessRequest;
    reference: SecretReference;
    actorRole?: string;
    allowedProjects?: readonly string[] | "*";
}
/**
 * Deterministic secret-access policy evaluation engine.
 *
 * SECURITY INVARIANTS:
 * 1. DENY BY DEFAULT.
 * 2. Browser UI / end-user clients (`actorType === 'user'`) are ALWAYS DENIED raw secret values.
 * 3. `manage_secret_references` capability manages reference metadata only — NOT raw values.
 * 4. AI Agents are denied raw secrets unless acting through authorized tools with valid purpose.
 * 5. Project & environment scope boundaries are strictly enforced.
 * 6. Secrets marked `compromised`, `suspected_leak`, or `disabled` fail closed unless emergency break-glass is authorized.
 */
export declare class SecretPolicyEngine {
    evaluate(ctx: SecretPolicyEvaluationContext): SecretAccessDecision;
}
