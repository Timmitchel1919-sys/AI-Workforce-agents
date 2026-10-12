export interface AppAttestationResult {
    valid: boolean;
    appId?: string;
    error?: "app_check_missing" | "app_check_invalid" | "app_check_unconfigured" | "app_check_verification_failed" | string;
}
export interface AppAttestationVerifier {
    verify(token: string | undefined): Promise<AppAttestationResult>;
}
export type AppCheckEnforcementMode = "disabled" | "monitor" | "enforced";
/**
 * Default pass-through verifier used when App Check is unconfigured or disabled.
 */
export declare class DefaultAppAttestationVerifier implements AppAttestationVerifier {
    verify(_token: string | undefined): Promise<AppAttestationResult>;
}
export interface AppCheckVerifierSeam {
    verifyToken(appCheckToken: string): Promise<{
        appId: string;
        [claim: string]: unknown;
    }>;
}
/**
 * Production Firebase App Check verifier implementation.
 * Verifies App Check tokens through the official Firebase Admin App Check SDK.
 */
export declare class FirebaseAppAttestationVerifier implements AppAttestationVerifier {
    private readonly appCheck?;
    private readonly mode;
    constructor(appCheck?: AppCheckVerifierSeam | undefined, mode?: AppCheckEnforcementMode);
    verify(token: string | undefined): Promise<AppAttestationResult>;
}
