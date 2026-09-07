/**
 * Project Manager Agent.
 *
 * Two modes on the same `GeneralAgent` pipeline:
 *
 *  - `"decompose"`: turn a high-level objective into a dependency-ordered
 *    subtask plan (`ProjectManagerDecision.subtasks`).
 *  - `"summarize"`: turn a set of prior task results into a workflow-level
 *    summary + `finalStatus`.
 *
 * It makes exactly one model call and never touches a tool, a task, or the
 * agent registry — the `WorkflowEngine` is the only thing authorized to turn
 * a decision into real tasks, and it re-validates every recommendation.
 */
import {
  type Agent,
  type AgentLimits,
  type Environment,
  type ModelProvider,
  type PermissionGuard,
  type ProjectManagerDecision,
  type ProjectManagerRecommendation,
  type ProjectManagerSubtask,
  type ProjectManagerTask,
  type Task,
  type WorkflowFinalStatus,
  DEFAULT_AGENT_LIMITS,
  ProviderUnavailableError,
  validateProjectManagerDecision,
  validateProjectManagerTask,
} from "../../contracts/index.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { AgentRun, GeneralAgent } from "../../core/agents/general-agent.js";
import {
  extractJsonObject,
  toStringArray,
  truncate,
} from "../shared/text-utils.js";
import {
  PROJECT_MANAGER_AGENT_ID,
  PROJECT_MANAGER_AGENT_LIMITS,
} from "./project-manager-agent-definition.js";

export interface ProjectManagerAgentConfig {
  model?: ModelProvider;
  audit: AuditLog;
  limits?: Partial<AgentLimits>;
  clock?: () => number;
  environment?: Environment;
  logContent?: boolean;
}

const RECOMMENDATIONS: readonly ProjectManagerRecommendation[] = [
  "proceed",
  "needs_approval",
  "blocked",
];
const FINAL_STATUSES: readonly WorkflowFinalStatus[] = [
  "completed",
  "blocked",
  "failed",
];

export class ProjectManagerAgent extends GeneralAgent<
  ProjectManagerTask,
  ProjectManagerDecision
> {
  protected readonly agentId = PROJECT_MANAGER_AGENT_ID;
  protected readonly role = "project-manager";
  protected readonly limits: AgentLimits;

  private readonly model: ModelProvider | undefined;
  private readonly logContent: boolean;

  constructor(config: ProjectManagerAgentConfig) {
    super({ audit: config.audit, clock: config.clock });
    this.limits = {
      ...DEFAULT_AGENT_LIMITS,
      ...PROJECT_MANAGER_AGENT_LIMITS,
      ...(config.limits ?? {}),
    };
    this.model = config.model;
    this.logContent = config.logContent ?? false;
  }

  protected validateInput(raw: unknown): ProjectManagerTask {
    try {
      return validateProjectManagerTask(raw);
    } catch (error) {
      throw this.fail(
        "invalid_task",
        error instanceof Error ? error.message : String(error),
        {},
        error,
      );
    }
  }

  protected validateOutput(
    output: unknown,
  ): asserts output is ProjectManagerDecision {
    try {
      validateProjectManagerDecision(output);
    } catch (error) {
      throw this.fail(
        "invalid_result",
        error instanceof Error ? error.message : String(error),
        {},
        error,
      );
    }
  }

  protected async run(
    input: ProjectManagerTask,
    task: Task,
    _agent: Agent,
    run: AgentRun,
    _guard: PermissionGuard | undefined,
  ): Promise<ProjectManagerDecision> {
    run.checkDeadline();
    run.nextIteration(input.mode);

    const raw = await this.callModel(task, run, input);
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      throw this.fail(
        "model_failure",
        `${input.mode} model returned no parseable JSON`,
      );
    }

    const createdAt = new Date(this.now()).toISOString();
    const recommendation = normalizeRecommendation(parsed.recommendation);

    if (input.mode === "decompose") {
      const subtasks = normalizeSubtasks(parsed.subtasks);
      run.activity("decomposition_ready", { subtaskCount: subtasks.length });
      return {
        mode: "decompose",
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        subtasks,
        risks: toStringArray(parsed.risks),
        assumptions: toStringArray(parsed.assumptions),
        recommendation,
        createdAt,
        metadata: { objective: input.objective },
      };
    }

    run.activity("summary_ready", {});
    return {
      mode: "summarize",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      subtasks: [],
      risks: toStringArray(parsed.risks),
      assumptions: toStringArray(parsed.assumptions),
      recommendation,
      finalStatus: normalizeFinalStatus(parsed.finalStatus),
      createdAt,
      metadata: {},
    };
  }

  private async callModel(
    task: Task,
    run: AgentRun,
    input: ProjectManagerTask,
  ): Promise<string> {
    run.checkDeadline();
    run.countModelCall(input.mode);
    if (!this.model) {
      throw this.fail("model_unavailable", "no model provider configured");
    }

    const system =
      input.mode === "decompose"
        ? "You are the planning step of a project manager agent. Break the " +
          "objective into 2-6 dependency-ordered subtasks. Each subtask needs " +
          "an id, type, description, either a recommendedAgentId or " +
          "recommendedCapability, dependsOn (subtask ids), acceptanceCriteria, " +
          "and — when you know what the receiving agent needs — an `input` " +
          "object shaped for that agent's own task contract (e.g. a research " +
          "subtask's input needs objective/question; a development subtask's " +
          "input needs objective/instructions). Respond with ONLY JSON: " +
          '{"summary": string, "subtasks": [{"id": string, "type": string, ' +
          '"description": string, "recommendedAgentId": string, ' +
          '"recommendedCapability": string, "dependsOn": string[], ' +
          '"acceptanceCriteria": string[], "input": object}], "risks": ' +
          'string[], "assumptions": string[], "recommendation": ' +
          '"proceed"|"needs_approval"|"blocked"}.'
        : "You are the completion step of a project manager agent. Summarize " +
          "the given prior task results into an overall workflow summary. " +
          'Respond with ONLY JSON: {"summary": string, "risks": string[], ' +
          '"assumptions": string[], "recommendation": ' +
          '"proceed"|"needs_approval"|"blocked", "finalStatus": ' +
          '"completed"|"blocked"|"failed"}.';

    const user =
      input.mode === "decompose"
        ? [
            `Objective: ${input.objective}`,
            input.constraints.length
              ? `Constraints: ${input.constraints.join("; ")}`
              : "",
            input.availableAgents.length
              ? `Available agents/capabilities: ${input.availableAgents.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        : [
            `Objective: ${input.objective}`,
            "Prior results:",
            ...input.priorResults.map(
              (r) =>
                `- ${r.specId} (${r.agentId ?? "unassigned"}) [${r.status}]: ${r.summary}`,
            ),
          ].join("\n");

    run.activity("model_call", {
      mode: input.mode,
      ...(this.logContent
        ? { promptPreview: truncate(`${system}\n${user}`, 300) }
        : {}),
    });
    try {
      const response = await this.model.generate({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        metadata: {
          taskId: task.id,
          agentId: this.agentId,
          projectId: task.projectId,
        },
      });
      run.activity("model_result", {
        mode: input.mode,
        model: response.model,
        chars: response.content.length,
      });
      return response.content;
    } catch (error) {
      const reason =
        error instanceof ProviderUnavailableError
          ? "model_unavailable"
          : "model_failure";
      throw this.fail(
        reason,
        `model call failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error,
      );
    }
  }
}

function normalizeRecommendation(value: unknown): ProjectManagerRecommendation {
  return typeof value === "string" &&
    RECOMMENDATIONS.includes(value as ProjectManagerRecommendation)
    ? (value as ProjectManagerRecommendation)
    : "needs_approval";
}

function normalizeFinalStatus(value: unknown): WorkflowFinalStatus {
  return typeof value === "string" &&
    FINAL_STATUSES.includes(value as WorkflowFinalStatus)
    ? (value as WorkflowFinalStatus)
    : "blocked";
}

function normalizeSubtasks(value: unknown): ProjectManagerSubtask[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (s): s is Record<string, unknown> =>
        !!s && typeof s === "object" && !Array.isArray(s),
    )
    .map((s) => ({
      id: typeof s.id === "string" ? s.id : "",
      type: typeof s.type === "string" ? s.type : "",
      description: typeof s.description === "string" ? s.description : "",
      recommendedAgentId:
        typeof s.recommendedAgentId === "string"
          ? s.recommendedAgentId
          : undefined,
      recommendedCapability:
        typeof s.recommendedCapability === "string"
          ? s.recommendedCapability
          : undefined,
      dependsOn: toStringArray(s.dependsOn),
      acceptanceCriteria: toStringArray(s.acceptanceCriteria),
      input: "input" in s ? s.input : undefined,
    }))
    .filter((s) => s.id !== "" && s.type !== "" && s.description !== "");
}
