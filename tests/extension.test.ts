import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry } from "../core/extension/registry.js";
import { ExtensionSandbox } from "../core/extension/sandbox.js";
import { ExtensionSDK } from "../sdk/extension/index.js";

describe("Extension Platform", () => {
  it("registers and sandboxes extension", () => {
    const manifest = {
      id: "test-ext",
      version: "1.0.0",
      name: "Test",
      capabilities: [],
      dependencies: {},
      permissions: [],
    };
    const registry = new ExtensionRegistry();
    registry.register(manifest);
    assert.ok(registry.get("test-ext"));

    const sandbox = new ExtensionSandbox();
    const instance = sandbox.create(manifest);
    assert.strictEqual(instance.isolated, true);

    const sdk = new ExtensionSDK(manifest);
    assert.deepStrictEqual(sdk.getCapabilities(), []);
  });
});
