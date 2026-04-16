'use strict';

/**
 * MESH — Auth / Session / Credential layer
 * Extracted from src/core/index.js for maintainability.
 * Handles: password hashing, session cookies, requireAuth middleware, BYOK credential normalization.
 */

const path   = require('path');
const crypto = require('crypto');
const secureDb = require('../../secure-db');
const logger = require('../logger');
const config = require('../config');

// ── Auth constants ──

const AUTH_STORE_FILE          = path.join(__dirname, '.mesh-auth-store.json');
const AUTH_SESSION_TTL_MS      = 1000 * 60 * 60 * 24 * 14;
const AUTH_SESSION_TOUCH_INTERVAL_MS = config.MESH_AUTH_SESSION_TOUCH_INTERVAL_MS;
const AUTH_COOKIE_NAME      = config.AUTH_COOKIE_NAME;
const AUTH_COOKIE_PATH      = config.AUTH_COOKIE_PATH;
const AUTH_COOKIE_SAME_SITE = config.AUTH_COOKIE_SAME_SITE;
const AUTH_COOKIE_SECURE    = config.AUTH_COOKIE_SECURE;

const DEMO_USER_ENABLED      = config.DEMO_USER_ENABLED;
const DEMO_USER_EMAIL        = config.DEMO_USER_EMAIL;
const DEMO_USER_EMAIL_ALIASES = config.DEMO_USER_EMAIL_ALIASES;
const DEMO_USER_PASSWORD     = config.DEMO_USER_PASSWORD;

const USER_STORE_ALLOWED_KEYS = new Set([
  'meshAiAnthropic',
  'meshAiOpenAI',
  'meshAiGoogle',
  'meshAiByok',
  'meshAiBehaviour',
  'meshByokModelRegistry',
  'meshApiKeys',
  'meshAppearance',
  'meshSwitches',
  'meshAccountProfile',
  'meshWorkspaceConfig',
  'meshSecurityBaseline',
  'meshBillingContact',
  'meshBillingState',
  'meshIntegrations',
  'meshAssistantEditFlow',
]);
const USER_STORE_MAX_JSON_BYTES = 1024 * 1024;

// ── Session resolution cache ──────────────────────────────────────────────────
// Saves 2 DynamoDB calls (readSession + getUserById) per authenticated request.
// Expiry is still re-checked on every cache hit — no security shortcut.
const SESSION_CACHE_TTL_MS = 30_000;
const SESSION_CACHE_MAX    = 100;
/** @type {Map<string, { result: { token: string, user: object, session: object }, ts: number }>} */
const sessionCache = new Map();

function pruneSessionCache() {
  if (sessionCache.size <= SESSION_CACHE_MAX) return;
  const cutoff = Date.now() - SESSION_CACHE_TTL_MS;
  for (const [key, entry] of sessionCache) {
    if (entry.ts < cutoff || sessionCache.size > SESSION_CACHE_MAX) {
      sessionCache.delete(key);
    }
  }
}

/**
 * Evict a single session token from the in-process cache (call on logout).
 * @param {string} token
 */
function invalidateSessionCache(token) {
  sessionCache.delete(String(token || ''));
}

/**
 * Evict all session cache entries for a user (call on revoke-all / revoke-others).
 * @param {string} userId
 */
function invalidateSessionCacheForUser(userId) {
  const uid = String(userId || '');
  if (!uid) return;
  for (const [key, entry] of sessionCache) {
    if (entry.result?.user?.id === uid) sessionCache.delete(key);
  }
}

// ── Credential cache ──────────────────────────────────────────────────────────
// Saves 1 DynamoDB GSI query (getUserStoreValues) per /api/assistant/chat request.
// Invalidated immediately on PUT /api/user/store/:key.
const CREDENTIAL_CACHE_TTL_MS = 60_000;
const CREDENTIAL_CACHE_MAX    = 100;
/** @type {Map<string, { result: object, ts: number }>} */
const credentialCache = new Map();

function pruneCredentialCache() {
  if (credentialCache.size <= CREDENTIAL_CACHE_MAX) return;
  const cutoff = Date.now() - CREDENTIAL_CACHE_TTL_MS;
  for (const [key, entry] of credentialCache) {
    if (entry.ts < cutoff || credentialCache.size > CREDENTIAL_CACHE_MAX) {
      credentialCache.delete(key);
    }
  }
}

/**
 * Evict a user's credential cache entry (call after PUT /api/user/store/:key).
 * @param {string} userId
 */
function invalidateCredentialCache(userId) {
  credentialCache.delete(String(userId || ''));
}

let lastAuthStoreErrorLogAt = 0;

// ── Auth functions ──

/**
 * @param {string} email
 * @returns {string} Lowercased, trimmed email address.
 */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Hash a password using scrypt with a random or provided salt.
 * @param {string} password
 * @param {string} [saltHex] - Hex-encoded salt; generated if omitted.
 * @returns {string} Format: `<salt>:<hash>` (both hex-encoded).
 */
function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored `salt:hash` string using timing-safe comparison.
 * @param {string} password
 * @param {string} storedHash - Format: `<salt>:<hash>`.
 * @returns {boolean}
 */
function verifyPassword(password, storedHash) {
  const raw = String(storedHash || '');
  const separator = raw.indexOf(':');
  if (separator < 0) return false;

  const salt     = raw.slice(0, separator);
  const expected = raw.slice(separator + 1);
  if (!salt || !expected) return false;

  try {
    const actual         = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer   = Buffer.from(actual, 'hex');
    if (expectedBuffer.length === 0 || expectedBuffer.length !== actualBuffer.length) return false;
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Extract and stringify safe user fields for client-facing responses.
 * @param {object} user
 * @returns {{ id: string, email: string, name: string, role: string, createdAt: string }}
 */
function sanitizeAuthUser(user) {
  return {
    id:        String(user?.id || ''),
    email:     String(user?.email || ''),
    name:      String(user?.name || ''),
    role:      String(user?.role || 'user'),
    createdAt: String(user?.createdAt || ''),
  };
}

function reportAuthStoreError(scope, error) {
  const now = Date.now();
  if (now - lastAuthStoreErrorLogAt < 30_000) return;
  lastAuthStoreErrorLogAt = now;
  const message = String(error?.message || error || 'unknown auth store error');
  logger.error(message, { scope: `auth-store.${scope}` });
}

function buildDemoUserSeed() {
  return {
    id:           'user-edgar-demo',
    email:        DEMO_USER_EMAIL,
    name:         'Edgar Baumann',
    role:         'operator',
    passwordHash: hashPassword(DEMO_USER_PASSWORD),
    createdAt:    new Date().toISOString(),
  };
}

async function ensureDemoUserRecord() {
  return await secureDb.upsertUser(buildDemoUserSeed());
}

async function loadAuthStore() {
  try {
    await secureDb.migrateLegacyAuthStore(AUTH_STORE_FILE);
    if (DEMO_USER_ENABLED) {
      await ensureDemoUserRecord();
    }
  } catch (error) {
    reportAuthStoreError('load', error);
  }
}

/**
 * Create a new auth session and return its token.
 * @param {string} userId
 * @param {object} [metadata]
 * @returns {Promise<string>} Session token.
 */
async function issueAuthSession(userId, metadata = {}) {
  const session = await secureDb.createSession(userId, AUTH_SESSION_TTL_MS, metadata);
  return session.token;
}

/**
 * Parse a raw Cookie header string into a key-value map.
 * @param {string} headerValue
 * @returns {Record<string, string>}
 */
function parseCookiesFromHeader(headerValue) {
  const cookies = {};
  const raw = String(headerValue || '').trim();
  if (!raw) return cookies;

  for (const chunk of raw.split(';')) {
    const part = String(chunk || '').trim();
    if (!part) continue;
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key   = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) continue;
    cookies[key] = value;
  }
  return cookies;
}

function decodeCookieValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function readAuthCookieToken(req) {
  const cookies = parseCookiesFromHeader(req.headers?.cookie);
  const token   = decodeCookieValue(cookies[AUTH_COOKIE_NAME]);
  return String(token || '').trim();
}

function normalizeSameSiteValue(rawValue) {
  const normalized = String(rawValue || 'Lax').trim().toLowerCase();
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'none')   return 'None';
  return 'Lax';
}

/**
 * Build a Set-Cookie header string with the given options.
 * @param {string} name
 * @param {string} value
 * @param {{ path?: string, maxAge?: number, sameSite?: string, httpOnly?: boolean, secure?: boolean }} [options]
 * @returns {string}
 */
function createCookieHeader(name, value, options = {}) {
  const parts     = [`${name}=${encodeURIComponent(String(value || ''))}`];
  const pathValue = String(options.path || '/').trim() || '/';
  parts.push(`Path=${pathValue}`);

  const maxAge = Number(options.maxAge);
  if (Number.isFinite(maxAge)) {
    parts.push(`Max-Age=${Math.max(0, Math.trunc(maxAge))}`);
  }

  const sameSite = normalizeSameSiteValue(options.sameSite);
  parts.push(`SameSite=${sameSite}`);

  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (Boolean(options.secure)) parts.push('Secure');

  return parts.join('; ');
}

function setAuthCookie(res, token) {
  const maxAgeSeconds = Math.max(1, Math.trunc(AUTH_SESSION_TTL_MS / 1000));
  const headerValue   = createCookieHeader(AUTH_COOKIE_NAME, token, {
    path:     AUTH_COOKIE_PATH,
    maxAge:   maxAgeSeconds,
    sameSite: AUTH_COOKIE_SAME_SITE,
    httpOnly: true,
    secure:   AUTH_COOKIE_SECURE,
  });
  res.setHeader('Set-Cookie', headerValue);
}

function clearAuthCookie(res) {
  const headerValue = createCookieHeader(AUTH_COOKIE_NAME, '', {
    path:     AUTH_COOKIE_PATH,
    maxAge:   0,
    sameSite: AUTH_COOKIE_SAME_SITE,
    httpOnly: true,
    secure:   AUTH_COOKIE_SECURE,
  });
  res.setHeader('Set-Cookie', headerValue);
}

function readAuthTokenFromRequest(req) {
  const cookieToken = readAuthCookieToken(req);
  if (cookieToken) return cookieToken;
  return '';
}

async function resolveAuthUserFromRequest(req) {
  try {
    const token = readAuthTokenFromRequest(req);
    if (!token) return null;

    // ── Cache hit path ────────────────────────────────────────────────────────
    const cached = sessionCache.get(token);
    if (cached && Date.now() - cached.ts < SESSION_CACHE_TTL_MS) {
      // Re-validate expiry even on cache hit — a cached session may have expired
      // or been deleted (logout from another tab) within the TTL window.
      if (Number(cached.result.session.expiresAt || 0) <= Date.now()) {
        sessionCache.delete(token);
        await secureDb.deleteSession(token);
        return null;
      }
      // Still honour the touchSession interval to keep lastSeenAt accurate.
      const nowMs = Date.now();
      const lastSeenAt = Number(cached.result.session.lastSeenAt || 0);
      if (AUTH_SESSION_TOUCH_INTERVAL_MS > 0 && (nowMs - lastSeenAt >= AUTH_SESSION_TOUCH_INTERVAL_MS)) {
        await secureDb.touchSession(token, nowMs);
        // Update cached session's lastSeenAt so next hit doesn't touch again immediately.
        cached.result.session.lastSeenAt = nowMs;
      }
      return cached.result;
    }

    // ── Cache miss path (original logic) ────────────────────────────────────
    const session = await secureDb.readSession(token);
    if (!session) return null;

    if (Number(session.expiresAt || 0) <= Date.now()) {
      await secureDb.deleteSession(token);
      return null;
    }

    const nowMs      = Date.now();
    const lastSeenAt = Number(session.lastSeenAt || 0);
    const shouldTouch = AUTH_SESSION_TOUCH_INTERVAL_MS > 0 && (nowMs - lastSeenAt >= AUTH_SESSION_TOUCH_INTERVAL_MS);
    if (shouldTouch) {
      await secureDb.touchSession(token, nowMs);
    }

    const user = await secureDb.getUserById(session.userId);
    if (!user) {
      await secureDb.deleteSession(token);
      return null;
    }

    const result = { token, user, session };
    sessionCache.set(token, { result, ts: Date.now() });
    pruneSessionCache();
    return result;
  } catch (error) {
    reportAuthStoreError('resolve-session', error);
    return null;
  }
}

/**
 * Express middleware that validates auth session from cookie.
 * Sets req.authUser, req.authToken, req.authSession on success.
 * Returns 401 on failure.
 *
 * Prefetches credentials in the background after session resolution so that
 * handlers calling getStoredCredentialsForUser() immediately after this
 * middleware hit the warm credential cache instead of waiting on a DynamoDB
 * GSI query. The prefetch is fire-and-forget — it never delays the response.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function requireAuth(req, res, next) {
  const resolved = await resolveAuthUserFromRequest(req);
  if (!resolved) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return;
  }

  req.authUser    = resolved.user;
  req.authToken   = resolved.token;
  req.authSession = resolved.session;

  // Warm the credential cache while the handler begins executing.
  // The credential cache TTL is 60s — a cache miss here means a cold user
  // session; subsequent calls within the same request or next 60s are free.
  const userId = resolved.user?.id;
  if (userId) {
    const cached = credentialCache.get(String(userId));
    if (!cached || Date.now() - cached.ts >= CREDENTIAL_CACHE_TTL_MS) {
      // Fire-and-forget: don't await — handler proceeds immediately.
      getStoredCredentialsForUser(userId).catch(() => {
        // Prefetch failure is silent — handler will fetch on demand.
      });
    }
  }

  next();
}

async function pruneExpiredSessions() {
  await secureDb.pruneExpiredSessions();
}

function normalizeUserStoreKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return '';
  if (!USER_STORE_ALLOWED_KEYS.has(key)) return '';
  return key;
}

function normalizeRequestedStoreKeys(rawKeys) {
  const input = String(rawKeys || '');
  const keys  = input
    .split(',')
    .map((key) => normalizeUserStoreKey(key))
    .filter(Boolean);
  return [...new Set(keys)];
}

function normalizeStoredByokProviders(byokConfig, registry) {
  const byokApiKey = String(byokConfig?.apiKey || '').trim();
  if (!byokApiKey) return [];

  const providerId   = String(byokConfig?.providerId || 'openrouter').trim().toLowerCase() || 'openrouter';
  const providerName = String(byokConfig?.providerName || 'BYOK').trim() || 'BYOK';
  const reportKey    = `byok:${providerId}`;
  const providerReports  = registry?.providerReports && typeof registry.providerReports === 'object' ? registry.providerReports : {};
  const providerReport   = providerReports[reportKey] || {};
  const dynamicModels    = Array.isArray(registry?.dynamicModels) ? registry.dynamicModels : [];
  const dynamicForProvider = dynamicModels
    .filter((entry) => String(entry?.providerId || '').trim().toLowerCase() === providerId)
    .map((entry) => String(entry?.id || '').trim())
    .filter(Boolean);
  const reachableModels = Array.isArray(providerReport?.reachableModels)
    ? providerReport.reachableModels.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const modelSet = new Set([...reachableModels, ...dynamicForProvider]);

  return [
    {
      providerId,
      providerName,
      apiKey:      byokApiKey,
      baseUrl:     String(byokConfig?.baseUrl || '').trim() || (providerId === 'openrouter' ? 'https://openrouter.ai/api/v1' : ''),
      apiVersion:  String(byokConfig?.apiVersion || '').trim(),
      models:      [...modelSet],
    },
  ];
}

/**
 * Load and normalize all AI provider credentials for a user.
 * @param {string} userId
 * @returns {Promise<{ anthropic: { apiKey: string, maxTokens: number }, openai: { apiKey: string, orgId: string }, google: { apiKey: string }, byok: { providers: Array } }>}
 */
async function getStoredCredentialsForUser(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return { anthropic: { apiKey: '', maxTokens: 2048 }, openai: { apiKey: '', orgId: '' }, google: { apiKey: '' }, byok: { providers: [] } };

  // ── Cache hit path ─────────────────────────────────────────────────────────
  const cached = credentialCache.get(uid);
  if (cached && Date.now() - cached.ts < CREDENTIAL_CACHE_TTL_MS) {
    return cached.result;
  }

  // ── Cache miss path (original logic) ──────────────────────────────────────
  const values = await secureDb.getUserStoreValues(uid, [
    'meshAiAnthropic',
    'meshAiOpenAI',
    'meshAiGoogle',
    'meshAiByok',
    'meshByokModelRegistry',
  ]);

  const anthropic = values.meshAiAnthropic && typeof values.meshAiAnthropic === 'object' ? values.meshAiAnthropic : {};
  const openai    = values.meshAiOpenAI    && typeof values.meshAiOpenAI    === 'object' ? values.meshAiOpenAI    : {};
  const google    = values.meshAiGoogle    && typeof values.meshAiGoogle    === 'object' ? values.meshAiGoogle    : {};
  const byok      = values.meshAiByok      && typeof values.meshAiByok      === 'object' ? values.meshAiByok      : {};
  const registry  = values.meshByokModelRegistry && typeof values.meshByokModelRegistry === 'object' ? values.meshByokModelRegistry : {};

  const result = {
    anthropic: {
      apiKey:    String(anthropic.apiKey || '').trim(),
      maxTokens: Number(anthropic.maxTokens || 2048) || 2048,
    },
    openai: {
      apiKey: String(openai.apiKey || '').trim(),
      orgId:  String(openai.orgId  || '').trim(),
    },
    google: {
      apiKey: String(google.apiKey || '').trim(),
    },
    byok: {
      providers: normalizeStoredByokProviders(byok, registry),
    },
  };

  credentialCache.set(uid, { result, ts: Date.now() });
  pruneCredentialCache();
  return result;
}

function mergeChatCredentials(storedCredentials) {
  const stored             = storedCredentials && typeof storedCredentials === 'object' ? storedCredentials : {};
  const storedByokProviders = Array.isArray(stored?.byok?.providers) ? stored.byok.providers : [];

  return {
    anthropic: { ...(stored?.anthropic || {}) },
    openai:    { ...(stored?.openai    || {}) },
    google:    { ...(stored?.google    || {}) },
    byok:      { providers: storedByokProviders },
  };
}

module.exports = {
  AUTH_STORE_FILE,
  AUTH_SESSION_TTL_MS,
  AUTH_SESSION_TOUCH_INTERVAL_MS,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_PATH,
  AUTH_COOKIE_SAME_SITE,
  AUTH_COOKIE_SECURE,
  DEMO_USER_ENABLED,
  DEMO_USER_EMAIL,
  DEMO_USER_EMAIL_ALIASES,
  DEMO_USER_PASSWORD,
  USER_STORE_ALLOWED_KEYS,
  USER_STORE_MAX_JSON_BYTES,
  normalizeEmail,
  hashPassword,
  verifyPassword,
  sanitizeAuthUser,
  reportAuthStoreError,
  buildDemoUserSeed,
  ensureDemoUserRecord,
  loadAuthStore,
  issueAuthSession,
  parseCookiesFromHeader,
  decodeCookieValue,
  readAuthCookieToken,
  normalizeSameSiteValue,
  createCookieHeader,
  setAuthCookie,
  clearAuthCookie,
  readAuthTokenFromRequest,
  resolveAuthUserFromRequest,
  requireAuth,
  pruneExpiredSessions,
  normalizeUserStoreKey,
  normalizeRequestedStoreKeys,
  normalizeStoredByokProviders,
  getStoredCredentialsForUser,
  mergeChatCredentials,
  invalidateSessionCache,
  invalidateSessionCacheForUser,
  invalidateCredentialCache,
};
