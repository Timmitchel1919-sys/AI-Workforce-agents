/**
 * Prompt foundation.
 *
 * A `Prompt` is a versioned, project/task-scoped instruction artifact. This is
 * the data foundation only — the Prompt Engineer / composition engine is a
 * later layer. Kept deliberately small; extend fields only when a consumer
 * needs them.
 */
import type { Entity } from "./persistence.js";

/** The intent a prompt serves. Future layers may add types. */
export type PromptType =
  | "USER_INTENT"
  | "PROJECT_PROMPT"
  | "TASK_PROMPT"
  | "AGENT_PROMPT"
  | "TOOL_PROMPT";

export interface Prompt extends Entity {
  /** Scope: at least one of projectId/taskId is expected for non-user intents. */
  projectId?: string;
  taskId?: string;
  type: PromptType;
  /** The prompt text. Never a credential. */
  content: string;
  /** Monotonic revision for this prompt's lineage, starting at 1. */
  version: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}
