/**
 * Destructive-action and security-override detection (Phase 3) — pure rules.
 *
 * Deterministic on purpose: a safety classifier must be explainable and must
 * never be model-assisted. It errs toward flagging; a flag only routes the
 * request to the EXISTING human approval mechanism, it never blocks silently.
 *
 * Dutch and English are both recognised (the operator writes in both).
 */
import type { DestructiveFinding } from "../../contracts/prompt-intelligence.js";
/** Detects destructive requests. Bounded, deterministic, secret-free output. */
export declare function detectDestructive(request: string): DestructiveFinding[];
/** Instructions that try to weaken a security requirement (never obeyed). */
export declare function detectSecurityOverrides(request: string): string[];
