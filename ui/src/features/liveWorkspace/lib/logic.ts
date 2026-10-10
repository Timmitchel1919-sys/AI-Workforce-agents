import type {
  CommandRecord, FileChange, RuntimeEvent, RuntimeSession, RuntimeState,
} from "../types";
import { TERMINAL_RUNTIME_STATES } from "../types";

export function isTerminal(status: RuntimeState | undefined): boolean {
  return status !== undefined && TERMINAL_RUNTIME_STATES.includes(status);
}

export function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

export function sessionDurationMs(session: RuntimeSession): number | undefined {
  if (!session.startedAt || !session.completedAt) return undefined;
  const ms = Date.parse(session.completedAt) - Date.parse(session.startedAt);
  return Number.isFinite(ms) ? ms : undefined;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Latest change per path, so the tree can badge each file once. */
export function changesByPath(changes: readonly FileChange[]): Map<string, FileChange> {
  const map = new Map<string, FileChange>();
  for (const change of changes) map.set(change.path, change);
  return map;
}

export function badgeKeyFor(operation: FileChange["operation"]): string {
  switch (operation) {
    case "create": return "created";
    case "update": return "modified";
    case "delete": return "deleted";
    case "rename": return "renamed";
    default: return "moved";
  }
}

export type DiffLineKind = "add" | "del" | "hunk" | "ctx";

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "ctx";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

export function sortEntries<T extends { path: string; type: "file" | "dir" }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return baseName(a.path).localeCompare(baseName(b.path));
  });
}

/** Merge new events into a list by seq (idempotent), bounded. */
export function mergeEvents(existing: readonly RuntimeEvent[], incoming: readonly RuntimeEvent[], max: number): RuntimeEvent[] {
  const seen = new Set(existing.map((e) => e.seq));
  const added = incoming.filter((e) => !seen.has(e.seq));
  if (added.length === 0) return existing as RuntimeEvent[];
  const merged = [...existing, ...added].sort((a, b) => a.seq - b.seq);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export function lastSeq(events: readonly RuntimeEvent[]): number {
  return events.reduce((max, e) => (e.seq > max ? e.seq : max), 0);
}

/* ------------------------------------------------------------------ */
/* Terminal lines                                                     */
/* ------------------------------------------------------------------ */

export type TerminalLine =
  | { key: string; kind: "cmd"; text: string }
  | { key: string; kind: "out"; text: string }
  | { key: string; kind: "exit"; exitCode: number | null; durationMs?: number }
  | { key: string; kind: "marker"; marker: "timedOut" | "cancelled" | "refused" | "truncated"; text?: string }
  | { key: string; kind: "info"; type: string; text: string };

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function infoText(event: RuntimeEvent): string {
  const d = event.data;
  switch (event.type) {
    case "execution.state": return str(d.status) ?? "";
    case "execution.file.changed": return [str(d.operation), str(d.path)].filter(Boolean).join(" ");
    case "execution.scope.flagged": return [...((d.unexpected as string[] | undefined) ?? []), ...((d.sensitive as string[] | undefined) ?? [])].slice(0, 5).join(", ");
    case "execution.approval.requested": return str(d.reason) ?? "";
    case "execution.failed": return str(d.error) ?? str(d.status) ?? "";
    case "execution.test.started":
    case "execution.build.started": return str(d.script) ?? "";
    case "execution.test.completed":
    case "execution.build.completed": return str(d.status) ?? "";
    case "execution.created": return str(d.taskId) ?? "";
    default: return "";
  }
}

/**
 * Builds the terminal transcript from live events (command start/output/exit are merged per command), then
 * adds recorded commands that no event covers (e.g. events rolled off the bounded buffer). Plain text only.
 */
export function buildTerminalLines(events: readonly RuntimeEvent[], commands: readonly CommandRecord[]): TerminalLine[] {
  const lines: TerminalLine[] = [];
  const covered = new Set<string>();
  const outputIndex = new Map<string, number>();
  for (const event of events) {
    const key = `e${event.seq}`;
    const commandId = str(event.data.commandId);
    if (commandId) covered.add(commandId);
    switch (event.type) {
      case "execution.command.started": {
        lines.push({ key, kind: "cmd", text: str(event.data.command) ?? str(event.data.display) ?? "" });
        if (event.data.refused === true) lines.push({ key: `${key}r`, kind: "marker", marker: "refused", text: str(event.data.reason) ?? "" });
        break;
      }
      case "execution.command.output": {
        const chunk = str(event.data.chunk) ?? "";
        const index = commandId !== undefined ? outputIndex.get(commandId) : undefined;
        const existing = index !== undefined ? lines[index] : undefined;
        if (existing && existing.kind === "out") {
          lines[index as number] = { ...existing, text: existing.text + chunk };
        } else {
          if (commandId !== undefined) outputIndex.set(commandId, lines.length);
          lines.push({ key, kind: "out", text: chunk });
        }
        break;
      }
      case "execution.command.completed": {
        const exit = event.data.exitCode;
        const durationMs = num(event.data.durationMs);
        lines.push({ key, kind: "exit", exitCode: typeof exit === "number" ? exit : null, ...(durationMs !== undefined ? { durationMs } : {}) });
        if (event.data.timedOut === true) lines.push({ key: `${key}t`, kind: "marker", marker: "timedOut" });
        if (event.data.cancelled === true) lines.push({ key: `${key}c`, kind: "marker", marker: "cancelled" });
        break;
      }
      default:
        lines.push({ key, kind: "info", type: event.type.replace(/\./g, "_"), text: infoText(event) });
    }
  }
  for (const command of commands) {
    if (covered.has(command.commandId)) continue;
    lines.push({ key: `c${command.commandId}`, kind: "cmd", text: command.display });
    if (command.output) lines.push({ key: `c${command.commandId}o`, kind: "out", text: command.output });
    if (command.truncated) lines.push({ key: `c${command.commandId}x`, kind: "marker", marker: "truncated" });
    if (command.completedAt !== undefined || command.exitCode !== undefined) {
      lines.push({
        key: `c${command.commandId}e`, kind: "exit", exitCode: command.exitCode ?? null,
        ...(command.durationMs !== undefined ? { durationMs: command.durationMs } : {}),
      });
    }
    if (command.timedOut) lines.push({ key: `c${command.commandId}t`, kind: "marker", marker: "timedOut" });
    if (command.cancelled) lines.push({ key: `c${command.commandId}c`, kind: "marker", marker: "cancelled" });
  }
  return lines;
}
