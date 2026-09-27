import type { OnboardingSession, OnboardingSessionStore, ProvisionedProject, ProvisionedProjectCommit, ProvisionedProjectStore } from "../../contracts/onboarding.js";
import type { TransactionalFirestoreLike } from "./firebase-services.js";
export declare class FirestoreOnboardingSessionStore implements OnboardingSessionStore {
    private readonly firestore;
    private readonly col;
    constructor(firestore: TransactionalFirestoreLike, options?: {
        collectionPrefix?: string;
    });
    get(id: string): Promise<OnboardingSession | undefined>;
    list(): Promise<OnboardingSession[]>;
    create(session: OnboardingSession): Promise<boolean>;
    replace(session: OnboardingSession, expectedRevision: number): Promise<boolean>;
}
export declare class FirestoreProvisionedProjectStore implements ProvisionedProjectStore {
    private readonly firestore;
    private readonly projects;
    private readonly claims;
    constructor(firestore: TransactionalFirestoreLike, options?: {
        collectionPrefix?: string;
    });
    get(id: string): Promise<ProvisionedProject | undefined>;
    list(): Promise<ProvisionedProject[]>;
    create(project: ProvisionedProject): Promise<ProvisionedProjectCommit>;
    replace(project: ProvisionedProject, expectedRevision: number): Promise<boolean>;
}
