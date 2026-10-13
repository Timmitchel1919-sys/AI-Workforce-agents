import type { CanonicalSecurityEvent } from "../../contracts/index.js";
export declare const SECURITY_EVENT_GENESIS_HASH: string;
export declare function computeSecurityEventHash(event: CanonicalSecurityEvent, previousEventHash?: string): string;
export declare function chainSecurityEvent(event: CanonicalSecurityEvent, previousEventHash?: string): CanonicalSecurityEvent;
export declare function verifySecurityEventIntegrity(event: CanonicalSecurityEvent): boolean;
export declare function securityEventChainScope(event: CanonicalSecurityEvent): string;
