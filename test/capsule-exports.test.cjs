'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('capsule exports section — CAP-01', () => {
  it('given a JS file with exported function, when built, then capsule has exports section', async () => {
    assert.ok(true, 'stub — implement after 45-01-01');
  });

  it('given a JS file with exported function, when built, then symbols entry has isExported true', async () => {
    assert.ok(true, 'stub — implement after 45-01-02');
  });

  it('given a JS file with only non-exported functions, when built, then no exports section', async () => {
    assert.ok(true, 'stub — implement after 45-01-03');
  });
});
