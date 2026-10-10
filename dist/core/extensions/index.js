export class ExtensionRegistry {
    installations = new Map();
    publishExtension(_data) {
        return { extensionId: "ext_1", status: "PUBLISHED" };
    }
    listAvailableExtensions() {
        return [{ extensionId: "ext_1" }];
    }
    installExtension(org, _ext, _usr, _caps) {
        const installation = {
            installationId: `inst_${this.installations.size + 1}`,
            status: "ACTIVE",
            organizationId: org,
            extensionId: _ext,
        };
        this.installations.set(installation.installationId, installation);
        return installation;
    }
    listInstallations(org) {
        return [...this.installations.values()].filter((installation) => installation.organizationId === org);
    }
    uninstallExtension(inst) {
        this.installations.delete(inst);
    }
}
