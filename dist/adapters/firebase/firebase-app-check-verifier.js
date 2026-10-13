export class FirebaseAppCheckVerifier {
    appCheck;
    constructor(appCheck) {
        this.appCheck = appCheck;
    }
    async verify(token) {
        if (!this.appCheck) {
            return { valid: false, error: "verifier_unavailable" };
        }
        if (!token || typeof token !== "string" || token.trim() === "") {
            return { valid: false, error: "missing" };
        }
        try {
            const response = await this.appCheck.verifyToken(token.trim());
            if (response &&
                typeof response.appId === "string" &&
                response.appId.length > 0) {
                return {
                    valid: true,
                    appId: response.appId,
                };
            }
            return { valid: false, error: "invalid" };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const code = error?.code ?? "";
            // Classify error: client-facing invalidity vs infrastructure unavailability
            const isClientTokenError = code.includes("expired") ||
                code.includes("invalid-argument") ||
                code.includes("invalid-credential") ||
                message.toLowerCase().includes("expired") ||
                message.toLowerCase().includes("invalid") ||
                message.toLowerCase().includes("malformed") ||
                message.toLowerCase().includes("decoding") ||
                message.toLowerCase().includes("jwt");
            if (isClientTokenError) {
                return { valid: false, error: "invalid" };
            }
            // Infrastructure / network / firebase admin service failure
            return { valid: false, error: "unavailable" };
        }
    }
}
