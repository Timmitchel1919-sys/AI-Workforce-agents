/**
 * EO-6.2 — decorator that gates a `ModelProvider` call on the project's
 * budget BEFORE the inner call is made, and records real usage (from the
 * response's own reported tokens) after a successful one.
 *
 * Compose it INSIDE `AuditedModelProvider` (`new AuditedModelProvider(new
 * BudgetGovernedModelProvider(inner, ...), audit)`) so a denial is still
 * captured as a `model_execution_failed` audit event, and this decorator
 * stays focused on budget + usage, not the audit trail.
 *
 * A request with no `projectId` in its metadata cannot be evaluated against
 * any project's budget and is refused — never silently ungoverned.
 */
import { type ModelProvider, type ModelRequest, type ModelResponse } from "../../contracts/index.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { BudgetEnforcer } from "./budget-enforcer.js";
import type { UsageLedger } from "./usage-ledger.js";
export declare class BudgetGovernedModelProvider implements ModelProvider {
    private readonly inner;
    private readonly enforcer;
    private readonly ledger;
    private readonly audit?;
    readonly id: string;
    constructor(inner: ModelProvider, enforcer: BudgetEnforcer, ledger: UsageLedger, audit?: AuditLog | undefined);
    generate(request: ModelRequest): Promise<ModelResponse>;
}
