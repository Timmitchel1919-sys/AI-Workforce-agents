export class ExtensionRegistry {
    publishExtension(data) { return { extensionId: "ext_1", status: "PUBLISHED" }; }
    listAvailableExtensions() { return [{ extensionId: "ext_1" }]; }
    installExtension(org, ext, usr, caps) { return { installationId: "inst_1", status: "ACTIVE", organizationId: org }; }
    listInstallations(org) { return []; }
    uninstallExtension(inst) { }
}
