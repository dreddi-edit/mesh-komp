const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('node:crypto');

const logger = require('./logger');

// ── Fail fast if critical env vars are missing ────────────────────────────────
const config = require('./config');
const { validation } = require('./config');
validation.warnings.forEach((w) => logger.warn(w, { phase: 'startup' }));
if (!validation.ok) {
  validation.errors.forEach((e) => logger.error(e, { phase: 'startup', fatal: true }));
  process.exit(1);
}

const helmet = require('helmet');
const cors = require('cors');

const core = require('./core/index');


const app = express();

// ── Request ID ────────────────────────────────────────────────────────────────
// Attaches a unique ID to every request so log lines can be correlated.
app.use((req, _res, next) => {
  req.requestId = randomUUID();
  next();
});

// ── Security headers (helmet) ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: config.IS_PRODUCTION ? { maxAge: 31536000, includeSubDomains: true } : false,
  permissionsPolicy: {
    camera: [],
    microphone: ['self'],
    geolocation: [],
    usb: [],
    payment: [],
  },
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: config.CORS_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

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

const { apiLimiter, uploadLimiter } = require('./middleware/rate-limiter');
app.use('/api', apiLimiter);
app.use('/api/workspace/offload', uploadLimiter);
app.use('/api/workspace/ingest', uploadLimiter);

// ── HTTP Response Compression ─────────────────────────────────────────────────
// Compresses all compressible responses (JSON, JS, CSS, HTML) using Brotli or
// gzip. SSE streams are excluded — chunked streaming must not be buffered.
// Must be registered before express.static and all route handlers.
const { compressionMiddleware } = require('./middleware/compression');
app.use(compressionMiddleware);

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

// ── Asset content-hash map (built once at startup) ───────────────────────────
const crypto = require('node:crypto');
const ASSET_HASH_MAP = new Map();

function buildAssetHashMap(assetsDir) {
  const HASHABLE = /\.(js|css)$/;
  let entries;
  try { entries = fs.readdirSync(assetsDir, { withFileTypes: true, recursive: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isFile() || !HASHABLE.test(entry.name)) continue;
    const rel = path.relative(assetsDir, path.join(entry.parentPath || entry.path, entry.name)).replace(/\\/g, '/');
    try {
      const content = fs.readFileSync(path.join(assetsDir, rel));
      const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
      ASSET_HASH_MAP.set(`/assets/${rel}`, hash);
    } catch { /* skip unreadable */ }
  }
}
buildAssetHashMap(path.join(REPO_ROOT, 'assets'));
logger.info('Asset hash map built', { assets: ASSET_HASH_MAP.size });

/**
 * @param {string} html
 * @returns {string}
 */
function injectAssetHashes(html) {
  return html.replace(/(["'])(\/assets\/[^"'?]+)(\?[^"']*)?(["'])/g, (_match, open, assetPath, _existingQuery, close) => {
    const hash = ASSET_HASH_MAP.get(assetPath);
    if (!hash) return _match;
    return `${open}${assetPath}?v=${hash}${close}`;
  });
}

function sendHtmlWithHashes(res, filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const rewritten = injectAssetHashes(html);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(rewritten);
}

app.get('/', (_req, res) => {
  sendHtmlWithHashes(res, path.join(REPO_ROOT, 'views', 'index.html'));
});

app.use((req, res, next) => {
  if (req.path === '/' || req.path.slice(1).includes('.')) return next();
  const filePath = VIEW_ROUTE_MAP.get(req.path);
  if (filePath) return sendHtmlWithHashes(res, filePath);
  next();
});

const IMMUTABLE_CACHE = { setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable') };
const STATIC_CACHE = { setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400') };

app.use('/assets', express.static(path.join(REPO_ROOT, 'assets'), IMMUTABLE_CACHE));
app.use('/pitch', express.static(path.join(REPO_ROOT, 'pitch'), STATIC_CACHE));
app.use('/ccmon-web', express.static(path.join(REPO_ROOT, 'ccmon-web'), STATIC_CACHE));
app.use('/node_modules/animejs', express.static(path.join(REPO_ROOT, 'node_modules', 'animejs'), STATIC_CACHE));


const { createAuthRouter } = require('./routes/auth.routes');
const { createAppRouter } = require('./routes/app.routes');
const { createAssistantRouter } = require('./routes/assistant.routes');
const { setupRealtimeRelay } = require('./routes/realtime.routes');

const http = require('http');
const server = http.createServer(app);

/* Voice: WebSocket relay (AWS Transcribe + Polly) */
setupRealtimeRelay(server, core);

app.use('/', createAuthRouter(core));
app.use('/', createAppRouter(core));
app.use('/', createAssistantRouter(core));

/* ─────────────────────────────────────────
   WebSocket terminal — ws://localhost:8080/terminal
───────────────────────────────────────── */
const { setupTerminalRelay } = require('./routes/terminal.routes');
setupTerminalRelay(server, { projectRoot: REPO_ROOT, core });

// Pre-warm tree-sitter worker pool so the first chat request doesn't pay
// worker spin-up latency. Safe no-op if the export is unavailable.
try {
  const { getTreeSitterWorkerPool } = require('../mesh-core/src/compression-core.cjs');
  if (typeof getTreeSitterWorkerPool === 'function') {
    const pool = getTreeSitterWorkerPool();
    logger.info('Tree-sitter worker pool pre-warmed', { workers: Array.isArray(pool) ? pool.length : 0 });
  }
} catch (err) {
  logger.warn('Tree-sitter worker pool pre-warm skipped', { error: err?.message });
}

const PORT = config.PORT;
server.listen(PORT, () => {
  logger.info('Server started', { port: PORT });
});
