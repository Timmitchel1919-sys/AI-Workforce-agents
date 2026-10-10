/**
 * EO-8 — `RoutedModelProvider`: a `ModelProvider` DECORATOR that routes and
 * meters every call, reusable across every `GeneralAgent`-based agent
 * (Developer/QA/Project Manager today; Research once a real, non-fabricated
 * search/fetch provider exists to make it honest — see ADR-0030).
 *
 * This generalizes the bespoke routing/usage wiring EO-7 hand-rolled inside
 * `OpenAIAgentExecutor.run()` (which uses the richer `StructuredModelProvider`
 * interface, not this plain one) into something composable: wrap ANY real
 * `ModelProvider` once per agent at the composition root, and every existing,
 * already-tested agent class (`DeveloperAgent`, `QaAgent`,
 * `ProjectManagerAgent`) needs ZERO code changes — they already accept an
 * injected `ModelProvider` and already map `ProviderUnavailableError` to a
 * `"model_unavailable"` failure, which is exactly what a routing denial
 * throws here.
 *
 * SELECTED != EXECUTED is enforced the same way EO-7 established: routing
 * happens strictly before `inner.generate()` is ever called, and a denied /
 * unavailable / unknown routing outcome throws instead of falling through.
 */
import { type Agent, type ModelProvider, type ModelRequest, type ModelRequirementProfile, type ModelResponse } from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ModelRouter } from "./model-router.js";
import type { UsageLedger } from "../cost-center/usage-ledger.js";
export interface RoutedModelProviderOptions {
    /** The real provider a selected candidate is actually executed against. */
    inner: ModelProvider;
    router: Pick<ModelRouter, "routeInternal">;
    /** The agent this provider instance is bound to — fixed at composition time, one instance per agent. */
    agent: Agent;
    requirement: ModelRequirementProfile;
    /** Recorded into the Cost Center after a successful call, keyed by taskId (idempotent). Optional, same as EO-7. */
    usageLedger?: Pick<UsageLedger, "record">;
    /** Records a `model_mismatch` activity when the router's selection differs from what the provider actually used. Optional. */
    audit?: AuditLog;
}
export declare class RoutedModelProvider implements ModelProvider {
    private readonly options;
    constructor(options: RoutedModelProviderOptions);
    get id(): string;
    generate(request: ModelRequest): Promise<ModelResponse>;
}
