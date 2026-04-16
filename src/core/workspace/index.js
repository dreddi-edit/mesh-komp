'use strict';

/**
 * Workspace module index — re-exports all public functions from sub-modules.
 */

const utils = require('./utils');
const files = require('./files');
const search = require('./search');
const git = require('./git');
const batch = require('./batch');

module.exports = {
  ...utils,
  ...files,
  ...search,
  ...git,
  ...batch,
};
