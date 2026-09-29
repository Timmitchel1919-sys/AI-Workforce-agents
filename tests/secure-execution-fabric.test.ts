import test from "node:test";
import assert from "node:assert";
import { SecureExecutionFabric } from "../core/secure-execution-fabric.js";

test("SecureExecutionFabric runs full lifecycle without throwing", async () => {
    const fabric = new SecureExecutionFabric();
    await fabric.runFullLifecycle();
    assert.ok(true);
});

