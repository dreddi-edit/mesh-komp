'use strict';

/**
 * Assistant run module index — re-exports all public functions from sub-modules.
 */

const model = require('./run-model');
const planner = require('./run-planner');
const proposals = require('./run-proposals');
const lifecycle = require('./run-lifecycle');

module.exports = {
  ...model,
  ...planner,
  ...proposals,
  ...lifecycle,
};
