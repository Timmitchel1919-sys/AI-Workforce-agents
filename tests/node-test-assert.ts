import nodeAssert from "node:assert/strict";

export { default as test } from "node:test";

/**
 * Small compatibility surface for legacy tests written with Chai-like helpers.
 * The root suite is intentionally executed by Node's built-in test runner.
 */
interface NodeTestAssert {
  equal(actual: unknown, expected: unknown, message?: string): void;
  throws(block: () => unknown, expected?: string | RegExp): void;
  isDefined<T>(value: T): asserts value is NonNullable<T>;
  isUndefined(value: unknown): void;
  isTrue(value: unknown): void;
  isFalse(value: unknown): void;
  include<T>(values: readonly T[], value: T): void;
}

export const assert: NodeTestAssert = {
  equal: (actual, expected, message) =>
    nodeAssert.equal(actual, expected, message),
  throws: (block, expected) => {
    let thrown: unknown;
    try {
      block();
    } catch (error) {
      thrown = error;
    }
    nodeAssert.notEqual(thrown, undefined, "Expected function to throw");
    if (expected !== undefined) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      if (typeof expected === "string") {
        nodeAssert.match(
          message,
          new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        );
      } else {
        nodeAssert.match(message, expected);
      }
    }
  },
  isDefined: (value) => nodeAssert.notEqual(value, undefined),
  isUndefined: (value) => nodeAssert.equal(value, undefined),
  isTrue: (value) => nodeAssert.equal(value, true),
  isFalse: (value) => nodeAssert.equal(value, false),
  include: (values, value) => nodeAssert.ok(values.includes(value)),
};
