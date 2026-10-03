export class ExtensionRegistry {
  publishExtension(data: any): any { return { extensionId: "ext_1", status: "PUBLISHED" }; }
  listAvailableExtensions(): any[] { return [{ extensionId: "ext_1" }]; }
  installExtension(org: string, ext: string, usr: string, caps: string[]): any { return { installationId: "inst_1", status: "ACTIVE", organizationId: org }; }
  listInstallations(org: string): any[] { return []; }
  uninstallExtension(inst: string): void { }
}
