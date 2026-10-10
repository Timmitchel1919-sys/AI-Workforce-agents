/**
 * Prompt Validator (Phase 3).
 *
 * The last gate before a prompt may leave this layer. It re-checks the work of
 * the analyzer, the engine and the engineer independently, so a defect or a
 * future model-assisted analyzer cannot slip an unsafe request through.
 *
 *   PASS               ready for the Project Manager / workflow engine
 *   WARN               ready, with surfaced gaps (e.g. files not pre-resolved)
 *   CLARIFY            a human must answer questions first
 *   APPROVAL_REQUIRED  protected/destructive: existing approval flow is mandatory
 *   BLOCKED            conflicts with a security requirement or is malformed
 *
 * Ambiguity policy: low-risk gaps use the recorded safe default; high-risk
 * gaps (unknown project/target/operation, unbounded scope, anything
 * destructive) are never defaulted — they go to a human.
 */
import {
  canonicalizeCapability,
  capabilitySatisfies,
} from "../../contracts/capabilities.js";
import type {
  GeneratedPrompt,
  IntentAnalysis,
  IntentCategory,
  PromptValidation,
  ResolvedContext,
  PromptValidationCheck,
  ValidationStatus,
} from "../../contracts/prompt-intelligence.js";
import { containsSecret } from "./secret-scan.js";

export interface PromptValidatorInput {
  intent: IntentAnalysis;
  context: ResolvedContext;
  prompt: GeneratedPrompt;
  /** Does the project exist and is it visible to the requester? */
  projectExists: boolean;
  /** Canonical capability ids offered by registered agents (informational). */
  registeredCapabilities: readonly string[];
}

const NEEDS_TARGET: ReadonlySet<IntentCategory> = new Set([
  "UI_MODIFICATION",
  "BUG_FIX",
  "REFACTOR",
  "DESTRUCTIVE_OPERATION",
]);
const MODIFIES_CODE: ReadonlySet<IntentCategory> = new Set([
  "UI_MODIFICATION",
  "THEME_MODIFICATION",
  "BUG_FIX",
  "REFACTOR",
  "FEATURE_IMPLEMENTATION",
  "CONFIGURATION",
]);

export function approvalRequiredFor(intent: IntentAnalysis): string[] {
  const reasons: string[] = [];
  for (const finding of intent.destructive) {
    reasons.push(`destructive operation: ${finding.kind}`);
  }
  if (intent.category === "DEPLOYMENT" && intent.risk === "high") {
    reasons.push("production deployment");
  }
  return reasons;
}

export class PromptValidator {
  validate(input: PromptValidatorInput): PromptValidation {
    const { intent, context, prompt } = input;
    const checks: PromptValidationCheck[] = [];
    const blocked: string[] = [];
    const clarify: string[] = [];
    const questions: string[] = [];
    const add = (
      key: string,
      title: string,
      outcome: PromptValidationCheck["outcome"],
      detail: string,
    ): void => {
      checks.push({ key, title, outcome, detail });
    };

    // 1. project exists
    if (input.projectExists && intent.project.projectId) {
      add(
        "project_exists",
        "Project exists and is accessible",
        "pass",
        intent.project.displayName ?? intent.project.projectId,
      );
    } else {
      add(
        "project_exists",
        "Project exists and is accessible",
        "fail",
        "No accessible project was identified.",
      );
      clarify.push("project could not be identified");
      questions.push("Which project is this request for?");
    }

    // 2. required context
    const hasIdentity = context.byCategory.project.some(
      (f) => f.key === "identity",
    );
    if (!hasIdentity && input.projectExists) {
      add(
        "required_context",
        "Required context exists",
        "fail",
        "No project identity context was resolved.",
      );
      blocked.push("project context could not be resolved");
    } else if (context.missing.length > 0) {
      add(
        "required_context",
        "Required context exists",
        "warn",
        `No context available for: ${context.missing.join(", ")}. The agent must derive it from the code.`,
      );
    } else {
      add(
        "required_context",
        "Required context exists",
        "pass",
        `${context.fragments.length} relevant fragment(s) from ${context.sources.filter((s) => s.status === "ok").length} source(s).`,
      );
    }

    // 3. target identifiable
    if (NEEDS_TARGET.has(intent.category)) {
      if (intent.target)
        add(
          "target_identifiable",
          "Target is identifiable",
          "pass",
          intent.target,
        );
      else {
        add(
          "target_identifiable",
          "Target is identifiable",
          "fail",
          "The target of the change was not identified.",
        );
        clarify.push("target not identified");
        questions.push(
          "What exactly should be changed (which page, component or file)?",
        );
      }
    } else {
      add(
        "target_identifiable",
        "Target is identifiable",
        "info",
        "Not required for this kind of request.",
      );
    }

    // 4. operation understood
    const operationOk =
      intent.category !== "UNKNOWN" &&
      (intent.category !== "UI_MODIFICATION" || intent.operation !== undefined);
    if (operationOk)
      add(
        "operation_understood",
        "Requested operation is understood",
        "pass",
        intent.operation ?? intent.category,
      );
    else {
      add(
        "operation_understood",
        "Requested operation is understood",
        "fail",
        "The requested operation is unclear.",
      );
      clarify.push("operation not understood");
      questions.push(
        "What should change, and what should the result look like?",
      );
    }

    // 5. constraints preserved
    const carried = new Set(prompt.sections.technicalConstraints);
    const dropped = intent.explicitConstraints.filter((c) => !carried.has(c));
    if (dropped.length === 0) {
      add(
        "constraints_preserved",
        "Stated constraints are preserved",
        intent.explicitConstraints.length > 0 ? "pass" : "info",
        `${intent.explicitConstraints.length} explicit constraint(s) carried into the prompt.`,
      );
    } else {
      add(
        "constraints_preserved",
        "Stated constraints are preserved",
        "fail",
        `Dropped: ${dropped.join(" | ")}`,
      );
      blocked.push("an explicit constraint was lost");
    }

    // 6. security requirements present + not weakened
    const securityText = prompt.sections.security.join(" ").toLowerCase();
    const hasBaseline =
      securityText.includes("secrets") && securityText.includes("destructive");
    if (hasBaseline)
      add(
        "security_requirements",
        "Security requirements are present",
        "pass",
        `${prompt.sections.security.length} requirement(s).`,
      );
    else {
      add(
        "security_requirements",
        "Security requirements are present",
        "fail",
        "The security baseline is missing from the prompt.",
      );
      blocked.push("security requirements missing");
    }
    if (intent.securityOverrideAttempts.length > 0) {
      add(
        "security_override",
        "Request does not weaken security",
        "fail",
        `Conflicts with a security requirement: ${intent.securityOverrideAttempts.join(" | ")}. These parts are not applied.`,
      );
      blocked.push("the request conflicts with a security requirement");
    } else {
      add(
        "security_override",
        "Request does not weaken security",
        "pass",
        "No conflict detected.",
      );
    }

    // 7. destructive + approval
    const approvals = approvalRequiredFor(intent);
    if (approvals.length > 0) {
      add(
        "destructive_actions",
        "Destructive actions are detected",
        "warn",
        approvals.join("; "),
      );
      add(
        "approval_identified",
        "Required approval is identified",
        "pass",
        "Human approval is mandatory before any execution; it is requested through the existing approval flow.",
      );
    } else {
      add(
        "destructive_actions",
        "Destructive actions are detected",
        "pass",
        "None detected.",
      );
      add(
        "approval_identified",
        "Required approval is identified",
        "info",
        "No approval required.",
      );
    }

    // 8. relevant files
    if (MODIFIES_CODE.has(intent.category)) {
      if (context.relevantFiles.length > 0) {
        add(
          "relevant_files",
          "Relevant files are resolved",
          "pass",
          context.relevantFiles.join(", "),
        );
      } else {
        add(
          "relevant_files",
          "Relevant files are resolved",
          "warn",
          "No files were pre-resolved; the agent must locate them from the repository.",
        );
      }
    } else {
      add(
        "relevant_files",
        "Relevant files are resolved",
        "info",
        "Not required for this kind of request.",
      );
    }

    // 9. acceptance criteria
    if (prompt.sections.acceptanceCriteria.length > 0) {
      add(
        "acceptance_criteria",
        "Acceptance criteria exist",
        "pass",
        `${prompt.sections.acceptanceCriteria.length} criteria.`,
      );
    } else {
      add(
        "acceptance_criteria",
        "Acceptance criteria exist",
        "fail",
        "No acceptance criteria were produced.",
      );
      blocked.push("acceptance criteria missing");
    }

    // 10. capabilities
    const invalid = intent.requiredCapabilities.filter(
      (c) => canonicalizeCapability(c.capability) !== c.capability,
    );
    const hasPrimary = intent.requiredCapabilities.some(
      (c) => c.role === "primary",
    );
    if (invalid.length > 0 || !hasPrimary) {
      add(
        "capability_appropriate",
        "Required capability is appropriate",
        "fail",
        invalid.length > 0
          ? `Unknown capability: ${invalid.map((c) => c.capability).join(", ")}`
          : "No primary capability.",
      );
      blocked.push("required capability is invalid");
    } else {
      const uncovered = intent.requiredCapabilities.filter(
        (c) =>
          !input.registeredCapabilities.some((offered) =>
            capabilitySatisfies(offered, c.capability),
          ),
      );
      add(
        "capability_appropriate",
        "Required capability is appropriate",
        uncovered.length > 0 ? "warn" : "pass",
        uncovered.length > 0
          ? `No registered agent currently offers: ${uncovered.map((c) => c.capability).join(", ")} (the Agent Router decides at execution time).`
          : "Every required capability is offered by a registered agent.",
      );
    }

    // 11. ambiguity
    const high = intent.ambiguity.filter((a) => a.severity === "high");
    const low = intent.ambiguity.filter((a) => a.severity === "low");
    for (const issue of high) {
      if (!questions.includes(issue.message)) questions.push(issue.message);
    }
    if (high.length > 0) {
      add(
        "ambiguity",
        "Request is unambiguous",
        "fail",
        high.map((a) => a.message).join(" "),
      );
      if (!clarify.includes("high-risk ambiguity"))
        clarify.push("high-risk ambiguity");
    } else if (low.length > 0) {
      add(
        "ambiguity",
        "Request is unambiguous",
        "warn",
        low
          .map(
            (a) => `${a.message} Default applied: ${a.appliedDefault ?? "n/a"}`,
          )
          .join(" "),
      );
    } else {
      add("ambiguity", "Request is unambiguous", "pass", "No ambiguity.");
    }

    // 12. no secrets in the outgoing prompt
    if (containsSecret(prompt.text)) {
      add(
        "no_secrets",
        "Prompt contains no secrets",
        "fail",
        "Secret-like content was found.",
      );
      blocked.push("secret-like content in the prompt");
    } else {
      add("no_secrets", "Prompt contains no secrets", "pass", "Clean.");
    }

    const approvalRequired = approvals.length > 0;
    let status: ValidationStatus;
    let reasons: string[];
    if (blocked.length > 0) {
      status = "BLOCKED";
      reasons = blocked;
    } else if (clarify.length > 0) {
      status = "CLARIFY";
      reasons = clarify;
    } else if (approvalRequired) {
      status = "APPROVAL_REQUIRED";
      reasons = approvals;
    } else if (checks.some((c) => c.outcome === "warn")) {
      status = "WARN";
      reasons = [];
    } else {
      status = "PASS";
      reasons = [];
    }
    return {
      status,
      checks,
      reasons,
      approvalRequired,
      clarifications: status === "CLARIFY" ? questions : [],
    };
  }
}
