import { type ScopedContext } from "../../contracts/index.js";
export class ContextSystem {
  private readonly contexts = new Map<string, ScopedContext>();
  put(context: ScopedContext): void { this.contexts.set(context.taskId, { ...context, values: { ...context.values } }); }
  get(taskId: string, projectId: string): ScopedContext | undefined { const context = this.contexts.get(taskId); return context?.projectId === projectId ? { ...context, values: { ...context.values } } : undefined; }
}
