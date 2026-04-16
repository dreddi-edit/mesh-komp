'use strict';

/**
 * Context excerpt utilities, codec transport builders, and refusal detection.
 * Uses globals: extractSearchTokens, dedupePaths, encodeMeshModelCodec,
 * decodeMeshModelCodec, decodeCompressedModelResponse, extractCompressedModelPayload,
 * decompressLocalWorkspaceText, MESH_MODEL_CODEC_VERSION, escapeTagAttribute.
 */

const { openWorkspaceFileWithFallback, recoverWorkspaceWithFallback } = require('./file-cache');

/**
 * @param {string} input
 * @returns {string}
 */
function normalizeContextExcerptText(input) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n');
}

/**
 * @param {string[]|string} rawTerms
 * @returns {string[]}
 */
function normalizeExcerptFocusTerms(rawTerms) {
  const sourceTerms = Array.isArray(rawTerms)
    ? rawTerms
    : extractSearchTokens(String(rawTerms || ''));

  const deduped = [];
  const seen = new Set();
  for (const term of sourceTerms) {
    const normalized = String(term || '').trim().toLowerCase();
    if (normalized.length < 3 || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= 10) break;
  }
  return deduped;
}

/**
 * @param {string} text
 * @param {string[]} focusTerms
 * @param {object} [options]
 * @returns {Array<{ start: number, end: number }>}
 */
function collectFocusedCharRanges(text, focusTerms = [], options = {}) {
  const source = String(text || '');
  const terms = Array.isArray(focusTerms) ? focusTerms : [];
  if (!source || terms.length === 0) return [];

  const aroundBefore = Math.max(40, Number(options.aroundBefore) || 220);
  const aroundAfter = Math.max(60, Number(options.aroundAfter) || 520);
  const maxHits = Math.max(1, Number(options.maxHits) || 10);

  const ranges = [];
  const lower = source.toLowerCase();
  let hitCount = 0;

  for (const rawTerm of terms) {
    if (hitCount >= maxHits) break;
    const term = String(rawTerm || '').toLowerCase();
    if (!term) continue;

    let searchIdx = 0;
    while (hitCount < maxHits) {
      const hitIdx = lower.indexOf(term, searchIdx);
      if (hitIdx < 0) break;
      ranges.push({
        start: Math.max(0, hitIdx - aroundBefore),
        end: Math.min(source.length, hitIdx + term.length + aroundAfter),
      });
      hitCount += 1;
      searchIdx = hitIdx + term.length;
    }
  }

  return mergeCharRanges(ranges);
}

/**
 * @param {Array<{ start: number, end: number }>} ranges
 * @returns {Array<{ start: number, end: number }>}
 */
function mergeCharRanges(ranges = []) {
  const normalized = (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({
      start: Math.max(0, Number(range?.start) || 0),
      end: Math.max(0, Number(range?.end) || 0),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (!normalized.length) return [];

  const merged = [normalized[0]];
  for (const current of normalized.slice(1)) {
    const previous = merged[merged.length - 1];
    if (current.start <= previous.end + 24) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push(current);
  }
  return merged;
}

/**
 * @param {string} text
 * @param {Array<{ start: number, end: number }>} ranges
 * @param {string} [gapMarker]
 * @returns {string}
 */
function buildExcerptFromCharRanges(text, ranges = [], gapMarker = '\n\n[...omitted...]\n\n') {
  const source = String(text || '');
  const normalizedRanges = mergeCharRanges(ranges);
  if (!source || normalizedRanges.length === 0) return '';

  let output = '';
  let lastEnd = 0;
  for (const range of normalizedRanges) {
    if (output && range.start > lastEnd) output += gapMarker;
    output += source.slice(range.start, range.end);
    lastEnd = range.end;
  }
  return output;
}

/**
 * @param {string} content
 * @param {number} limitChars
 * @param {string} [pathValue]
 * @param {object} [options]
 * @returns {{ excerpt: string, truncated: boolean, excerptChars: number }}
 */
function createCompressedContextExcerpt(content, limitChars, pathValue = '', options = {}) {
  const text = normalizeContextExcerptText(content);
  const maxChars = Math.max(400, Number(limitChars) || 0);
  const focusTerms = normalizeExcerptFocusTerms(options.focusTerms || []);
  if (!text) return { excerpt: '', truncated: false, excerptChars: 0 };
  if (text.length <= maxChars) return { excerpt: text, truncated: false, excerptChars: text.length };

  const marker = `\n\n[server-note: excerpt truncated for token budget in ${toSafePath(pathValue) || 'workspace file'}]\n\n`;
  const gapMarker = '\n\n[...omitted...]\n\n';

  const headSize = Math.max(180, Math.floor(maxChars * 0.24));
  const tailSize = Math.max(140, Math.floor(maxChars * 0.18));
  const focusRanges = collectFocusedCharRanges(text, focusTerms, {
    aroundBefore: 220,
    aroundAfter: 520,
    maxHits: 10,
  });

  let ranges = mergeCharRanges([
    { start: 0, end: Math.min(text.length, headSize) },
    ...focusRanges,
    { start: Math.max(0, text.length - tailSize), end: text.length },
  ]);

  let excerptBody = buildExcerptFromCharRanges(text, ranges, gapMarker);
  let availableChars = Math.max(120, maxChars - marker.length);

  while (excerptBody.length > availableChars && ranges.length > 2) {
    ranges.splice(1, 1);
    excerptBody = buildExcerptFromCharRanges(text, ranges, gapMarker);
  }

  if (excerptBody.length > availableChars) {
    const trimmedHead = Math.max(80, Math.floor(availableChars * 0.68));
    const trimmedTail = Math.max(40, availableChars - trimmedHead);
    excerptBody = `${text.slice(0, trimmedHead)}${gapMarker}${text.slice(Math.max(0, text.length - trimmedTail))}`;
  }

  const excerpt = `${excerptBody}${marker}`;
  return { excerpt, truncated: true, excerptChars: excerpt.length };
}

/**
 * @param {string[]} paths
 * @param {object} [options]
 * @returns {Promise<{ entries: object[], skippedOversizePaths: string[] }>}
 */
async function loadCompressedContextEntries(paths = [], options = {}) {
  const maxFiles = Math.min(Math.max(Number(options.maxFiles) || 3, 1), 8);
  const maxModelCompressedChars = Math.min(Math.max(Number(options.maxModelCompressedChars) || 12000, 1000), 90000);
  const firstFileMaxModelCompressedChars = Math.min(
    Math.max(Number(options.firstFileMaxModelCompressedChars) || maxModelCompressedChars, maxModelCompressedChars),
    700000,
  );
  const maxDecodedChars = Math.min(Math.max(Number(options.maxDecodedChars) || 16000, 800), 250000);
  const firstFileMaxDecodedChars = Math.min(
    Math.max(Number(options.firstFileMaxDecodedChars) || maxDecodedChars, maxDecodedChars),
    400000,
  );
  const maxTotalDecodedChars = Math.min(
    Math.max(Number(options.maxTotalDecodedChars) || firstFileMaxDecodedChars + maxDecodedChars * Math.max(1, maxFiles - 1), 1200),
    1000000,
  );
  const disableCodecDictionary = Boolean(options.disableCodecDictionary);

  const selectedPaths = dedupePaths(paths).slice(0, maxFiles);
  const focusTerms = normalizeExcerptFocusTerms(options.focusTerms || []);
  const entries = [];
  const skippedOversizePaths = [];
  let remainingDecodedChars = maxTotalDecodedChars;

  for (const [index, path] of selectedPaths.entries()) {
    if (remainingDecodedChars < 400) break;

    try {
      const opened = await openWorkspaceFileWithFallback(path, 'compressed');
      const encoding = String(opened?.encoding || '').toLowerCase();
      if (encoding !== 'base64-brotli') continue;

      const compressedBase64 = String(opened?.content || '');
      if (!compressedBase64) continue;

      const decoded = await decompressLocalWorkspaceText(compressedBase64);
      const decodedLimit = Math.max(
        400,
        Math.min(index === 0 ? firstFileMaxDecodedChars : maxDecodedChars, remainingDecodedChars),
      );

      let excerptResult = createCompressedContextExcerpt(decoded, decodedLimit, path, { focusTerms });
      let encodedMeta = encodeMeshModelCodec(excerptResult.excerpt, {
        withMeta: true,
        disableDictionary: disableCodecDictionary,
      });
      let modelCompressed = encodedMeta.encoded;
      const perFileLimit = index === 0 ? firstFileMaxModelCompressedChars : maxModelCompressedChars;

      while (modelCompressed.length > perFileLimit && excerptResult.excerpt.length > 700) {
        const nextLimit = Math.max(500, Math.floor(excerptResult.excerpt.length * 0.72));
        if (nextLimit >= excerptResult.excerpt.length) break;
        excerptResult = createCompressedContextExcerpt(decoded, nextLimit, path, { focusTerms });
        encodedMeta = encodeMeshModelCodec(excerptResult.excerpt, {
          withMeta: true,
          disableDictionary: disableCodecDictionary,
        });
        modelCompressed = encodedMeta.encoded;
      }

      if (modelCompressed.length > perFileLimit) {
        skippedOversizePaths.push(path);
        continue;
      }

      remainingDecodedChars = Math.max(0, remainingDecodedChars - excerptResult.excerptChars);

      entries.push({
        path,
        sourceEncoding: 'base64-brotli',
        modelEncoding: MESH_MODEL_CODEC_VERSION,
        modelCompressed,
        usedTokens: Array.isArray(encodedMeta?.usedTokens) ? encodedMeta.usedTokens : [],
        usesCodecDictionary: Boolean(encodedMeta?.dictionaryEnabled),
        contentTruncated: excerptResult.truncated,
        excerptChars: excerptResult.excerptChars,
        originalSize: Number(opened?.originalSize || Buffer.byteLength(decoded, 'utf8')),
        compressedSize: Number(opened?.compressedSize || Buffer.byteLength(compressedBase64, 'utf8')),
      });
    } catch {
      // Ignore individual file load failures so the model can still answer with partial context.
    }
  }

  return { entries, skippedOversizePaths };
}

/**
 * @param {string[]} paths
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
async function loadPlainContextEntries(paths = [], options = {}) {
  const maxFiles = Math.min(Math.max(Number(options.maxFiles) || 1, 1), 3);
  const maxChars = Math.min(Math.max(Number(options.maxChars) || 220000, 2000), 900000);
  const selectedPaths = dedupePaths(paths).slice(0, maxFiles);
  const entries = [];

  for (const path of selectedPaths) {
    try {
      const opened = await openWorkspaceFileWithFallback(path, 'original');
      const content = String(opened?.content || '');
      if (!content) continue;

      const contentTruncated = content.length > maxChars;
      entries.push({
        path,
        content: contentTruncated
          ? `${content.slice(0, maxChars)}\n\n[server-note: file excerpt truncated by safety limit]`
          : content,
        contentTruncated,
        originalSize: Number(opened?.originalSize || Buffer.byteLength(content, 'utf8')),
      });
    } catch {
      // Ignore individual file load failures.
    }
  }

  return entries;
}

/**
 * @param {object[]} entries
 * @returns {string}
 */
function buildPlainContextBlock(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return '';

  const header = [
    '<mesh_workspace_plain_context>',
    'Files below are workspace source-of-truth in plain text.',
    'Use these file contents directly when answering.',
    '</mesh_workspace_plain_context>',
  ].join('\n');

  const blocks = entries.map((entry) => {
    const safePath = escapeTagAttribute(entry.path);
    return [
      `<workspace_file path="${safePath}" encoding="plain-text" excerpt_truncated="${Boolean(entry.contentTruncated)}" original_bytes="${entry.originalSize}">`,
      entry.content,
      '</workspace_file>',
    ].join('\n');
  });

  return `${header}\n\n${blocks.join('\n\n')}`;
}

/**
 * @param {object[]} entries
 * @returns {string}
 */
function buildCompressedContextBlock(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return '';

  const header = [
    `<mesh_workspace_context codec="${MESH_MODEL_CODEC_VERSION}">`,
    'Workspace files below are compressed payloads only.',
    'Decode tokens using the one-time mesh codec context document.',
    '</mesh_workspace_context>',
  ].join('\n');

  const blocks = entries.map((entry) => {
    const safePath = escapeTagAttribute(entry.path);
    return [
      `<compressed_file path="${safePath}" source_encoding="${entry.sourceEncoding}" model_encoding="${entry.modelEncoding}" original_bytes="${entry.originalSize}" source_compressed_bytes="${entry.compressedSize}" excerpt_truncated="${Boolean(entry.contentTruncated)}" excerpt_chars="${Number(entry.excerptChars || 0)}">`,
      entry.modelCompressed,
      '</compressed_file>',
    ].join('\n');
  });

  return `${header}\n\n${blocks.join('\n\n')}`;
}

/** @param {string} rawText @returns {boolean} */
function shouldPrefetchRecoveryForPrompt(rawText) {
  const text = String(rawText || '').toLowerCase();
  return /\b(exact|literally|verbatim|line|lines|which span|where exactly|regex|string|constant|env|process\.env|why|how does|what does)\b/.test(text);
}

/**
 * @param {string[]} paths
 * @param {object} [options]
 * @returns {Promise<{ entries: object[], skippedOversizePaths: string[] }>}
 */
async function loadCapsuleContextEntries(paths = [], options = {}) {
  const maxFiles = Math.min(Math.max(Number(options.maxFiles) || 3, 1), 8);
  const maxModelChars = Math.min(Math.max(Number(options.maxModelChars) || 18000, 1500), 120000);
  const firstFileMaxModelChars = Math.min(
    Math.max(Number(options.firstFileMaxModelChars) || maxModelChars, maxModelChars),
    240000,
  );
  const query = String(options.query || '').trim();
  const disableCodecDictionary = Boolean(options.disableCodecDictionary);
  const fileOpenFn = typeof options.fileOpenFn === 'function' ? options.fileOpenFn : openWorkspaceFileWithFallback;
  const entries = [];
  const skippedOversizePaths = [];

  const dedupedPaths = dedupePaths(paths).slice(0, maxFiles);
  const fetchResults = await Promise.all(
    dedupedPaths.map(async (path, index) => {
      try {
        const opened = await fileOpenFn(path, query ? 'focused' : 'capsule', { query });
        return { path, index, opened, error: false };
      } catch {
        return { path, index, opened: null, error: true };
      }
    }),
  );

  for (const { path, index, opened, error } of fetchResults) {
    if (error || !opened) continue;
    const rendered = String(opened?.content || '').trim();
    if (!rendered) continue;

    const perFileLimit = index === 0 ? firstFileMaxModelChars : maxModelChars;
    let modelContent = rendered;
    let modelEncoding = 'plain-text';
    let usesCodecDictionary = false;
    let truncated = false;

    if (rendered.length > perFileLimit) {
      const encodedMeta = encodeMeshModelCodec(rendered, {
        withMeta: true,
        disableDictionary: disableCodecDictionary,
      });
      if (encodedMeta?.encoded && encodedMeta.encoded.length <= perFileLimit) {
        modelContent = encodedMeta.encoded;
        modelEncoding = MESH_MODEL_CODEC_VERSION;
        usesCodecDictionary = Boolean(encodedMeta.dictionaryEnabled);
      } else {
        const nextLimit = Math.max(600, perFileLimit - 128);
        const retainedPct = Math.round((nextLimit / rendered.length) * 100);
        const totalKb = Math.round(rendered.length / 1024);
        modelContent = `${rendered.slice(0, nextLimit)}\n\n[capsule truncated: showing first ${retainedPct}% of ${totalKb}k chars — use a specific file path to load complete content]`;
        truncated = true;
      }
    }

    if (modelContent.length > perFileLimit * 1.15) {
      skippedOversizePaths.push(path);
      continue;
    }

    entries.push({
      path,
      fileType: String(opened?.fileType || ''),
      parserFamily: String(opened?.parserFamily || ''),
      capsuleMode: String(opened?.capsule?.capsuleMode || opened?.capsuleMode || ''),
      modelEncoding,
      modelContent,
      contentTruncated: truncated,
      usesCodecDictionary,
      rawBytes: Number(opened?.rawBytes || opened?.originalSize || 0),
      capsuleBytes: Number(opened?.capsuleBytes || Buffer.byteLength(rendered, 'utf8')),
      recoveryEligible: Boolean(opened?.capsule?.recoveryEligible),
      isSkeleton: Boolean(opened?.isSkeleton || opened?.capsule?.isSkeleton),
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  return { entries, skippedOversizePaths };
}

/**
 * @param {string[]} paths
 * @param {string} [query]
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
async function loadRecoveredSpanEntries(paths = [], query = '', options = {}) {
  if (!query || !shouldPrefetchRecoveryForPrompt(query)) return [];

  const maxFiles = Math.min(Math.max(Number(options.maxFiles) || 2, 1), 4);
  const maxSpansPerFile = Math.min(Math.max(Number(options.maxSpansPerFile) || 3, 1), 6);
  const dedupedPaths = dedupePaths(paths).slice(0, maxFiles);

  const perFileSpans = await Promise.all(
    dedupedPaths.map(async (path) => {
      try {
        const result = await recoverWorkspaceWithFallback(path, { query });
        const spans = Array.isArray(result?.spans) ? result.spans.slice(0, maxSpansPerFile) : [];
        return spans
          .filter((span) => Boolean(span?.text))
          .map((span) => ({
            path,
            spanId: String(span.spanId || ''),
            lineStart: Number(span.lineStart || 0),
            lineEnd: Number(span.lineEnd || 0),
            text: String(span.text || ''),
          }));
      } catch {
        return [];
      }
    }),
  );

  return perFileSpans.flat();
}

/** @param {object} entry @returns {string} */
function renderCapsuleFileTag(entry) {
  return [
    `<capsule_file path="${escapeTagAttribute(entry.path)}" file_type="${escapeTagAttribute(entry.fileType)}" parser="${escapeTagAttribute(entry.parserFamily)}" capsule_mode="${escapeTagAttribute(entry.capsuleMode)}" model_encoding="${escapeTagAttribute(entry.modelEncoding)}" raw_bytes="${Number(entry.rawBytes || 0)}" capsule_bytes="${Number(entry.capsuleBytes || 0)}" recovery_eligible="${Boolean(entry.recoveryEligible)}" excerpt_truncated="${Boolean(entry.contentTruncated)}" is_skeleton="${Boolean(entry.isSkeleton)}">`,
    String(entry.modelContent || ''),
    '</capsule_file>',
  ].join('\n');
}

/**
 * @param {object[]} entries
 * @param {object[]} [recoveredSpans]
 * @returns {string}
 */
function buildCapsuleContextBlock(entries = [], recoveredSpans = []) {
  if ((!Array.isArray(entries) || entries.length === 0) && (!Array.isArray(recoveredSpans) || recoveredSpans.length === 0)) {
    return '';
  }

  const stableEntries = [];
  const dynamicEntries = [];

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (entry.contentTruncated || entry.capsuleMode === 'focused') {
        dynamicEntries.push(entry);
      } else {
        stableEntries.push(entry);
      }
    }
  }

  const lines = [
    `<mesh_workspace_capsules codec="${MESH_MODEL_CODEC_VERSION}">`,
    'Workspace capsules below are the primary model context.',
    'Treat span ids as evidence handles. Cite them when making exact claims.',
  ];

  for (const entry of stableEntries) lines.push(renderCapsuleFileTag(entry));
  for (const entry of dynamicEntries) lines.push(renderCapsuleFileTag(entry));

  if (Array.isArray(recoveredSpans) && recoveredSpans.length > 0) {
    lines.push('<recovered_spans>');
    for (const span of recoveredSpans) {
      lines.push(
        `<recovered_span path="${escapeTagAttribute(span.path)}" span_id="${escapeTagAttribute(span.spanId)}" line_start="${Number(span.lineStart || 0)}" line_end="${Number(span.lineEnd || 0)}">`,
      );
      lines.push(String(span.text || ''));
      lines.push('</recovered_span>');
    }
    lines.push('</recovered_spans>');
  }

  lines.push('</mesh_workspace_capsules>');
  return lines.join('\n');
}

/**
 * @param {object[]} messages
 * @param {string} [contextBlock]
 * @returns {object[]}
 */
function injectCompressedContextIntoMessages(messages = [], contextBlock = '') {
  if (!contextBlock) return messages;

  const cloned = (Array.isArray(messages) ? messages : []).map((message) => ({
    role: message.role,
    content: String(message.content || ''),
  }));

  for (let idx = cloned.length - 1; idx >= 0; idx -= 1) {
    if (cloned[idx].role === 'user') {
      cloned[idx].content = `${cloned[idx].content}\n\n${contextBlock}`;
      return cloned;
    }
  }

  cloned.push({ role: 'user', content: contextBlock });
  return cloned;
}

/**
 * @param {string} encodedPayload
 * @param {string} decodedText
 * @param {boolean} compressedByModel
 * @returns {object}
 */
function buildModelResponseTransport(encodedPayload, decodedText, compressedByModel) {
  return {
    responseEncoding: `mesh-${MESH_MODEL_CODEC_VERSION}`,
    responseEncodedBytes: Buffer.byteLength(String(encodedPayload || ''), 'utf8'),
    responseDecodedBytes: Buffer.byteLength(String(decodedText || ''), 'utf8'),
    compressedByModel,
  };
}

/**
 * @param {string} rawText
 * @returns {object}
 */
function buildServerCodecRecovery(rawText) {
  const parsed = decodeCompressedModelResponse(rawText, {
    allowLegacy: true,
    allowUnframedRot47: true,
  });
  if (parsed.codecValid) {
    return {
      decoded: parsed.decoded,
      encodedPayload: parsed.encodedPayload,
      compressedByModel: true,
      codecValid: true,
      codecMode: parsed.codecMode || 'server-recovery-decoded',
      wrapped: parsed.wrapped,
      serverCodecRecovery: true,
    };
  }

  const extracted = extractCompressedModelPayload(rawText);
  const fallbackPlain = extracted.wrapped ? extracted.encodedPayload : String(rawText || '');
  const encodedPayload = encodeMeshModelCodec(fallbackPlain);
  const decoded = decodeMeshModelCodec(encodedPayload, { allowLegacy: false, allowUnframedRot47: false });

  return {
    decoded: decoded.ok ? decoded.decoded : fallbackPlain,
    encodedPayload,
    compressedByModel: false,
    codecValid: decoded.ok,
    codecMode: decoded.mode || 'server-recovery-plain',
    wrapped: extracted.wrapped,
    serverCodecRecovery: true,
  };
}

/**
 * @param {string} rawText
 * @returns {string}
 */
function polishDecompressedAssistantText(rawText) {
  let text = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) return '';

  const looksLikeCode = /```|^\s*(const|let|var|function|class|import|export)\b/m.test(text);
  if (!looksLikeCode) {
    const dashSegments = (text.match(/\s-\s/g) || []).length;
    if (dashSegments >= 3 && !/\n-\s/.test(text)) {
      text = text.replace(/\s-\s/g, '\n- ');
    }
    text = text.replace(/([.!?])([A-Za-z])/g, '$1 $2');
    text = text.replace(/(^|[.!?]\s+|\n+)([a-z])/g, (_m, prefix, first) => `${prefix}${first.toUpperCase()}`);
  }

  return text;
}

/**
 * @param {string} rawText
 * @returns {boolean}
 */
function looksLikeCodecProtocolRefusal(rawText) {
  const text = String(rawText || '').toLowerCase();
  if (!text) return false;

  const refusalSignals = [
    'prompt injection',
    'social engineering',
    'not a real codec',
    'fake codec',
    'fake workspace',
    'what i will not do',
    'what i can do',
  ];

  if (refusalSignals.some((signal) => text.includes(signal))) return true;
  if (text.includes('rot47') && (text.includes('will not') || text.includes("won't"))) return true;
  return false;
}

module.exports = {
  normalizeContextExcerptText,
  normalizeExcerptFocusTerms,
  collectFocusedCharRanges,
  mergeCharRanges,
  buildExcerptFromCharRanges,
  createCompressedContextExcerpt,
  loadCompressedContextEntries,
  loadPlainContextEntries,
  buildPlainContextBlock,
  buildCompressedContextBlock,
  shouldPrefetchRecoveryForPrompt,
  loadCapsuleContextEntries,
  loadRecoveredSpanEntries,
  buildCapsuleContextBlock,
  injectCompressedContextIntoMessages,
  buildModelResponseTransport,
  buildServerCodecRecovery,
  polishDecompressedAssistantText,
  looksLikeCodecProtocolRefusal,
};
