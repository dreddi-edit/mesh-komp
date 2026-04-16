'use strict';

/**
 * Shared utilities for provider modules.
 */

const path = require('path');
const { LRUCache } = require('lru-cache');
const config = require('../../config');
const { toSafePath } = require('../infrastructure/path-utils');

const MODEL_PROVIDER_TIMEOUT_MS = Number(process.env.MESH_MODEL_TIMEOUT_MS) || 120_000;

/**
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, options, timeoutMs = MODEL_PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const merged = { ...options, signal: controller.signal };
  return fetch(url, merged).finally(() => clearTimeout(timer));
}

function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function joinPath(baseUrl, tailPath) {
  return `${trimTrailingSlash(baseUrl)}/${String(tailPath || '').replace(/^\/+/, '')}`;
}

function stripModelPrefix(model) {
  return String(model || '').replace(/^models\//, '').trim();
}

function readMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        if (part && typeof part.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
  }
  if (content == null) return '';
  return String(content);
}

function normalizeMessages(messages) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = String(message?.role || 'user').toLowerCase();
      const allowedRole = role === 'assistant' || role === 'system' ? role : 'user';
      return {
        role: allowedRole,
        content: readMessageText(message?.content).trim(),
      };
    })
    .filter((message) => message.content.length > 0);

  if (normalized.length > 0) return normalized;
  return [{ role: 'user', content: 'ping' }];
}

function toOpenAiMessages(messages) {
  return normalizeMessages(messages).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function toAnthropicMessages(messages) {
  const normalized = normalizeMessages(messages)
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }));

  if (normalized.length > 0) return normalized;
  return [{ role: 'user', content: 'ping' }];
}

function toGeminiContents(messages) {
  const normalized = normalizeMessages(messages)
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  if (normalized.length > 0) return normalized;
  return [{ role: 'user', parts: [{ text: 'ping' }] }];
}

function isAzureProvider(providerId, baseUrl) {
  return (
    String(providerId || '').trim().toLowerCase() === 'azure' ||
    /\.openai\.azure\.com/i.test(String(baseUrl || ''))
  );
}

function normalizeAzureBaseUrl(baseUrl) {
  let root = trimTrailingSlash(baseUrl);
  root = root.replace(/\/openai\/v1$/i, '');
  root = root.replace(/\/openai$/i, '');
  return root;
}

function modelDisplayLabel(id) {
  const normalized = stripModelPrefix(id);
  if (!normalized) return 'Unknown model';
  return normalized
    .split(/[\/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseProviderError(payload, fallbackMessage) {
  if (!payload) return fallbackMessage;
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  if (typeof payload.message === 'string') return payload.message;
  return fallbackMessage;
}

function normalizeProviderUsage(rawUsage) {
  const usage = rawUsage && typeof rawUsage === 'object' ? rawUsage : {};

  const inputTokens = Number(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? 0
  );
  const outputTokens = Number(
    usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? 0
  );

  const normalizedInput = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.trunc(inputTokens) : 0;
  const normalizedOutput = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.trunc(outputTokens) : 0;

  let totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? 0);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    totalTokens = normalizedInput + normalizedOutput;
  }
  const normalizedTotal = Math.max(0, Math.trunc(totalTokens));

  const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);

  return {
    inputTokens: normalizedInput,
    outputTokens: normalizedOutput,
    totalTokens: normalizedTotal,
    cacheCreationInputTokens: Number.isFinite(cacheCreation) && cacheCreation > 0 ? Math.trunc(cacheCreation) : 0,
    cacheReadInputTokens: Number.isFinite(cacheRead) && cacheRead > 0 ? Math.trunc(cacheRead) : 0,
  };
}

async function readJsonResponse(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { error: raw.slice(0, 400) };
  }
}

function buildOpenAIChatCompletionBody({ model, messages, maxTokens, tokenField = 'max_tokens', includeModel = true }) {
  const body = {
    messages: toOpenAiMessages(messages),
    temperature: 0.2,
  };
  if (includeModel) body.model = model;
  body[tokenField] = Math.max(16, Number(maxTokens) || 512);
  return body;
}

function providerWantsMaxCompletionTokens(errorMessage) {
  const msg = String(errorMessage || '').toLowerCase();
  return (
    msg.includes('max_tokens') &&
    msg.includes('max_completion_tokens') &&
    (msg.includes('not supported') || msg.includes('unsupported parameter') || msg.includes('use'))
  );
}

function textFromMaybeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        if (part && typeof part.content === 'string') return part.content;
        if (part && part.type === 'text' && typeof part.value === 'string') return part.value;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    if (content.type === 'text' && typeof content.value === 'string') return content.value;
  }
  return '';
}

function extractAssistantTextFromChatPayload(payload) {
  const direct = [
    payload?.output_text,
    payload?.message,
    payload?.text,
    payload?.result,
    payload?.choices?.[0]?.message?.refusal,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean);
  if (direct) return direct;

  const choiceContent = payload?.choices?.[0]?.message?.content;
  const choiceText = textFromMaybeContent(choiceContent).trim();
  if (choiceText) return choiceText;

  const altChoiceText = [
    payload?.choices?.[0]?.text,
    payload?.choices?.[0]?.message?.text,
    payload?.choices?.[0]?.delta?.content,
    payload?.choices?.[0]?.delta?.text,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean);
  if (altChoiceText) return altChoiceText;

  const refusalFromMessage = Array.isArray(payload?.choices?.[0]?.message?.refusal)
    ? payload.choices[0].message.refusal
        .map((item) => (typeof item === 'string' ? item : (typeof item?.text === 'string' ? item.text : '')))
        .filter(Boolean)
        .join('\n')
    : '';
  if (refusalFromMessage.trim()) return refusalFromMessage.trim();

  const outputText = Array.isArray(payload?.output)
    ? payload.output
        .flatMap((block) => (Array.isArray(block?.content) ? block.content : []))
        .map((item) => {
          if (typeof item?.text === 'string') return item.text;
          if (typeof item?.refusal === 'string') return item.refusal;
          return '';
        })
        .filter(Boolean)
        .join('\n')
    : '';
  if (outputText.trim()) return outputText.trim();

  return '';
}

const meshCodecSessionState = new LRUCache({ max: config.CODEC_SESSION_CACHE_MAX });

module.exports = {
  MODEL_PROVIDER_TIMEOUT_MS,
  fetchWithTimeout,
  toSafePath,
  trimTrailingSlash,
  joinPath,
  stripModelPrefix,
  readMessageText,
  normalizeMessages,
  toOpenAiMessages,
  toAnthropicMessages,
  toGeminiContents,
  isAzureProvider,
  normalizeAzureBaseUrl,
  modelDisplayLabel,
  parseProviderError,
  normalizeProviderUsage,
  readJsonResponse,
  buildOpenAIChatCompletionBody,
  providerWantsMaxCompletionTokens,
  textFromMaybeContent,
  extractAssistantTextFromChatPayload,
  meshCodecSessionState,
};
