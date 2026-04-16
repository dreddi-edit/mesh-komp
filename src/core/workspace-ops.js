'use strict';

// Thin re-export facade — implementation lives in workspace/
// NOTE: workspace/index.js re-exports workspace/utils.js (pure funcs) plus
// stubs for the stateful ops. The stateful implementations remain here because
// they rely on globals (localAssistantWorkspace, workspaceMetadataStore, etc.)
// injected by core/index.js at boot — moving them would require that index.js
// import this module before injecting globals, creating a circular dependency.
module.exports = require('./workspace');
