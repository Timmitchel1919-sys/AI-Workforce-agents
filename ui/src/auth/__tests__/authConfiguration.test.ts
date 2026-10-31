import { describe, expect, it } from "vitest";
import { hasCompleteFirebaseConfig, resolveAuthRuntimeMode } from "../authConfiguration";

const valid = {
  apiKey: "public-api-key",
  authDomain: "example.firebaseapp.com",
  projectId: "example",
  appId: "1:123:web:abc",
};

describe("authentication runtime configuration", () => {
  it("accepts a complete Firebase web configuration", () => {
    expect(hasCompleteFirebaseConfig(valid)).toBe(true);
    expect(resolveAuthRuntimeMode({ config: valid, production: true, development: false, allowDevelopmentDemo: false })).toBe("firebase");
  });

  it("fails closed in production when configuration is missing", () => {
    expect(resolveAuthRuntimeMode({ config: {}, production: true, development: false, allowDevelopmentDemo: true })).toBe("configuration-error");
  });

  it("allows demo auth only when explicitly enabled in development", () => {
    expect(resolveAuthRuntimeMode({ config: {}, production: false, development: true, allowDevelopmentDemo: true })).toBe("development-demo");
    expect(resolveAuthRuntimeMode({ config: {}, production: false, development: true, allowDevelopmentDemo: false })).toBe("configuration-error");
  });

  it("rejects whitespace-only values", () => {
    expect(hasCompleteFirebaseConfig({ ...valid, projectId: "   " })).toBe(false);
  });
});
