import type { CanonicalSecurityEvent, Repository, SecurityEventQuery } from "../../contracts/index.js";
export interface SecurityEventStore {
    append(event: CanonicalSecurityEvent): void;
    query(query?: SecurityEventQuery): CanonicalSecurityEvent[];
}
export declare class AppendOnlySecurityEventStore implements SecurityEventStore {
    private readonly events;
    append(event: CanonicalSecurityEvent): void;
    query(query?: SecurityEventQuery): CanonicalSecurityEvent[];
}
export declare class RepositorySecurityEventStore implements SecurityEventStore {
    private readonly repository;
    constructor(repository: Repository<CanonicalSecurityEvent>);
    append(event: CanonicalSecurityEvent): void;
    query(query?: SecurityEventQuery): CanonicalSecurityEvent[];
}
