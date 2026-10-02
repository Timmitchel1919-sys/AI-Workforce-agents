import { ExtensionDefinition, ExtensionInstallation } from "../../contracts/extensions.js";

export class ExtensionRegistry {
  private extensions = new Map<string, ExtensionDefinition>();
  private installations = new Map<string, ExtensionInstallation>();

  publishExtension(definition: Omit<ExtensionDefinition, "extensionId" | "status" | "createdAt">): ExtensionDefinition {
    const ext: ExtensionDefinition = {
      extensionId: `ext_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      status: "PUBLISHED",
      createdAt: new Date(),
      ...definition
    };
    this.extensions.set(ext.extensionId, ext);
    return ext;
  }

  installExtension(organizationId: string, extensionId: string, userId: string, scopes: string[]): ExtensionInstallation {
    const ext = this.extensions.get(extensionId);
    if (!ext || ext.status !== "PUBLISHED") {
      throw new Error("Extension not found or not published.");
    }

    const installation: ExtensionInstallation = {
      installationId: `inst_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      organizationId,
      extensionId,
      installedBy: userId,
      version: ext.version,
      status: "ACTIVE",
      grantedScopes: scopes,
      installedAt: new Date()
    };

    this.installations.set(installation.installationId, installation);
    return installation;
  }

  listAvailableExtensions(): ExtensionDefinition[] {
    return Array.from(this.extensions.values()).filter(e => e.status === "PUBLISHED");
  }

  listInstallations(organizationId: string): ExtensionInstallation[] {
    return Array.from(this.installations.values()).filter(i => i.organizationId === organizationId);
  }

  uninstallExtension(installationId: string) {
    this.installations.delete(installationId);
  }
}
