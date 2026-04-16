'use strict';

/**
 * Context module index — re-exports all public functions from sub-modules.
 */

const fileCache = require('./file-cache');
const terminalSessions = require('./terminal-sessions');
const workspaceFallback = require('./workspace-fallback');

module.exports = {
  ...fileCache,
  ...terminalSessions,
  ...workspaceFallback,
};
