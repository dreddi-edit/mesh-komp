'use strict';

/**
 * OpenAI-compatible provider — direct API, Azure, and responses endpoint.
 */

const {
  fetchWithTimeout,
  trimTrailingSlash,
  joinPath,
  parseProviderError,
  normalizeProviderUsage,
  readJsonResponse,
  buildOpenAIChatCompletionBody,
  providerWantsMaxCompletionTokens,
  extractAssistantTextFromChatPayload,
  normalizeMessages,
} = require('./utils');

/**
 * Call the OpenAI /v1/responses endpoint (newer API).
 *
 * @param {{ apiKey: string, model: string, messages: object[], baseUrl: string, orgId?: string, providerName: string, maxOutputTokens?: number, withMeta?: boolean }} params
 * @returns {Promise<string|object>}
 */
async function callOpenAIResponsesEndpoint({ apiKey, model, messages, baseUrl, orgId, providerName, maxOutputTokens = 512, withMeta = false }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (orgId) headers['OpenAI-Organization'] = orgId;

  const isOpenRouter = trimTrailingSlash(baseUrl).includes('openrouter.ai');
  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'http://localhost:4173';
    headers['X-Title'] = 'Mesh';
  }

  const transcript = normalizeMessages(messages)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');

  const response = await fetchWithTimeout(joinPath(baseUrl, 'responses'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input: transcript,
      max_output_tokens: Math.max(16, Number(maxOutputTokens) || 512),
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `${providerName} request failed (${response.status})`));
  }

  const outputText = extractAssistantTextFromChatPayload(payload);
  if (outputText) {
    const result = {
      content: outputText,
      usage: normalizeProviderUsage(payload?.usage),
      requestId: String(response.headers.get('x-request-id') || response.headers.get('request-id') || '').trim(),
    };
    return withMeta ? result : result.content;
  }
  throw new Error(`${providerName} returned no content.`);
}

/**
 * Call an OpenAI-compatible /v1/chat/completions endpoint.
 *
 * @param {{ apiKey: string, model: string, messages: object[], baseUrl: string, orgId?: string, providerName: string, maxTokens?: number, withMeta?: boolean }} params
 * @returns {Promise<string|object>}
 */
async function callOpenAICompatibleChat({ apiKey, model, messages, baseUrl, orgId, providerName, maxTokens = 512, withMeta = false }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (orgId) headers['OpenAI-Organization'] = orgId;

  const targetBase = trimTrailingSlash(baseUrl);
  const isOpenRouter = targetBase.includes('openrouter.ai');
  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'http://localhost:4173';
    headers['X-Title'] = 'Mesh';
  }

  const endpoint = joinPath(targetBase, 'chat/completions');
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildOpenAIChatCompletionBody({ model, messages, maxTokens, tokenField: 'max_tokens' })),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const firstError = parseProviderError(payload, `${providerName} request failed (${response.status})`);

    if (providerWantsMaxCompletionTokens(firstError)) {
      const retryResponse = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildOpenAIChatCompletionBody({ model, messages, maxTokens, tokenField: 'max_completion_tokens' })),
      });

      const retryPayload = await readJsonResponse(retryResponse);
      if (retryResponse.ok) {
        const retryContent = extractAssistantTextFromChatPayload(retryPayload);
        if (retryContent) {
          const result = {
            content: retryContent,
            usage: normalizeProviderUsage(retryPayload?.usage),
            requestId: String(retryResponse.headers.get('x-request-id') || retryResponse.headers.get('request-id') || '').trim(),
          };
          return withMeta ? result : result.content;
        }
        throw new Error(`${providerName} returned no content.`);
      }

      if (!isOpenRouter) {
        return callOpenAIResponsesEndpoint({ apiKey, model, messages, baseUrl: targetBase, orgId, providerName, maxOutputTokens: maxTokens, withMeta });
      }

      throw new Error(parseProviderError(retryPayload, `${providerName} request failed (${retryResponse.status})`));
    }

    if (!isOpenRouter) {
      return callOpenAIResponsesEndpoint({ apiKey, model, messages, baseUrl: targetBase, orgId, providerName, maxOutputTokens: maxTokens, withMeta });
    }
    throw new Error(firstError);
  }

  const content = extractAssistantTextFromChatPayload(payload);
  if (content) {
    const result = {
      content,
      usage: normalizeProviderUsage(payload?.usage),
      requestId: String(response.headers.get('x-request-id') || response.headers.get('request-id') || '').trim(),
    };
    return withMeta ? result : result.content;
  }
  throw new Error(`${providerName} returned no content.`);
}

const { DEFAULT_AZURE_API_VERSION } = require('./constants');
const { stripModelPrefix, normalizeAzureBaseUrl } = require('./utils');

/**
 * Call Azure OpenAI chat completions endpoint.
 *
 * @param {{ apiKey: string, model: string, messages: object[], baseUrl: string, providerName: string, apiVersion?: string, maxTokens?: number }} params
 * @returns {Promise<string>}
 */
async function callAzureOpenAIChat({ apiKey, model, messages, baseUrl, providerName, apiVersion = DEFAULT_AZURE_API_VERSION, maxTokens = 512 }) {
  const deploymentId = stripModelPrefix(model);
  if (!deploymentId) throw new Error(`${providerName} requires a deployment/model ID.`);

  const root = normalizeAzureBaseUrl(baseUrl);
  if (!root) throw new Error(`${providerName} requires a valid Azure base URL.`);

  const endpoint = `${root}/openai/deployments/${encodeURIComponent(deploymentId)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const azureHeaders = { 'api-key': apiKey, 'Content-Type': 'application/json' };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: azureHeaders,
    body: JSON.stringify(buildOpenAIChatCompletionBody({ model: deploymentId, messages, maxTokens, tokenField: 'max_tokens', includeModel: false })),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const firstError = parseProviderError(payload, `${providerName} request failed (${response.status})`);
    if (providerWantsMaxCompletionTokens(firstError)) {
      const retryResponse = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: azureHeaders,
        body: JSON.stringify(buildOpenAIChatCompletionBody({ model: deploymentId, messages, maxTokens, tokenField: 'max_completion_tokens', includeModel: false })),
      });

      const retryPayload = await readJsonResponse(retryResponse);
      if (!retryResponse.ok) {
        throw new Error(parseProviderError(retryPayload, `${providerName} request failed (${retryResponse.status})`));
      }

      const retryContent = extractAssistantTextFromChatPayload(retryPayload);
      if (retryContent) return retryContent;
      throw new Error(`${providerName} returned no content.`);
    }
    throw new Error(firstError);
  }

  const content = extractAssistantTextFromChatPayload(payload);
  if (content) return content;
  throw new Error(`${providerName} returned no content.`);
}

/**
 * Fetch available model IDs from an OpenAI-compatible /v1/models endpoint.
 *
 * @param {{ apiKey: string, baseUrl: string, providerName: string, orgId?: string }} params
 * @returns {Promise<string[]>}
 */
async function fetchOpenAICompatibleModels({ apiKey, baseUrl, providerName, orgId }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (orgId) headers['OpenAI-Organization'] = orgId;

  const targetBase = trimTrailingSlash(baseUrl);
  if (targetBase.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'http://localhost:4173';
    headers['X-Title'] = 'Mesh';
  }

  const response = await fetchWithTimeout(joinPath(targetBase, 'models'), { method: 'GET', headers });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `${providerName} model list failed (${response.status})`));
  }

  return Array.isArray(payload?.data)
    ? payload.data.map((model) => stripModelPrefix(model?.id || model?.name)).filter(Boolean)
    : [];
}

module.exports = {
  callOpenAIResponsesEndpoint,
  callOpenAICompatibleChat,
  callAzureOpenAIChat,
  fetchOpenAICompatibleModels,
};
