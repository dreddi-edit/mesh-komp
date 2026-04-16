'use strict';

/**
 * Service layer barrel export.
 * Each service factory accepts explicit dependencies and wraps core operations.
 */

module.exports = {
  createWorkspaceService: require('./workspace-service').createWorkspaceService,
  createAssistantService: require('./assistant-service').createAssistantService,
  createAuthService: require('./auth-service').createAuthService,
  createVoiceService: require('./voice-service').createVoiceService,
};
