import type {
  ApprovalState,
  PromptRequestSummary,
  PromptRequestView,
  ValidationStatus,
} from "../types";

export interface ViewOptions {
  requestId?: string;
  status?: ValidationStatus;
  approval?: ApprovalState;
  executionReady?: boolean;
  blockedBy?: string[];
  reasons?: string[];
  clarifications?: string[];
  request?: string;
  projectId?: string;
}

/** A complete, realistic view; individual tests tweak status/approval only. */
export function makeView(options: ViewOptions = {}): PromptRequestView {
  const status = options.status ?? "PASS";
  const approval = options.approval ?? (status === "APPROVAL_REQUIRED" ? "required" : "not_required");
  const requestId = options.requestId ?? "req-1";
  const projectId = options.projectId ?? "money-mind";
  const executionReady = options.executionReady ?? (status === "PASS" || status === "WARN");
  const capabilities = [
    { capability: "frontend.ui", role: "primary" as const, reason: "The request changes the login card." },
    { capability: "qa.review", role: "verification" as const, reason: "Visual regression check." },
  ];
  return {
    record: {
      id: requestId,
      requestId,
      projectId,
      requestedBy: "op@example.test",
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:00:00.000Z",
      request: options.request ?? "Make the login card shorter",
      intent: {
        language: "en",
        category: "UI_MODIFICATION",
        objective: "Reduce the vertical size of the login card",
        project: { projectId, displayName: "Money Mind", via: "explicit", candidates: [] },
        target: "login card",
        operation: "resize",
        scope: "vertical dimensions",
        explicitConstraints: ["Keep the existing colours"],
        impliedConstraints: ["Preserve accessibility"],
        expectedOutput: "Updated component",
        risk: status === "BLOCKED" ? "high" : "low",
        risks: [],
        requiredCapabilities: capabilities,
        ambiguity: [
          { code: "A1", message: "No exact size given", severity: "low", appliedDefault: "Reduce padding by 20%" },
          ...(status === "CLARIFY" ? [{ code: "A2", message: "Which login card?", severity: "high" as const }] : []),
        ],
        destructive: status === "APPROVAL_REQUIRED" ? [{ kind: "file_deletion" as const, matched: "delete the old card" }] : [],
        securityOverrideAttempts: status === "BLOCKED" ? ["disable authentication"] : [],
        keywords: ["login", "card"],
        analyzer: "rules",
      },
      context: {
        projectId,
        fragments: [
          {
            category: "ui",
            key: "design.tokens",
            value: "Use the shared theme tokens",
            source: "design-system",
            origin: "Design system guide",
            authority: "curated",
            precedence: "project_documentation",
            sensitivity: "internal",
            relevance: { score: 0.9, reasons: ["Matches keyword login", "UI category request"] },
          },
          {
            category: "security",
            key: "auth.no-bypass",
            value: "Authentication must never be bypassed",
            source: "policy",
            origin: "Security policy",
            authority: "authoritative",
            precedence: "project_security_policy",
            sensitivity: "internal",
            mandatory: true,
            relevance: { score: 1, reasons: ["Mandatory security fragment"] },
          },
        ],
        byCategory: { project: [], architecture: [], ui: [], security: [], development: [], preference: [], task: [], knowledge: [] },
        relevantFiles: ["src/components/LoginCard.tsx"],
        previousDecisions: [],
        constraints: [],
        conflicts: [
          {
            category: "ui",
            key: "card.height",
            winner: { source: "policy", precedence: "project_security_policy", value: "min 320" },
            overridden: { source: "user", precedence: "explicit_user_instruction", value: "min 200" },
          },
        ],
        excluded: [
          { category: "ui", key: "a", source: "docs", reason: "not_relevant" },
          { category: "ui", key: "b", source: "docs", reason: "not_relevant" },
          { category: "task", key: "c", source: "tasks", reason: "over_budget" },
        ],
        sources: [
          { source: "design-system", status: "ok", fragments: 1 },
          { source: "repo-files", status: "unavailable", fragments: 0, note: "Repository not connected" },
          { source: "tasks", status: "empty", fragments: 0 },
        ],
        missing: ["architecture"],
        audience: { capabilities: ["frontend.ui"], clearance: "internal" },
        resolvedAt: "2026-05-01T10:00:00.000Z",
      },
      prompt: {
        version: 2,
        sections: {
          role: "You are a frontend engineer.",
          project: "Money Mind",
          objective: "Reduce card height",
          context: ["Use theme tokens"],
          scope: [],
          requirements: ["Keep colours"],
          nonFunctional: [],
          technicalConstraints: [],
          uiux: [],
          security: ["Never bypass authentication"],
          relevantFiles: [],
          dependencies: [],
          requiredCapability: [],
          implementationSteps: [],
          validation: [],
          acceptanceCriteria: [],
          deployment: [],
        },
        text: "ROLE: frontend engineer\nOBJECTIVE: reduce the login card height <script>alert(1)</script>",
      },
      validation: {
        status,
        checks: [
          { key: "c1", title: "Secrets scan", outcome: "pass", detail: "No credential found" },
          { key: "c2", title: "Ambiguity", outcome: status === "CLARIFY" ? "fail" : "warn", detail: "Size not specified" },
          { key: "c3", title: "Scope", outcome: "info", detail: "Single component" },
        ],
        reasons: options.reasons ?? (status === "BLOCKED" ? ["Request tries to disable authentication"] : []),
        approvalRequired: status === "APPROVAL_REQUIRED",
        clarifications: options.clarifications ?? (status === "CLARIFY" ? ["Which login card do you mean?"] : []),
      },
      approval: { state: approval },
      executionState: "not_started",
      contextSources: ["design-system"],
      revision: 1,
    },
    execution: {
      requestId,
      projectId,
      promptVersion: 2,
      prompt: "ROLE: frontend engineer",
      requiredCapabilities: capabilities,
      validation: status,
      approval: { state: approval },
      executionReady,
      blockedBy: options.blockedBy ?? (executionReady ? [] : ["Not ready: see validation"]),
    },
  };
}

export function summaryOf(view: PromptRequestView, createdAt = view.record.createdAt): PromptRequestSummary {
  return {
    requestId: view.record.requestId,
    projectId: view.record.projectId,
    requestedBy: view.record.requestedBy,
    createdAt,
    intent: view.record.intent.category,
    validation: view.execution.validation,
    approval: view.execution.approval.state,
    executionReady: view.execution.executionReady,
    requiredCapabilities: view.execution.requiredCapabilities.map((c) => c.capability),
    request: view.record.request,
  };
}
