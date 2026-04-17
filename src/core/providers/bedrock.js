'use strict';

/**
 * AWS Bedrock provider — direct Anthropic model invocation via SDK.
 */

const config = require('../../config');
const { MODEL_PROVIDER_TIMEOUT_MS } = require('./utils');

let BedrockRuntimeClient, InvokeModelWithResponseStreamCommand, InvokeModelCommand;
try {
  const bedrock = require('@aws-sdk/client-bedrock-runtime');
  BedrockRuntimeClient = bedrock.BedrockRuntimeClient;
  InvokeModelWithResponseStreamCommand = bedrock.InvokeModelWithResponseStreamCommand;
  InvokeModelCommand = bedrock.InvokeModelCommand;
} catch { /* SDK not installed — Bedrock direct mode unavailable */ }

const BEDROCK_MODEL_MAP = {
  'claude-sonnet-4-6':        'us.anthropic.claude-sonnet-4-6',
  'claude-opus-4-6-v1':       'us.anthropic.claude-opus-4-6-v1',
  'claude-opus-4-5':          'us.anthropic.claude-opus-4-5-20251101-v1:0',
  'claude-haiku-4-5':         'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-opus-4-1':          'us.anthropic.claude-opus-4-1-20250805-v1:0',
  'claude-sonnet-4-5':        'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-sonnet-4-20250514': 'us.anthropic.claude-sonnet-4-20250514-v1:0',
};

/**
 * Resolve a mesh model ID to its Bedrock cross-region inference profile ID.
 * Falls back to claude-sonnet-4-6 for unknown IDs.
 *
 * @param {string} model - Mesh model identifier
 * @returns {string} Bedrock modelId (us.anthropic.* inference profile)
 */
function resolveBedrockModelId(model) {
  const clean = String(model || '').replace(/^(us\.|anthropic\.)/, '');
  return BEDROCK_MODEL_MAP[clean] || BEDROCK_MODEL_MAP['claude-sonnet-4-6'];
}

// Module-level singleton — avoids per-request TLS/credential overhead
let bedrockClient = null;

/**
 * Get or create a configured BedrockRuntimeClient (singleton).
 * Uses explicit IAM credentials from config when set; otherwise falls back to
 * the default AWS credential chain (env, ~/.aws, instance metadata).
 *
 * @returns {import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient}
 */
function getBedrockClient() {
  if (!bedrockClient) {
    const opts = { region: config.AWS_REGION_BEDROCK || 'us-east-1' };
    if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
      opts.credentials = {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      };
    }
    bedrockClient = new BedrockRuntimeClient(opts);
  }
  return bedrockClient;
}

/**
 * Call AWS Bedrock (Anthropic model) without streaming — returns full text.
 *
 * @param {{ model: string, messages: object[], maxTokens?: number }} params
 * @returns {Promise<{ content: string, usage: object }>}
 * @throws {Error} If Bedrock SDK is unavailable or the API call fails
 */
async function callBedrockDirect({ model, messages, maxTokens = 4096 }) {
  if (!BedrockRuntimeClient || !InvokeModelCommand) {
    throw new Error('AWS Bedrock SDK not available. Run: npm install @aws-sdk/client-bedrock-runtime');
  }

  const bedrockModelId = resolveBedrockModelId(model);
  const client = getBedrockClient();

  const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const conversation = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: String(m.content || '') }));

  const payload = { anthropic_version: 'bedrock-2023-05-31', max_tokens: maxTokens, messages: conversation };
  if (systemText) {
    payload.system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
  }

  const cmd = new InvokeModelCommand({
    modelId: bedrockModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const bedrockAbort = new AbortController();
  const bedrockTimer = setTimeout(() => bedrockAbort.abort(), MODEL_PROVIDER_TIMEOUT_MS);
  const response = await client.send(cmd, { abortSignal: bedrockAbort.signal }).finally(() => clearTimeout(bedrockTimer));
  const decoded = JSON.parse(new TextDecoder().decode(response.body));
  const content = decoded.content?.map(c => c.text || '').join('') || '';
  const usage = {
    promptTokens: decoded.usage?.input_tokens || 0,
    completionTokens: decoded.usage?.output_tokens || 0,
  };

  return { content, usage };
}

module.exports = {
  BEDROCK_MODEL_MAP,
  resolveBedrockModelId,
  getBedrockClient,
  callBedrockDirect,
};
