export class InMemoryOnboardingSessionStore {
    sessions = new Map();
    async get(id) {
        const found = this.sessions.get(id);
        return found ? structuredClone(found) : undefined;
    }
    async list() {
        return [...this.sessions.values()].map((s) => structuredClone(s));
    }
    async create(session) {
        if (this.sessions.has(session.id))
            return false;
        this.sessions.set(session.id, structuredClone(session));
        return true;
    }
    async replace(session, expectedRevision) {
        const current = this.sessions.get(session.id);
        if (!current || current.revision !== expectedRevision)
            return false;
        this.sessions.set(session.id, structuredClone(session));
        return true;
    }
}
export class InMemoryProvisionedProjectStore {
    projects = new Map();
    codes = new Map();
    repositories = new Map();
    async get(id) {
        const found = this.projects.get(id);
        return found ? structuredClone(found) : undefined;
    }
    async list() {
        return [...this.projects.values()].map((p) => structuredClone(p));
    }
    async create(project) {
        const existing = this.projects.get(project.id);
        if (existing) {
            return {
                result: "exists",
                sameOnboarding: existing.onboardingId === project.onboardingId,
            };
        }
        const codeOwner = this.codes.get(project.code);
        if (codeOwner !== undefined)
            return { result: "conflict", reason: "code" };
        if (project.repositoryKey !== undefined) {
            const repositoryOwner = this.repositories.get(project.repositoryKey);
            if (repositoryOwner !== undefined) {
                return { result: "conflict", reason: "repository" };
            }
        }
        this.projects.set(project.id, structuredClone(project));
        this.codes.set(project.code, project.id);
        if (project.repositoryKey !== undefined) {
            this.repositories.set(project.repositoryKey, project.id);
        }
        return { result: "created" };
    }
    async replace(project, expectedRevision) {
        const current = this.projects.get(project.id);
        if (!current || current.revision !== expectedRevision)
            return false;
        this.projects.set(project.id, structuredClone(project));
        return true;
    }
}
