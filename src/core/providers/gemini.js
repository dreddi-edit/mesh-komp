'use strict';

/**
 * Google Gemini provider — chat and model listing.
 */

const {
  fetchWithTimeout,
  stripModelPrefix,
  parseProviderError,
  readJsonResponse,
  toGeminiContents,
} = require('./utils');

/**
 * Call Google Gemini generateContent.
 *
 * @param {{ apiKey: string, model: string, messages: object[] }} params
 * @returns {Promise<string>}
 */
async function callGeminiChat({ apiKey, model, messages }) {
  const normalizedModel = stripModelPrefix(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: toGeminiContents(messages),
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.2,
      },
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `Gemini request failed (${response.status})`));
  }

  const text = Array.isArray(payload?.candidates)
    ? payload.candidates
        .flatMap((candidate) => candidate?.content?.parts || [])
        .map((part) => part?.text)
        .filter(Boolean)
        .join('\n')
    : '';

  if (text.trim()) return text;
  throw new Error('Gemini returned no content.');
}

/**
 * Fetch available model IDs from Gemini /v1beta/models.
 *
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
async function fetchGeminiModels(apiKey) {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(parseProviderError(payload, `Gemini model list failed (${response.status})`));
  }

  return Array.isArray(payload?.models)
    ? payload.models.map((model) => stripModelPrefix(model?.name)).filter(Boolean)
    : [];
}

module.exports = {
  callGeminiChat,
  fetchGeminiModels,
};
