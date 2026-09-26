import { NotFoundError, ValidationError, } from "../../contracts/index.js";
import { parseProjectRepositoryRef, repositoryKey, } from "./project-repository-ref.js";
export class ProjectRegistry {
    projects = new Map();
    repositories = new Map();
    register(adapter, options = {}) {
        if (!adapter || typeof adapter.execute !== "function") {
            throw new ValidationError("project adapter must implement execute()");
        }
        const projectId = adapter.projectId?.trim();
        if (!projectId) {
            throw new ValidationError("project adapter must have a projectId");
        }
        if (this.projects.has(projectId)) {
            throw new ValidationError(`project already registered: ${projectId}`);
        }
        // A declared repository reference must be credential-free and unique: two
        // projects may not bind the same repository.
        let repoKey;
        if (options.metadata?.repository !== undefined) {
            const ref = parseProjectRepositoryRef(options.metadata.repository);
            if (!ref) {
                throw new ValidationError(`project ${projectId} declares an invalid repository reference (https URL without credentials and a default branch are required)`);
            }
            repoKey = repositoryKey(ref);
            const owner = this.repositories.get(repoKey);
            if (owner !== undefined) {
                throw new ValidationError(`repository already bound to project ${owner}`);
            }
        }
        const registration = {
            projectId,
            displayName: options.displayName?.trim() || projectId,
            adapter,
            metadata: { ...(options.metadata ?? {}) },
        };
        this.projects.set(projectId, registration);
        if (repoKey !== undefined)
            this.repositories.set(repoKey, projectId);
        return registration;
    }
    has(projectId) {
        return this.projects.has(projectId);
    }
    get(projectId) {
        return this.projects.get(projectId);
    }
    require(projectId) {
        const registration = this.projects.get(projectId);
        if (!registration) {
            throw new NotFoundError(`unknown project: ${projectId}`);
        }
        return registration;
    }
    list() {
        return [...this.projects.values()].sort((a, b) => a.projectId.localeCompare(b.projectId));
    }
    ids() {
        return this.list().map((r) => r.projectId);
    }
}
