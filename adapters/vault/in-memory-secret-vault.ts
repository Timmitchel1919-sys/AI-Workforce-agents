import type {
  ManagedSecretReference,
  ResolvedSecretLease,
  SecretAccessContext,
  SecretVault,
  SecretVaultHealth,
} from "../../contracts/index.js";

/**
 * In-memory SecretVault implementation for deterministic testing,
 * local execution, and development mocking.
 */
export class InMemorySecretVault implements SecretVault {
  private readonly secrets = new Map<
    string,
    { versions: Map<string, string>; latest: string }
  >();
  private healthy = true;
  private lastAccess?: string;
  private lastError?: string;

  constructor(initialSecrets?: Record<string, string>) {
    if (initialSecrets) {
      for (const [key, value] of Object.entries(initialSecrets)) {
        this.setSecret(key, value, "1");
      }
    }
  }

  setSecret(id: string, value: string, version = "1"): void {
    const entry = this.secrets.get(id) ?? {
      versions: new Map<string, string>(),
      latest: version,
    };
    entry.versions.set(version, value);
    entry.latest = version;
    this.secrets.set(id, entry);
  }

  async resolve(
    reference: ManagedSecretReference,
    _context: SecretAccessContext,
  ): Promise<ResolvedSecretLease> {
    if (!this.healthy) {
      this.lastError = "Secret vault provider unavailable";
      throw new Error(this.lastError);
    }
    const entry = this.secrets.get(reference.id);
    if (!entry) {
      this.lastError = `Secret '${reference.id}' not found in vault`;
      throw new Error(this.lastError);
    }
    const ver = reference.version ? String(reference.version) : entry.latest;
    const val = entry.versions.get(ver) ?? entry.versions.get(entry.latest);
    if (!val) {
      this.lastError = `Secret version '${ver}' not found in vault`;
      throw new Error(this.lastError);
    }
    this.lastAccess = new Date().toISOString();
    let disposed = false;
    let leaseValue: string | null = val;

    return {
      referenceId: reference.id,
      get value() {
        if (disposed || leaseValue === null) {
          throw new Error("Secret lease has been disposed");
        }
        return leaseValue;
      },
      version: ver,
      resolvedAt: new Date().toISOString(),
      expiresAt: reference.expiresAt,
      dispose() {
        disposed = true;
        leaseValue = null;
      },
    };
  }

  async createSecret(
    reference: ManagedSecretReference,
    initialValue: string,
    _context: SecretAccessContext,
  ): Promise<void> {
    this.setSecret(reference.id, initialValue, String(reference.version || 1));
  }

  async rotate(
    reference: ManagedSecretReference,
    newValue: string,
    _context: SecretAccessContext,
  ): Promise<{ newVersion: string }> {
    const nextVer = String((reference.version || 1) + 1);
    this.setSecret(reference.id, newValue, nextVer);
    return { newVersion: nextVer };
  }

  async revoke(
    reference: ManagedSecretReference,
    _context: SecretAccessContext,
  ): Promise<void> {
    this.secrets.delete(reference.id);
  }

  async health(): Promise<SecretVaultHealth> {
    return {
      configured: true,
      reachable: this.healthy,
      provider: "in_memory_vault",
      lastSuccessfulAccess: this.lastAccess,
      lastFailure: this.lastError,
    };
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }
}
