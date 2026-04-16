'use strict';

/**
 * Anthropic provider — direct API calls and model listing.
 */

const {
  fetchWithTimeout,
  normalizeMessages,
  toAnthropicMessages,
  parseProviderError,
  normalizeProviderUsage,
  readJsonResponse,
} = require('./utils');
const { STATIC_MODELS } = require('./constants');

let Anthropic;
try {
  Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic;
} catch {
  Anthropic = null;
}

/**
 * Call Anthropic /v1/messages and return content + usage metadata.
 *
 * @param {{ apiKey: string, model: string, messages: object[], maxTokens?: number }} params
 * @returns {Promise<{ content: string, usage: object, requestId: string }>}
 */
async function callAnthropicChatWithMeta({ apiKey, model, messages, maxTokens = 4096 }) {
  const normalizedMsgs = normalizeMessages(messages);
  const systemMsg = normalizedMsgs.find(m => m.role === 'system');
  const conversationMsgs = toAnthropicMessages(messages);

  const requestBody = {
    model,
    max_tokens: Math.max(64, Number(maxTokens) || 4096),
    messages: conversationMsgs,
  };

  if (systemMsg) {
    requestBody.system = [{
      type: 'text',
      text: systemMsg.content,
      cache_control: { type: 'ephemeral' },
    }];
  }

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `Anthropic request failed (${response.status})`));
  }

  const text = Array.isArray(payload?.content)
    ? payload.content
        .filter((item) => item?.type === 'text' && typeof item?.text === 'string')
        .map((item) => item.text)
        .join('\n')
    : '';

  if (text.trim()) {
    return {
      content: text,
      usage: normalizeProviderUsage(payload?.usage),
      requestId: String(response.headers.get('request-id') || response.headers.get('x-request-id') || '').trim(),
    };
  }
  throw new Error('Anthropic returned no content.');
}

/**
 * Call Anthropic chat and return content string only.
 *
 * @param {{ apiKey: string, model: string, messages: object[], maxTokens?: number }} args
 * @returns {Promise<string>}
 */
async function callAnthropicChat(args) {
  const result = await callAnthropicChatWithMeta(args);
  return result.content;
}

/**
 * Fetch available model IDs from Anthropic /v1/models.
 *
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
async function fetchAnthropicModels(apiKey) {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `Anthropic model list failed (${response.status})`));
  }

  const { stripModelPrefix } = require('./utils');
  return Array.isArray(payload?.data)
    ? payload.data.map((model) => stripModelPrefix(model?.id)).filter(Boolean)
    : [];
}

module.exports = {
  Anthropic,
  STATIC_MODELS,
  callAnthropicChatWithMeta,
  callAnthropicChat,
  fetchAnthropicModels,
};
