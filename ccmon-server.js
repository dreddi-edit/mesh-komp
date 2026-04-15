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
const { fetchBedrockUsageFromCloudWatch, mergeCloudWatchIntoHistory } = require('./ccmon/cloudwatch.js');

const PORT = 3030;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const PROJECT_NAME = path.basename(process.cwd());

/** CloudWatch refresh interval — 5 minutes. CW metrics have ~1 min latency and are billed per request. */
const CW_REFRESH_INTERVAL_MS = 5 * 60_000;

const app = express();
app.use(cors());
app.use(express.json());

// ── State ────────────────────────────────────────────────────────
let session = createSession();
/** JSONL-derived history — always up-to-date from file watcher */
let jsonlByDate = new Map();
/** Merged history: JSONL + CloudWatch overlay (authoritative token/cost figures) */
let byDate = new Map();
let cwStatus = { ok: false, lastFetched: null, error: 'Not yet fetched' };
let clients = [];
const fileOffsets = new Map();

function rebuildByDate() {
  byDate = cwStatus.ok && cwStatus.cwByDate
    ? mergeCloudWatchIntoHistory(jsonlByDate, cwStatus.cwByDate)
    : new Map(jsonlByDate);
}

function getFullState() {
  const accumulated = getAccumulatedStats(byDate);
  const burnRate = getBurnRate(byDate);
  return {
    projectName: PROJECT_NAME,
    session,
    accumulated,
    burnRate,
    cloudWatch: {
      ok: cwStatus.ok,
      lastFetched: cwStatus.lastFetched,
      error: cwStatus.error || null,
    },
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

// ── CloudWatch Refresh ───────────────────────────────────────────

async function refreshCloudWatch() {
  console.log(`\x1b[34m[ccmon-server]\x1b[0m Refreshing Bedrock metrics from CloudWatch...`);
  const result = await fetchBedrockUsageFromCloudWatch({ lookbackDays: 30 });

  if (result.ok) {
    cwStatus = { ok: true, lastFetched: new Date().toISOString(), cwByDate: result.cwByDate };
    console.log(`\x1b[32m[ccmon-server]\x1b[0m CloudWatch OK — ${result.cwByDate.size} day(s) of Bedrock data`);
  } else {
    cwStatus = { ok: false, lastFetched: new Date().toISOString(), error: result.error, cwByDate: null };
    console.warn(`\x1b[33m[ccmon-server]\x1b[0m CloudWatch unavailable: ${result.error}`);
  }

  rebuildByDate();
  broadcast({ type: 'cw_update', ...getFullState() });
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
    if (!jsonlByDate.has(dateKey)) {
      jsonlByDate.set(dateKey, { costUSD: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, requests: 0 });
    }
    const day = jsonlByDate.get(dateKey);
    day.costUSD += event.costUSD;
    day.tokensIn += event.tokensIn;
    day.tokensOut += event.tokensOut;
    day.cacheRead += event.cacheRead;
    day.cacheWrite += event.cacheWrite;
    day.requests += 1;
  }

  rebuildByDate();
  broadcast({ type: 'update', ...getFullState() });
}

// ── API Routes ───────────────────────────────────────────────────

app.get('/api/state', (_req, res) => {
  res.json(getFullState());
});

/** Manual CloudWatch refresh trigger */
app.post('/api/cloudwatch/refresh', async (_req, res) => {
  await refreshCloudWatch();
  res.json({ ok: cwStatus.ok, error: cwStatus.error || null, lastFetched: cwStatus.lastFetched });
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
async function startup() {
  console.log(`\x1b[34m[ccmon-server]\x1b[0m Starting for project: ${PROJECT_NAME}`);

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error(`\x1b[31m[error]\x1b[0m ~/.claude/projects not found.`);
    process.exit(1);
  }

  // Load JSONL history
  const allEvents = [];
  const files = findJSONLFiles(PROJECTS_DIR);
  for (const file of files) {
    const { events } = require('./ccmon/parser.js').readSessionEvents(file);
    allEvents.push(...events);
    try { fileOffsets.set(file, fs.statSync(file).size); } catch { /* skip unreadable */ }
  }

  jsonlByDate = require('./ccmon/history.js').buildHistoryFromEvents(allEvents);
  byDate = new Map(jsonlByDate);

  // Seed session with latest model if available
  if (allEvents.length > 0) {
    const latestEvent = allEvents.sort((a, b) => b.timestamp - a.timestamp)[0];
    session.model = latestEvent.model;
    session.contextLimit = require('./ccmon/pricing.js').getContextLimit(latestEvent.model);
    console.log(`\x1b[34m[ccmon-server]\x1b[0m Seeding model from history: ${session.model}`);
  }

  // Watch JSONL files for live events
  watchProjectsDir(PROJECTS_DIR, handleFileChange);

  app.listen(PORT, () => {
    console.log(`\x1b[32m[ccmon-server]\x1b[0m Web Dashboard API ready at http://localhost:${PORT}`);
    console.log(`\x1b[32m[ccmon-server]\x1b[0m SSE stream active at http://localhost:${PORT}/events`);
  });

  // Initial CloudWatch fetch + periodic refresh
  await refreshCloudWatch();
  setInterval(refreshCloudWatch, CW_REFRESH_INTERVAL_MS);
}

startup();
