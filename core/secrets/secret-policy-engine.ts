import type {
  SecretAccessDecision,
  SecretAccessPurpose,
  SecretAccessRequest,
  SecretReference,
} from "../../contracts/secrets.js";

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
export class SecretPolicyEngine {
  evaluate(ctx: SecretPolicyEvaluationContext): SecretAccessDecision {
    const { request, reference, actorRole, allowedProjects } = ctx;

    // Rule 1: Browser UI / user clients cannot access raw secret values.
    if (request.actorType === "user") {
      return {
        allowed: false,
        reason: "browser_user_direct_secret_access_denied",
        referenceId: reference.id,
        actorId: request.actorId,
        purpose: request.purpose,
      };
    }

    // Rule 2: Secret status check
    if (reference.status === "disabled") {
      return {
        allowed: false,
        reason: "secret_disabled",
        referenceId: reference.id,
        actorId: request.actorId,
        purpose: request.purpose,
      };
    }

    if (reference.status === "compromised" || reference.status === "suspected_leak") {
      if (request.purpose !== "emergency_break_glass") {
        return {
          allowed: false,
          reason: `secret_${reference.status}_requires_emergency_break_glass_or_rotation`,
          referenceId: reference.id,
          actorId: request.actorId,
          purpose: request.purpose,
        };
      }
    }

    // Rule 3: Emergency Break-Glass Handling
    if (request.purpose === "emergency_break_glass") {
      if (actorRole !== "admin") {
        return {
          allowed: false,
          reason: "emergency_break_glass_requires_admin",
          referenceId: reference.id,
          actorId: request.actorId,
          purpose: request.purpose,
        };
      }
      if (!request.breakGlassReason || !request.breakGlassReason.trim()) {
        return {
          allowed: false,
          reason: "emergency_break_glass_reason_required",
          referenceId: reference.id,
          actorId: request.actorId,
          purpose: request.purpose,
        };
      }
      return {
        allowed: true,
        referenceId: reference.id,
        actorId: request.actorId,
        purpose: request.purpose,
      };
    }

    // Rule 4: Purpose-Bound Authorization
    const VALID_PURPOSES: SecretAccessPurpose[] = [
      "deploy_release",
      "call_model_provider",
      "github_push",
      "webhook_validation",
      "firebase_admin_operation",
      "runner_execution",
      "manage_secret_references",
    ];

    if (!VALID_PURPOSES.includes(request.purpose)) {
      return {
        allowed: false,
        reason: "unauthorized_secret_access_purpose",
        referenceId: reference.id,
        actorId: request.actorId,
        purpose: request.purpose,
      };
    }

    // Rule 5: Project Scoping
    if (reference.projectId && reference.projectId !== "*") {
      if (request.projectId && request.projectId !== reference.projectId) {
        return {
          allowed: false,
          reason: "project_scope_mismatch",
          referenceId: reference.id,
          actorId: request.actorId,
          purpose: request.purpose,
        };
      }
      if (allowedProjects && allowedProjects !== "*") {
        if (!allowedProjects.includes(reference.projectId)) {
          return {
            allowed: false,
            reason: "actor_project_permission_denied",
            referenceId: reference.id,
            actorId: request.actorId,
            purpose: request.purpose,
          };
        }
      }
    }

    // Rule 6: Environment Scoping
    if (reference.environment && reference.environment !== "*") {
      if (request.environment && request.environment !== reference.environment) {
        return {
          allowed: false,
          reason: "environment_scope_mismatch",
          referenceId: reference.id,
          actorId: request.actorId,
          purpose: request.purpose,
        };
      }
    }

    // Default: ALLOW
    return {
      allowed: true,
      referenceId: reference.id,
      actorId: request.actorId,
      purpose: request.purpose,
    };
  }
}
