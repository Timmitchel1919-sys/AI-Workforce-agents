import { NotFoundError, PermissionDeniedError, ValidationError, operatorCan, operatorCanAccessProject, validateSecretReference, } from "../../contracts/index.js";
import { SECRET_REFERENCE_PROVIDERS, SECRET_REFERENCE_STATUSES, } from "../../contracts/secret-reference.js";
const RESOURCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{1,299}$/;
const FORBIDDEN_KEYS = /^(secret|value|plaintext|token|credential|password|privatekey|apikey)$/i;
function assertMetadataOnly(value, path = "secretReference") {
    if (!value || typeof value !== "object")
        return;
    for (const [key, nested] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.test(key)) {
            throw new ValidationError(`${path}.${key} is forbidden; raw secret material is never accepted`);
        }
        assertMetadataOnly(nested, `${path}.${key}`);
    }
}
function validateDate(value, field) {
    if (value !== undefined && Number.isNaN(Date.parse(value))) {
        throw new ValidationError(`${field} must be an ISO date`);
    }
}
function validateRecord(record) {
    assertMetadataOnly(record);
    validateSecretReference(record.ref);
    if (record.id !== record.ref.slice("secret://".length)) {
        throw new ValidationError("secret reference id must equal its secret:// name");
    }
    if (!SECRET_REFERENCE_PROVIDERS.includes(record.provider)) {
        throw new ValidationError("unknown secret reference provider");
    }
    if (!RESOURCE_PATTERN.test(record.providerResource)) {
        throw new ValidationError("invalid provider resource identifier");
    }
    if (!record.purpose.trim() || record.purpose.length > 300) {
        throw new ValidationError("secret reference purpose must contain 1-300 characters");
    }
    if (!SECRET_REFERENCE_STATUSES.includes(record.status)) {
        throw new ValidationError("unknown secret reference status");
    }
    validateDate(record.createdAt, "createdAt");
    validateDate(record.updatedAt, "updatedAt");
    validateDate(record.lastRotatedAt, "lastRotatedAt");
    validateDate(record.rotationDueAt, "rotationDueAt");
    validateDate(record.expiresAt, "expiresAt");
}
/** Durable metadata catalog. Raw secret material cannot be represented here. */
export class SecretReferenceService {
    repository;
    authorizer;
    clock;
    constructor(repository, authorizer, clock = () => new Date().toISOString()) {
        this.repository = repository;
        this.authorizer = authorizer;
        this.clock = clock;
    }
    list(principal) {
        if (!operatorCan(principal, "manage_secret_references")) {
            throw new PermissionDeniedError("manage_secret_references capability required");
        }
        return this.repository
            .list()
            .filter((record) => !record.projectId ||
            operatorCanAccessProject(principal, record.projectId))
            .map((record) => structuredClone(record));
    }
    async create(principal, draft, context) {
        this.requireMutationCapability(principal, draft.projectId);
        assertMetadataOnly(draft);
        const timestamp = this.clock();
        const proposed = {
            ...structuredClone(draft),
            id: validateSecretReference(draft.ref).slice("secret://".length),
            status: "active",
            version: 1,
            createdAt: timestamp,
            createdBy: principal.id,
            updatedAt: timestamp,
            updatedBy: principal.id,
        };
        if (this.repository.findById(proposed.id)) {
            throw new ValidationError(`secret reference already exists: ${proposed.ref}`);
        }
        return this.persistAuthorized(principal, "create", proposed, context);
    }
    async update(principal, ref, update, context) {
        assertMetadataOnly(update);
        const normalized = validateSecretReference(ref);
        const id = normalized.slice("secret://".length);
        const current = this.repository.findById(id);
        if (!current)
            throw new NotFoundError(`unknown secret reference: ${normalized}`);
        this.requireMutationCapability(principal, current.projectId);
        const proposed = {
            ...current,
            ...structuredClone(update),
            id: current.id,
            ref: current.ref,
            provider: current.provider,
            projectId: current.projectId,
            createdAt: current.createdAt,
            createdBy: current.createdBy,
            version: current.version + 1,
            updatedAt: this.clock(),
            updatedBy: principal.id,
        };
        validateRecord(proposed);
        return this.persistAuthorized(principal, "update", proposed, context);
    }
    requireMutationCapability(principal, projectId) {
        if (!operatorCan(principal, "manage_secret_references")) {
            throw new PermissionDeniedError("manage_secret_references capability required");
        }
        if (projectId && !operatorCanAccessProject(principal, projectId)) {
            throw new PermissionDeniedError(`operator has no access to project '${projectId}'`);
        }
        if (!this.authorizer) {
            throw new PermissionDeniedError("secret reference mutation authorizer unavailable");
        }
    }
    async persistAuthorized(principal, operation, proposed, context) {
        validateRecord(proposed);
        const authorization = await this.authorizer.authorize({
            principal,
            operation,
            proposed: structuredClone(proposed),
            context,
        });
        if (!authorization.authorized) {
            throw new PermissionDeniedError(authorization.reason ?? "secret reference mutation not authorized");
        }
        try {
            this.repository.upsert(proposed);
            await authorization.complete?.();
            return structuredClone(proposed);
        }
        catch (error) {
            await authorization.fail?.(error instanceof Error
                ? error.message
                : "secret reference mutation failed");
            throw error;
        }
    }
}
