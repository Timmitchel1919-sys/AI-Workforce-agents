/**
 * Prompt Engineer (Phase 3).
 *
 * Turns an analysed intent + resolved context into a structured, agent-ready
 * execution prompt. Deterministic and template-driven: the same inputs always
 * produce the same prompt, every line is traceable to the intent or to a
 * context fragment, and nothing is invented.
 *
 * Verbosity is controlled by omission: a section with nothing to say is not
 * rendered, project facts already known are stated once, and context is the
 * relevance-filtered set from the Context Engine — never the whole project.
 */
import type {
  GeneratedPrompt,
  IntentAnalysis,
  IntentCategory,
  PromptSections,
  ResolvedContext,
  ResolvedFragment,
} from "../../contracts/prompt-intelligence.js";
import { containsSecret } from "./secret-scan.js";

export interface PromptEngineerInput {
  requestId: string;
  version: number;
  projectId: string;
  taskId?: string;
  intent: IntentAnalysis;
  context: ResolvedContext;
  createdAt: string;
}

const ROLE_BY_CAPABILITY: Readonly<Record<string, string>> = {
  "software.frontend": "senior frontend engineer",
  "software.backend": "senior backend engineer",
  "software.general": "senior software engineer",
  "software.testing": "senior test engineer",
  "software.review": "independent code reviewer",
  "software.security": "security engineer",
  "design.ui": "senior UI/UX designer-engineer",
  deployment: "release engineer",
  "deployment.firebase": "release engineer for Firebase",
  "integration.github": "source-control engineer",
  research: "research analyst",
  data: "data analyst",
  "project.management": "technical project manager",
};

function lines(fragments: readonly ResolvedFragment[], max = 8): string[] {
  return fragments.slice(0, max).map((f) => `${f.value}`);
}

function cmd(context: ResolvedContext, stage: string): string | undefined {
  const fragment = context.byCategory.development.find(
    (f) => f.key === `command.${stage}`,
  );
  return fragment?.value.replace(/^[a-z]+:\s*/i, "");
}

const STEPS: Readonly<
  Record<
    IntentCategory,
    (i: IntentAnalysis, files: readonly string[]) => string[]
  >
> = {
  UI_MODIFICATION: (i, files) => [
    `Identify the component(s) that render the ${i.target ?? "target"}${files.length ? ` (start with: ${files.slice(0, 3).join(", ")})` : ""}.`,
    "Inspect the current implementation and styles before changing anything.",
    `Make the smallest change that satisfies: ${i.operation ?? i.objective}`,
    "Leave every property outside that scope exactly as it is.",
    "Run the project's validation (typecheck, lint, tests, build) and fix only regressions you introduced.",
    "Report the changed files and exactly what changed in each.",
  ],
  THEME_MODIFICATION: (i) => [
    `Inventory how the current ${i.target ?? "theme"} is defined (tokens, CSS, theme provider).`,
    "Implement the new theme through the existing theme/token mechanism; do not hard-code colours in components.",
    "Verify the other theme and all themed components still render correctly.",
    "Run the project's validation (typecheck, lint, tests, build).",
    "Report the changed files.",
  ],
  FEATURE_IMPLEMENTATION: () => [
    "Read the relevant architecture and existing modules; reuse them instead of duplicating.",
    "Define interfaces/contracts first, then implement the smallest complete slice.",
    "Add or update tests alongside the implementation.",
    "Run the project's validation (typecheck, lint, tests, build).",
    "Report the changed files and any follow-up work.",
  ],
  BUG_FIX: () => [
    "Reproduce the defect and capture the failing behaviour.",
    "Find the root cause; do not patch the symptom.",
    "Fix it without weakening any security control or test.",
    "Add a regression test that fails before the fix and passes after.",
    "Run the project's validation and report the changed files.",
  ],
  REFACTOR: () => [
    "Record a green test baseline before changing anything.",
    "Refactor in small steps; behaviour must not change.",
    "Keep existing tests unchanged and passing.",
    "Run the project's validation and report the changed files.",
  ],
  TESTING: () => [
    "Identify the behaviour and risk areas that lack coverage.",
    "Write deterministic tests; never weaken or delete existing tests to pass.",
    "Run them and report results and any gaps.",
  ],
  CODE_REVIEW: () => [
    "Review the change against the stated requirements, architecture and security rules.",
    "Classify findings as blocker, critical, major, minor or informational with file references.",
    "Do not modify the code under review.",
  ],
  SECURITY_REVIEW: () => [
    "Inspect authentication, authorization, secret handling, input validation and data isolation.",
    "Classify findings by severity with a concrete failure scenario and fix for each.",
    "Do not modify code; report findings only.",
  ],
  DEPLOYMENT: () => [
    "Confirm the change set to release and that validation has passed.",
    "Deploy only the affected resources through the project's configured mechanism.",
    "Verify the deployment (health and the changed behaviour) before reporting success.",
    "Report exactly what was deployed and what was verified.",
  ],
  DOCUMENTATION: () => [
    "Read the existing documentation and the code it describes.",
    "Update only what is inaccurate or missing; keep the existing structure and tone.",
    "Report the changed files.",
  ],
  RESEARCH: () => [
    "State the questions to answer and the sources consulted.",
    "Separate verified facts from inference.",
    "Conclude with a recommendation and its trade-offs.",
  ],
  DATA_ANALYSIS: () => [
    "State the data used and its limits.",
    "Describe the method, then the results.",
    "Do not present estimates as measurements.",
  ],
  PROJECT_MANAGEMENT: () => [
    "Break the objective into tasks with dependencies and owners (capabilities).",
    "Identify risks and approval points.",
    "Produce a plan; do not start execution.",
  ],
  CONFIGURATION: () => [
    "Inspect the current configuration and where it is consumed.",
    "Change only the named setting; never print or commit secret values.",
    "Verify behaviour after the change and report the changed files.",
  ],
  DESTRUCTIVE_OPERATION: () => [
    "DO NOT execute anything destructive in this step.",
    "Prepare a plan: exactly what would be removed, its blast radius, whether it is reversible, and the backup/rollback.",
    "Wait for explicit human approval of this request before any execution.",
  ],
  UNKNOWN: () => [
    "Do not act yet: the request is not specific enough.",
    "Ask the requester to clarify the objective, the target and the expected result.",
  ],
};

function acceptance(i: IntentAnalysis): string[] {
  const out: string[] = [];
  switch (i.category) {
    case "UI_MODIFICATION":
      out.push(
        `Only ${i.scope ?? "the requested aspect"} of the ${i.target ?? "target"} changed.`,
      );
      if (i.impliedConstraints.some((c) => /authentication/i.test(c)))
        out.push("Authentication remains functional.");
      out.push("Responsive layouts remain intact.");
      break;
    case "THEME_MODIFICATION":
      out.push("The new theme is applied consistently across components.");
      out.push("The other theme and all functionality are unchanged.");
      break;
    case "BUG_FIX":
      out.push(
        "The defect no longer reproduces and a regression test covers it.",
      );
      break;
    case "FEATURE_IMPLEMENTATION":
      out.push("The feature works as described and is covered by tests.");
      break;
    case "REFACTOR":
      out.push("Behaviour is unchanged and all existing tests pass.");
      break;
    case "DESTRUCTIVE_OPERATION":
      out.push("Nothing is executed before the approval is granted.");
      out.push("An approved operation leaves an audit trail.");
      break;
    case "DEPLOYMENT":
      out.push("The deployed change is verified healthy.");
      break;
    case "UNKNOWN":
      out.push(
        "The objective, target and expected result are confirmed by the requester.",
      );
      break;
    default:
      out.push(i.expectedOutput);
  }
  for (const constraint of i.explicitConstraints)
    out.push(`Satisfied: ${constraint}`);
  if (
    ![
      "CODE_REVIEW",
      "SECURITY_REVIEW",
      "RESEARCH",
      "DATA_ANALYSIS",
      "PROJECT_MANAGEMENT",
      "UNKNOWN",
      "DESTRUCTIVE_OPERATION",
    ].includes(i.category)
  ) {
    out.push("Typecheck, lint, tests and build pass.");
    out.push(
      "The changed files are listed and none is unrelated to the request.",
    );
  }
  return [...new Set(out)];
}

/** Compose the structured prompt sections. */
function buildSections(input: PromptEngineerInput): PromptSections {
  const { intent, context } = input;
  const primary = intent.requiredCapabilities.find((c) => c.role === "primary");
  const role = `You are a ${ROLE_BY_CAPABILITY[primary?.capability ?? ""] ?? "software engineer"} working on ${intent.project.displayName ?? input.projectId}.`;
  const byKey = (category: keyof ResolvedContext["byCategory"]) =>
    context.byCategory[category];

  const project = byKey("project").map((f) =>
    f.key === "identity" ? f.value : `${f.key}: ${f.value}`,
  );
  const security = lines(byKey("security"), 12);
  const approvalNeeded = intent.destructive.length > 0;
  if (approvalNeeded) {
    security.push(
      `This request involves a destructive operation (${intent.destructive.map((d) => d.kind).join(", ")}): do not execute any step until the human approval for this request is granted.`,
    );
  }
  if (intent.securityOverrideAttempts.length > 0) {
    security.push(
      "Parts of the request conflict with security requirements and are NOT applied; the security rules above prevail.",
    );
  }
  const uiux = lines(byKey("ui"));
  if (["UI_MODIFICATION", "THEME_MODIFICATION"].includes(intent.category)) {
    uiux.push(
      "Reuse existing design-system components and tokens; do not introduce new colours, fonts or spacing values.",
    );
  }
  const dev = byKey("development");
  const technical = [
    ...intent.explicitConstraints,
    ...intent.impliedConstraints,
    ...lines(
      dev.filter(
        (f) => !f.key.startsWith("command.") && f.key !== "deployment",
      ),
      6,
    ),
    ...lines(
      byKey("architecture").filter(
        (f) => f.precedence === "project_architecture_rule",
      ),
      4,
    ),
  ];
  const scope: string[] = [];
  if (intent.target) scope.push(`Target: ${intent.target}`);
  if (intent.operation) scope.push(`Change: ${intent.operation}`);
  if (intent.scope && intent.category !== "THEME_MODIFICATION")
    scope.push(`Limited to: ${intent.scope}`);
  for (const a of intent.ambiguity) {
    if (a.appliedDefault)
      scope.push(`Assumed (${a.code}): ${a.appliedDefault}`);
  }

  const validation = [
    "Run the project's own validation before reporting completion:",
  ];
  const stages = ["install", "typecheck", "lint", "test", "build"] as const;
  const known = stages
    .map((s) => ({ s, c: cmd(context, s) }))
    .filter((x) => x.c);
  if (known.length > 0) {
    for (const { s, c } of known) validation.push(`${s}: ${c}`);
  } else {
    validation.push(
      "typecheck, lint, tests and build (commands are not established; use the project's own scripts — do not guess).",
    );
  }
  validation.push("Report the list of changed files.");
  const readOnly = [
    "CODE_REVIEW",
    "SECURITY_REVIEW",
    "RESEARCH",
    "DATA_ANALYSIS",
    "PROJECT_MANAGEMENT",
    "UNKNOWN",
    "DESTRUCTIVE_OPERATION",
  ].includes(intent.category);

  const deploymentFragment = dev.find((f) => f.key === "deployment");
  const deployment =
    intent.category === "DEPLOYMENT"
      ? [
          deploymentFragment?.value ??
            "Use the project's configured deployment mechanism only.",
          "Deploy only affected resources and verify before reporting.",
        ]
      : [
          "Do not deploy as part of this task; deployment is a separate, governed step.",
        ];

  return {
    role,
    project: project.join(" · "),
    objective: intent.objective,
    context: lines(
      [
        ...byKey("architecture"),
        ...byKey("knowledge"),
        ...byKey("task"),
        ...byKey("preference"),
      ],
      8,
    ),
    scope,
    requirements: [intent.expectedOutput],
    nonFunctional: [
      "UI_MODIFICATION",
      "THEME_MODIFICATION",
      "FEATURE_IMPLEMENTATION",
    ].includes(intent.category)
      ? ["Responsive layouts remain intact.", "Accessibility is not regressed."]
      : [],
    technicalConstraints: [...new Set(technical)],
    uiux,
    security,
    relevantFiles: [...context.relevantFiles],
    dependencies: byKey("task")
      .filter((f) => f.key.startsWith("dependency."))
      .map((f) => f.value),
    requiredCapability: intent.requiredCapabilities.map(
      (c) => `${c.role}: ${c.capability} — ${c.reason}`,
    ),
    implementationSteps: STEPS[intent.category](intent, context.relevantFiles),
    validation:
      readOnly && intent.category !== "DESTRUCTIVE_OPERATION"
        ? ["Report your findings with evidence."]
        : validation,
    acceptanceCriteria: acceptance(intent),
    deployment,
  };
}

const HEADINGS: ReadonlyArray<readonly [keyof PromptSections, string]> = [
  ["project", "Project"],
  ["objective", "Objective"],
  ["scope", "Scope"],
  ["context", "Context"],
  ["requirements", "Requirements"],
  ["technicalConstraints", "Constraints"],
  ["nonFunctional", "Non-functional requirements"],
  ["uiux", "UI/UX"],
  ["security", "Security"],
  ["relevantFiles", "Relevant files"],
  ["dependencies", "Dependencies"],
  ["requiredCapability", "Required capability"],
  ["implementationSteps", "Steps"],
  ["validation", "Validation"],
  ["acceptanceCriteria", "Acceptance criteria"],
  ["deployment", "Deployment"],
];

function render(input: PromptEngineerInput, sections: PromptSections): string {
  const out: string[] = [
    sections.role,
    `(request ${input.requestId} · prompt v${input.version})`,
    "",
  ];
  for (const [key, title] of HEADINGS) {
    const value = sections[key];
    const items = Array.isArray(value) ? value : value ? [value] : [];
    if (items.length === 0) continue;
    out.push(`## ${title}`);
    if (Array.isArray(value)) {
      const numbered = key === "implementationSteps";
      items.forEach((item, index) =>
        out.push(numbered ? `${index + 1}. ${item}` : `- ${item}`),
      );
    } else {
      out.push(items[0]!);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

export class PromptEngineer {
  generate(input: PromptEngineerInput): GeneratedPrompt {
    const sections = buildSections(input);
    const text = render(input, sections);
    // Defence in depth: every input was already scanned; fail closed anyway.
    if (containsSecret(text)) {
      throw new Error("generated prompt contained secret-like content");
    }
    return {
      version: input.version,
      sections,
      text,
      entity: {
        id: `${input.requestId}-v${input.version}`,
        projectId: input.projectId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        type: "TASK_PROMPT",
        content: text,
        version: input.version,
        createdAt: input.createdAt,
        metadata: {
          requestId: input.requestId,
          intent: input.intent.category,
          capabilities: input.intent.requiredCapabilities.map(
            (c) => c.capability,
          ),
        },
      },
    };
  }
}
