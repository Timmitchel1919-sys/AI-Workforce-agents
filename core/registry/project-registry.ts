import {
  type ProjectAdapter,
  NotFoundError,
  ValidationError,
} from "../../contracts/index.js";
import {
  parseProjectRepositoryRef,
  repositoryKey,
} from "./project-repository-ref.js";

/**
 * A registry of project integrations, so the Control Plane (and any future
 * multi-project caller) selects a project by id rather than hard-coding one.
 *
 * It holds `ProjectAdapter` *instances* — the concrete adapter (Money Mind,
 * and later AIMS / Mastery / Tripod) is built and registered by the wiring
 * layer. This registry knows nothing project-specific.
 */
export interface ProjectRegistration {
  projectId: string;
  displayName: string;
  adapter: ProjectAdapter;
  metadata: Record<string, unknown>;
}

export interface ProjectRegistrationOptions {
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export class ProjectRegistry {
  private readonly projects = new Map<string, ProjectRegistration>();
  private readonly repositories = new Map<string, string>();

  register(
    adapter: ProjectAdapter,
    options: ProjectRegistrationOptions = {},
  ): ProjectRegistration {
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
    let repoKey: string | undefined;
    if (options.metadata?.repository !== undefined) {
      const ref = parseProjectRepositoryRef(options.metadata.repository);
      if (!ref) {
        throw new ValidationError(
          `project ${projectId} declares an invalid repository reference (https URL without credentials and a default branch are required)`,
        );
      }
      repoKey = repositoryKey(ref);
      const owner = this.repositories.get(repoKey);
      if (owner !== undefined) {
        throw new ValidationError(
          `repository already bound to project ${owner}`,
        );
      }
    }
    const registration: ProjectRegistration = {
      projectId,
      displayName: options.displayName?.trim() || projectId,
      adapter,
      metadata: { ...(options.metadata ?? {}) },
    };
    this.projects.set(projectId, registration);
    if (repoKey !== undefined) this.repositories.set(repoKey, projectId);
    return registration;
  }

  has(projectId: string): boolean {
    return this.projects.has(projectId);
  }

  get(projectId: string): ProjectRegistration | undefined {
    return this.projects.get(projectId);
  }

  require(projectId: string): ProjectRegistration {
    const registration = this.projects.get(projectId);
    if (!registration) {
      throw new NotFoundError(`unknown project: ${projectId}`);
    }
    return registration;
  }

  list(): ProjectRegistration[] {
    return [...this.projects.values()].sort((a, b) =>
      a.projectId.localeCompare(b.projectId),
    );
  }

  ids(): string[] {
    return this.list().map((r) => r.projectId);
  }
}
