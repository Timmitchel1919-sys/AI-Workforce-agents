/**
 * Permission engine — least privilege by task type, plus the sensitive-scope
 * rule: an agent may write a sensitive resource (security rules, auth code,
 * CI/deploy config, database, infrastructure) only when the task DECLARED it.
 * Reading is not restricted here (secrets are denied by system policy).
 */
import type { ActionRequest, ResourceInfo } from "../../contracts/security-governance.js";
export interface PermissionVerdict {
    ok: boolean;
    reason: string;
    /** Which rule decided (for alerts and explanations). */
    rule: "task_profile" | "sensitive_scope" | "agent_action" | "ok";
}
export declare function checkPermission(req: ActionRequest, resource: ResourceInfo): PermissionVerdict;
