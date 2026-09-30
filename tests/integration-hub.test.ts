import assert from 'node:assert/strict';
import test from 'node:test';

import { DefaultConnectorRegistry, DefaultCredentialBroker, ToolInvocationEngine } from '../core/integration-hub.js';
import { MCPAdapterImpl } from '../adapters/integration-adapters.js';
import { GovernancePolicy, ResultValidator, InvocationContext } from '../contracts/integration-hub.js';

class MockGovernancePolicy implements GovernancePolicy {
    async canInvoke(): Promise<boolean> {
        return true;
    }
}

class MockResultValidator implements ResultValidator {
    async validate(): Promise<boolean> {
        return true;
    }
}

test('Integration Hub Core Components', async (t) => {
    const context: InvocationContext = {
        userId: 'user123',
        workspaceId: 'ws123',
        roles: ['admin'],
        traceId: 'trace123',
        timestamp: Date.now()
    };

    await t.test('should register and find capable connectors', async () => {
        const registry = new DefaultConnectorRegistry();
        const mcpConnector = new MCPAdapterImpl({
            id: 'mcp-1',
            name: 'Test MCP',
            version: '1.0.0',
            type: 'mcp',
            authType: 'none',
            metadata: {}
        });

        await registry.register(mcpConnector);

        const connectors = await registry.listConnectors();
        assert.equal(connectors.length, 1);

        const capable = await registry.findCapableConnectors('Sample MCP Tool');
        assert.equal(capable.length, 1);
        assert.equal(capable[0].getConfig().id, 'mcp-1');
    });

    await t.test('should invoke capability successfully via engine', async () => {
        const registry = new DefaultConnectorRegistry();
        const broker = new DefaultCredentialBroker();
        const engine = new ToolInvocationEngine(
            registry,
            broker,
            new MockGovernancePolicy(),
            new MockResultValidator()
        );

        const mcpConnector = new MCPAdapterImpl({
            id: 'mcp-1',
            name: 'Test MCP',
            version: '1.0.0',
            type: 'mcp',
            authType: 'none',
            metadata: {}
        });

        await registry.register(mcpConnector);

        const result = await engine.invoke('mcp-1', 'mcp-tool-1', {}, context);
        
        assert.equal(result.success, true);
        assert.equal(result.data.message, 'MCP executed mcp-tool-1');
    });

    await t.test('should handle governance rejection', async () => {
        const registry = new DefaultConnectorRegistry();
        const engine = new ToolInvocationEngine(
            registry,
            new DefaultCredentialBroker(),
            { canInvoke: async () => false },
            new MockResultValidator()
        );

        const mcpConnector = new MCPAdapterImpl({
            id: 'mcp-1',
            name: 'Test MCP',
            version: '1.0.0',
            type: 'mcp',
            authType: 'none',
            metadata: {}
        });

        await registry.register(mcpConnector);

        const result = await engine.invoke('mcp-1', 'mcp-tool-1', {}, context);
        
        assert.equal(result.success, false);
        assert.equal(result.error, 'Governance policy blocked invocation');
    });
});
