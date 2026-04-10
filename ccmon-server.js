'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const cors = require('cors');
const { loadAllHistory, getAccumulatedStats, getBurnRate } = require('./ccmon/history.js');
const { createSession, applyEvent } = require('./ccmon/state.js');
const { readTailWithErrors, findJSONLFiles } = require('./ccmon/parser.js');
const { watchProjectsDir } = require('./ccmon/watcher.js');

const PORT = 3030;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const PROJECT_NAME = path.basename(process.cwd());

const app = express();
app.use(cors());
app.use(express.json());

// ── State ────────────────────────────────────────────────────────
let session = createSession();
let byDate = new Map();
let clients = [];
const fileOffsets = new Map();

function getFullState() {
  const accumulated = getAccumulatedStats(byDate);
  const burnRate = getBurnRate(byDate);
  return {
    projectName: PROJECT_NAME,
    session,
    accumulated,
    burnRate,
    history: Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 10)
      .map(([date, data]) => ({ date, ...data })),
    timestamp: Date.now()
  };
}

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(payload));
}

// ── File Events ──────────────────────────────────────────────────
function handleFileChange(filePath) {
  const offset = fileOffsets.get(filePath) ?? 0;
  const { events, newByte, skipped } = readTailWithErrors(filePath, offset);

  if (!events.length && !skipped) return;

  fileOffsets.set(filePath, newByte);

  for (const event of events) {
    session = applyEvent(session, event, session.lastEvent);

    const dateKey = event.timestamp.toISOString().slice(0, 10);
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, { costUSD: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, requests: 0 });
    }
    const day = byDate.get(dateKey);
    day.costUSD += event.costUSD;
    day.tokensIn += event.tokensIn;
    day.tokensOut += event.tokensOut;
    day.cacheRead += event.cacheRead;
    day.cacheWrite += event.cacheWrite;
    day.requests += 1;
  }

  broadcast({ type: 'update', ...getFullState() });
}

// ── API Routes ───────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  res.json(getFullState());
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'init', ...getFullState() })}\n\n`);
  clients.push(res);

  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

// ── Startup ──────────────────────────────────────────────────────
function startup() {
  console.log(`\x1b[34m[ccmon-server]\x1b[0m Starting for project: ${PROJECT_NAME}`);

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error(`\x1b[31m[error]\x1b[0m ~/.claude/projects not found.`);
    process.exit(1);
  }

  // Load history
  const allEvents = [];
  const files = findJSONLFiles(PROJECTS_DIR);
  for (const file of files) {
    const { events } = require('./ccmon/parser.js').readSessionEvents(file);
    allEvents.push(...events);
    try { fileOffsets.set(file, fs.statSync(file).size); } catch (e) {}
  }
  
  byDate = require('./ccmon/history.js').buildHistoryFromEvents(allEvents);

  // Seed session with latest model if available
  if (allEvents.length > 0) {
    const latestEvent = allEvents.sort((a, b) => b.timestamp - a.timestamp)[0];
    session.model = latestEvent.model;
    session.contextLimit = require('./ccmon/pricing.js').getContextLimit(latestEvent.model);
    console.log(`\x1b[34m[ccmon-server]\x1b[0m Seeding model from history: ${session.model}`);
  }

  // Watch
  watchProjectsDir(PROJECTS_DIR, handleFileChange);

  app.listen(PORT, () => {
    console.log(`\x1b[32m[ccmon-server]\x1b[0m Web Dashboard API ready at http://localhost:${PORT}`);
    console.log(`\x1b[32m[ccmon-server]\x1b[0m SSE stream active at http://localhost:${PORT}/events`);
  });
}

startup();
