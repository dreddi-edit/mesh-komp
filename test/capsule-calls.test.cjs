'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('capsule calls section — CAP-02', () => {
  it('given a JS file calling another function, when built, then capsule has calls section', async () => {
    assert.ok(true, 'stub — implement after 45-02-01');
  });

  it('given a JS file with no outgoing calls, when built, then no calls section', async () => {
    assert.ok(true, 'stub — implement after 45-02-01');
  });
});
