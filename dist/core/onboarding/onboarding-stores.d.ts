/**
 * In-memory onboarding stores (PROJECT-2). They implement the same revision /
 * claim semantics as the Firestore stores so the services are provider-neutral
 * and every concurrency rule is testable without Firebase.
 */
import type { OnboardingSession, OnboardingSessionStore, ProvisionedProject, ProvisionedProjectCommit, ProvisionedProjectStore } from "../../contracts/onboarding.js";
export declare class InMemoryOnboardingSessionStore implements OnboardingSessionStore {
    private readonly sessions;
    get(id: string): Promise<OnboardingSession | undefined>;
    list(): Promise<OnboardingSession[]>;
    create(session: OnboardingSession): Promise<boolean>;
    replace(session: OnboardingSession, expectedRevision: number): Promise<boolean>;
}
export declare class InMemoryProvisionedProjectStore implements ProvisionedProjectStore {
    private readonly projects;
    private readonly codes;
    private readonly repositories;
    get(id: string): Promise<ProvisionedProject | undefined>;
    list(): Promise<ProvisionedProject[]>;
    create(project: ProvisionedProject): Promise<ProvisionedProjectCommit>;
    replace(project: ProvisionedProject, expectedRevision: number): Promise<boolean>;
}
