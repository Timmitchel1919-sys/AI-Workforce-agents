import test from "node:test";
import assert from "node:assert";
import { AgentOrchestrator } from "../core/agent-orchestrator.js";

test("AgentOrchestrator runs full lifecycle without throwing", async () => {
    const orchestrator = new AgentOrchestrator();
    await orchestrator.runFullOrchestrationCycle();
    assert.ok(true);
});
