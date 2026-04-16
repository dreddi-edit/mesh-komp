'use strict';

/**
 * Unified provider interface — imports all provider sub-modules and
 * exposes the same API surface as the original model-providers.js.
 */

const config = require('../../config');

const constants = require('./constants');
const utils = require('./utils');
const anthropicProvider = require('./anthropic');
const openaiProvider = require('./openai');
const geminiProvider = require('./gemini');
const bedrockProvider = require('./bedrock');
const byokProvider = require('./byok');
const codecModule = require('./codec');

const {
  STATIC_MODELS,
  ALL_STATIC_MODELS,
  DEFAULT_BYOK_BASE_URLS,
  DEFAULT_AZURE_API_VERSION,
  MESH_SYSTEM_PROMPT,
} = constants;

const {
  stripModelPrefix,
  normalizeMessages,
  meshCodecSessionState,
} = utils;

const { callAnthropicChatWithMeta, callAnthropicChat, fetchAnthropicModels } = anthropicProvider;
const { callOpenAICompatibleChat, fetchOpenAICompatibleModels } = openaiProvider;
const { callGeminiChat, fetchGeminiModels } = geminiProvider;
const { callBedrockDirect } = bedrockProvider;
const { normalizeByokProviders, callByokProviderChat } = byokProvider;

/**
 * Inject the Mesh system prompt at the beginning of the messages array.
 *
 * @param {Array} messages
 * @param {{ codecContext?: string }} [options]
 * @returns {Array}
 */
function injectMeshSystemPrompt(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  if (messages[0]?.role === 'system') return messages;
  const systemContent = options.codecContext
    ? `${MESH_SYSTEM_PROMPT}\n\n${options.codecContext}`
    : MESH_SYSTEM_PROMPT;
  return [{ role: 'system', content: systemContent }, ...messages];
}

function resolveProviderForModel(model, credentials = {}) {
  const normalizedModel = stripModelPrefix(model);

  if (STATIC_MODELS.anthropic.includes(normalizedModel)) return { provider: 'anthropic', model: normalizedModel };
  if (STATIC_MODELS.openai.includes(normalizedModel)) return { provider: 'openai', model: normalizedModel };
  if (STATIC_MODELS.google.includes(normalizedModel)) return { provider: 'google', model: normalizedModel };

  const byokProviders = normalizeByokProviders(credentials);
  const exactByok = byokProviders.find((provider) => provider.models.includes(normalizedModel));
  if (exactByok) return { provider: 'byok', model: normalizedModel, byokProvider: exactByok };

  if (normalizedModel.startsWith('claude-')) return { provider: 'anthropic', model: normalizedModel };
  if (normalizedModel.startsWith('gemini-')) return { provider: 'google', model: normalizedModel };
  if (normalizedModel.startsWith('gpt-') || normalizedModel.includes('codex')) return { provider: 'openai', model: normalizedModel };

  if (byokProviders.length > 0) return { provider: 'byok', model: normalizedModel, byokProvider: byokProviders[0] };

  return { provider: 'unknown', model: normalizedModel };
}

/**
 * Route a chat request to the appropriate provider and return content + metadata.
 *
 * @param {{ model: string, messages: object[], credentials?: object }} params
 * @returns {Promise<{ provider: string, model: string, content: string, usage?: object }>}
 */
async function runModelChat({ model, messages, credentials = {} }) {
  const resolved = resolveProviderForModel(model, credentials);
  const byokProviders = normalizeByokProviders(credentials);
  const byokExactProvider = byokProviders.find((provider) => provider.models.includes(resolved.model));

  async function runByok(provider) {
    if (!provider || !provider.apiKey) {
      throw new Error('Missing BYOK provider key. Add it in Settings > AI & Models.');
    }
    const content = await callByokProviderChat({ provider, model: resolved.model, messages, maxTokens: 512 });
    return { provider: `byok:${provider.providerId}`, model: resolved.model, content };
  }

  if (resolved.provider === 'anthropic') {
    let apiKey = String(credentials?.anthropic?.apiKey || config.ANTHROPIC_API_KEY || '').trim();
    const bedrockAccessKey = String(config.AWS_ACCESS_KEY_ID || '').trim();

    if (bedrockAccessKey && resolved.model.startsWith('claude-')) {
      const bedrockResult = await callBedrockDirect({
        model: resolved.model,
        messages: injectMeshSystemPrompt(messages),
        maxTokens: Number(credentials?.anthropic?.maxTokens || 4096),
      });
      return { provider: 'mesh-bedrock', model: resolved.model, content: bedrockResult.content, usage: bedrockResult.usage };
    }

    if (!apiKey) {
      if (byokExactProvider) return runByok(byokExactProvider);
      throw new Error('Missing Anthropic API key. Configure it in Settings > AI & Models.');
    }

    const anthropicResult = await callAnthropicChatWithMeta({
      apiKey,
      model: resolved.model,
      messages,
      maxTokens: Number(credentials?.anthropic?.maxTokens || 4096),
    });
    return {
      provider: 'anthropic',
      model: resolved.model,
      content: anthropicResult.content,
      usage: anthropicResult.usage,
      providerRequestId: anthropicResult.requestId,
    };
  }

  if (resolved.provider === 'openai') {
    const userApiKey = String(credentials?.openai?.apiKey || config.OPENAI_API_KEY || '').trim();
    if (userApiKey) {
      const openAiResult = await callOpenAICompatibleChat({
        apiKey: userApiKey,
        model: resolved.model,
        messages: injectMeshSystemPrompt(messages),
        baseUrl: 'https://api.openai.com/v1',
        orgId: String(credentials?.openai?.orgId || '').trim(),
        providerName: 'OpenAI',
        withMeta: true,
      });
      return {
        provider: 'openai',
        model: resolved.model,
        content: openAiResult.content,
        usage: openAiResult.usage,
        providerRequestId: openAiResult.requestId,
      };
    }
    if (byokExactProvider) return runByok(byokExactProvider);
    throw new Error('Missing OpenAI API key. Configure it in Settings > AI & Models.');
  }

  if (resolved.provider === 'google') {
    const apiKey = String(credentials?.google?.apiKey || config.GOOGLE_API_KEY || '').trim();
    if (!apiKey) {
      if (byokExactProvider) return runByok(byokExactProvider);
      throw new Error('Missing Google API key. Configure it in Settings > AI & Models.');
    }
    const content = await callGeminiChat({ apiKey, model: resolved.model, messages });
    return { provider: 'google', model: resolved.model, content };
  }

  if (resolved.provider === 'byok') return runByok(resolved.byokProvider);

  throw new Error(`No provider configured for model "${model}".`);
}

function dedupeModelIds(models) {
  const seen = new Set();
  const out = [];
  for (const model of models || []) {
    const normalized = stripModelPrefix(model);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function staticModelMatch(modelId) {
  const normalized = stripModelPrefix(modelId);
  if (!normalized) return null;
  if (ALL_STATIC_MODELS.has(normalized)) return normalized;
  const slashIdx = normalized.indexOf('/');
  if (slashIdx > -1) {
    const tail = normalized.slice(slashIdx + 1);
    if (ALL_STATIC_MODELS.has(tail)) return tail;
  }
  return null;
}

function normalizeImportedModels(models, providerId, providerName) {
  const { modelDisplayLabel } = utils;
  return dedupeModelIds(models)
    .filter((modelId) => !staticModelMatch(modelId))
    .slice(0, 80)
    .map((modelId) => ({
      id: modelId,
      label: modelDisplayLabel(modelId),
      providerId,
      providerName,
    }));
}

function normalizeRequestedModelIds(modelIds) {
  const raw = Array.isArray(modelIds) ? modelIds : String(modelIds || '').split(/[\n,]/g);
  return dedupeModelIds(raw.map((modelId) => stripModelPrefix(modelId)));
}

/**
 * Validate provider API key by probing available models and making a test chat call.
 *
 * @param {{ provider: string, apiKey: string, [key: string]: any }} payload
 * @returns {Promise<{ ok: boolean, provider: string, reachableModels: string[], verifiedModels: string[], additionalModels: object[] }>}
 */
async function validateProviderKey(payload = {}) {
  const provider = String(payload.provider || '').trim().toLowerCase();
  const apiKey = String(payload.apiKey || '').trim();

  if (!provider) throw new Error('Provider is required.');
  if (!apiKey) throw new Error('API key is required.');

  if (provider === 'anthropic') {
    const listed = await fetchAnthropicModels(apiKey).catch(() => []);
    const probeModel = listed.find((id) => STATIC_MODELS.anthropic.includes(id)) || STATIC_MODELS.anthropic[2];
    await callAnthropicChat({ apiKey, model: probeModel, messages: [{ role: 'user', content: 'ping' }], maxTokens: 64 });

    const reachableModels = listed.length ? dedupeModelIds(listed) : [probeModel];
    const verifiedModels = STATIC_MODELS.anthropic.filter((id) => reachableModels.includes(id));
    if (!verifiedModels.length) verifiedModels.push(probeModel);

    return { ok: true, provider, providerId: 'anthropic', providerName: 'Anthropic', reachableModels, verifiedModels: dedupeModelIds(verifiedModels), additionalModels: [] };
  }

  if (provider === 'openai') {
    const listed = await fetchOpenAICompatibleModels({
      apiKey,
      baseUrl: 'https://api.openai.com/v1',
      providerName: 'OpenAI',
      orgId: String(payload.orgId || '').trim(),
    });

    const probeModel = listed.find((id) => STATIC_MODELS.openai.includes(id)) || STATIC_MODELS.openai[0];
    await callOpenAICompatibleChat({
      apiKey,
      model: probeModel,
      messages: [{ role: 'user', content: 'ping' }],
      baseUrl: 'https://api.openai.com/v1',
      orgId: String(payload.orgId || '').trim(),
      providerName: 'OpenAI',
    });

    const reachableModels = dedupeModelIds(listed.length ? listed : [probeModel]);
    const verifiedModels = STATIC_MODELS.openai.filter((id) => reachableModels.includes(id));
    return { ok: true, provider, providerId: 'openai', providerName: 'OpenAI', reachableModels, verifiedModels, additionalModels: [] };
  }

  if (provider === 'google') {
    const listed = await fetchGeminiModels(apiKey);
    const probeModel = listed.find((id) => STATIC_MODELS.google.includes(id)) || STATIC_MODELS.google[0];
    await callGeminiChat({ apiKey, model: probeModel, messages: [{ role: 'user', content: 'ping' }] });

    const reachableModels = dedupeModelIds(listed.length ? listed : [probeModel]);
    const verifiedModels = STATIC_MODELS.google.filter((id) => reachableModels.includes(id));
    return { ok: true, provider, providerId: 'google', providerName: 'Google', reachableModels, verifiedModels, additionalModels: [] };
  }

  if (provider === 'byok') {
    const { trimTrailingSlash, joinPath, fetchWithTimeout, readJsonResponse, parseProviderError } = utils;
    const providerId = String(payload.providerId || 'openrouter').trim().toLowerCase() || 'openrouter';
    const providerName = String(payload.providerName || 'BYOK').trim() || 'BYOK';
    const baseUrl = trimTrailingSlash(String(payload.baseUrl || DEFAULT_BYOK_BASE_URLS[providerId] || ''));
    const apiVersion = String(payload.apiVersion || DEFAULT_AZURE_API_VERSION).trim() || DEFAULT_AZURE_API_VERSION;
    if (!baseUrl) throw new Error(`No base URL configured for BYOK provider "${providerName}".`);

    if (providerId === 'openrouter') {
      const authResponse = await fetchWithTimeout(joinPath(baseUrl, 'auth/key'), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      const authPayload = await readJsonResponse(authResponse);
      if (!authResponse.ok) {
        throw new Error(parseProviderError(authPayload, `OpenRouter key validation failed (${authResponse.status})`));
      }
    }

    const requestedModels = normalizeRequestedModelIds(payload.modelIds);
    if (!requestedModels.length) {
      throw new Error('Enter at least one model ID to test (one per line or comma-separated).');
    }

    const providerConfig = { providerId, providerName, apiKey, baseUrl, apiVersion };
    const reachableModels = [];
    const failedModels = [];

    for (const modelId of requestedModels) {
      try {
        await callByokProviderChat({ provider: providerConfig, model: modelId, messages: [{ role: 'user', content: 'ping' }], maxTokens: 24 });
        reachableModels.push(modelId);
      } catch (error) {
        failedModels.push({ id: modelId, error: String(error?.message || 'Validation call failed.') });
      }
    }

    if (!reachableModels.length) {
      const firstFailure = failedModels[0];
      if (firstFailure) throw new Error(`None of the tested model IDs are reachable. First error (${firstFailure.id}): ${firstFailure.error}`);
      throw new Error(`${providerName} validation failed. No reachable model IDs.`);
    }

    const verifiedModels = dedupeModelIds(reachableModels.map(staticModelMatch).filter(Boolean));
    const additionalModels = normalizeImportedModels(reachableModels, providerId, providerName);

    return { ok: true, provider, providerId, providerName, reachableModels, requestedModels, failedModels, verifiedModels, additionalModels };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

module.exports = {
  // SDK client
  Anthropic: anthropicProvider.Anthropic,

  // Constants
  ...constants,

  // Utils
  meshCodecSessionState,
  injectMeshSystemPrompt,
  stripModelPrefix,
  readMessageText: utils.readMessageText,
  normalizeMessages,
  toOpenAiMessages: utils.toOpenAiMessages,
  toAnthropicMessages: utils.toAnthropicMessages,
  toGeminiContents: utils.toGeminiContents,
  trimTrailingSlash: utils.trimTrailingSlash,
  joinPath: utils.joinPath,
  isAzureProvider: utils.isAzureProvider,
  normalizeAzureBaseUrl: utils.normalizeAzureBaseUrl,
  modelDisplayLabel: utils.modelDisplayLabel,
  parseProviderError: utils.parseProviderError,
  normalizeProviderUsage: utils.normalizeProviderUsage,
  readJsonResponse: utils.readJsonResponse,
  buildOpenAIChatCompletionBody: utils.buildOpenAIChatCompletionBody,
  providerWantsMaxCompletionTokens: utils.providerWantsMaxCompletionTokens,
  textFromMaybeContent: utils.textFromMaybeContent,
  extractAssistantTextFromChatPayload: utils.extractAssistantTextFromChatPayload,

  // Anthropic
  callAnthropicChatWithMeta,
  callAnthropicChat,
  fetchAnthropicModels,

  // OpenAI
  callOpenAIResponsesEndpoint: openaiProvider.callOpenAIResponsesEndpoint,
  callOpenAICompatibleChat,
  callAzureOpenAIChat: openaiProvider.callAzureOpenAIChat,
  fetchOpenAICompatibleModels,

  // Gemini
  callGeminiChat,
  fetchGeminiModels,

  // Bedrock
  BEDROCK_MODEL_MAP: bedrockProvider.BEDROCK_MODEL_MAP,
  resolveBedrockModelId: bedrockProvider.resolveBedrockModelId,
  getBedrockClient: bedrockProvider.getBedrockClient,
  callBedrockDirect,

  // BYOK
  normalizeByokProviders,
  callByokProviderChat,

  // Model routing
  resolveProviderForModel,
  runModelChat,
  dedupeModelIds,
  staticModelMatch,
  normalizeImportedModels,
  normalizeRequestedModelIds,
  validateProviderKey,

  // Codec
  ...codecModule,
};
