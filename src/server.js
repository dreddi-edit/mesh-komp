const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('node:crypto');

const logger = require('./logger');

// ── Fail fast if critical env vars are missing ────────────────────────────────
const { runStartupChecks } = require('./core/startup-checks');
const startupResult = runStartupChecks();
startupResult.warnings.forEach((w) => logger.warn(w, { phase: 'startup' }));
if (!startupResult.ok) {
  startupResult.errors.forEach((e) => logger.error(e, { phase: 'startup', fatal: true }));
  process.exit(1);
}

const core = require('./core/index');


const app = express();

// ── Request ID ────────────────────────────────────────────────────────────────
// Attaches a unique ID to every request so log lines can be correlated.
app.use((req, _res, next) => {
  req.requestId = randomUUID();
  next();
});

// ── Security headers ──────────────────────────────────────────────────────────

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' ws: wss:",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  next();
});

// ── CSRF protection (Origin / Referer check for mutating requests) ────────────

/**
 * Rejects cross-origin state-changing requests.
 * Works as defense-in-depth alongside SameSite: Strict cookies.
 * Requests without Origin/Referer (e.g. curl, server-to-server) are allowed
 * because those clients cannot carry user session cookies via the browser.
 */
function csrfGuard(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

  const origin  = String(req.headers.origin  || '').trim();
  const referer = String(req.headers.referer || '').trim();
  const source  = origin || referer;
  if (!source) return next();

  try {
    const parsed = new URL(source);
    const host   = String(req.headers.host || '').trim();
    if (parsed.host !== host) {
      res.status(403).json({ ok: false, error: 'CSRF validation failed.' });
      return;
    }
  } catch {
    res.status(403).json({ ok: false, error: 'CSRF validation failed.' });
    return;
  }
  next();
}

// Tight default — only the offload/ingest route overrides this per-route.
app.use(express.json({ limit: '1mb' }));
app.use(csrfGuard);

// ── Pre-computed clean-URL route map ─────────────────────────────────────────
// Built once at startup — eliminates fs.existsSync() on every request.
const REPO_ROOT = path.join(__dirname, '..');

/**
 * Scans views/ and the repo root for .html files and maps clean URL paths to
 * their absolute file paths. views/ takes priority over root-level files.
 *
 * @param {string} repoRoot
 * @returns {Map<string, string>}
 */
function buildViewRouteMap(repoRoot) {
  const map = new Map();
  const viewsDir = path.join(repoRoot, 'views');

  if (fs.existsSync(viewsDir)) {
    for (const file of fs.readdirSync(viewsDir)) {
      if (file.endsWith('.html')) {
        map.set('/' + file.slice(0, -5), path.join(viewsDir, file));
      }
    }
  }

  for (const file of fs.readdirSync(repoRoot)) {
    if (file.endsWith('.html')) {
      const route = '/' + file.slice(0, -5);
      if (!map.has(route)) {
        map.set(route, path.join(repoRoot, file));
      }
    }
  }

  return map;
}

const VIEW_ROUTE_MAP = buildViewRouteMap(REPO_ROOT);

// Serve root (/) from views/index.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(REPO_ROOT, 'views', 'index.html'));
});

// Clean URL support — O(1) map lookup built once at startup.
app.use((req, res, next) => {
  if (req.path === '/' || req.path.slice(1).includes('.')) return next();
  const filePath = VIEW_ROUTE_MAP.get(req.path);
  if (filePath) return res.sendFile(filePath);
  next();
});

// Point static files to the root directory, not the /src directory!
// Keep the fast-changing workbench assets effectively uncached so UI/graph fixes
// are visible immediately after deploy.
app.use(express.static(path.join(__dirname, '..'), {
  setHeaders(res, filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    if (/(\/assets\/app-workspace\.js|\/assets\/app-graph\.js|\/assets\/app-workspace\.css|\/assets\/features\/voice-chat\.js)$/.test(normalized)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));


const { createAuthRouter } = require('./routes/auth.routes');
const { createAppRouter } = require('./routes/app.routes');
const { createAssistantRouter } = require('./routes/assistant.routes');
const { setupRealtimeRelay } = require('./routes/realtime.routes');

const http = require('http');
const server = http.createServer(app);

/* Voice: WebSocket relay to Azure OpenAI Realtime API */
setupRealtimeRelay(server, core);

app.use('/', createAuthRouter(core));
app.use('/', createAppRouter(core));
app.use('/', createAssistantRouter(core));

/* ─────────────────────────────────────────
   WebSocket terminal — ws://localhost:8080/terminal
───────────────────────────────────────── */
const { setupTerminalRelay } = require('./routes/terminal.routes');
setupTerminalRelay(server, { projectRoot: REPO_ROOT, core });

const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, () => {
  logger.info('Server started', { port: PORT });
});
