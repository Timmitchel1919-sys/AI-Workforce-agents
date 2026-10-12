# ADR-0037: LLM Agent Loop (Layer 6)

## Status

Accepted (Layer 6)

## Context

Layer 5 can run governed work inside a workspace but delegated authoring, review and
analysis to an `AgentExecutorPort` that had no implementation. The platform is private
and single-user; nothing multi-tenant is added.

## Decision

`LlmAgentExecutor` (`core/agent-loop/`) implements `AgentExecutorPort`:

```
brief + progress + recent results ─► model ─► ONE JSON action ─► strict validation
  ─► AgentToolSession (permissions, path guard, command policy, approvals, cancel/pause)
  ─► bounded, masked observation ─► repeat until `finish`
```

- **Closed protocol.** The provider is text-only, so the model replies with one JSON
  action per turn (`list_tree`, `read_file`, `create/update/rename/delete_file`,
  `run_command`, `finish`). Anything else is bounced back (bounded repairs), never
  interpreted loosely. There is no shell action; commands go through the Layer 5
  allow-list.
- **The model never executes.** Every action goes through the tool session, so tool
  authorization, the path guard, command policy, delete approval, cancel and pause are
  enforced exactly as for any other caller. Refusals are fed back as observations;
  repeated refusals fail the task (SECURITY when policy/path blocks dominate).
- **Success is computed, not claimed.** Evidence and checks come from the real tool
  records. Tasks that own resources must change files; reviews must inspect something and
  finish with a verdict; a flagged scope withholds approval.
- **Untrusted content.** File and command output is presented as quoted data; instruction-like
  text is flagged and ignored; everything is masked and bounded before it reaches the model.
- **Limits.** Steps, model calls, tokens, wall clock, repeated actions, malformed replies,
  refusals. Cancel/pause are checked every turn; approval, timeout and capacity errors
  propagate to the runtime's existing mapping.
- **Cost.** Production builds a `RoutedModelProvider` per agent (router + usage ledger +
  audit), so every call is routed and metered like the specialist agents. The loop adds no
  second cost calculation.
- **Events.** `execution.agent.step` (action, target, outcome, optional reason) streams to
  the Live Workspace.
- The mechanical `Inspect…` analysis task still runs without the model.

## Known gaps (reported, not hidden)

- Not exercised against a real model: tests use a scripted provider. Prompt quality is unproven.
- Production still has no registered workspace, so the loop does not run there until a host
  registers one; with no `OPENAI_API_KEY` the provider fails closed.
- Single-reply JSON protocol: no native tool calling, no streaming tokens, whole-file writes only
  (no patch format), no multi-file edits per turn.
- Context is a rolling window (progress log + last 4 results), not a retrieval system.
- Pause/resume works between steps; an in-flight model call is not interrupted.
- Not wired to the EO-4 source-control/deployment orchestrators.
