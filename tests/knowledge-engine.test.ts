import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { KnowledgeEngine } from '../core/knowledge-engine.js';

describe('Knowledge Engine', () => {
  it('should ingest, normalize, and retrieve knowledge records', () => {
    const engine = new KnowledgeEngine();
    const record = engine.ingest('auth', ' User login process requires MFA  ', 'wiki', 'admin');
    
    assert.ok(record.id);
    assert.strictEqual(record.content, 'user login process requires mfa');
    assert.strictEqual(record.domain, 'auth');
  });

  it('should search for records and provide context', () => {
    const engine = new KnowledgeEngine();
    engine.ingest('auth', 'MFA is mandatory for all users', 'policy', 'security-team');
    engine.ingest('ui', 'The login button is blue', 'design', 'ui-team');

    const searchResults = engine.search('mfa', 'auth');
    assert.strictEqual(searchResults.length, 1);
    
    const context = engine.getContext('login');
    assert.ok(context.includes('login button is blue'));
  });
});
