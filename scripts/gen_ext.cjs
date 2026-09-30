const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const basePath = 'C:/Users/Administrator/Downloads/AI Webapp Projects/Ai worforce agents';

const contractsDir = path.join(basePath, 'contracts');
const coreExtDir = path.join(basePath, 'core', 'extension');
const sdkExtDir = path.join(basePath, 'sdk', 'extension');
const testsDir = path.join(basePath, 'tests');

[coreExtDir, sdkExtDir, testsDir].forEach(d => {
    if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
    }
});

fs.writeFileSync(path.join(contractsDir, 'extension.ts'), `
export interface ExtensionManifest {
    id: string;
    version: string;
    name: string;
    capabilities: string[];
    dependencies: Record<string, string>;
    permissions: string[];
}
export interface ExtensionContext {
    manifest: ExtensionManifest;
    runtime: any;
}
`);

fs.writeFileSync(path.join(coreExtDir, 'sandbox.ts'), `
export class ExtensionSandbox {
    create(manifest: any) {
        return { isolated: true, manifestId: manifest.id };
    }
}
`);

fs.writeFileSync(path.join(coreExtDir, 'registry.ts'), `
export class ExtensionRegistry {
    private extensions = new Map<string, any>();
    register(manifest: any) {
        this.extensions.set(manifest.id, manifest);
    }
    get(id: string) {
        return this.extensions.get(id);
    }
}
`);

fs.writeFileSync(path.join(sdkExtDir, 'index.ts'), `
import { ExtensionManifest } from '../../contracts/extension.js';
export class ExtensionSDK {
    constructor(private manifest: ExtensionManifest) {}
    getCapabilities() { return this.manifest.capabilities; }
}
`);

fs.writeFileSync(path.join(testsDir, 'extension.test.ts'), `
import { ExtensionRegistry } from '../core/extension/registry.js';
import { ExtensionSandbox } from '../core/extension/sandbox.js';
import { ExtensionSDK } from '../sdk/extension/index.js';

describe('Extension Platform', () => {
    it('registers and sandboxes extension', () => {
        const manifest = { id: 'test-ext', version: '1.0.0', name: 'Test', capabilities: [], dependencies: {}, permissions: [] };
        const registry = new ExtensionRegistry();
        registry.register(manifest);
        expect(registry.get('test-ext')).toBeDefined();
        
        const sandbox = new ExtensionSandbox();
        const instance = sandbox.create(manifest);
        expect(instance.isolated).toBe(true);
        
        const sdk = new ExtensionSDK(manifest);
        expect(sdk.getCapabilities()).toEqual([]);
    });
});
`);

console.log('Extension files generated.');
