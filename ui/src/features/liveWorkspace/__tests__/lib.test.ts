import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { liveWorkspaceEn } from "../../../i18n/locales/liveWorkspace.en";
import { liveWorkspaceNl } from "../../../i18n/locales/liveWorkspace.nl";
import { buildTerminalLines, classifyDiffLine, formatDuration, mergeEvents, sortEntries } from "../lib/logic";
import { makeEvent } from "./fixtures";

function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

describe("logic", () => {
  it("classifies diff lines by prefix", () => {
    expect(classifyDiffLine("+added")).toBe("add");
    expect(classifyDiffLine("-removed")).toBe("del");
    expect(classifyDiffLine("@@ -1 +1 @@")).toBe("hunk");
    expect(classifyDiffLine(" context")).toBe("ctx");
    expect(classifyDiffLine("+++ b/file")).toBe("ctx");
  });

  it("formats durations", () => {
    expect(formatDuration(350)).toBe("350 ms");
    expect(formatDuration(1200)).toBe("1.2 s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(undefined)).toBeUndefined();
  });

  it("merges events idempotently by seq", () => {
    const a = [makeEvent(1, "execution.started")];
    const merged = mergeEvents(a, [makeEvent(1, "execution.started"), makeEvent(2, "execution.state")], 100);
    expect(merged.map((e) => e.seq)).toEqual([1, 2]);
    expect(mergeEvents(merged, [makeEvent(2, "execution.state")], 100)).toBe(merged);
    expect(mergeEvents(merged, [makeEvent(3, "execution.state")], 2).map((e) => e.seq)).toEqual([2, 3]);
  });

  it("sorts directories first", () => {
    const sorted = sortEntries([{ path: "b.ts", type: "file" as const }, { path: "src", type: "dir" as const }, { path: "a.ts", type: "file" as const }]);
    expect(sorted.map((e) => e.path)).toEqual(["src", "a.ts", "b.ts"]);
  });

  it("builds a terminal transcript: merged output, exit and markers, plus uncovered commands", () => {
    const lines = buildTerminalLines(
      [
        makeEvent(1, "execution.command.started", { commandId: "c1", command: "npm run build" }),
        makeEvent(2, "execution.command.output", { commandId: "c1", chunk: "line one\n" }),
        makeEvent(3, "execution.command.output", { commandId: "c1", chunk: "line two\n" }),
        makeEvent(4, "execution.command.completed", { commandId: "c1", exitCode: 1, durationMs: 1500, timedOut: true, cancelled: false }),
      ],
      [{
        commandId: "c0", display: "npm run lint", spec: { kind: "script", script: "lint" }, class: "SAFE", startedAt: "x",
        completedAt: "y", exitCode: 0, durationMs: 10, timedOut: false, cancelled: false, output: "ok", truncated: false,
      }],
    );
    expect(lines.filter((l) => l.kind === "out").map((l) => (l as { text: string }).text)).toEqual(["line one\nline two\n", "ok"]);
    expect(lines.some((l) => l.kind === "cmd" && l.text === "npm run build")).toBe(true);
    expect(lines.some((l) => l.kind === "cmd" && l.text === "npm run lint")).toBe(true);
    expect(lines.some((l) => l.kind === "marker" && l.marker === "timedOut")).toBe(true);
  });
});

describe("catalogue", () => {
  it("Dutch mirrors English key-for-key with matching placeholders", () => {
    expect(leafPaths(liveWorkspaceNl).sort()).toEqual(leafPaths(liveWorkspaceEn).sort());
    const get = (root: unknown, path: string) => path.split(".").reduce((n, k) => (n as Record<string, unknown>)[k], root) as string;
    for (const path of leafPaths(liveWorkspaceEn)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(get(liveWorkspaceNl, path)), path).toEqual(ph(get(liveWorkspaceEn, path)));
      expect(get(liveWorkspaceNl, path).trim().length, path).toBeGreaterThan(0);
    }
  });

  it("every literal tt('key') used by the components exists", () => {
    const dir = join(__dirname, "../components");
    const have = new Set(leafPaths(liveWorkspaceEn));
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const match of source.matchAll(/\btt\(\s*"([\w.]+)"/g)) {
        expect(have.has(match[1] as string), `${file}: ${match[1]}`).toBe(true);
      }
    }
  });
});

describe("stylesheet", () => {
  const css = readFileSync(join(__dirname, "../liveWorkspace.css"), "utf8");

  it("uses theme tokens and no hard-coded colours", () => {
    expect(css).toContain("var(--color-surface)");
    expect(css).toContain("var(--color-focus)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it("has no fixed pixel widths outside media queries", () => {
    const withoutMedia = css.replace(/@media[^{]*\{/g, "{");
    expect(withoutMedia).not.toMatch(/(?<![-\w])(min-|max-)?width\s*:\s*\d+px/);
    expect(withoutMedia).not.toMatch(/(?<![-\w])(min-|max-)?inline-size\s*:\s*\d+px/);
  });

  it("respects reduced motion, scrolls code inside its own box, and orders the mobile areas", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/\.lw-code, \.lw-diff, \.lw-terminal \{[^}]*overflow: auto/);
    expect(css).toContain('"header" "inspector" "center" "terminal" "tree"');
  });
});
