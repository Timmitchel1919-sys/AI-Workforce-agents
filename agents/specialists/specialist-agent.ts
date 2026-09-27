import {
  type Agent,
  type AgentLimits,
  type Environment,
  type ModelProvider,
  type PermissionGuard,
  type Task,
  DEFAULT_AGENT_LIMITS,
  ProviderUnavailableError,
} from "../../contracts/index.js";
import {
  type AgentDescriptor,
  type SpecialistResult,
  type SpecialistTask,
  validateSpecialistResult,
  validateSpecialistTask,
} from "../../contracts/workforce.js";
import { AuditLog } from "../../core/audit/audit-log.js";
import { AgentRun, GeneralAgent } from "../../core/agents/general-agent.js";
import { extractJsonObject, truncate } from "../shared/text-utils.js";

export interface SpecialistAgentConfig {
  descriptor: AgentDescriptor;
  model?: ModelProvider;
  audit: AuditLog;
  limits?: Partial<AgentLimits>;
  clock?: () => number;
  environment?: Environment;
  logContent?: boolean;
}

export class SpecialistAgent extends GeneralAgent<
  SpecialistTask,
  SpecialistResult
> {
  protected readonly agentId: string;
  protected readonly role: string;
  protected readonly limits: AgentLimits;

  private readonly descriptor: AgentDescriptor;
  private readonly model: ModelProvider | undefined;
  private readonly logContent: boolean;

  constructor(config: SpecialistAgentConfig) {
    super({ audit: config.audit, clock: config.clock });
    this.descriptor = config.descriptor;
    this.agentId = config.descriptor.id;
    this.role = config.descriptor.role;
    this.limits = {
      ...DEFAULT_AGENT_LIMITS,
      ...(config.limits ?? {}),
    };
    this.model = config.model;
    this.logContent = config.logContent ?? false;
  }

  protected validateInput(raw: unknown): SpecialistTask {
    try {
      return validateSpecialistTask(raw);
    } catch (error) {
      throw this.fail(
        "invalid_task",
        error instanceof Error ? error.message : String(error),
        {},
        error,
      );
    }
  }

  protected validateOutput(output: unknown): asserts output is SpecialistResult {
    try {
      validateSpecialistResult(output);
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
    input: SpecialistTask,
    task: Task,
    _agent: Agent,
    run: AgentRun,
    _guard: PermissionGuard | undefined,
  ): Promise<SpecialistResult> {
    run.checkDeadline();
    run.nextIteration(this.role);

    const raw = await this.callModel(task, run, input);
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      throw this.fail(
        "model_failure",
        `${this.role} model returned no parseable JSON`,
      );
    }
    
    run.activity("task_completed", {});

    return {
      taskId: task.id,
      agentId: this.agentId,
      summary: typeof parsed.summary === "string" ? parsed.summary : "Task completed",
      output: parsed,
      createdAt: new Date(this.now()).toISOString(),
    };
  }

  private async callModel(
    task: Task,
    run: AgentRun,
    input: SpecialistTask,
  ): Promise<string> {
    run.checkDeadline();
    run.countModelCall(this.role);
    if (!this.model) {
      throw this.fail("model_unavailable", "no model provider configured");
    }

    const system = 
      `You are the ${this.descriptor.name} (${this.descriptor.role}) in the ${this.descriptor.department} department.\n` +
      `Description: ${this.descriptor.description}\n` +
      `Your capabilities: ${this.descriptor.capabilities.join(", ")}\n` +
      `You should provide a structured JSON response to fulfill the user's objective.\n` +
      `Respond with ONLY JSON containing at least {"summary": "Brief explanation of what you did", ...other fields relevant to the task}.`;

    const user = [
      `Objective: ${input.objective}`,
      `Instructions: ${input.instructions}`,
      input.context.length
        ? `Context:\n${input.context.map((c) => `- ${c}`).join("\n")}`
        : "",
      input.acceptanceCriteria.length
        ? `Acceptance criteria:\n${input.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    run.activity("model_call", {
      mode: this.role,
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
        mode: this.role,
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
