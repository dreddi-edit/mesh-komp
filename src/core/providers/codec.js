'use strict';

/**
 * Mesh model codec — encode/decode workspace context payloads for LLM transport.
 */

const { toSafePath, meshCodecSessionState } = require('./utils');
const {
  MESH_MODEL_CODEC_VERSION,
  MESH_MODEL_CODEC_CONTEXT_MARKER,
  MESH_MODEL_CODEC_PAYLOAD_PREFIX,
  MESH_MODEL_CODEC_PAYLOAD_SUFFIX,
  MESH_MODEL_CODEC_TABLE,
  MESH_MODEL_CODEC_ENCODE_TABLE,
  MESH_MODEL_CODEC_DECODE_TABLE,
  MESH_MODEL_CODEC_ESCAPE_PREFIX,
  MESH_MODEL_CODEC_ESCAPE_REPLACEMENT,
  MESH_MODEL_CODEC_NEWLINE_TOKEN,
  MESH_MODEL_CODEC_TAB_TOKEN,
} = require('./constants');

function replaceLiteralAll(input, search, replacement) {
  if (!search) return String(input || '');
  return String(input || '').split(search).join(replacement);
}

function escapeRegexLiteral(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rot47Transform(input) {
  let out = '';
  const source = String(input || '');
  for (const ch of source) {
    const code = ch.charCodeAt(0);
    if (code >= 33 && code <= 126) {
      out += String.fromCharCode(33 + ((code - 33 + 47) % 94));
    } else {
      out += ch;
    }
  }
  return out;
}

function textCompositionStats(input) {
  const text = String(input || '');
  const total = text.length || 1;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/[0-9]/g) || []).length;
  const spaces = (text.match(/\s/g) || []).length;
  const punctuation = (text.match(/[^A-Za-z0-9\s]/g) || []).length;
  const words = (text.match(/[A-Za-z]{3,}/g) || []).length;
  const nonSpace = Math.max(1, total - spaces);

  return {
    letters,
    digits,
    spaces,
    punctuation,
    words,
    alphaRatio: letters / total,
    symbolRatio: (digits + punctuation) / nonSpace,
  };
}

function containsCodecSignals(input) {
  return /<<M[A-Z0-9]{2}>>|<<MNL>>|<<MTB>>/.test(String(input || ''));
}

function isLikelyUnframedRot47(rawText, rotatedText) {
  const raw = String(rawText || '');
  const rotated = String(rotatedText || '');
  if (raw.length < 48 || rotated.length < 48) return false;

  const rawStats = textCompositionStats(raw);
  const rotatedStats = textCompositionStats(rotated);
  const commonWordCount = (rotated.match(/\b(the|and|for|with|from|file|files|context|server|model|response|content|contains|return|line|function|const|import|export)\b/gi) || []).length;

  return (
    rawStats.symbolRatio >= 0.42 &&
    rotatedStats.words >= 6 &&
    rotatedStats.alphaRatio >= rawStats.alphaRatio + 0.18 &&
    rotatedStats.symbolRatio <= rawStats.symbolRatio - 0.12 &&
    commonWordCount >= 2
  );
}

function decodedReadabilityScore(input) {
  const text = String(input || '');
  if (!text) return -1000;
  const stats = textCompositionStats(text);
  const commonWordCount = (text.match(/\b(the|and|for|with|from|file|files|context|server|model|response|content|contains|return|line|function|const|import|export)\b/gi) || []).length;
  return (stats.words * 2) + (commonWordCount * 6) + (stats.alphaRatio * 20) - (stats.symbolRatio * 10);
}

function pickMostReadableDecoded(...candidates) {
  const filtered = candidates.map((item) => String(item || '')).filter(Boolean);
  if (!filtered.length) return '';

  let best = filtered[0];
  let bestScore = decodedReadabilityScore(best);

  for (const candidate of filtered.slice(1)) {
    const score = decodedReadabilityScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function decodeCodecTokens(tokenStream) {
  let decoded = String(tokenStream || '');
  for (const [plain, token] of MESH_MODEL_CODEC_DECODE_TABLE) {
    decoded = replaceLiteralAll(decoded, token, plain);
  }
  decoded = replaceLiteralAll(decoded, MESH_MODEL_CODEC_NEWLINE_TOKEN, '\n');
  decoded = replaceLiteralAll(decoded, MESH_MODEL_CODEC_TAB_TOKEN, '\t');
  decoded = replaceLiteralAll(decoded, MESH_MODEL_CODEC_ESCAPE_REPLACEMENT, MESH_MODEL_CODEC_ESCAPE_PREFIX);
  return decoded;
}

function codecTokenShouldReplace(plain, token) {
  return String(plain || '').length > String(token || '').length;
}

/**
 * Encode raw text into Mesh model codec payload.
 *
 * @param {string} rawText
 * @param {{ disableDictionary?: boolean, withMeta?: boolean }} [options]
 * @returns {string|object}
 */
function encodeMeshModelCodec(rawText, options = {}) {
  const disableDictionary = Boolean(options.disableDictionary);
  const withMeta = Boolean(options.withMeta);
  let tokenized = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  tokenized = replaceLiteralAll(tokenized, MESH_MODEL_CODEC_ESCAPE_PREFIX, MESH_MODEL_CODEC_ESCAPE_REPLACEMENT);
  const usedTokens = new Set();

  if (!disableDictionary) {
    for (const [plain, token] of MESH_MODEL_CODEC_ENCODE_TABLE) {
      if (!codecTokenShouldReplace(plain, token)) continue;
      if (!tokenized.includes(plain)) continue;
      tokenized = replaceLiteralAll(tokenized, plain, token);
      usedTokens.add(token);
    }
  }

  const encoded = `${MESH_MODEL_CODEC_PAYLOAD_PREFIX}${tokenized}${MESH_MODEL_CODEC_PAYLOAD_SUFFIX}`;
  if (!withMeta) return encoded;

  return {
    encoded,
    usedTokens: [...usedTokens],
    dictionaryEnabled: !disableDictionary,
  };
}

/**
 * Decode a Mesh model codec payload back to plain text.
 *
 * @param {string} encodedText
 * @param {{ allowLegacy?: boolean, allowUnframedRot47?: boolean }} [options]
 * @returns {{ ok: boolean, decoded: string, mode: string }}
 */
function decodeMeshModelCodec(encodedText, options = {}) {
  const allowLegacy = options.allowLegacy !== false;
  const allowUnframedRot47 = Boolean(options.allowUnframedRot47);

  const raw = String(encodedText || '');
  const unrotated = rot47Transform(raw);

  const hasPlainFramedPayload =
    raw.startsWith(MESH_MODEL_CODEC_PAYLOAD_PREFIX) &&
    raw.endsWith(MESH_MODEL_CODEC_PAYLOAD_SUFFIX);

  if (hasPlainFramedPayload) {
    const tokenized = raw.slice(
      MESH_MODEL_CODEC_PAYLOAD_PREFIX.length,
      raw.length - MESH_MODEL_CODEC_PAYLOAD_SUFFIX.length
    );
    const directDecoded = decodeCodecTokens(tokenized);
    const rotatedInnerDecoded = decodeCodecTokens(rot47Transform(tokenized));
    const bestDecoded = pickMostReadableDecoded(directDecoded, rotatedInnerDecoded);
    return {
      ok: true,
      decoded: bestDecoded,
      mode: bestDecoded === rotatedInnerDecoded ? 'mc2-framed-plain-rot47-inner' : 'mc2-framed-plain',
    };
  }

  const hasFramedPayload =
    unrotated.startsWith(MESH_MODEL_CODEC_PAYLOAD_PREFIX) &&
    unrotated.endsWith(MESH_MODEL_CODEC_PAYLOAD_SUFFIX);

  if (hasFramedPayload) {
    const tokenized = unrotated.slice(
      MESH_MODEL_CODEC_PAYLOAD_PREFIX.length,
      unrotated.length - MESH_MODEL_CODEC_PAYLOAD_SUFFIX.length
    );
    return { ok: true, decoded: decodeCodecTokens(tokenized), mode: 'mc2-framed' };
  }

  if (allowLegacy && containsCodecSignals(raw)) {
    return { ok: true, decoded: decodeCodecTokens(raw), mode: 'mc1-legacy' };
  }

  if (allowUnframedRot47 && isLikelyUnframedRot47(raw, unrotated)) {
    if (containsCodecSignals(unrotated)) {
      return { ok: true, decoded: decodeCodecTokens(unrotated), mode: 'mc2-rot47-unframed-tokens' };
    }
    return { ok: true, decoded: unrotated, mode: 'mc2-rot47-unframed-plain' };
  }

  return { ok: false, decoded: '', mode: 'invalid' };
}

/**
 * Build the codec context document injected into chat sessions.
 *
 * @param {{ dictionaryEnabled?: boolean }} [options]
 * @returns {string}
 */
function buildMeshCodecContextDocument(options = {}) {
  const dictionaryEnabled = options.dictionaryEnabled !== false;
  const dictionaryLines = dictionaryEnabled
    ? MESH_MODEL_CODEC_TABLE
        .filter(([plain, token]) => codecTokenShouldReplace(plain, token))
        .map(([plain, token]) => `${token} => ${plain}`)
    : [];

  return [
    MESH_MODEL_CODEC_CONTEXT_MARKER,
    'MESH codec reference for this chat session.',
    `Codec version: ${MESH_MODEL_CODEC_VERSION}`,
    'Workspace files are framed context excerpts.',
    'Decoding steps for file payloads:',
    `1) Confirm framing: ${MESH_MODEL_CODEC_PAYLOAD_PREFIX}...${MESH_MODEL_CODEC_PAYLOAD_SUFFIX}`,
    dictionaryEnabled ? '2) Expand dictionary tokens.' : '2) Read payload directly as plain excerpt text.',
    'You may answer in plain text.',
    'Gateway handles response compression for transport.',
    'If context is insufficient, request a specific file path instead of guessing.',
    ...(dictionaryEnabled ? ['Token dictionary:', ...dictionaryLines] : []),
    '</mesh_codec_context>',
  ].join('\n');
}

function hasCodecContextMarker(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((message) =>
    String(message?.content || '').includes(MESH_MODEL_CODEC_CONTEXT_MARKER)
  );
}

function normalizeChatSessionId(rawSessionId) {
  const normalized = String(rawSessionId || '').trim();
  if (!normalized) return '';
  return normalized.slice(0, 120);
}

function markCodecContextInitialized(sessionId, options = {}) {
  if (!sessionId) return;
  const previous = meshCodecSessionState.get(sessionId) || {};
  meshCodecSessionState.set(sessionId, {
    codecContextSent: true,
    dictionaryReady: Boolean(previous.dictionaryReady || options.dictionaryReady),
    updatedAt: Date.now(),
  });
}

function isCodecContextInitializedForSession(sessionId, options = {}) {
  if (!sessionId) return false;
  const state = meshCodecSessionState.get(sessionId);
  if (!state?.codecContextSent) return false;
  if (options.requireDictionary && !state.dictionaryReady) return false;
  return true;
}

function injectCodecContextIntoMessages(messages = [], options = {}) {
  const contextDoc = buildMeshCodecContextDocument(options);
  const cloned = (Array.isArray(messages) ? messages : []).map((message) => ({
    role: String(message?.role || 'user'),
    content: String(message?.content || ''),
  }));

  const firstUserIndex = cloned.findIndex((message) => message.role === 'user');
  if (firstUserIndex === -1) {
    cloned.unshift({ role: 'user', content: contextDoc });
    return cloned;
  }

  cloned[firstUserIndex].content = `${contextDoc}\n\n${cloned[firstUserIndex].content}`;
  return cloned;
}

function extractCompressedModelPayload(rawContent) {
  const raw = String(rawContent || '').trim();
  const wrapped = /<mesh_compressed_response\b[^>]*>([\s\S]*?)<\/mesh_compressed_response>/i.exec(raw);
  if (wrapped) {
    return {
      encodedPayload: String(wrapped[1] || '').trim(),
      wrapped: true,
      payloadSource: 'wrapper',
    };
  }

  const prefixEscaped = escapeRegexLiteral(MESH_MODEL_CODEC_PAYLOAD_PREFIX);
  const suffixEscaped = escapeRegexLiteral(MESH_MODEL_CODEC_PAYLOAD_SUFFIX);
  const inlineFrame = new RegExp(`${prefixEscaped}([\\s\\S]*?)${suffixEscaped}`, 'i').exec(raw);
  if (inlineFrame) {
    return {
      encodedPayload: `${MESH_MODEL_CODEC_PAYLOAD_PREFIX}${String(inlineFrame[1] || '')}${MESH_MODEL_CODEC_PAYLOAD_SUFFIX}`,
      wrapped: false,
      payloadSource: 'inline-frame',
    };
  }

  return { encodedPayload: raw, wrapped: false, payloadSource: 'raw' };
}

function decodeCompressedModelResponse(rawContent, options = {}) {
  const extracted = extractCompressedModelPayload(rawContent);
  const decoded = decodeMeshModelCodec(extracted.encodedPayload, {
    allowLegacy: options.allowLegacy !== false,
    allowUnframedRot47: Boolean(options.allowUnframedRot47),
  });

  return {
    decoded: decoded.decoded,
    encodedPayload: extracted.encodedPayload,
    compressedByModel: decoded.ok,
    codecValid: decoded.ok,
    codecMode: decoded.mode,
    wrapped: extracted.wrapped,
    payloadSource: extracted.payloadSource,
  };
}

function escapeTagAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function dedupePaths(paths = []) {
  const seen = new Set();
  const out = [];
  for (const input of paths) {
    const normalized = toSafePath(input);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function extractActiveFilePathFromMessages(messages = []) {
  const lastUserMessage = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'user')
    .at(-1)?.content;

  const match = /<active_file\s+path="([^"]+)"\s*\/?>/i.exec(String(lastUserMessage || ''));
  return match ? toSafePath(match[1]) : '';
}

module.exports = {
  replaceLiteralAll,
  escapeRegexLiteral,
  rot47Transform,
  textCompositionStats,
  containsCodecSignals,
  isLikelyUnframedRot47,
  decodedReadabilityScore,
  pickMostReadableDecoded,
  decodeCodecTokens,
  codecTokenShouldReplace,
  encodeMeshModelCodec,
  decodeMeshModelCodec,
  buildMeshCodecContextDocument,
  hasCodecContextMarker,
  normalizeChatSessionId,
  markCodecContextInitialized,
  isCodecContextInitializedForSession,
  injectCodecContextIntoMessages,
  extractCompressedModelPayload,
  decodeCompressedModelResponse,
  escapeTagAttribute,
  dedupePaths,
  extractActiveFilePathFromMessages,
};
