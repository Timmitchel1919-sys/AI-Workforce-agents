import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../../../i18n/locales/en";
import { nl } from "../../../i18n/locales/nl";
import { executionCenterEn } from "../../../i18n/locales/executionCenter.en";
import { executionCenterNl } from "../../../i18n/locales/executionCenter.nl";
import { navigationItems } from "../../../config/navigation";
import {
  APPROVAL_TRACE_STATES, BLOCK_KINDS, FAILURE_CLASSES, GATE_KINDS, ORCH_PRIORITIES, ORCH_TASK_STATUSES,
  ORCH_TASK_TYPES, ORCHESTRATION_COMMANDS, RECOVERY_ACTIONS, RUN_STATUSES,
} from "../types";
import { canRetryTask, orderTasks } from "../lib/runLogic";
import { makeTask } from "./fixtures";

function leaves(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sources(p);
    return /\.tsx?$/.test(name) ? [readFileSync(p, "utf8")] : [];
  });
}

const get = (o: unknown, k: string) => k.split(".").reduce<unknown>((a, p) => (a as Record<string, unknown>)[p], o) as string;

describe("executionCenter locale parity", () => {
  it("EN and NL have identical keys, placeholders and no empty values", () => {
    const enKeys = leaves(executionCenterEn).sort();
    expect(leaves(executionCenterNl).sort()).toEqual(enKeys);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of enKeys) {
      expect(get(executionCenterNl, key).trim().length, key).toBeGreaterThan(0);
      expect(ph(get(executionCenterNl, key)), key).toEqual(ph(get(executionCenterEn, key)));
    }
  });

  it("is merged into both catalogues and the navigation label resolves", () => {
    expect(en.executionCenter).toBe(executionCenterEn);
    expect(nl.executionCenter).toBe(executionCenterNl);
    expect(navigationItems.some((i) => i.route === "/execution-center" && i.labelKey === "executionCenter.nav")).toBe(true);
  });

  it("every literal tt('...') key used in the sources exists", () => {
    const keys = new Set(leaves(executionCenterEn));
    const code = [...sources(join(__dirname, "..")), ...sources(join(__dirname, "../../../pages/ExecutionCenter"))].join("\n");
    const used = [...code.matchAll(/\btt\(\s*"([\w.]+)"/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(60);
    for (const key of used) expect(keys.has(key), key).toBe(true);
    for (const m of code.matchAll(/"(error\.\w+(?:Title|Body))"/g)) expect(keys.has(m[1] as string), m[1]).toBe(true);
  });

  it("labels every backend enum value", () => {
    const groups: [string, readonly string[]][] = [
      ["runStatus", RUN_STATUSES],
      ["taskStatus", ORCH_TASK_STATUSES],
      ["taskType", ORCH_TASK_TYPES],
      ["gate", GATE_KINDS],
      ["blockKind", BLOCK_KINDS],
      ["failureClass", FAILURE_CLASSES],
      ["recovery", RECOVERY_ACTIONS],
      ["approvalState", APPROVAL_TRACE_STATES],
      ["priority", ORCH_PRIORITIES],
      ["claimed", ["success", "failure"]],
      ["verdict", ["approved", "changes_requested"]],
      ["validation", ["PASS", "WARN", "APPROVAL_REQUIRED"]],
      ["risk", ["low", "medium", "high"]],
    ];
    const keys = new Set(leaves(executionCenterEn));
    for (const [group, values] of groups) for (const v of values) expect(keys.has(`${group}.${v}`), `${group}.${v}`).toBe(true);
    expect(ORCHESTRATION_COMMANDS).toHaveLength(7);
  });
});

describe("task helpers", () => {
  it("orders tasks so dependencies come first and tolerates cycles/unknown ids", () => {
    const a = makeTask({ taskId: "a", dependencies: ["b"] });
    const b = makeTask({ taskId: "b", dependencies: ["c", "missing"] });
    const c = makeTask({ taskId: "c" });
    expect(orderTasks([a, b, c]).map((t) => t.taskId)).toEqual(["c", "b", "a"]);
    const x = makeTask({ taskId: "x", dependencies: ["y"] });
    const y = makeTask({ taskId: "y", dependencies: ["x"] });
    expect(orderTasks([x, y])).toHaveLength(2);
  });

  it("only failed or blocked non-security tasks are retryable", () => {
    expect(canRetryTask(makeTask({ status: "FAILED" }))).toBe(true);
    expect(canRetryTask(makeTask({ status: "BLOCKED", blockKind: "routing" }))).toBe(true);
    expect(canRetryTask(makeTask({ status: "BLOCKED", blockKind: "security" }))).toBe(false);
    expect(canRetryTask(makeTask({ status: "RUNNING" }))).toBe(false);
  });
});

describe("stylesheet", () => {
  const css = readFileSync(join(__dirname, "../executionOrchestration.css"), "utf8");

  it("uses theme tokens (dark + light) and no hard-coded colours", () => {
    expect(css).toContain("var(--color-surface)");
    expect(css).toContain("var(--color-text)");
    expect(css).toContain("var(--color-focus)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it("has no fixed pixel widths outside media queries (no horizontal overflow)", () => {
    const withoutMedia = css.replace(/@media[^{]*\{/g, "{");
    expect(withoutMedia).not.toMatch(/(?<![-\w])(min-|max-)?width\s*:\s*\d+px/);
    expect(withoutMedia).not.toMatch(/(?<![-\w])(min-|max-)?inline-size\s*:\s*\d+px/);
  });

  it("respects reduced motion and uses cards, not tables", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/\.eo-tasks \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).not.toMatch(/<table|display:\s*table/);
  });
});
