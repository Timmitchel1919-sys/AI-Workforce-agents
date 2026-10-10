interface ExtensionRecord {
  extensionId?: string;
  installationId?: string;
  status?: string;
  organizationId?: string;
}

export class ExtensionRegistry {
  private readonly installations = new Map<string, ExtensionRecord>();

  publishExtension(
    _data: Record<string, unknown>,
  ): ExtensionRecord & { extensionId: string } {
    return { extensionId: "ext_1", status: "PUBLISHED" };
  }
  listAvailableExtensions(): Array<ExtensionRecord & { extensionId: string }> {
    return [{ extensionId: "ext_1" }];
  }
  installExtension(
    org: string,
    _ext: string,
    _usr: string,
    _caps: string[],
  ): ExtensionRecord & { installationId: string } {
    const installation = {
      installationId: `inst_${this.installations.size + 1}`,
      status: "ACTIVE",
      organizationId: org,
      extensionId: _ext,
    };
    this.installations.set(installation.installationId, installation);
    return installation;
  }
  listInstallations(org: string): ExtensionRecord[] {
    return [...this.installations.values()].filter(
      (installation) => installation.organizationId === org,
    );
  }
  uninstallExtension(inst: string): void {
    this.installations.delete(inst);
  }
}
