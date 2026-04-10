'use strict';

const fs = require('node:fs');
const path = require('node:path');

const POLL_INTERVAL_MS = 500;

/**
 * Watch a Claude Code projects directory for new JSONL content.
 * Uses fs.watch recursive on macOS; falls back to polling on Linux.
 *
 * @param {string} projectsDir  e.g. /Users/foo/.claude/projects
 * @param {(filePath: string) => void} onChange  called with the changed file path
 * @returns {{ stop: () => void }}
 */
function watchProjectsDir(projectsDir, onChange) {
  if (process.platform === 'darwin') {
    try {
      const watcher = fs.watch(projectsDir, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;
        onChange(path.join(projectsDir, filename));
      });
      return { stop: () => watcher.close() };
    } catch {
      // Fall through to polling if fs.watch fails
    }
  }

  // Linux / fallback: poll for modified .jsonl files
  const knownFiles = new Map(); // filePath → mtime
  seedKnownFiles(projectsDir, knownFiles);

  const interval = setInterval(() => {
    collectAndNotify(projectsDir, knownFiles, onChange);
  }, POLL_INTERVAL_MS);

  return { stop: () => clearInterval(interval) };
}

/**
 * Scan directory recursively; call onChange for files modified since last scan.
 * @param {string} dir
 * @param {Map<string, number>} known
 * @param {Function} onChange
 */
function collectAndNotify(dir, known, onChange) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectAndNotify(fullPath, known, onChange);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const { mtimeMs } = fs.statSync(fullPath);
        const prevMtime = known.get(fullPath) ?? 0;
        known.set(fullPath, mtimeMs);
        // Only fire onChange for files we've seen before (not brand-new on first scan)
        if (prevMtime > 0 && mtimeMs > prevMtime) onChange(fullPath);
      } catch {
        // File disappeared between readdir and stat — ignore
      }
    }
  }
}

/**
 * Seed the known-files map without triggering onChange for existing files.
 * @param {string} dir
 * @param {Map<string, number>} known
 */
function seedKnownFiles(dir, known) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      seedKnownFiles(fullPath, known);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const { mtimeMs } = fs.statSync(fullPath);
        known.set(fullPath, mtimeMs);
      } catch {
        // ignore
      }
    }
  }
}

module.exports = { watchProjectsDir };
