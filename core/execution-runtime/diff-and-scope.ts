/**
 * Diffs and change-scope protection (Layer 5).
 *
 * The runtime does not decide that a change is WRONG; it flags a change as
 * UNEXPECTED for the task, so a human or reviewer decides. Nothing is
 * discarded automatically.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import {
  RUNTIME_LIMITS,
  type FileChange,
  type ScopeReport,
} from "../../contracts/execution-runtime.js";
import { maskSecrets } from "../prompt-intelligence/secret-scan.js";

export function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * A small unified-style line diff (LCS), bounded in size and secret-masked.
 * Good for review, not a patch format.
 */
export function unifiedDiff(
  before: string | undefined,
  after: string | undefined,
  label: string,
): string {
  const a = (before ?? "").split("\n");
  const b = (after ?? "").split("\n");
  if (before === after) return "";
  const out: string[] = [
    `--- ${before === undefined ? "/dev/null" : `a/${label}`}`,
    `+++ ${after === undefined ? "/dev/null" : `b/${label}`}`,
  ];
  // Trim the common prefix/suffix so the LCS table stays small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start])
    start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length * y.length > 4_000_000) {
    out.push(
      `@@ large change: ${x.length} lines removed, ${y.length} added @@`,
    );
  } else {
    const table: number[][] = Array.from({ length: x.length + 1 }, () =>
      new Array<number>(y.length + 1).fill(0),
    );
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        table[i]![j] =
          x[i] === y[j]
            ? table[i + 1]![j + 1]! + 1
            : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
      }
    }
    out.push(`@@ -${start + 1},${x.length} +${start + 1},${y.length} @@`);
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        out.push(` ${x[i]}`);
        i += 1;
        j += 1;
      } else if (
        j < y.length &&
        (i >= x.length || table[i]![j + 1]! >= table[i + 1]![j]!)
      ) {
        out.push(`+${y[j]}`);
        j += 1;
      } else {
        out.push(`-${x[i]}`);
        i += 1;
      }
    }
  }
  const text = maskSecrets(out.join("\n"));
  return text.length > RUNTIME_LIMITS.maxDiffBytes
    ? `${text.slice(0, RUNTIME_LIMITS.maxDiffBytes)}\n… diff truncated`
    : text;
}

/* ------------------------------------------------------------------ */
/* Scope                                                              */
/* ------------------------------------------------------------------ */

/**
 * Collapse a change history to its NET effect: a file changed and then restored
 * (or created and then deleted) leaves no net change and must not be flagged
 * or committed. Renames are kept as they are.
 */
export function netChanges(changes: readonly FileChange[]): FileChange[] {
  const byPath = new Map<string, FileChange[]>();
  const passthrough: FileChange[] = [];
  for (const change of changes) {
    if (change.operation === "rename" || change.operation === "move") {
      passthrough.push(change);
      continue;
    }
    const list = byPath.get(change.path) ?? [];
    list.push(change);
    byPath.set(change.path, list);
  }
  const out: FileChange[] = [];
  for (const list of byPath.values()) {
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const start = first.operation === "create" ? undefined : first.beforeHash;
    const end = last.operation === "delete" ? undefined : last.afterHash;
    if (start === end) continue;
    out.push({
      ...last,
      operation:
        start === undefined
          ? "create"
          : end === undefined
            ? "delete"
            : "update",
      ...(start !== undefined ? { beforeHash: start } : {}),
      ...(end !== undefined ? { afterHash: end } : {}),
    });
  }
  return [...out, ...passthrough];
}

/** Areas where an unexpected change is a security concern, not just noise. */
const SENSITIVE_AREAS =
  /(^|\/)(auth|authentication|authorization|security|database|db|firestore\.rules|storage\.rules|permissions?|rbac|secrets?|credentials?|\.github\/workflows)([./]|$)|(auth|database|security)[^/]*\.(ts|tsx|js|jsx|py|rules)$|(^|\/)(firebase\.json|\.firebaserc|package-lock\.json)$/i;

export interface ScopeInput {
  /** Files the Context Engine resolved as relevant to the task. */
  relevantFiles: readonly string[];
  /** Target/intent keywords (e.g. "login", "card"). */
  keywords: readonly string[];
}

function stem(file: string): string {
  return path.posix
    .basename(file)
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

function expectedFor(file: string, input: ScopeInput): boolean {
  const lower = file.toLowerCase();
  for (const rel of input.relevantFiles) {
    const relLower = rel.toLowerCase();
    if (lower === relLower) return true;
    // Same component folder (styles, tests, siblings) is in scope.
    const dir = path.posix.dirname(relLower);
    if (dir !== "." && (lower === dir || lower.startsWith(`${dir}/`)))
      return true;
    if (stem(file) === stem(rel)) return true;
  }
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return input.keywords.some((k) => {
    const key = k.toLowerCase();
    return key.length >= 4 && (words.includes(key) || compact.includes(key));
  });
}

/**
 * Compare what changed with what the task should touch. With no scope hints at
 * all every change is "unverifiable" and reported as such rather than waved
 * through.
 */
export function evaluateScope(
  changes: readonly FileChange[],
  input: ScopeInput,
): ScopeReport {
  const files = [
    ...new Set(
      netChanges(changes).flatMap((c) => [
        c.path,
        ...(c.renamedFrom ? [c.renamedFrom] : []),
      ]),
    ),
  ];
  const hasHints = input.relevantFiles.length > 0 || input.keywords.length > 0;
  const unexpected = files.filter((f) => !hasHints || !expectedFor(f, input));
  const sensitive = unexpected.filter((f) => SENSITIVE_AREAS.test(f));
  return {
    status: unexpected.length > 0 ? "FLAGGED_FOR_REVIEW" : "IN_SCOPE",
    expected: files.filter((f) => !unexpected.includes(f)),
    unexpected,
    sensitive,
  };
}
