'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('query-index-incremental', () => {
  describe('queryIndex manual update', () => {
    it('given a queryIndex Map, when entries for a file are added and removed, then index reflects new state', () => {
      // Tests the raw Map manipulation logic (not localWorkspaceSave — that requires full workspace context)
      const queryIndex = new Map();

      // Simulate adding entries for file A
      const addEntry = (token, entry) => {
        const existing = queryIndex.get(token) || [];
        existing.push(entry);
        queryIndex.set(token, existing);
      };

      addEntry('login', { file: 'src/auth.js', lineStart: 10, lineEnd: 20, snippet: 'function login()', kind: 'function_declaration', kindBoost: 40 });
      addEntry('auth', { file: 'src/auth.js', lineStart: 10, lineEnd: 20, snippet: 'function login()', kind: 'function_declaration', kindBoost: 40 });

      // Verify entries exist
      assert.ok(queryIndex.has('login'), 'login token should be present');
      assert.ok(queryIndex.has('auth'), 'auth token should be present');

      // Simulate removing entries for file A (incremental update pattern)
      for (const [token, entries] of queryIndex) {
        const filtered = entries.filter(e => e.file !== 'src/auth.js');
        if (filtered.length === 0) {
          queryIndex.delete(token);
        } else {
          queryIndex.set(token, filtered);
        }
      }

      // Both tokens removed since only src/auth.js had them
      assert.ok(!queryIndex.has('login'), 'login token removed after file cleared');
      assert.ok(!queryIndex.has('auth'), 'auth token removed after file cleared');
    });

    it('given a queryIndex, when new file entries are added for a fresh symbol, then tokens are queryable', () => {
      const queryIndex = new Map();
      const token = 'handlelogin';
      queryIndex.set(token, [{ file: 'src/auth.js', lineStart: 5, lineEnd: 10, snippet: 'function handleLogin()', kind: 'function_declaration', kindBoost: 40 }]);
      assert.strictEqual(queryIndex.get(token).length, 1);
      assert.strictEqual(queryIndex.get(token)[0].file, 'src/auth.js');
    });
  });
});
