import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AuditedModelProvider,
  AuditLog,
  ModelProviderRegistry,
  NotFoundError,
  ValidationError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "../core/index.js";
import { AnthropicModelProvider, anthropicFactory } from "../adapters/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A minimal non-Anthropic provider, proving the layer is provider-neutral. */
class FakeProvider implements ModelProvider {
  readonly id = "fake";
  lastRequest: ModelRequest | undefined;
  constructor(private readonly reply: ModelResponse | Error) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.lastRequest = request;
    if (this.reply instanceof Error) throw this.reply;
    return this.reply;
  }
}

const reply: ModelResponse = {
  content: "ok",
  model: "fake-1",
  usage: { inputTokens: 3, outputTokens: 1 },
};

const request: ModelRequest = {
  messages: [{ role: "user", content: "hi" }],
  model: "fake-1",
  metadata: { taskId: "task_9", agentId: "alpha", projectId: "money-mind" },
};

/* ------------------------------------------------------------------ */
/* Registry                                                           */
/* ------------------------------------------------------------------ */

test("registry: resolves a provider by id and memoizes the instance", () => {
  const registry = new ModelProviderRegistry();
  let built = 0;
  registry.register("Fake", () => {
    built += 1;
    return new FakeProvider(reply);
  });

  assert.ok(registry.has("fake"));
  assert.deepEqual(registry.list(), ["fake"]);
  const a = registry.resolve("fake");
  const b = registry.resolve("FAKE");
  assert.equal(a, b);
  assert.equal(built, 1);
});

test("registry: unknown id throws NotFoundError listing what is registered", () => {
  const registry = new ModelProviderRegistry();
  registry.register("anthropic", anthropicFactory({ apiKey: "sk-ant-x" }));
  assert.throws(
    () => registry.resolve("openai"),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundError);
      assert.match((error as Error).message, /anthropic/);
      return true;
    },
  );
});

test("registry: duplicate registration and blank id are rejected", () => {
  const registry = new ModelProviderRegistry();
  registry.register("fake", () => new FakeProvider(reply));
  assert.throws(
    () => registry.register("fake", () => new FakeProvider(reply)),
    ValidationError,
  );
  assert.throws(
    () => registry.register("  ", () => new FakeProvider(reply)),
    ValidationError,
  );
});

test("registry: the Anthropic adapter plugs in without core changes", () => {
  const registry = new ModelProviderRegistry();
  registry.register(
    "anthropic",
    anthropicFactory({ apiKey: "sk-ant-x", model: "claude-x" }),
  );
  const provider = registry.resolve("anthropic");
  assert.ok(provider instanceof AnthropicModelProvider);
  assert.equal(provider.id, "anthropic");
});

/* ------------------------------------------------------------------ */
/* Audited model provider                                             */
/* ------------------------------------------------------------------ */

test("audit: records the four model events around a successful call", async () => {
  const audit = new AuditLog();
  const provider = new AuditedModelProvider(new FakeProvider(reply), audit);

  const out = await provider.generate(request);
  assert.deepEqual(out, reply);

  const events = audit.list();
  assert.deepEqual(
    events.map((e) => e.type),
    [
      "model_provider_requested",
      "model_execution_started",
      "model_execution_completed",
    ],
  );
  // correlation ids come from request.metadata
  assert.equal(events[0]!.taskId, "task_9");
  assert.equal(events[0]!.agentId, "alpha");
  assert.equal(events[2]!.data.provider, "fake");
  assert.deepEqual(events[2]!.data.usage, { inputTokens: 3, outputTokens: 1 });
  assert.equal(events[2]!.data.contentChars, 2);
});

test("audit: records model_execution_failed and rethrows", async () => {
  const audit = new AuditLog();
  const provider = new AuditedModelProvider(
    new FakeProvider(new Error("boom")),
    audit,
  );
  await assert.rejects(provider.generate(request), /boom/);

  const failed = audit.query({ type: "model_execution_failed" })[0];
  assert.ok(failed);
  assert.equal(failed!.data.provider, "fake");
  assert.equal(failed!.data.error, "boom");
});

test("audit: content is NOT logged unless explicitly enabled", async () => {
  const auditOff = new AuditLog();
  await new AuditedModelProvider(new FakeProvider(reply), auditOff).generate(
    request,
  );
  const startedOff = auditOff.query({ type: "model_execution_started" })[0]!;
  assert.equal(startedOff.data.promptPreview, undefined);

  const auditOn = new AuditLog();
  await new AuditedModelProvider(new FakeProvider(reply), auditOn, {
    logContent: true,
  }).generate(request);
  const startedOn = auditOn.query({ type: "model_execution_started" })[0]!;
  assert.match(String(startedOn.data.promptPreview), /user: hi/);
});

test("audit: never records credentials from a failing Anthropic call", async () => {
  const key = "sk-ant-SECRET-000";
  const audit = new AuditLog();
  const failing = new AnthropicModelProvider(
    { apiKey: key },
    {
      transport: {
        createMessage: async () => {
          throw { status: 401, message: `nope key=${key}` };
        },
      },
    },
  );
  const provider = new AuditedModelProvider(failing, audit);
  await assert.rejects(
    provider.generate({ messages: [{ role: "user", content: "hi" }] }),
  );

  const dump = JSON.stringify(audit.list());
  assert.ok(!dump.includes(key), "audit log must not contain the API key");
});

/* ------------------------------------------------------------------ */
/* Provider independence + core isolation                            */
/* ------------------------------------------------------------------ */

test("independence: a non-Anthropic provider works through the whole layer", async () => {
  const audit = new AuditLog();
  const registry = new ModelProviderRegistry();
  const fake = new FakeProvider(reply);
  registry.register("fake", () => new AuditedModelProvider(fake, audit));

  const provider = registry.resolve("fake");
  const out = await provider.generate(request);
  assert.deepEqual(out, reply);
  assert.equal(audit.list().length, 3);
});

test("isolation: core/ and contracts/ have no dependency on Anthropic code", () => {
  // Comments may mention "Anthropic" as an illustrative example; what must not
  // appear is an actual import of the SDK or the adapter, or use of an
  // Anthropic-specific identifier.
  const offenders: string[] = [];
  for (const dir of ["core", "contracts"]) {
    for (const file of walkTs(join(repoRoot, dir))) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (
        /@anthropic-ai\/sdk/.test(code) ||
        /anthropic-model-provider/.test(code) ||
        /\bAnthropic[A-Z_]/.test(code) ||
        /\banthropic\b/i.test(code)
      ) {
        offenders.push(file.replace(repoRoot, "").replace(/\\/g, "/"));
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Anthropic dependency leaked into: ${offenders.join(", ")}`,
  );
});

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
