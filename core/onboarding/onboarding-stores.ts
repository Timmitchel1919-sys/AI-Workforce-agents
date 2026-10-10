/**
 * In-memory onboarding stores (PROJECT-2). They implement the same revision /
 * claim semantics as the Firestore stores so the services are provider-neutral
 * and every concurrency rule is testable without Firebase.
 */
import type {
  OnboardingSession,
  OnboardingSessionStore,
  ProvisionedProject,
  ProvisionedProjectCommit,
  ProvisionedProjectStore,
} from "../../contracts/onboarding.js";

export class InMemoryOnboardingSessionStore implements OnboardingSessionStore {
  private readonly sessions = new Map<string, OnboardingSession>();

  async get(id: string): Promise<OnboardingSession | undefined> {
    const found = this.sessions.get(id);
    return found ? structuredClone(found) : undefined;
  }

  async list(): Promise<OnboardingSession[]> {
    return [...this.sessions.values()].map((s) => structuredClone(s));
  }

  async create(session: OnboardingSession): Promise<boolean> {
    if (this.sessions.has(session.id)) return false;
    this.sessions.set(session.id, structuredClone(session));
    return true;
  }

  async replace(
    session: OnboardingSession,
    expectedRevision: number,
  ): Promise<boolean> {
    const current = this.sessions.get(session.id);
    if (!current || current.revision !== expectedRevision) return false;
    this.sessions.set(session.id, structuredClone(session));
    return true;
  }
}

export class InMemoryProvisionedProjectStore implements ProvisionedProjectStore {
  private readonly projects = new Map<string, ProvisionedProject>();
  private readonly codes = new Map<string, string>();
  private readonly repositories = new Map<string, string>();

  async get(id: string): Promise<ProvisionedProject | undefined> {
    const found = this.projects.get(id);
    return found ? structuredClone(found) : undefined;
  }

  async list(): Promise<ProvisionedProject[]> {
    return [...this.projects.values()].map((p) => structuredClone(p));
  }

  async create(project: ProvisionedProject): Promise<ProvisionedProjectCommit> {
    const existing = this.projects.get(project.id);
    if (existing) {
      return {
        result: "exists",
        sameOnboarding: existing.onboardingId === project.onboardingId,
      };
    }
    const codeOwner = this.codes.get(project.code);
    if (codeOwner !== undefined) return { result: "conflict", reason: "code" };
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

  async replace(
    project: ProvisionedProject,
    expectedRevision: number,
  ): Promise<boolean> {
    const current = this.projects.get(project.id);
    if (!current || current.revision !== expectedRevision) return false;
    this.projects.set(project.id, structuredClone(project));
    return true;
  }
}
