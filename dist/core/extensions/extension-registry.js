export class ExtensionRegistry {
    extensions = new Map();
    installations = new Map();
    publishExtension(definition) {
        const ext = {
            extensionId: `ext_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            status: "PUBLISHED",
            createdAt: new Date(),
            ...definition
        };
        this.extensions.set(ext.extensionId, ext);
        return ext;
    }
    installExtension(organizationId, extensionId, userId, scopes) {
        const ext = this.extensions.get(extensionId);
        if (!ext || ext.status !== "PUBLISHED") {
            throw new Error("Extension not found or not published.");
        }
        const installation = {
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
    listAvailableExtensions() {
        return Array.from(this.extensions.values()).filter(e => e.status === "PUBLISHED");
    }
    listInstallations(organizationId) {
        return Array.from(this.installations.values()).filter(i => i.organizationId === organizationId);
    }
    uninstallExtension(installationId) {
        this.installations.delete(installationId);
    }
}
