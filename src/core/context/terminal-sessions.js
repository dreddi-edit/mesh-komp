'use strict';

/**
 * Assistant terminal session management — create, read, write, destroy.
 * Uses node-pty (global `pty`) and assistantTerminalSessions (global Map).
 */

const crypto = require('crypto');

/** @param {string} raw @returns {string} */
function sanitizeTerminalChunk(raw) {
  return String(raw || '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[\[(][0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b[^[\]PX^_()]/g, '')
    .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * @param {object} session
 * @param {string} type
 * @param {string} text
 * @param {object} [extra]
 * @returns {object}
 */
function makeAssistantTerminalEntry(session, type, text, extra = {}) {
  session.cursor += 1;
  const entry = {
    index: session.cursor,
    type,
    text: String(text || ''),
    createdAt: toIsoNow(),
    ...extra,
  };
  session.entries.push(entry);
  if (session.entries.length > 1500) {
    session.entries.splice(0, session.entries.length - 1500);
  }
  session.updatedAt = entry.createdAt;
  return entry;
}

/**
 * @param {string} sessionId
 * @returns {object|null}
 */
function getAssistantTerminalSession(sessionId) {
  const id = String(sessionId || '').trim();
  return id ? assistantTerminalSessions.get(id) || null : null;
}

/**
 * @param {object} [options]
 * @returns {{ ok: boolean, session: object }}
 */
function createAssistantTerminalSession(options = {}) {
  if (!pty) {
    throw new Error('node-pty is not available on this server.');
  }

  const shellPref = String(options.shell || '').trim().toLowerCase();
  let shell;
  if (shellPref === 'python3' || shellPref === 'python') shell = 'python3';
  else if (shellPref === 'bash' || shellPref === 'zsh') shell = shellPref;
  else shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');

  const id = `term-${Date.now()}-${crypto.randomUUID()}`;
  const proc = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd: process.env.HOME || __dirname,
    env: process.env,
  });

  const session = {
    id,
    shell,
    status: 'running',
    createdAt: toIsoNow(),
    updatedAt: toIsoNow(),
    entries: [],
    cursor: 0,
    proc,
  };

  proc.onData((raw) => {
    const chunk = sanitizeTerminalChunk(raw);
    if (!chunk) return;
    makeAssistantTerminalEntry(session, 'output', chunk);
  });

  proc.onExit((event) => {
    session.status = 'exited';
    session.exitCode = Number(event?.exitCode ?? 0);
    makeAssistantTerminalEntry(session, 'exit', `Process exited with code ${session.exitCode}.`, {
      exitCode: session.exitCode,
    });
  });

  assistantTerminalSessions.set(id, session);
  return {
    ok: true,
    session: {
      id: session.id,
      shell: session.shell,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  };
}

/**
 * @param {string} sessionId
 * @param {number} [sinceIndex]
 * @returns {object}
 */
function listAssistantTerminalOutput(sessionId, sinceIndex = 0) {
  const session = getAssistantTerminalSession(sessionId);
  if (!session) throw new Error('Terminal session not found.');

  const since = Math.max(0, Number(sinceIndex) || 0);
  return {
    ok: true,
    session: {
      id: session.id,
      shell: session.shell,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      exitCode: Number.isFinite(session.exitCode) ? session.exitCode : null,
    },
    cursor: session.cursor,
    entries: session.entries.filter((entry) => entry.index > since),
  };
}

/**
 * @param {string} sessionId
 * @param {string} input
 * @returns {object}
 */
function writeAssistantTerminalInput(sessionId, input) {
  const session = getAssistantTerminalSession(sessionId);
  if (!session || !session.proc) throw new Error('Terminal session not found.');
  if (session.status !== 'running') throw new Error('Terminal session is not running.');

  const data = typeof input === 'string' ? input : String(input || '');
  if (!data) throw new Error('Terminal input is required.');

  makeAssistantTerminalEntry(session, 'input', data);
  session.proc.write(data);
  return {
    ok: true,
    session: {
      id: session.id,
      status: session.status,
      updatedAt: session.updatedAt,
    },
  };
}

/**
 * @param {string} sessionId
 * @returns {{ ok: boolean, deleted: boolean, sessionId?: string }}
 */
function destroyAssistantTerminalSession(sessionId) {
  const session = getAssistantTerminalSession(sessionId);
  if (!session) return { ok: true, deleted: false };

  try {
    session.proc?.kill();
  } catch {
    // ignore shutdown race
  }
  session.status = 'closed';
  session.updatedAt = toIsoNow();
  assistantTerminalSessions.delete(session.id);
  return { ok: true, deleted: true, sessionId: session.id };
}

module.exports = {
  sanitizeTerminalChunk,
  makeAssistantTerminalEntry,
  getAssistantTerminalSession,
  createAssistantTerminalSession,
  listAssistantTerminalOutput,
  writeAssistantTerminalInput,
  destroyAssistantTerminalSession,
};
