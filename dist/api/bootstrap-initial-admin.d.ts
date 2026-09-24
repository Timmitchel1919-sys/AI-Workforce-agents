import { type FirebaseServices } from "../adapters/firebase/index.js";
export type InitialAdminBootstrapOutcome = "created" | "already_provisioned" | "refused";
export interface InitialAdminBootstrapResult {
    outcome: InitialAdminBootstrapOutcome;
    message: string;
}
/** Mask an identifier for console output (never print it in full). */
export declare function maskIdentifier(value: string): string;
export declare function bootstrapInitialAdministrator(options: {
    services: FirebaseServices;
    uid: string;
    collectionPrefix?: string;
}): Promise<InitialAdminBootstrapResult>;
