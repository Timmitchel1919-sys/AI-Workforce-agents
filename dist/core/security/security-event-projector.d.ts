import type { AuditEvent, CanonicalSecurityEvent } from "../../contracts/index.js";
export declare function projectAuditEvent(event: AuditEvent): CanonicalSecurityEvent | undefined;
