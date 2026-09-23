import assert from "node:assert/strict";
import test from "node:test";

import {
  RestrictedCommandProbeRunner,
  type SpawnImplementation,
} from "../adapters/index.js";
import {
  ValidationError,
  type CommandProbeDefinition,
} from "../contracts/index.js";

const NODE_VERSION: CommandProbeDefinition = {
  id: "node-version",
  executable: "node",
  arguments: ["--version"],
  timeoutMs: 5000,
  maxOutputBytes: 1024,
};

function runner(spawnImpl?: SpawnImplementation) {
  const injected =
    spawnImpl ??
    (async () => ({
      exitCode: 0,
      signal: null,
      stdout: Buffer.from("v20.11.1\n"),
      stderr: Buffer.from(""),
      timedOut: false,
    }));
  return new RestrictedCommandProbeRunner(injected);
}

test("probe definition: rejects callers trying to run arbitrary executables", async () => {
  const probe = runner();
  await assert.rejects(
    probe.execute({ ...NODE_VERSION, executable: "/usr/bin/python" }),
    ValidationError,
  );
  await assert.rejects(
    probe.execute({ ...NODE_VERSION, executable: ".." }),
    ValidationError,
  );
  await assert.rejects(
    probe.execute({ ...NODE_VERSION, executable: "rm -rf /" }),
    ValidationError,
  );
  await assert.rejects(
    probe.execute({ ...NODE_VERSION, arguments: [42 as never] }),
    /arguments must be strings/,
  );
});

test("probe definition: rejects invalid timeouts and output bounds", async () => {
  const probe = runner();
  await assert.rejects(
    probe.execute({ ...NODE_VERSION, timeoutMs: 0 }),
    /positive number/,
  );
  await assert.rejects(
    probe.execute({ ...NODE_VERSION, maxOutputBytes: -1 }),
    /positive number/,
  );
  await assert.rejects(probe.execute({ ...NODE_VERSION, id: "" }), /probe.id/);
});

test("runner: executes only the allowlisted executable with fixed arguments", async () => {
  const seen: Array<{ executable: string; args: readonly string[] }> = [];
  const probe = runner(async (definition) => {
    seen.push({
      executable: definition.executable,
      args: definition.arguments,
    });
    return {
      exitCode: 0,
      signal: null,
      stdout: Buffer.from("v20.11.1\n"),
      stderr: Buffer.from(""),
      timedOut: false,
    };
  });

  const result = await probe.execute(NODE_VERSION);
  assert.equal(result.ran, true);
  assert.equal(result.error, undefined);
  assert.equal(result.stdout.includes("v20.11.1"), true);
  assert.deepEqual(seen, [{ executable: "node", args: ["--version"] }]);
});

test("runner: unexpected exit code is surfaced as safe metadata, never a throw", async () => {
  const probe = runner(async () => ({
    exitCode: 3,
    signal: null,
    stdout: Buffer.from(""),
    stderr: Buffer.from("boom"),
    timedOut: false,
  }));
  const result = await probe.execute(NODE_VERSION);
  assert.equal(result.ran, true);
  assert.match(result.error ?? "", /unexpected exit code 3/);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "boom");
});

test("runner: timeouts are surfaced and never leave a bad state", async () => {
  const probe = runner(async () => ({
    exitCode: null,
    signal: "SIGTERM",
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
    timedOut: true,
  }));
  const result = await probe.execute(NODE_VERSION);
  assert.equal(result.ran, false);
  assert.match(result.error ?? "", /timed out/);
});

test("runner: output is bounded", async () => {
  const probe = runner(async () => ({
    exitCode: 0,
    signal: null,
    stdout: Buffer.from("x".repeat(100_000)),
    stderr: Buffer.from(""),
    timedOut: false,
  }));
  const tight: CommandProbeDefinition = { ...NODE_VERSION, maxOutputBytes: 64 };
  const result = await probe.execute(tight);
  assert.ok(result.outputBytes <= 64);
  assert.ok(result.stdout.length <= 64);
});

test("runner: declared secrets are redacted from output", async () => {
  const probe = runner(async () => ({
    exitCode: 0,
    signal: null,
    stdout: Buffer.from("token=SUPER-SECRET-VALUE done"),
    stderr: Buffer.from(""),
    timedOut: false,
  }));
  const redacting: CommandProbeDefinition = {
    ...NODE_VERSION,
    redactSecrets: ["SUPER-SECRET-VALUE"],
  };
  const result = await probe.execute(redacting);
  assert.equal(result.stdout, "token=****** done");
});

test("runner: a failing spawn is classified as not-run with a message", async () => {
  const probe = runner(async () => {
    throw new Error("ENOENT: no such file");
  });
  const result = await probe.execute(NODE_VERSION);
  assert.equal(result.ran, false);
  assert.match(result.error ?? "", /ENOENT/);
});
