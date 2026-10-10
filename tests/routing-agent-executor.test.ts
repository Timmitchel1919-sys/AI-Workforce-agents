/**
 * EO-7 — `RoutingAgentExecutor.replace`: upgrading a bootstrap-time executor
 * once more dependencies (Model Router, Cost Center) exist.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  NotFoundError,
  ValidationError,
  type AgentExecutor,
} from "../contracts/index.js";
import { RoutingAgentExecutor } from "../core/index.js";

const fake = (tag: string): AgentExecutor => ({ execute: async () => tag });

test("REPLACE: overwrites an existing registration and execute() uses the NEW executor", async () => {
  const router = new RoutingAgentExecutor();
  router.register("agent-1", fake("original"));
  router.replace("agent-1", fake("upgraded"));
  const result = await router.execute({ id: "agent-1" } as never, {} as never);
  assert.equal(result, "upgraded");
});

test("REPLACE: throws NotFoundError when there was nothing to replace — never silently registers", async () => {
  const router = new RoutingAgentExecutor();
  assert.throws(
    () => router.replace("never-registered", fake("x")),
    NotFoundError,
  );
  assert.equal(
    router.has("never-registered"),
    false,
    "a failed replace must not leave a registration behind",
  );
});

test("REPLACE: an empty agent id is rejected", () => {
  const router = new RoutingAgentExecutor();
  router.register("a", fake("x"));
  assert.throws(() => router.replace("  ", fake("y")), ValidationError);
});
