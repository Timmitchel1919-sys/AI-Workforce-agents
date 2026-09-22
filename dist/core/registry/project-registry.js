import { NotFoundError, ValidationError, } from "../../contracts/index.js";
export class ProjectRegistry {
    projects = new Map();
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
        const registration = {
            projectId,
            displayName: options.displayName?.trim() || projectId,
            adapter,
            metadata: { ...(options.metadata ?? {}) },
        };
        this.projects.set(projectId, registration);
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
