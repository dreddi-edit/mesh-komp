'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('logger', () => {
  beforeEach(() => {
    // Clear module cache so each test gets a fresh instance
    delete require.cache[require.resolve('../src/logger')];
  });

  it('given info level, when info is called, then emits valid JSON to stdout', () => {
    const lines = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };

    try {
      const logger = require('../src/logger');
      logger.info('test message', { foo: 'bar' });
    } finally {
      process.stdout.write = origWrite;
    }

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.msg, 'test message');
    assert.equal(parsed.foo, 'bar');
    assert.ok(parsed.ts, 'ts field must be present');
  });

  it('given error level, when error is called, then emits to stderr', () => {
    const lines = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };

    try {
      const logger = require('../src/logger');
      logger.error('something failed', { code: 'E_TEST' });
    } finally {
      process.stderr.write = origWrite;
    }

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, 'error');
    assert.equal(parsed.msg, 'something failed');
    assert.equal(parsed.code, 'E_TEST');
  });

  it('given warn level, when warn is called, then emits to stderr', () => {
    const lines = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };

    try {
      const logger = require('../src/logger');
      logger.warn('low disk space', { availableMb: 10 });
    } finally {
      process.stderr.write = origWrite;
    }

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, 'warn');
    assert.equal(parsed.availableMb, 10);
  });

  it('given debug level call with default LOG_LEVEL=info, then does not emit', () => {
    delete process.env.LOG_LEVEL;
    const lines = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };

    try {
      const logger = require('../src/logger');
      logger.debug('verbose detail');
    } finally {
      process.stdout.write = origWrite;
    }

    assert.equal(lines.length, 0, 'debug should be suppressed at info level');
  });
});
