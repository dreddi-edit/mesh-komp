'use strict';

/**
 * Assistant service — coordinates AI chat, inline completion, and run lifecycle.
 * Routes call this service rather than core directly.
 */

/**
 * @typedef {object} AssistantServiceDeps
 * @property {object} core  Full core exports (model providers, assistant runs, context)
 * @property {object} config  Application config
 * @property {object} logger  Logger instance
 */

/**
 * @typedef {object} AssistantService
 * @property {Function} startRun
 * @property {Function} getRunStatus
 * @property {Function} cancelRun
 * @property {Function} chat
 * @property {Function} inlineComplete
 * @property {Function} applyProposal
 * @property {Function} getMergedCredentials
 */

/**
 * Creates an assistant service instance with injected dependencies.
 *
 * @param {AssistantServiceDeps} deps
 * @returns {AssistantService}
 */
function createAssistantService({ core, config, logger }) {
  /**
   * Starts an assistant run for the given user.
   *
   * @param {object} payload
   * @param {object} user
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function startRun(payload, user, requestId) {
    return core.createAssistantRun(payload, user, requestId);
  }

  /**
   * Returns the status of an assistant run.
   *
   * @param {string} runId
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async function getRunStatus(runId, userId) {
    return core.getAssistantRun(runId, userId);
  }

  /**
   * Cancels a running assistant run.
   *
   * @param {string} runId
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async function cancelRun(runId, userId) {
    return core.cancelAssistantRun(runId, userId);
  }

  /**
   * Executes a non-streaming chat request.
   *
   * @param {object} payload  Normalized chat payload
   * @param {object} user  Authenticated user
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function chat(payload, user, requestId) {
    const { runModelChat, mergeChatCredentials, getStoredCredentialsForUser } = core;
    const credentials = await mergeChatCredentials(
      payload.credentials,
      await getStoredCredentialsForUser(user.id)
    );
    return runModelChat({ ...payload, credentials }, requestId);
  }

  /**
   * Executes inline code completion for the editor.
   *
   * @param {object} payload
   * @param {object} user
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function inlineComplete(payload, user, requestId) {
    const { localAssistantReply, mergeChatCredentials, getStoredCredentialsForUser } = core;
    const credentials = await mergeChatCredentials(
      payload.credentials,
      await getStoredCredentialsForUser(user.id)
    );
    return localAssistantReply({ ...payload, credentials }, requestId);
  }

  /**
   * Applies a proposed edit from an assistant run.
   *
   * @param {string} runId
   * @param {string} proposalId
   * @param {object} user
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function applyProposal(runId, proposalId, user, requestId) {
    return core.applyAssistantRunProposal(runId, proposalId, user, requestId);
  }

  /**
   * Resolves merged credentials for a user (stored + request-supplied).
   *
   * @param {object|null} requestCredentials
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async function getMergedCredentials(requestCredentials, userId) {
    const { mergeChatCredentials, getStoredCredentialsForUser } = core;
    const stored = await getStoredCredentialsForUser(userId);
    return mergeChatCredentials(requestCredentials, stored);
  }

  return {
    startRun,
    getRunStatus,
    cancelRun,
    chat,
    inlineComplete,
    applyProposal,
    getMergedCredentials,
  };
}

module.exports = { createAssistantService };
