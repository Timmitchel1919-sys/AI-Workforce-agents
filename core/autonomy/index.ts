import type {
  AutonomousWorkflowDef,
  AutonomyAuditEvent,
  AutonomyGlobal,
  AutonomySetting,
  TriggerRule,
  WorkflowInstance,
} from "../../contracts/autonomy.js";
import type { Repository } from "../../contracts/persistence.js";
import { InMemoryRepository } from "../persistence/in-memory-repository.js";
import type {
  ActionContext,
  ActionExecutor,
  ActionResult,
  AutonomyRepos,
} from "./engine.js";

export * from "./catalog.js";
export * from "./engine.js";

export function inMemoryAutonomyRepos(): AutonomyRepos {
  const r = <T extends { id: string }>() =>
    new InMemoryRepository<T>() as Repository<T>;
  return {
    settings: r<AutonomySetting>(),
    global: r<AutonomyGlobal>(),
    definitions: r<AutonomousWorkflowDef>(),
    rules: r<TriggerRule>(),
    instances: r<WorkflowInstance>(),
    audit: r<AutonomyAuditEvent>(),
  };
}

type Handler = (ctx: ActionContext) => Promise<ActionResult> | ActionResult;

/**
 * The executor only offers the actions whose handler was actually wired. An action without a
 * handler is reported UNAVAILABLE and the workflow blocks with that reason: nothing is simulated.
 */
export class PlatformActionExecutor implements ActionExecutor {
  constructor(
    private readonly handlers: Record<string, Handler | undefined>,
    private readonly reasons: Record<string, string> = {},
  ) {}

  available(actionId: string): { ok: boolean; reason: string } {
    return this.handlers[actionId]
      ? { ok: true, reason: "available" }
      : {
          ok: false,
          reason:
            this.reasons[actionId] ??
            `"${actionId}" is not available in this deployment (no executor is wired for it)`,
        };
  }

  async execute(actionId: string, ctx: ActionContext): Promise<ActionResult> {
    const h = this.handlers[actionId];
    if (!h)
      return {
        ok: false,
        error: {
          kind: "UNAVAILABLE",
          message: this.available(actionId).reason,
        },
      };
    return h(ctx);
  }
}
