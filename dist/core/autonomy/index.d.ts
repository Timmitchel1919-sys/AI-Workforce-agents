import type { ActionContext, ActionExecutor, ActionResult, AutonomyRepos } from "./engine.js";
export * from "./catalog.js";
export * from "./engine.js";
export declare function inMemoryAutonomyRepos(): AutonomyRepos;
type Handler = (ctx: ActionContext) => Promise<ActionResult> | ActionResult;
/**
 * The executor only offers the actions whose handler was actually wired. An action without a
 * handler is reported UNAVAILABLE and the workflow blocks with that reason: nothing is simulated.
 */
export declare class PlatformActionExecutor implements ActionExecutor {
    private readonly handlers;
    private readonly reasons;
    constructor(handlers: Record<string, Handler | undefined>, reasons?: Record<string, string>);
    available(actionId: string): {
        ok: boolean;
        reason: string;
    };
    execute(actionId: string, ctx: ActionContext): Promise<ActionResult>;
}
