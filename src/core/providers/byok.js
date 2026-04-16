'use strict';

/**
 * Bring-your-own-key (BYOK) provider — credential normalization and routing.
 */

const { trimTrailingSlash, stripModelPrefix, isAzureProvider } = require('./utils');
const { DEFAULT_BYOK_BASE_URLS, DEFAULT_AZURE_API_VERSION } = require('./constants');
const { callOpenAICompatibleChat, callAzureOpenAIChat } = require('./openai');

/**
 * Normalize raw BYOK credential objects from user settings.
 *
 * @param {{ byok?: { providers: object[] } }} credentials
 * @returns {Array<{ providerId: string, providerName: string, apiKey: string, baseUrl: string, apiVersion: string, models: string[] }>}
 */
function normalizeByokProviders(credentials) {
  const providers = Array.isArray(credentials?.byok?.providers) ? credentials.byok.providers : [];
  return providers
    .map((provider) => {
      const providerId = String(provider?.providerId || provider?.id || 'byok').trim().toLowerCase() || 'byok';
      const providerName = String(provider?.providerName || providerId.toUpperCase()).trim() || providerId.toUpperCase();
      const apiKey = String(provider?.apiKey || '').trim();
      const baseUrl = trimTrailingSlash(String(provider?.baseUrl || DEFAULT_BYOK_BASE_URLS[providerId] || ''));
      const apiVersion = String(provider?.apiVersion || DEFAULT_AZURE_API_VERSION).trim() || DEFAULT_AZURE_API_VERSION;
      const models = (Array.isArray(provider?.models) ? provider.models : [])
        .map((model) => stripModelPrefix(model))
        .filter(Boolean);
      return { providerId, providerName, apiKey, baseUrl, apiVersion, models };
    })
    .filter((provider) => provider.apiKey);
}

/**
 * Route a BYOK chat request to the correct underlying provider (Azure or OpenAI-compatible).
 *
 * @param {{ provider: object, model: string, messages: object[], maxTokens?: number }} params
 * @returns {Promise<string>}
 */
async function callByokProviderChat({ provider, model, messages, maxTokens = 512 }) {
  const providerId = String(provider?.providerId || '').trim().toLowerCase();
  const providerName = String(provider?.providerName || providerId || 'BYOK').trim() || 'BYOK';
  const baseUrl = trimTrailingSlash(String(provider?.baseUrl || DEFAULT_BYOK_BASE_URLS[providerId] || ''));
  if (!baseUrl) {
    throw new Error(`BYOK provider "${providerName}" has no base URL configured.`);
  }

  if (isAzureProvider(providerId, baseUrl)) {
    return callAzureOpenAIChat({
      apiKey: provider.apiKey,
      model,
      messages,
      baseUrl,
      providerName,
      apiVersion: String(provider?.apiVersion || DEFAULT_AZURE_API_VERSION).trim() || DEFAULT_AZURE_API_VERSION,
      maxTokens,
    });
  }

  return callOpenAICompatibleChat({
    apiKey: provider.apiKey,
    model,
    messages,
    baseUrl,
    providerName,
    orgId: String(provider?.orgId || '').trim(),
    maxTokens,
  });
}

module.exports = {
  normalizeByokProviders,
  callByokProviderChat,
};
