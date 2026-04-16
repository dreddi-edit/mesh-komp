'use strict';

/**
 * Static model lists, system prompt, BYOK defaults, and codec constants.
 */

const config = require('../../config');

const STATIC_MODELS = {
  anthropic: [
    'claude-opus-4-6-v1',
    'claude-opus-4-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  openai: ['gpt-4o-mini', 'gpt-4o'],
  google: ['gemini-2.0-flash', 'gemini-1.5-pro'],
};

const MESH_DEFAULT_MODEL = config.MESH_DEFAULT_MODEL;

const MESH_SYSTEM_PROMPT = [
  'You are Mesh AI, an expert AI coding assistant integrated into the Mesh AI IDE.',
  'Mesh AI IDE is a browser-based development environment similar to VS Code, with an integrated file explorer, Monaco code editor, terminal, source control, and AI chat panel.',
  'You are running inside this IDE and can help users with coding, debugging, explaining code, writing documentation, refactoring, and any software development tasks.',
  'The user\'s workspace files are provided as structural capsules in the `<mesh_workspace_capsules>` XML block. These capsules are intelligently summarized to fit the context window.',
  'If a capsule file has `is_skeleton="true"`, it means the function/class bodies are elided for context efficiency. You must use the `read_file_range` tool to fetch the full implementation if you need to perform an exact analysis or edit.',
  'Refer to the files, structural symbols, and lines you can see. Be concise, technically accurate, and use markdown formatting.',
  'You can produce code blocks with language tags. The user can click \'Apply\' on those blocks to insert them directly into their editor.',
  'You are powered by state-of-the-art AI models and run on Mesh\'s cloud infrastructure.',
].join(' ');

const ALL_STATIC_MODELS = new Set([
  ...STATIC_MODELS.anthropic,
  ...STATIC_MODELS.openai,
  ...STATIC_MODELS.google,
]);

const DEFAULT_BYOK_BASE_URLS = {
  openrouter: 'https://openrouter.ai/api/v1',
};
const DEFAULT_AZURE_API_VERSION = '2024-08-01-preview';

const MESH_MODEL_CODEC_VERSION = 'mc2';
const MESH_MODEL_CODEC_CONTEXT_MARKER = `<mesh_codec_context id="${MESH_MODEL_CODEC_VERSION}">`;
const MESH_MODEL_CODEC_RESPONSE_OPEN = `<mesh_compressed_response codec="${MESH_MODEL_CODEC_VERSION}">`;
const MESH_MODEL_CODEC_RESPONSE_CLOSE = '</mesh_compressed_response>';
const MESH_MODEL_CODEC_PAYLOAD_PREFIX = `${MESH_MODEL_CODEC_VERSION.toUpperCase()}|`;
const MESH_MODEL_CODEC_PAYLOAD_SUFFIX = `|/${MESH_MODEL_CODEC_VERSION.toUpperCase()}`;

const MESH_MODEL_CODEC_TERMS = [
  'function', 'const', 'let', 'return', 'import', 'export', 'from', 'class', 'extends',
  'constructor', 'async', 'await', 'Promise', 'try', 'catch', 'if', 'else', 'for', 'while',
  'switch', 'case', 'break', 'continue', 'null', 'undefined', 'true', 'false',
  'document', 'querySelector', 'querySelectorAll', 'addEventListener', 'classList', 'textContent',
  'innerHTML', 'dataset', 'setAttribute', 'removeAttribute', 'toggleAttribute', 'IntersectionObserver',
  'JSON.stringify', 'JSON.parse', 'map', 'filter', 'forEach', 'includes', 'slice', 'push', 'split', 'join',
  'messages', 'model', 'content', 'workspace', 'path', 'originalSize', 'compressedSize', 'encoding',
  '<div', '</div>', '<span', '</span>', '<script', '</script>', '=>', '===', '!==',
];

const MESH_MODEL_CODEC_ESCAPE_PREFIX = '<<M';
const MESH_MODEL_CODEC_ESCAPE_REPLACEMENT = '<<MM';
const MESH_MODEL_CODEC_NEWLINE_TOKEN = '<<MNL>>';
const MESH_MODEL_CODEC_TAB_TOKEN = '<<MTB>>';

const MESH_MODEL_CODEC_TABLE = MESH_MODEL_CODEC_TERMS.map((term, index) => {
  const code = index.toString(36).toUpperCase().padStart(2, '0');
  return [term, `<<M${code}>>`];
});

const MESH_MODEL_CODEC_ENCODE_TABLE = [...MESH_MODEL_CODEC_TABLE].sort((a, b) => b[0].length - a[0].length);
const MESH_MODEL_CODEC_DECODE_TABLE = [...MESH_MODEL_CODEC_TABLE].sort((a, b) => b[1].length - a[1].length);

module.exports = {
  STATIC_MODELS,
  MESH_DEFAULT_MODEL,
  MESH_SYSTEM_PROMPT,
  ALL_STATIC_MODELS,
  DEFAULT_BYOK_BASE_URLS,
  DEFAULT_AZURE_API_VERSION,
  MESH_MODEL_CODEC_VERSION,
  MESH_MODEL_CODEC_CONTEXT_MARKER,
  MESH_MODEL_CODEC_RESPONSE_OPEN,
  MESH_MODEL_CODEC_RESPONSE_CLOSE,
  MESH_MODEL_CODEC_PAYLOAD_PREFIX,
  MESH_MODEL_CODEC_PAYLOAD_SUFFIX,
  MESH_MODEL_CODEC_TERMS,
  MESH_MODEL_CODEC_ESCAPE_PREFIX,
  MESH_MODEL_CODEC_ESCAPE_REPLACEMENT,
  MESH_MODEL_CODEC_NEWLINE_TOKEN,
  MESH_MODEL_CODEC_TAB_TOKEN,
  MESH_MODEL_CODEC_TABLE,
  MESH_MODEL_CODEC_ENCODE_TABLE,
  MESH_MODEL_CODEC_DECODE_TABLE,
};
