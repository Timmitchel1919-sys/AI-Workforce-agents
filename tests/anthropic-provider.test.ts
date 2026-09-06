import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderAuthError,
  ProviderConfigError,
  ProviderError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderResponseError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  ValidationError,
  type ModelRequest,
} from "../core/index.js";
import {
  AnthropicModelProvider,
  DEFAULT_ANTHROPIC_MODEL,
  loadAnthropicConfig,
  mapAnthropicError,
  redactSecrets,
  type AnthropicMessageParams,
  type AnthropicTransport,
  type RawAnthropicMessage,
} from "../adapters/index.js";

const API_KEY = "sk-ant-test-DEADBEEF-not-a-real-key";

/** A transport whose behaviour each test controls. */
function stubTransport(
  handler: (params: AnthropicMessageParams) => Promise<RawAnthropicMessage>,
): { transport: AnthropicTransport; calls: AnthropicMessageParams[] } {
  const calls: AnthropicMessageParams[] = [];
  return {
    calls,
    transport: {
      createMessage: (params) => {
        calls.push(params);
        return handler(params);
      },
    },
  };
}

const okReply = (text = "hello from claude"): RawAnthropicMessage => ({
  id: "msg_1",
  model: "claude-3-5-sonnet-20241022",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 5 },
});

const request = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  messages: [
    { role: "system", content: "Be brief." },
    { role: "user", content: "Say hi." },
  ],
  ...over,
});

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

test("config: loads from an explicit input and applies defaults", () => {
  const config = loadAnthropicConfig({ apiKey: API_KEY }, {});
  assert.equal(config.apiKey, API_KEY);
  assert.equal(config.model, DEFAULT_ANTHROPIC_MODEL);
  assert.equal(config.timeoutMs, 60000);
  assert.equal(config.maxTokens, 1024);
  assert.equal(config.maxRetries, 2);
});

test("config: reads environment variables", () => {
  const config = loadAnthropicConfig(
    {},
    {
      ANTHROPIC_API_KEY: API_KEY,
      ANTHROPIC_MODEL: "claude-x",
      ANTHROPIC_TIMEOUT_MS: "1500",
      ANTHROPIC_MAX_TOKENS: "64",
      ANTHROPIC_MAX_RETRIES: "0",
    },
  );
  assert.equal(config.model, "claude-x");
  assert.equal(config.timeoutMs, 1500);
  assert.equal(config.maxTokens, 64);
  assert.equal(config.maxRetries, 0);
});

test("config: missing API key throws a ProviderConfigError (a ValidationError)", () => {
  assert.throws(
    () => loadAnthropicConfig({}, {}),
    (error: unknown) => {
      assert.ok(error instanceof ProviderConfigError);
      assert.ok(error instanceof ValidationError);
      assert.match((error as Error).message, /ANTHROPIC_API_KEY/);
      return true;
    },
  );
});

test("config: a non-numeric timeout throws a clear error", () => {
  assert.throws(
    () =>
      loadAnthropicConfig(
        {},
        { ANTHROPIC_API_KEY: API_KEY, ANTHROPIC_TIMEOUT_MS: "soon" },
      ),
    /ANTHROPIC_TIMEOUT_MS must be a number/,
  );
});

test("config: a zero/negative max_tokens is rejected", () => {
  assert.throws(
    () => loadAnthropicConfig({ apiKey: API_KEY, maxTokens: 0 }, {}),
    /ANTHROPIC_MAX_TOKENS must be an integer >= 1/,
  );
});

test("config: constructing a provider with no API key throws", () => {
  assert.throws(
    () => new AnthropicModelProvider({}, { env: {} }),
    ProviderConfigError,
  );
});

/* ------------------------------------------------------------------ */
/* Request / response mapping                                         */
/* ------------------------------------------------------------------ */

test("maps a Workforce request into Anthropic params (system split out)", async () => {
  const { transport, calls } = stubTransport(async () => okReply());
  const provider = new AnthropicModelProvider(
    { apiKey: API_KEY, model: "claude-cfg", maxTokens: 256 },
    { transport },
  );

  await provider.generate(
    request({
      messages: [
        { role: "system", content: "rule one" },
        { role: "system", content: "rule two" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
    }),
  );

  assert.equal(calls.length, 1);
  const params = calls[0]!;
  assert.equal(params.system, "rule one\n\nrule two");
  assert.equal(params.model, "claude-cfg");
  assert.equal(params.maxTokens, 256);
  assert.deepEqual(
    params.messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
});

test("per-request model overrides the configured model", async () => {
  const { transport, calls } = stubTransport(async () => okReply());
  const provider = new AnthropicModelProvider(
    { apiKey: API_KEY, model: "claude-cfg" },
    { transport },
  );
  await provider.generate(request({ model: "claude-override" }));
  assert.equal(calls[0]!.model, "claude-override");
});

test("maps an Anthropic reply into a ModelResponse", async () => {
  const { transport } = stubTransport(async () => ({
    model: "claude-3-5-sonnet-20241022",
    content: [
      { type: "text", text: "part one " },
      { type: "thinking", text: "ignored" },
      { type: "text", text: "part two" },
    ],
    usage: { input_tokens: 20, output_tokens: 8 },
  }));
  const provider = new AnthropicModelProvider(
    { apiKey: API_KEY },
    { transport },
  );

  const response = await provider.generate(request());
  assert.equal(response.content, "part one part two");
  assert.equal(response.model, "claude-3-5-sonnet-20241022");
  assert.deepEqual(response.usage, { inputTokens: 20, outputTokens: 8 });
});

test("a request with no user/assistant messages is rejected before any call", async () => {
  const { transport, calls } = stubTransport(async () => okReply());
  const provider = new AnthropicModelProvider(
    { apiKey: API_KEY },
    { transport },
  );
  await assert.rejects(
    provider.generate({
      messages: [{ role: "system", content: "only system" }],
    }),
    ProviderRequestError,
  );
  assert.equal(calls.length, 0);
});

test("describe() never exposes the API key", () => {
  const provider = new AnthropicModelProvider(
    { apiKey: API_KEY, model: "claude-cfg" },
    { transport: stubTransport(async () => okReply()).transport },
  );
  const described = provider.describe();
  assert.deepEqual(Object.keys(described).sort(), [
    "maxRetries",
    "maxTokens",
    "model",
    "provider",
    "timeoutMs",
  ]);
  assert.ok(!JSON.stringify(described).includes(API_KEY));
});

/* ------------------------------------------------------------------ */
/* Failure mapping                                                    */
/* ------------------------------------------------------------------ */

async function generateWith(failure: unknown): Promise<{ error: unknown }> {
  const { transport } = stubTransport(async () => {
    throw failure;
  });
  const provider = new AnthropicModelProvider(
    { apiKey: API_KEY },
    { transport },
  );
  try {
    await provider.generate(request());
    return { error: undefined };
  } catch (error) {
    return { error };
  }
}

test("401 -> ProviderAuthError (not retryable)", async () => {
  const { error } = await generateWith({
    status: 401,
    message: "invalid x-api-key",
  });
  assert.ok(error instanceof ProviderAuthError);
  assert.equal((error as ProviderError).retryable, false);
  assert.equal((error as ProviderError).provider, "anthropic");
});

test("429 -> ProviderRateLimitError (retryable)", async () => {
  const { error } = await generateWith({ status: 429, message: "slow down" });
  assert.ok(error instanceof ProviderRateLimitError);
  assert.equal((error as ProviderError).retryable, true);
  assert.equal((error as ProviderError).status, 429);
});

test("timeout error name -> ProviderTimeoutError (retryable)", async () => {
  const { error } = await generateWith({
    name: "APIConnectionTimeoutError",
    message: "Request timed out.",
  });
  assert.ok(error instanceof ProviderTimeoutError);
  assert.equal((error as ProviderError).retryable, true);
});

test("connection error -> ProviderUnavailableError (retryable)", async () => {
  const { error } = await generateWith({
    name: "APIConnectionError",
    message: "ECONNREFUSED",
  });
  assert.ok(error instanceof ProviderUnavailableError);
  assert.equal((error as ProviderError).retryable, true);
});

test("500 -> ProviderUnavailableError (retryable)", async () => {
  const { error } = await generateWith({
    status: 500,
    message: "overloaded_error",
  });
  assert.ok(error instanceof ProviderUnavailableError);
  assert.equal((error as ProviderError).status, 500);
});

test("400 -> ProviderRequestError (not retryable)", async () => {
  const { error } = await generateWith({ status: 400, message: "bad param" });
  assert.ok(error instanceof ProviderRequestError);
  assert.equal((error as ProviderError).retryable, false);
});

test("an unclassified error still maps to a ProviderError", () => {
  const mapped = mapAnthropicError(new Error("weird"), API_KEY);
  assert.ok(mapped instanceof ProviderError);
  assert.equal(mapped.provider, "anthropic");
});

test("malformed response (content not an array) -> ProviderResponseError", async () => {
  const { transport } = stubTransport(async () => ({ content: "nope" }));
  const provider = new AnthropicModelProvider(
    { apiKey: API_KEY },
    { transport },
  );
  await assert.rejects(provider.generate(request()), ProviderResponseError);
});

test("malformed response (no text blocks) -> ProviderResponseError", async () => {
  const { transport } = stubTransport(async () => ({
    content: [{ type: "tool_use", id: "t1" }],
  }));
  const provider = new AnthropicModelProvider(
    { apiKey: API_KEY },
    { transport },
  );
  await assert.rejects(provider.generate(request()), ProviderResponseError);
});

/* ------------------------------------------------------------------ */
/* Secret redaction                                                   */
/* ------------------------------------------------------------------ */

test("redactSecrets removes known secrets", () => {
  const text = `auth failed for key ${API_KEY} on request`;
  const clean = redactSecrets(text, [API_KEY]);
  assert.ok(!clean.includes(API_KEY));
  assert.match(clean, /\*\*\*REDACTED\*\*\*/);
});

test("a provider error message never leaks the API key", async () => {
  const { error } = await generateWith({
    status: 401,
    // a hostile/naive SDK that echoes the key back in its message
    message: `Unauthorized: api_key=${API_KEY}`,
  });
  assert.ok(error instanceof ProviderAuthError);
  const message = (error as Error).message;
  assert.ok(!message.includes(API_KEY), "raw key must not appear in the error");
  assert.match(message, /REDACTED/);
});
