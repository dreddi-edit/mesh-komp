'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  stripModelPrefix,
  readMessageText,
  normalizeMessages,
  toOpenAiMessages,
  toAnthropicMessages,
  toGeminiContents,
  trimTrailingSlash,
  joinPath,
  isAzureProvider,
  normalizeAzureBaseUrl,
  modelDisplayLabel,
  parseProviderError,
  normalizeProviderUsage,
  resolveProviderForModel,
  injectMeshSystemPrompt,
  MESH_SYSTEM_PROMPT,
} = require('../src/core/model-providers');

describe('stripModelPrefix', () => {
  it('removes models/ prefix', () => {
    assert.equal(stripModelPrefix('models/gpt-4'), 'gpt-4');
  });

  it('returns trimmed string for models without prefix', () => {
    assert.equal(stripModelPrefix('  claude-opus-4-6  '), 'claude-opus-4-6');
  });

  it('handles null/undefined', () => {
    assert.equal(stripModelPrefix(null), '');
    assert.equal(stripModelPrefix(undefined), '');
  });
});

describe('readMessageText', () => {
  it('returns string content directly', () => {
    assert.equal(readMessageText('hello'), 'hello');
  });

  it('joins array of text parts', () => {
    assert.equal(readMessageText([{ text: 'part1' }, { text: 'part2' }]), 'part1\npart2');
  });

  it('handles mixed array with strings and objects', () => {
    assert.equal(readMessageText(['plain', { text: 'rich' }]), 'plain\nrich');
  });

  it('extracts .text from object content', () => {
    assert.equal(readMessageText({ text: 'hello' }), 'hello');
  });

  it('returns empty string for null', () => {
    assert.equal(readMessageText(null), '');
  });
});

describe('normalizeMessages', () => {
  it('normalizes roles to user/assistant/system', () => {
    const result = normalizeMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'system', content: 'prompt' },
    ]);
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'user');
    assert.equal(result[1].role, 'assistant');
    assert.equal(result[2].role, 'system');
  });

  it('maps unknown roles to user', () => {
    const result = normalizeMessages([{ role: 'tool', content: 'data' }]);
    assert.equal(result[0].role, 'user');
  });

  it('filters empty content', () => {
    const result = normalizeMessages([
      { role: 'user', content: 'hello' },
      { role: 'user', content: '' },
      { role: 'user', content: '   ' },
    ]);
    assert.equal(result.length, 1);
  });

  it('returns fallback ping for empty input', () => {
    const result = normalizeMessages([]);
    assert.equal(result.length, 1);
    assert.equal(result[0].content, 'ping');
  });
});

describe('toAnthropicMessages', () => {
  it('filters out system messages', () => {
    const result = toAnthropicMessages([
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'hello' },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'user');
  });
});

describe('toGeminiContents', () => {
  it('maps assistant to model role with parts', () => {
    const result = toGeminiContents([{ role: 'assistant', content: 'hi' }]);
    assert.equal(result[0].role, 'model');
    assert.deepEqual(result[0].parts, [{ text: 'hi' }]);
  });
});

describe('URL utilities', () => {
  it('trimTrailingSlash removes trailing slashes', () => {
    assert.equal(trimTrailingSlash('https://api.example.com///'), 'https://api.example.com');
  });

  it('joinPath combines base and tail', () => {
    assert.equal(joinPath('https://api.example.com/', '/v1/chat'), 'https://api.example.com/v1/chat');
  });
});

describe('isAzureProvider', () => {
  it('detects azure by providerId', () => {
    assert.equal(isAzureProvider('azure', ''), true);
  });

  it('detects azure by baseUrl pattern', () => {
    assert.equal(isAzureProvider('custom', 'https://myapp.openai.azure.com'), true);
  });

  it('returns false for non-azure', () => {
    assert.equal(isAzureProvider('openrouter', 'https://openrouter.ai'), false);
  });
});

describe('normalizeAzureBaseUrl', () => {
  it('strips /openai/v1 suffix', () => {
    assert.equal(normalizeAzureBaseUrl('https://myapp.azure.com/openai/v1'), 'https://myapp.azure.com');
  });

  it('strips /openai suffix', () => {
    assert.equal(normalizeAzureBaseUrl('https://myapp.azure.com/openai'), 'https://myapp.azure.com');
  });
});

describe('modelDisplayLabel', () => {
  it('converts model id to display label', () => {
    assert.equal(modelDisplayLabel('claude-opus-4-6'), 'Claude Opus 4 6');
  });

  it('handles models/ prefix', () => {
    assert.equal(modelDisplayLabel('models/gpt-4'), 'Gpt 4');
  });

  it('returns Unknown model for empty input', () => {
    assert.equal(modelDisplayLabel(''), 'Unknown model');
  });
});

describe('parseProviderError', () => {
  it('extracts error string', () => {
    assert.equal(parseProviderError({ error: 'rate limited' }, 'fallback'), 'rate limited');
  });

  it('extracts nested error.message', () => {
    assert.equal(parseProviderError({ error: { message: 'quota exceeded' } }, 'fallback'), 'quota exceeded');
  });

  it('returns fallback for null payload', () => {
    assert.equal(parseProviderError(null, 'fallback'), 'fallback');
  });
});

describe('normalizeProviderUsage', () => {
  it('normalizes OpenAI-style usage', () => {
    const result = normalizeProviderUsage({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
    assert.equal(result.inputTokens, 100);
    assert.equal(result.outputTokens, 50);
    assert.equal(result.totalTokens, 150);
  });

  it('normalizes Anthropic-style usage', () => {
    const result = normalizeProviderUsage({ input_tokens: 200, output_tokens: 80 });
    assert.equal(result.inputTokens, 200);
    assert.equal(result.outputTokens, 80);
    assert.equal(result.totalTokens, 280);
  });

  it('returns zeros for missing usage', () => {
    const result = normalizeProviderUsage(null);
    assert.equal(result.inputTokens, 0);
    assert.equal(result.outputTokens, 0);
  });
});

describe('resolveProviderForModel', () => {
  it('resolves anthropic models', () => {
    const result = resolveProviderForModel('claude-opus-4-6');
    assert.equal(result.provider, 'anthropic');
  });

  it('resolves openai models', () => {
    const result = resolveProviderForModel('gpt-5.4-mini');
    assert.equal(result.provider, 'openai');
  });

  it('resolves google models', () => {
    const result = resolveProviderForModel('gemini-3-flash');
    assert.equal(result.provider, 'google');
  });

  it('infers provider from model prefix', () => {
    assert.equal(resolveProviderForModel('claude-custom').provider, 'anthropic');
    assert.equal(resolveProviderForModel('gemini-custom').provider, 'google');
    assert.equal(resolveProviderForModel('gpt-custom').provider, 'openai');
  });

  it('falls back to unknown for unrecognized models', () => {
    assert.equal(resolveProviderForModel('llama-70b').provider, 'unknown');
  });

  it('routes to byok when provider has the model', () => {
    const creds = { byok: { providers: [{ providerId: 'openrouter', apiKey: 'key123', models: ['llama-70b'] }] } };
    const result = resolveProviderForModel('llama-70b', creds);
    assert.equal(result.provider, 'byok');
  });
});

describe('injectMeshSystemPrompt', () => {
  it('prepends system prompt when missing', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const result = injectMeshSystemPrompt(messages);
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.equal(result[0].content, MESH_SYSTEM_PROMPT);
  });

  it('does not duplicate existing system prompt', () => {
    const messages = [{ role: 'system', content: 'existing' }, { role: 'user', content: 'hi' }];
    const result = injectMeshSystemPrompt(messages);
    assert.equal(result.length, 2);
    assert.equal(result[0].content, 'existing');
  });
});
