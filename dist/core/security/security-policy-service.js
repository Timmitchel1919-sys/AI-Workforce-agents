import { PermissionDeniedError, ValidationError, operatorCan, } from "../../contracts/index.js";
const ID_PATTERN = /^sec\.[a-z0-9][a-z0-9._-]{1,98}$/;
const ACTION_PATTERN = /^[a-z0-9_*][a-z0-9._:/*-]{0,127}$/;
function validatePolicy(policy) {
    if (!ID_PATTERN.test(policy.id))
        throw new ValidationError("invalid security policy id");
    if (!policy.name.trim() || policy.name.length > 160)
        throw new ValidationError("invalid security policy name");
    if (!Number.isInteger(policy.priority) ||
        policy.priority < 0 ||
        policy.priority > 10_000)
        throw new ValidationError("invalid security policy priority");
    if (!policy.reason.trim() || policy.reason.length > 500)
        throw new ValidationError("invalid security policy reason");
    if (policy.actionPatterns?.some((pattern) => !ACTION_PATTERN.test(pattern)))
        throw new ValidationError("invalid security policy action pattern");
    if (Number.isNaN(Date.parse(policy.createdAt)) ||
        Number.isNaN(Date.parse(policy.updatedAt)))
        throw new ValidationError("security policy timestamps must be ISO dates");
}
/** Durable policy administration without delete or raw client approval flags. */
export class SecurityPolicyService {
    repository;
    authorizer;
    constructor(repository, authorizer) {
        this.repository = repository;
        this.authorizer = authorizer;
    }
    list(principal) {
        if (!operatorCan(principal, "view_security"))
            throw new PermissionDeniedError("view_security capability required");
        return this.repository.list().sort((a, b) => a.priority - b.priority);
    }
    async upsert(principal, proposed, context) {
        if (!operatorCan(principal, "manage_security_policy"))
            throw new PermissionDeniedError("manage_security_policy capability required");
        validatePolicy(proposed);
        if (!this.authorizer)
            throw new PermissionDeniedError("security policy mutation authorizer unavailable");
        const current = this.repository.findById(proposed.id);
        const authorization = await this.authorizer.authorize({
            principal,
            ...(current ? { current } : {}),
            proposed: structuredClone(proposed),
            context,
        });
        if (!authorization.authorized)
            throw new PermissionDeniedError(authorization.reason ?? "security policy mutation not authorized");
        const stored = structuredClone(proposed);
        try {
            this.repository.upsert(stored);
            await authorization.complete?.();
            return structuredClone(stored);
        }
        catch (error) {
            await authorization.fail?.(error instanceof Error
                ? error.message
                : "security policy mutation failed");
            throw error;
        }
    }
}
