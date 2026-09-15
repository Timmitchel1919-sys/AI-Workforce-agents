# OpenAI production agent execution

CP-EXEC-1 adds the first real, bounded provider path:

```
Orchestrator -> RoutingAgentExecutor -> OpenAIAgentExecutor
  -> StructuredModelProvider -> OpenAIModelProvider -> OpenAI Responses API
```

`OpenAIModelProvider` is the sole OpenAI SDK adapter. Core orchestration,
tasks, workflows, and the HTTP API only use Workforce contracts.

## Configuration

The server process must provide `OPENAI_API_KEY` and `OPENAI_MODEL`. Optional
limits are `OPENAI_TIMEOUT_MS` (30 seconds by default),
`OPENAI_MAX_OUTPUT_TOKENS` (1024), and `OPENAI_MAX_RETRIES` (0 by default).
No value is read in browser code or stored in the production configuration.
Missing configuration fails closed at first model execution with a safe
configuration error.

The official OpenAI Node SDK Responses API is used with JSON Schema Structured
Outputs. The provider supplies an abort signal and SDK timeout; retries are
disabled by default to avoid duplicate work and must be explicitly configured.

## First production agent

`control-plane-analysis-agent` is registered through the trusted production
bootstrap binding `openai-control-plane-analysis`. It accepts only
`control-plane-analysis` tasks, is scoped to `money-mind`, has no tools, and
explicitly denies write, deploy, external communication, and secret access.
Task input cannot choose a different executor, model, or tool.

The result is schema-constrained by the provider and independently validated by
the executor before it reaches the orchestrator. It includes normalized model
identity and available input/output/total token metadata; no prices or cost
estimates are stored.

## Tools and approvals

No production tools are enabled in CP-EXEC-1. A later tool-capable executor
must expose only the intersection of agent-allowed tools, trusted registered
tools, permissions, and approval policy, and execute each request through
`ToolExecutionEngine`. Model output must never directly invoke a handler.

## Audit and privacy

The executor emits existing `agent_activity` events for receipt, start, model
call, model result, validation, completion, and failure. Events contain task,
agent, provider, model, duration/counters, and usage when available. Prompts,
responses, API keys, authorization headers, and raw task payloads are not
persisted by default.

## Extending safely

Future providers implement the provider-neutral `ModelProvider` or
`StructuredModelProvider` contract in `adapters/models/`, then are bound in a
trusted production configuration entry. They must not introduce an alternative
orchestration path, dynamic module loading, browser credentials, or unrestricted
tools.
