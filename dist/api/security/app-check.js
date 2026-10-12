/**
 * Default pass-through verifier used when App Check is unconfigured or disabled.
 */
export class DefaultAppAttestationVerifier {
    async verify(_token) {
        return { valid: true };
    }
}
/**
 * Production Firebase App Check verifier implementation.
 * Verifies App Check tokens through the official Firebase Admin App Check SDK.
 */
export class FirebaseAppAttestationVerifier {
    appCheck;
    mode;
    constructor(appCheck, mode = "disabled") {
        this.appCheck = appCheck;
        this.mode = mode;
    }
    async verify(token) {
        if (this.mode === "disabled") {
            return { valid: true };
        }
        if (!token || !token.trim()) {
            return {
                valid: false,
                error: "app_check_missing",
            };
        }
        if (!this.appCheck) {
            if (this.mode === "enforced") {
                return { valid: false, error: "app_check_unconfigured" };
            }
            return { valid: true };
        }
        try {
            const decoded = await this.appCheck.verifyToken(token.trim());
            return {
                valid: true,
                appId: decoded.appId,
            };
        }
        catch {
            return {
                valid: false,
                error: "app_check_invalid",
            };
        }
    }
}
