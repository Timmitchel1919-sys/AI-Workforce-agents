import {
  type ProjectAdapter,
  NotFoundError,
  ValidationError,
} from "../../contracts/index.js";

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
    const registration: ProjectRegistration = {
      projectId,
      displayName: options.displayName?.trim() || projectId,
      adapter,
      metadata: { ...(options.metadata ?? {}) },
    };
    this.projects.set(projectId, registration);
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
