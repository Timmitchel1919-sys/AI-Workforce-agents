import test from "node:test";
import assert from "node:assert";
import { CognitiveAgentsLayer } from "../core/cognitive-agents-layer.js";

test("CognitiveAgentsLayer runs full initialization without throwing", async () => {
    const layer = new CognitiveAgentsLayer();
    await layer.runLayerInitialization();
    assert.ok(true);
});
