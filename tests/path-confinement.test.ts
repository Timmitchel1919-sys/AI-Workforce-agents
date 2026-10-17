import { strict as assert } from "node:assert";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  assertWorkspaceRelative,
  isPathInside,
  resolveWithinWorkspace,
} from "../core/index.js";
import { ValidationError } from "../contracts/index.js";

const ROOT = join(tmpdir(), "aw-path-confinement-test");

test("assertWorkspaceRelative accepts normal relative paths", () => {
  assertWorkspaceRelative("src/index.ts");
  assertWorkspaceRelative("a/b/c.txt");
  assertWorkspaceRelative("file.txt");
});

test("assertWorkspaceRelative rejects traversal, absolute, drive, UNC, null, percent", () => {
  const bad = [
    "../etc/passwd",
    "a/../b",
    "a/b/..",
    "/etc/passwd",
    "C:\\windows\\system32",
    "c:/windows",
    "\\\\server\\share",
    "a\0b",
    "%2e%2e/etc/passwd",
    "",
  ];
  for (const path of bad) {
    assert.throws(
      () => assertWorkspaceRelative(path),
      (error: unknown) => error instanceof ValidationError,
      `expected ${JSON.stringify(path)} to be rejected`,
    );
  }
});

test("resolveWithinWorkspace produces an absolute path under root", () => {
  const absolute = resolveWithinWorkspace(ROOT, "a/b.txt");
  assert.ok(absolute.startsWith(ROOT));
  assert.ok(absolute.endsWith("a" + sep + "b.txt"));
});

test("resolveWithinWorkspace rejects anything that would escape", () => {
  assert.throws(() => resolveWithinWorkspace(ROOT, "../x"));
  assert.throws(() => resolveWithinWorkspace(ROOT, "a/../../x"));
});

test("isPathInside returns true for root itself and nested paths", () => {
  assert.equal(isPathInside(ROOT, ROOT), true);
  assert.equal(isPathInside(ROOT, join(ROOT, "a", "b")), true);
  assert.equal(isPathInside(ROOT, join(ROOT, "..", "other")), false);
});
