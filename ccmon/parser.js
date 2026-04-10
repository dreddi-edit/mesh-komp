'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { calculateCost } = require('./pricing.js');

/**
 * Parse a single JSONL line from a Claude Code session file.
 * Returns a normalized event object, or null if the line is not a
 * real assistant response with token usage.
 *
 * @param {string} line
 * @returns {{ timestamp: Date, model: string, tokensIn: number, tokensOut: number,
 *             cacheRead: number, cacheWrite: number, costUSD: number } | null}
 */
function parseAssistantEvent(line) {
  if (!line || !line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed.type !== 'assistant') return null;
  const usage = parsed.message?.usage;
  if (!usage || !usage.input_tokens) return null;

  return {
    timestamp: new Date(parsed.timestamp),
    model: parsed.model ?? 'unknown',
    tokensIn: usage.input_tokens ?? 0,
    tokensOut: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    costUSD: calculateCost(usage, parsed.model ?? 'unknown'),
  };
}

/**
 * Read all assistant events from a session file.
 * @param {string} filePath
 * @returns {{ events: Array, lastByte: number }}
 */
function readSessionEvents(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { events: [], lastByte: 0 };
  }
  const events = content
    .split('\n')
    .map(parseAssistantEvent)
    .filter(Boolean);
  return { events, lastByte: Buffer.byteLength(content, 'utf8') };
}

/**
 * Read only new events appended to a file since the last known byte offset.
 * Used for live tailing without re-parsing the whole file.
 * @param {string} filePath
 * @param {number} fromByte
 * @returns {{ events: Array, newByte: number }}
 */
function readTail(filePath, fromByte) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { events: [], newByte: fromByte };
  }
  if (stat.size <= fromByte) return { events: [], newByte: fromByte };

  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(stat.size - fromByte);
  fs.readSync(fd, buf, 0, buf.length, fromByte);
  fs.closeSync(fd);

  const tail = buf.toString('utf8');
  const events = tail
    .split('\n')
    .map(parseAssistantEvent)
    .filter(Boolean);
  return { events, newByte: stat.size };
}

/**
 * Like readTail, but also returns a count of lines that failed to parse
 * as expected assistant events (useful for surfacing errors in the UI).
 * @param {string} filePath
 * @param {number} fromByte
 * @returns {{ events: Array, newByte: number, skipped: number }}
 */
function readTailWithErrors(filePath, fromByte) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { events: [], newByte: fromByte, skipped: 0 };
  }
  if (stat.size <= fromByte) return { events: [], newByte: fromByte, skipped: 0 };

  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(stat.size - fromByte);
  fs.readSync(fd, buf, 0, buf.length, fromByte);
  fs.closeSync(fd);

  // Known non-usage types that are not errors
  const SILENT_TYPES = new Set(['user', 'queue-operation', 'file-history-snapshot', 'ai-title', 'system']);

  const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
  let skipped = 0;
  const events = [];
  for (const line of lines) {
    const ev = parseAssistantEvent(line);
    if (ev) {
      events.push(ev);
    } else {
      try {
        const p = JSON.parse(line);
        if (p.type === 'assistant' && p.model !== '<synthetic>' && !(p.message?.usage?.input_tokens === 0)) {
          skipped++;
        }
      } catch {
        skipped++;
      }
    }
  }
  return { events, newByte: stat.size, skipped };
}

/**
 * Recursively find all .jsonl files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function findJSONLFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJSONLFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(fullPath);
    }
  }
  return results;
}

module.exports = { parseAssistantEvent, readSessionEvents, readTail, readTailWithErrors, findJSONLFiles };
