import test from "node:test";
import assert from "node:assert";
import { KnowledgeEngine } from "../../core/knowledge/KnowledgeEngine.js";

test("KnowledgeEngine instantiation", () => {
  const engine = new KnowledgeEngine();
  assert.ok(engine);
});

test("KnowledgeEngine preflight", async () => {
  const engine = new KnowledgeEngine();
  await engine.preflight();
});
