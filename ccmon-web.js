'use strict';

const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { loadAllHistory, getAccumulatedStats, getBurnRate } = require('./ccmon/history.js');
const { createSession, applyEvent } = require('./ccmon/state.js');
const { readTailWithErrors, findJSONLFiles } = require('./ccmon/parser.js');
const { watchProjectsDir } = require('./ccmon/watcher.js');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const PROJECT_NAME = path.basename(process.cwd());

const app = express();
const port = process.env.PORT || 4000;

app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'ccmon.html'));
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`ccmon-web listening at http://localhost:${port}`);
  console.log(`Also accessible on your network at http://<your-ip-address>:${port}`);
});

const wss = new WebSocketServer({ server });

let session = createSession();
let byDate = new Map();
let accumulated = { today: { costUSD: 0, requests: 0, tokensIn: 0, tokensOut: 0 }, week: { costUSD: 0, requests: 0 }, month: { costUSD: 0, requests: 0 }, allTime: { costUSD: 0, requests: 0, tokensIn: 0, tokensOut: 0 } };
let burnRate = { dailyAvg: 0, projectedMonthly: 0, spentThisMonth: 0, daysLeftInMonth: 0 };
let statusMsg = '';

const fileOffsets = new Map();

function updateAccumulated() {
  accumulated = getAccumulatedStats(byDate);
  burnRate = getBurnRate(byDate);
}

function broadcastState() {
  const data = JSON.stringify({
    projectName: PROJECT_NAME,
    session,
    accumulated,
    burnRate,
    statusMsg,
    byDate: Array.from(byDate.entries()).slice(-10)
  });
  for (const client of wss.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  }
}

function handleFileChange(filePath) {
  const offset = fileOffsets.get(filePath) ?? 0;
  const { events, newByte, skipped } = readTailWithErrors(filePath, offset);

  if (!events.length && !skipped) return;

  fileOffsets.set(filePath, newByte);

  if (skipped > 0) {
    statusMsg = `${skipped} line(s) skipped`;
    setTimeout(() => { statusMsg = ''; broadcastState(); }, 3000);
  }

  for (const event of events) {
    session = applyEvent(session, event, session.lastEvent);

    const dateKey = event.timestamp.toISOString().slice(0, 10);
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, { costUSD: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, requests: 0, sessions: 0 });
    }
    const day = byDate.get(dateKey);
    day.costUSD += event.costUSD;
    day.tokensIn += event.tokensIn;
    day.tokensOut += event.tokensOut;
    day.cacheRead += event.cacheRead;
    day.cacheWrite += event.cacheWrite;
    day.requests += 1;
  }

  updateAccumulated();
  broadcastState();
}

function startup() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    statusMsg = '~/.claude/projects not found. Run Claude Code at least once.';
    return;
  }

  byDate = loadAllHistory(CLAUDE_DIR);
  updateAccumulated();

  for (const f of findJSONLFiles(PROJECTS_DIR)) {
    try { fileOffsets.set(f, fs.statSync(f).size); } catch { /* skip */ }
  }

  watchProjectsDir(PROJECTS_DIR, handleFileChange);
}

startup();

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    projectName: PROJECT_NAME,
    session,
    accumulated,
    burnRate,
    statusMsg,
    byDate: Array.from(byDate.entries()).slice(-10)
  }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'reset') {
        session = createSession();
        statusMsg = 'Session reset';
        broadcastState();
        setTimeout(() => { statusMsg = ''; broadcastState(); }, 2000);
      } else if (data.type === 'clearFeed') {
        session = { ...session, feed: [] };
        broadcastState();
      }
    } catch (e) {
      console.error(e);
    }
  });
});
