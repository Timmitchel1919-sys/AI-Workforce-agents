import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_COMMAND_POLICY,
  evaluateCommand,
  validateCommandDescriptor,
  type CommandDescriptor,
} from "../core/index.js";
import { ValidationError } from "../contracts/index.js";

function cmd(overrides: Partial<CommandDescriptor> = {}): CommandDescriptor {
  return {
    executable: "node",
    args: ["--version"],
    cwd: "/tmp/x",
    timeoutMs: 5_000,
    ...overrides,
  };
}

test("evaluateCommand allows node --version", () => {
  const decision = evaluateCommand(cmd());
  assert.equal(decision.outcome, "allowed");
});

test("evaluateCommand allows npm test", () => {
  const decision = evaluateCommand(cmd({ executable: "npm", args: ["test"] }));
  assert.equal(decision.outcome, "allowed");
});

test("evaluateCommand allows npm run <script> with safe name", () => {
  const decision = evaluateCommand(
    cmd({ executable: "npm", args: ["run", "build:prod"] }),
  );
  assert.equal(decision.outcome, "allowed");
});

test("evaluateCommand denies executable not in allowlist", () => {
  const decision = evaluateCommand(cmd({ executable: "bash", args: ["-c", "id"] }));
  assert.equal(decision.outcome, "denied");
});

test("evaluateCommand denies npm args that do not match any pattern", () => {
  const decision = evaluateCommand(cmd({ executable: "npm", args: ["install", "evil-package"] }));
  assert.equal(decision.outcome, "denied");
});

test("evaluateCommand denies npm run with disallowed script name", () => {
  const decision = evaluateCommand(
    cmd({ executable: "npm", args: ["run", "../../evil"] }),
  );
  assert.equal(decision.outcome, "denied");
});

test("evaluateCommand enforces per-executable timeout ceiling", () => {
  const decision = evaluateCommand(
    cmd({ executable: "node", timeoutMs: DEFAULT_COMMAND_POLICY.defaultMaxTimeoutMs * 100 }),
  );
  assert.equal(decision.outcome, "denied");
});

test("evaluateCommand denies args that are too many or too long", () => {
  const many = Array.from({ length: 200 }, () => "x");
  const d1 = evaluateCommand(cmd({ executable: "node", args: many }));
  assert.equal(d1.outcome, "denied");

  const longArg = "a".repeat(1024);
  const d2 = evaluateCommand(cmd({ executable: "node", args: [longArg] }));
  assert.equal(d2.outcome, "denied");
});

test("evaluateCommand denies env variables not in allowlist", () => {
  const decision = evaluateCommand(
    cmd({ executable: "node", env: { SECRET: "leaked" } }),
  );
  assert.equal(decision.outcome, "denied");
});

test("evaluateCommand denies args containing null byte", () => {
  const decision = evaluateCommand(cmd({ executable: "node", args: ["foo\0bar"] }));
  assert.equal(decision.outcome, "denied");
});

test("validateCommandDescriptor rejects malformed inputs", () => {
  assert.throws(
    () => validateCommandDescriptor({ executable: "", args: [], cwd: "/", timeoutMs: 1 }),
    (e: unknown) => e instanceof ValidationError,
  );
  assert.throws(
    () => validateCommandDescriptor({ executable: "node", args: [], cwd: "", timeoutMs: 1 }),
    (e: unknown) => e instanceof ValidationError,
  );
  assert.throws(
    () => validateCommandDescriptor({ executable: "node", args: [], cwd: "/", timeoutMs: 0 }),
    (e: unknown) => e instanceof ValidationError,
  );
});
