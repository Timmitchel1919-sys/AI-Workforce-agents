import nodeAssert from "node:assert/strict";

/**
 * Chai-compatible assertion surface backed by node:assert/strict.
 *
 * The backend runs on the built-in Node test runner, which has no chai
 * dependency. A handful of suites were authored against vitest's chai-style
 * `assert`. This shim keeps those assertions working under `node --test`
 * without pulling in a second test framework or rewriting every call site.
 *
 * Semantics deliberately match chai:
 *   - equal/deepEqual are strict comparisons
 *   - isTrue/isFalse require a real boolean, not a truthy value
 *   - exists accepts anything except null/undefined
 *   - include matches array members and string substrings
 */
export interface ChaiCompatAssert {
  equal(actual: unknown, expected: unknown, message?: string): void;
  strictEqual(actual: unknown, expected: unknown, message?: string): void;
  notEqual(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
  ok(value: unknown, message?: string): void;
  throws(fn: () => unknown, expected?: unknown, message?: string): void;
  rejects(fn: Promise<unknown> | (() => Promise<unknown>), expected?: unknown, message?: string): void;
  doesNotThrow(fn: () => unknown, message?: string): void;
  match(actual: string, pattern: RegExp, message?: string): void;
  doesNotMatch(actual: string, pattern: RegExp, message?: string): void;
  isTrue(value: unknown, message?: string): void;
  isFalse(value: unknown, message?: string): void;
  isDefined(value: unknown, message?: string): void;
  isUndefined(value: unknown, message?: string): void;
  exists(value: unknown, message?: string): void;
  include(haystack: unknown, needle: unknown, message?: string): void;
}

function buildAssert(): ChaiCompatAssert {
  const equal = (actual: unknown, expected: unknown, message?: string): void => {
    nodeAssert.strictEqual(actual, expected, message);
  };

  const deepEqual = (actual: unknown, expected: unknown, message?: string): void => {
    nodeAssert.deepStrictEqual(actual, expected, message);
  };

  const include = (haystack: unknown, needle: unknown, message?: string): void => {
    if (typeof haystack === "string") {
      nodeAssert.ok(
        haystack.includes(String(needle)),
        message ?? `expected ${JSON.stringify(haystack)} to include ${String(needle)}`,
      );
      return;
    }

    nodeAssert.ok(
      Array.isArray(haystack) && haystack.includes(needle),
      message ?? "expected collection to include value",
    );
  };

  return {
    equal,
    strictEqual: equal,
    notEqual: (actual, expected, message) => {
      nodeAssert.notStrictEqual(actual, expected, message);
    },
    deepEqual,
    notDeepEqual: (actual, expected, message) => {
      nodeAssert.notDeepStrictEqual(actual, expected, message);
    },
    ok: (value, message) => {
      nodeAssert.ok(value, message);
    },
    throws: (fn, expected, message) => {
      // chai treats a string second argument as the assertion message, while
      // node:assert treats it as the expected error matcher.
      if (typeof expected === "string" && message === undefined) {
        // chai does not inspect the thrown message here; the string only
        // labels the assertion, so an always-true predicate is the
        // faithful translation.
        nodeAssert.throws(fn, () => true, expected);
        return;
      }
      nodeAssert.throws(fn, expected as never, message);
    },
    rejects: (fn, expected, message) => {
      if (typeof expected === "string" && message === undefined) {
        nodeAssert.rejects(fn as Promise<unknown>, () => true, expected);
        return;
      }
      nodeAssert.rejects(fn as Promise<unknown>, expected as never, message);
    },
    doesNotThrow: (fn, message) => {
      nodeAssert.doesNotThrow(fn, message);
    },
    match: (actual, pattern, message) => {
      nodeAssert.match(actual, pattern, message);
    },
    doesNotMatch: (actual, pattern, message) => {
      nodeAssert.doesNotMatch(actual, pattern, message);
    },
    isTrue: (value, message) => {
      nodeAssert.strictEqual(value, true, message);
    },
    isFalse: (value, message) => {
      nodeAssert.strictEqual(value, false, message);
    },
    isDefined: (value, message) => {
      nodeAssert.notStrictEqual(value, undefined, message ?? "expected value to be defined");
    },
    isUndefined: (value, message) => {
      nodeAssert.strictEqual(value, undefined, message);
    },
    exists: (value, message) => {
      nodeAssert.ok(
        value !== null && value !== undefined,
        message ?? "expected value to exist",
      );
    },
    include,
  };
}

export const assert: ChaiCompatAssert = buildAssert();
