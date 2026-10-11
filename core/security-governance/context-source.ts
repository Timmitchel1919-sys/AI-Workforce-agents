/**
 * Governance context for the Prompt Engineer (Layer 3 `ContextSource`).
 *
 * The generated execution prompt states what is permitted, what is forbidden,
 * what needs approval and which environment applies. This is a briefing, not
 * the control: the same rules are enforced by the governor at runtime whatever
 * the prompt says.
 */
import type {
  ContextFragment,
  ContextRequest,
  ContextSource,
} from "../../contracts/prompt-intelligence.js";
import type { PolicyStore } from "./governor.js";
import { inferEnvironment } from "./resources.js";

export class GovernanceContextSource implements ContextSource {
  readonly id = "governance";
  readonly categories = ["security" as const];

  constructor(private readonly policies: PolicyStore) {}

  fetch(request: ContextRequest): readonly ContextFragment[] {
    const i = request.intent;
    const text = `${i.objective} ${i.target ?? ""} ${i.scope ?? ""}`;
    const environment = inferEnvironment(text) ?? "DEVELOPMENT";
    const target = i.target ?? i.affectedModule ?? "the requested component";
    const rules = this.policies
      .all()
      .filter(
        (p) =>
          p.status === "ENABLED" &&
          (!p.scope.projectId || p.scope.projectId === request.projectId),
      )
      .filter(
        (p) =>
          p.effect === "DENY" ||
          p.effect === "REQUIRE_APPROVAL" ||
          p.effect === "REQUIRE_SECURITY_REVIEW",
      );
    const make = (key: string, value: string): ContextFragment => ({
      category: "security",
      key: `gov.${key}`,
      value,
      source: this.id,
      origin: "Governance policy",
      authority: "authoritative",
      precedence: "project_security_policy",
      sensitivity: "internal",
      projectId: request.projectId,
      mandatory: true,
    });
    return [
      make(
        "permitted",
        `Permitted operations: read project source; modify only files directly related to ${target}; run typecheck, lint, tests and build. Keep changes minimal.`,
      ),
      make(
        "forbidden",
        "Forbidden operations: reading or writing secrets, credentials or .env files; changing security rules, authentication/authorization code, CI/CD or deployment configuration, or database configuration unless the task explicitly declares it; putting credentials in files, logs or output; running commands outside the allow-list; deploying, committing or pushing without the governed approval path.",
      ),
      make(
        "approvals",
        rules.length === 0
          ? "No operation requires extra approval beyond the baseline."
          : `Human approval or review is required for: ${rules
              .slice(0, 8)
              .map(
                (p) =>
                  `${p.name} (${p.effect.replace(/_/g, " ").toLowerCase()})`,
              )
              .join(
                "; ",
              )}. High and critical risk actions are never auto-approved, whatever an agent claims.`,
      ),
      make(
        "environment",
        `Environment: ${environment}.${environment === "PRODUCTION" ? " Production actions are held to stricter policy and need explicit human approval." : ""}`,
      ),
    ];
  }
}
