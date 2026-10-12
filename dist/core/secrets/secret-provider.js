export class SecretVaultError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SecretVaultError";
    }
}
export class SecretNotFoundError extends SecretVaultError {
    constructor(refId) {
        super("secret_not_found", `Secret reference '${refId}' could not be resolved in the vault provider.`);
    }
}
export class SecretProviderUnconfiguredError extends SecretVaultError {
    constructor(providerName) {
        super("provider_unconfigured", `Secret vault provider '${providerName}' is not configured in this environment.`);
    }
}
