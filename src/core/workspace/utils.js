'use strict';

/**
 * Pure workspace utility functions — path scoring, query parsing, token extraction.
 * No globals or stateful deps — safe to import standalone.
 */

const { escapeRegexLiteral } = require('../model-providers');

const QUERY_EXTENSION_HINTS = {
  html: ['html', 'htm'],
  htm: ['html', 'htm'],
  css: ['css', 'scss', 'less'],
  scss: ['css', 'scss', 'less'],
  less: ['css', 'scss', 'less'],
  js: ['js', 'mjs', 'cjs'],
  javascript: ['js', 'mjs', 'cjs'],
  ts: ['ts', 'tsx'],
  typescript: ['ts', 'tsx'],
  json: ['json'],
  md: ['md', 'markdown'],
  markdown: ['md', 'markdown'],
  py: ['py'],
  python: ['py'],
  xml: ['xml'],
  yml: ['yml', 'yaml'],
  yaml: ['yml', 'yaml'],
  txt: ['txt'],
  pdf: ['pdf'],
};

const SINGLE_FILE_LOOKUP_RE = /\b(was\s+ist\s+in|what(?:'s|\s+is)?\s+in|inhalt|contents?|summar(?:y|ize)|überblick|ueberblick|overview|erklär|erklaer|explain|describe|zeige\s+mir)\b/i;
const MULTI_FILE_LOOKUP_RE = /\b(vergleich|compare|all|alle|mehrere|multiple|both|beide|zusammen)\b/i;
const BROAD_CHANGE_INTENT_RE = /\b(refactor|rewrite|rework|update|change|modify|implement|build|add|create|fix|bug|issue|across|project|repository|repo|codebase|architektur|architecture)\b/i;

const FILE_QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'bei', 'bitte', 'das', 'datei', 'dem', 'den', 'der', 'die', 'dir',
  'doch', 'ein', 'eine', 'einer', 'es', 'file', 'files', 'for', 'gib', 'give', 'hat', 'help',
  'ich', 'im', 'in', 'inhalt', 'is', 'ist', 'it', 'kannst', 'mir', 'mit', 'oder', 'show',
  'the', 'und', 'uns', 'was', 'what', 'wie', 'wo', 'worum', 'you', 'zu',
]);

function extractQueryExtensionHints(input) {
  const text = String(input || '').toLowerCase();
  const hints = new Set();

  const explicitExtMatches = text.match(/\.[a-z0-9]{2,6}\b/g) || [];
  for (const match of explicitExtMatches) {
    const ext = match.slice(1);
    (QUERY_EXTENSION_HINTS[ext] || [ext]).forEach((value) => hints.add(value));
  }

  for (const [token, mapped] of Object.entries(QUERY_EXTENSION_HINTS)) {
    if (!new RegExp(`\\b${escapeRegexLiteral(token)}\\b`, 'i').test(text)) continue;
    mapped.forEach((value) => hints.add(value));
  }

  return hints;
}

function pathHasExtensionHint(pathInput, extensionHints = new Set()) {
  if (!(extensionHints instanceof Set) || extensionHints.size === 0) return true;
  const normalized = toSafePath(pathInput).toLowerCase();
  const dotIdx = normalized.lastIndexOf('.');
  if (dotIdx < 0 || dotIdx === normalized.length - 1) return false;
  const ext = normalized.slice(dotIdx + 1);
  return extensionHints.has(ext);
}

function selectReferenceMatchLimit(lastUserMessage, extensionHints = new Set()) {
  const text = String(lastUserMessage || '');
  if (!text) return 1;
  if (MULTI_FILE_LOOKUP_RE.test(text)) return 3;
  if (extensionHints.size > 0) return 1;
  if (SINGLE_FILE_LOOKUP_RE.test(text)) return 1;
  return 3;
}

function resolveAdaptiveCompressedContextBudget({ lastUserMessage, hasActiveFileFocus }) {
  const text = String(lastUserMessage || '');
  const extensionHints = extractQueryExtensionHints(text);
  const multiFileIntent = MULTI_FILE_LOOKUP_RE.test(text);
  const broadChangeIntent = BROAD_CHANGE_INTENT_RE.test(text);
  const singleFileIntent = !multiFileIntent && (hasActiveFileFocus || extensionHints.size > 0 || SINGLE_FILE_LOOKUP_RE.test(text));

  if (singleFileIntent && !broadChangeIntent) {
    return { mode: 'single-file', maxFiles: 1, maxModelCompressedChars: 4200, firstFileMaxModelCompressedChars: 6500, maxDecodedChars: 5600, firstFileMaxDecodedChars: 9000, maxTotalDecodedChars: 10000, disableCodecDictionary: true };
  }

  if (hasActiveFileFocus && !multiFileIntent) {
    return { mode: 'active-file', maxFiles: 2, maxModelCompressedChars: 7000, firstFileMaxModelCompressedChars: 12000, maxDecodedChars: 9000, firstFileMaxDecodedChars: 18000, maxTotalDecodedChars: 26000, disableCodecDictionary: true };
  }

  if (multiFileIntent || broadChangeIntent) {
    return { mode: 'broad', maxFiles: 3, maxModelCompressedChars: 18000, firstFileMaxModelCompressedChars: 32000, maxDecodedChars: 24000, firstFileMaxDecodedChars: 42000, maxTotalDecodedChars: 90000, disableCodecDictionary: false };
  }

  return { mode: 'balanced', maxFiles: 2, maxModelCompressedChars: 12000, firstFileMaxModelCompressedChars: 22000, maxDecodedChars: 16000, firstFileMaxDecodedChars: 30000, maxTotalDecodedChars: 52000, disableCodecDictionary: false };
}

function extractSearchTokens(input) {
  const text = String(input || '').toLowerCase();
  const rawTokens = text.split(/[^a-z0-9]+/g).filter(Boolean);
  return rawTokens
    .filter((token) => token.length >= 3)
    .filter((token) => !FILE_QUERY_STOP_WORDS.has(token));
}

function compactAlphaNumeric(input) {
  return String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildWorkspaceQueryContext(rawQuery) {
  const rawText = String(rawQuery || '').toLowerCase();
  return {
    rawText,
    compactText: compactAlphaNumeric(rawText),
    tokens: extractSearchTokens(rawText),
  };
}

function scorePathForQuery(pathInput, queryContext) {
  const pathValue = toSafePath(pathInput).toLowerCase();
  if (!pathValue) return 0;

  const base = basename(pathValue).toLowerCase();
  const pathCompact = compactAlphaNumeric(pathValue);
  const baseCompact = compactAlphaNumeric(base);
  const pathTokens = pathValue.split(/[^a-z0-9]+/g).filter(Boolean);
  const pathTokenSet = new Set(pathTokens);

  const { rawText, compactText, tokens } = queryContext;
  if (!rawText || (!tokens.length && compactText.length < 4)) return 0;

  let score = 0;
  let matchedTokens = 0;

  if (rawText.includes(base)) score += 120;
  if (rawText.includes(pathValue)) score += 140;
  if (compactText && baseCompact && compactText.includes(baseCompact)) score += 90;
  if (compactText && pathCompact && compactText.includes(pathCompact)) score += 110;
  if (compactText && pathCompact && pathCompact.includes(compactText) && compactText.length >= 4) score += 85;

  for (const token of tokens) {
    if (pathTokenSet.has(token)) { score += 28; matchedTokens += 1; continue; }
    if (pathCompact.includes(token)) { score += 14; matchedTokens += 1; }
  }

  if (tokens.length > 0 && matchedTokens === tokens.length) score += 60;
  if (matchedTokens >= 2) score += 30;
  if (matchedTokens === 0 && score < 80) return 0;
  return score;
}

function rankWorkspacePathsForQuery(lastUserMessage, candidatePaths = [], maxMatches = 3) {
  const rawText = String(lastUserMessage || '').toLowerCase();
  if (!rawText) return [];

  const queryContext = { rawText, compactText: compactAlphaNumeric(rawText), tokens: extractSearchTokens(rawText) };

  const ranked = [];
  for (const pathValue of Array.isArray(candidatePaths) ? candidatePaths : []) {
    const safePath = toSafePath(pathValue);
    if (!safePath) continue;
    const score = scorePathForQuery(safePath, queryContext);
    if (score <= 0) continue;
    ranked.push({ path: safePath, score });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, Math.max(1, Number(maxMatches) || 3))
    .map((item) => item.path);
}

function findMatchesInText(content, query, options = {}) {
  const text = String(content || '');
  const needle = String(query || '');
  if (!text || !needle) return [];

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const caseSensitive = options.caseSensitive === true;
  const normalizedNeedle = caseSensitive ? needle : needle.toLowerCase();
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '');
    const haystack = caseSensitive ? line : line.toLowerCase();
    let searchIndex = 0;

    while (searchIndex <= haystack.length) {
      const hit = haystack.indexOf(normalizedNeedle, searchIndex);
      if (hit < 0) break;
      hits.push({ lineNumber: i + 1, column: hit + 1, line, preview: line.trim().slice(0, 240) });
      searchIndex = hit + Math.max(1, normalizedNeedle.length);
    }
  }

  return hits;
}

module.exports = {
  QUERY_EXTENSION_HINTS,
  SINGLE_FILE_LOOKUP_RE,
  MULTI_FILE_LOOKUP_RE,
  BROAD_CHANGE_INTENT_RE,
  FILE_QUERY_STOP_WORDS,
  extractQueryExtensionHints,
  pathHasExtensionHint,
  selectReferenceMatchLimit,
  resolveAdaptiveCompressedContextBudget,
  extractSearchTokens,
  compactAlphaNumeric,
  buildWorkspaceQueryContext,
  scorePathForQuery,
  rankWorkspacePathsForQuery,
  findMatchesInText,
};
