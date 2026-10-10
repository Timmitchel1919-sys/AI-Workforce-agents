/**
 * Task Decomposer (Layer 4).
 *
 * Converts one validated request into the SMALLEST set of tasks that does the
 * job, with dependencies, gates and resource claims. The list is generated
 * from the request: a standard task that does not apply (no repository → no
 * commit; no deployment target → no deploy; low risk → no security gate) is
 * omitted and the omission is recorded in the plan notes — never silently.
 *
 * Safety shape is structural, not advisory: code-changing plans always route
 * through test and independent review before anything integrates or deploys,
 * and destructive work is isolated in its own approval-gated task.
 */
import type {
  GateKind,
  OrchPriority,
  OrchTask,
  OrchTaskType,
} from "../../contracts/execution-orchestration.js";
import type {
  IntentAnalysis,
  ResolvedContext,
  RiskLevel,
} from "../../contracts/prompt-intelligence.js";
import { requireCanonical } from "./policies.js";

export interface DecomposeInput {
  runId: string;
  projectId: string;
  now: string;
  maxAttempts: number;
  intent: IntentAnalysis;
  context: ResolvedContext;
  promptText: string;
  acceptanceCriteria: readonly string[];
}

interface Draft {
  key: string;
  title: string;
  description: string;
  type: OrchTaskType;
  caps: string[];
  deps: string[];
  risk?: RiskLevel;
  gate?: GateKind;
  destructive?: boolean;
  approval?: boolean;
  resources?: string[];
  criteria: string[];
  prompt: string;
  correctionTarget?: string;
  independentOf?: string[];
  parent?: string;
}

const CODE_CHANGING = new Set([
  "UI_MODIFICATION",
  "THEME_MODIFICATION",
  "BUG_FIX",
  "REFACTOR",
  "FEATURE_IMPLEMENTATION",
  "CONFIGURATION",
]);

const MAX_PROMPT = 6000;

function clip(text: string, max = MAX_PROMPT): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function decompose(input: DecomposeInput): {
  tasks: OrchTask[];
  notes: string[];
} {
  const { intent, context } = input;
  const notes: string[] = [];
  const drafts: Draft[] = [];
  const primary =
    intent.requiredCapabilities.find((c) => c.role === "primary")?.capability ??
    "software.general";
  // A fact the engine knew but did not inject (not relevant to the prompt) still
  // decides the SHAPE of the plan: a bound repository means a commit step exists.
  const known = (category: "project" | "development", key: string): boolean =>
    context.byCategory[category].some((f) => f.key === key) ||
    context.excluded.some(
      (e) =>
        e.category === category &&
        e.key === key &&
        (e.reason === "not_relevant" || e.reason === "over_budget"),
    );
  const hasRepository = known("project", "repository");
  const deployFragment = known("development", "deployment")
    ? (context.byCategory.development.find((f) => f.key === "deployment") ?? {
        value: "",
      })
    : undefined;
  const firebase = /firebase/i.test(
    `${deployFragment?.value ?? ""} ${intent.objective}`,
  );
  // A mandatory security gate only where the risk justifies it (not for every tweak).
  const securityGate =
    intent.risk !== "low" || intent.category === "CONFIGURATION";
  const constraintLines = [
    ...intent.explicitConstraints,
    ...intent.impliedConstraints,
  ];
  const files = context.relevantFiles.slice(0, 8);
  const sourceResource = `source:${input.projectId}`;

  const slice = (instruction: string, extra: string[] = []): string =>
    clip(
      [
        instruction,
        `Objective: ${intent.objective}`,
        ...(constraintLines.length
          ? ["Constraints:", ...constraintLines.map((c) => `- ${c}`)]
          : []),
        ...(files.length ? [`Relevant files: ${files.join(", ")}`] : []),
        ...extra,
      ].join("\n"),
      2500,
    );

  const add = (draft: Draft): string => {
    drafts.push(draft);
    return draft.key;
  };

  const codeChange = CODE_CHANGING.has(intent.category);
  switch (intent.category) {
    case "UI_MODIFICATION":
    case "THEME_MODIFICATION":
    case "BUG_FIX":
    case "REFACTOR":
    case "FEATURE_IMPLEMENTATION":
    case "CONFIGURATION": {
      const inspect = add({
        key: "inspect",
        title: intent.target
          ? `Inspect the current ${intent.target} implementation`
          : "Inspect the current implementation",
        description:
          "Read-only: locate and understand the code that will change.",
        type: "ANALYSIS",
        caps: [primary],
        deps: [],
        risk: "low",
        criteria: [
          "Relevant files and the current implementation are identified",
          "No file was modified",
        ],
        prompt: slice("Inspect only. Do not modify any file."),
      });
      const upstream = [inspect];
      if (intent.category === "UI_MODIFICATION") {
        upstream.push(
          add({
            key: "scope",
            title: intent.scope
              ? `Identify the exact ${intent.scope} to change`
              : "Identify the exact change required",
            description:
              "Read-only: pin down the precise properties/values to change.",
            type: "ANALYSIS",
            caps: [primary],
            deps: [inspect],
            risk: "low",
            criteria: [
              "The exact properties and values to change are listed",
              "Everything outside that scope is listed as untouched",
            ],
            prompt: slice(
              "Identify exactly which properties change and which must stay untouched. Do not modify any file.",
            ),
          }),
        );
      }
      if (
        intent.category === "THEME_MODIFICATION" ||
        intent.category === "FEATURE_IMPLEMENTATION"
      ) {
        // Independent read-only analyses: safe to run in parallel.
        if (
          intent.category === "THEME_MODIFICATION" ||
          primary === "software.frontend"
        ) {
          upstream.push(
            add({
              key: "ui-analysis",
              title: "Analyse the UI and design system",
              description:
                "Read-only: how the design system and components are structured.",
              type: "DESIGN",
              caps: ["design.ui"],
              deps: [inspect],
              risk: "low",
              criteria: [
                "Design tokens, components and affected screens are identified",
              ],
              prompt: slice(
                "Analyse the design system and affected components. Do not modify any file.",
              ),
            }),
          );
        }
        if (securityGate) {
          upstream.push(
            add({
              key: "security-analysis",
              title: "Analyse security impact",
              description:
                "Read-only: what the change could affect security-wise.",
              type: "SECURITY",
              caps: ["software.security"],
              deps: [inspect],
              risk: "low",
              criteria: [
                "Security-relevant surfaces and required protections are listed",
              ],
              prompt: slice(
                "Analyse security impact only. Do not modify any file.",
              ),
            }),
          );
        }
        upstream.push(
          add({
            key: "test-analysis",
            title: "Analyse test coverage and strategy",
            description: "Read-only: which tests exist and which are needed.",
            type: "ANALYSIS",
            caps: ["software.testing"],
            deps: [inspect],
            risk: "low",
            criteria: ["Existing coverage and required new tests are listed"],
            prompt: slice("Analyse tests only. Do not modify any file."),
          }),
        );
      }
      const implement = add({
        key: "implement",
        title: intent.operation ?? intent.objective.slice(0, 100),
        description: "Make the requested change, limited to the stated scope.",
        type: "DEVELOPMENT",
        caps: [primary],
        deps: upstream,
        resources: [sourceResource],
        criteria: [...input.acceptanceCriteria],
        prompt: clip(input.promptText),
        risk: intent.risk,
      });
      const test = add({
        key: "test",
        title: "Run the automated tests",
        description: "Typecheck, lint and tests against the change.",
        type: "TEST",
        caps: ["software.testing"],
        deps: [implement],
        gate: "qa",
        correctionTarget: implement,
        criteria: [
          "Typecheck, lint and tests pass",
          "No test was weakened or removed",
        ],
        prompt: slice(
          "Run the project's own typecheck, lint and tests against the change and report every check. Do not modify source files.",
        ),
      });
      const review = add({
        key: "review",
        title: "Review the diff",
        description:
          "Independent review of the change against the request and constraints.",
        type: "REVIEW",
        caps: ["software.review"],
        deps: [test],
        gate: "review",
        correctionTarget: implement,
        independentOf: [implement],
        criteria: [
          "Only the requested scope changed",
          "Every stated constraint is preserved",
        ],
        prompt: slice(
          "Review the diff independently. Report a verdict: approved or changes_requested. Do not modify the code.",
        ),
      });
      const gates = [test, review];
      if (securityGate) {
        gates.push(
          add({
            key: "security-review",
            title: "Security review",
            description: "Independent security review of the change.",
            type: "SECURITY",
            caps: ["software.security"],
            deps: [test],
            gate: "security",
            correctionTarget: implement,
            independentOf: [implement],
            criteria: [
              "No security control is weakened",
              "No secret is exposed",
            ],
            prompt: slice(
              "Review the change for security impact. Report a verdict. Do not modify the code.",
            ),
          }),
        );
      } else {
        notes.push("Security review omitted: the request is low risk.");
      }
      const build = add({
        key: "build",
        title: "Build the application",
        description: "Production build of the verified change.",
        type: "DEVELOPMENT",
        caps: [primary],
        deps: gates,
        // A failing build goes back to the developer (a gate), not into a blind retry loop.
        gate: "qa",
        correctionTarget: implement,
        criteria: ["The production build passes"],
        prompt: slice(
          "Run the project's production build and report the result. Do not modify source files.",
        ),
      });
      let tail = build;
      if (hasRepository) {
        tail = add({
          key: "commit",
          title: "Commit the change",
          description: "Commit the verified change (requires human approval).",
          type: "INTEGRATION",
          caps: ["integration.github"],
          deps: [build],
          approval: true,
          risk: "medium",
          resources: [`git:${input.projectId}`],
          criteria: ["A commit containing only the verified change exists"],
          prompt: slice(
            "Commit exactly the verified change set with a clear message. Do not push unless separately approved.",
          ),
        });
      } else {
        notes.push("Commit omitted: no repository is bound to this project.");
      }
      if (deployFragment) {
        add({
          key: "deploy",
          title: "Deploy the change",
          description: "Deploy the committed change (requires human approval).",
          type: "DEPLOYMENT",
          caps: [firebase ? "deployment.firebase" : "deployment"],
          deps: [tail],
          approval: true,
          risk: intent.risk === "high" ? "high" : "medium",
          resources: [`deploy:${input.projectId}`],
          criteria: ["The deployment is verified healthy"],
          prompt: slice(
            "Deploy only the affected resources through the project's configured mechanism and verify.",
          ),
        });
      } else {
        notes.push(
          "Deploy omitted: no deployment target is known for this project.",
        );
      }
      break;
    }
    case "TESTING": {
      const inspect = add({
        key: "inspect",
        title: "Inspect existing tests",
        description: "Read-only.",
        type: "ANALYSIS",
        caps: ["software.testing"],
        deps: [],
        risk: "low",
        criteria: ["Existing coverage is described"],
        prompt: slice("Inspect existing tests. Do not modify any file."),
      });
      add({
        key: "tests",
        title: "Write and run the tests",
        description: "Author tests and run them.",
        type: "TEST",
        caps: ["software.testing"],
        deps: [inspect],
        resources: [sourceResource],
        gate: "qa",
        criteria: [...input.acceptanceCriteria],
        prompt: clip(input.promptText),
      });
      break;
    }
    case "CODE_REVIEW":
      add({
        key: "review",
        title: "Review the code",
        description: "Read-only review.",
        type: "REVIEW",
        caps: ["software.review"],
        deps: [],
        risk: "low",
        criteria: ["Findings are classified by severity"],
        prompt: clip(input.promptText),
      });
      break;
    case "SECURITY_REVIEW":
      add({
        key: "security-review",
        title: "Security review",
        description: "Read-only security review.",
        type: "SECURITY",
        caps: ["software.security"],
        deps: [],
        risk: "low",
        criteria: ["Findings are classified by severity"],
        prompt: clip(input.promptText),
      });
      break;
    case "DOCUMENTATION": {
      const inspect = add({
        key: "inspect",
        title: "Inspect existing documentation",
        description: "Read-only.",
        type: "ANALYSIS",
        caps: [primary],
        deps: [],
        risk: "low",
        criteria: ["Gaps are identified"],
        prompt: slice(
          "Read the existing documentation. Do not modify any file.",
        ),
      });
      const write = add({
        key: "write",
        title: "Update the documentation",
        description: "Edit documentation only.",
        type: "DOCUMENTATION",
        caps: [primary],
        deps: [inspect],
        resources: [sourceResource],
        criteria: [...input.acceptanceCriteria],
        prompt: clip(input.promptText),
      });
      add({
        key: "review",
        title: "Review the documentation",
        description: "Independent review.",
        type: "REVIEW",
        caps: ["software.review"],
        deps: [write],
        gate: "review",
        independentOf: [write],
        correctionTarget: write,
        criteria: ["Accurate and within scope"],
        prompt: slice("Review the documentation change. Report a verdict."),
      });
      break;
    }
    case "RESEARCH":
      add({
        key: "research",
        title: "Research the question",
        description: "Sourced research.",
        type: "RESEARCH",
        caps: [primary],
        deps: [],
        risk: "low",
        criteria: ["Sources and a recommendation are given"],
        prompt: clip(input.promptText),
      });
      break;
    case "DATA_ANALYSIS":
      add({
        key: "analysis",
        title: "Analyse the data",
        description: "Analysis.",
        type: "ANALYSIS",
        caps: [primary],
        deps: [],
        risk: "low",
        criteria: ["Method, data and conclusions are stated"],
        prompt: clip(input.promptText),
      });
      break;
    case "PROJECT_MANAGEMENT":
      add({
        key: "plan",
        title: "Produce the project plan",
        description: "Planning only.",
        type: "ANALYSIS",
        caps: [primary],
        deps: [],
        risk: "low",
        criteria: ["Milestones, owners and risks are listed"],
        prompt: clip(input.promptText),
      });
      break;
    case "DEPLOYMENT": {
      const verify = add({
        key: "verify",
        title: "Verify release prerequisites",
        description: "Tests and build must be green.",
        type: "TEST",
        caps: ["software.testing"],
        deps: [],
        gate: "qa",
        criteria: ["Validation passes before release"],
        prompt: slice("Run the project's validation and report every check."),
      });
      const deps = [verify];
      if (intent.risk !== "low") {
        deps.push(
          add({
            key: "security-gate",
            title: "Security release gate",
            description: "Release security review.",
            type: "SECURITY",
            caps: ["software.security"],
            deps: [verify],
            gate: "security",
            criteria: ["No blocking security finding"],
            prompt: slice(
              "Review the release for security impact. Report a verdict.",
            ),
          }),
        );
      }
      const deploy = add({
        key: "deploy",
        title: "Deploy",
        description: "Governed deployment (requires human approval).",
        type: "DEPLOYMENT",
        caps: [firebase ? "deployment.firebase" : "deployment"],
        deps,
        approval: true,
        risk: intent.risk,
        resources: [`deploy:${input.projectId}`],
        criteria: ["Deployment verified healthy"],
        prompt: clip(input.promptText),
      });
      add({
        key: "verify-deploy",
        title: "Verify the deployment",
        description: "Post-deploy verification.",
        type: "TEST",
        caps: ["software.testing"],
        deps: [deploy],
        criteria: ["The live system is healthy"],
        prompt: slice("Verify the live deployment and report evidence."),
      });
      break;
    }
    case "DESTRUCTIVE_OPERATION": {
      const assess = add({
        key: "assess",
        title: "Assess impact and reversibility",
        description:
          "Read-only: what would be removed, blast radius, backup/rollback.",
        type: "ANALYSIS",
        caps: [primary],
        deps: [],
        risk: "low",
        criteria: ["Exact targets, blast radius and rollback are listed"],
        prompt: slice("Assess only. Do not delete or modify anything."),
      });
      const execute = add({
        key: "execute",
        title: `Perform the destructive operation: ${intent.destructive.map((d) => d.kind).join(", ")}`,
        description: "Destructive. Runs only after an explicit human approval.",
        type: "MAINTENANCE",
        caps: [primary],
        deps: [assess],
        destructive: true,
        approval: true,
        risk: "high",
        resources: [sourceResource],
        criteria: [
          "Only the approved targets were affected",
          "An audit trail exists",
        ],
        prompt: slice(
          "Perform ONLY the approved operation on the approved targets.",
        ),
      });
      add({
        key: "verify",
        title: "Verify the outcome",
        description: "Independent verification.",
        type: "REVIEW",
        caps: ["software.review"],
        deps: [execute],
        gate: "review",
        independentOf: [execute],
        criteria: ["Only the approved targets were affected"],
        prompt: slice("Verify the outcome independently and report a verdict."),
      });
      notes.push(
        "Destructive operation: execution is isolated in an approval-gated task and never starts without a human decision.",
      );
      break;
    }
    case "UNKNOWN":
      add({
        key: "clarify",
        title: "Clarify the objective",
        description: "Planning only.",
        type: "ANALYSIS",
        caps: ["project.management"],
        deps: [],
        risk: "low",
        criteria: ["Objective, target and expected result are confirmed"],
        prompt: clip(input.promptText),
      });
      break;
  }
  if (!codeChange && intent.category !== "DESTRUCTIVE_OPERATION") {
    notes.push(
      "Non-code request: no implementation, build, commit or deploy tasks were generated.",
    );
  }

  // Materialize: stable ids, canonical capabilities, defaults.
  const idOf = new Map(
    drafts.map((d, i) => [d.key, `${input.runId}-t${i + 1}`]),
  );
  const priority: OrchPriority = intent.risk === "high" ? "high" : "normal";
  const tasks: OrchTask[] = drafts.map((d) => ({
    taskId: idOf.get(d.key)!,
    runId: input.runId,
    projectId: input.projectId,
    ...(d.parent ? { parentTaskId: idOf.get(d.parent)! } : {}),
    title: d.title,
    description: d.description,
    type: d.type,
    requiredCapabilities: requireCanonical(d.caps),
    dependencies: d.deps.map((k) => idOf.get(k)!),
    priority,
    risk: d.risk ?? intent.risk,
    status: "PENDING",
    permittedTools: [],
    deniedTools: [],
    acceptanceCriteria: d.criteria,
    prompt: d.prompt,
    destructive: d.destructive === true,
    requiresApproval: d.approval === true,
    ...(d.gate ? { gate: d.gate } : {}),
    ...(d.correctionTarget
      ? { correctionTarget: idOf.get(d.correctionTarget)! }
      : {}),
    resources: d.resources ?? [],
    excludedAgents: [],
    independentOf: (d.independentOf ?? []).map((k) => idOf.get(k)!),
    attempts: 0,
    maxAttempts: input.maxAttempts,
    corrections: 0,
    failures: [],
    estimate: {
      inputTokens: Math.ceil(d.prompt.length / 4),
      note: "characters/4 estimate; no price is implied",
    },
    createdAt: input.now,
    updatedAt: input.now,
  }));
  return { tasks, notes };
}
