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

// ── Utility helpers (duplicated from index.js — keep in sync if changed) ──

function parseBooleanFlag(rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

function parseIntegerInRange(rawValue, fallback, min, max) {
  const numeric = Number(rawValue);
  const selected = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
  return Math.min(max, Math.max(min, selected));
}

// ── Auth constants ──

const AUTH_STORE_FILE          = path.join(__dirname, '.mesh-auth-store.json');
const AUTH_SESSION_TTL_MS      = 1000 * 60 * 60 * 24 * 14;
const AUTH_SESSION_TOUCH_INTERVAL_MS = parseIntegerInRange(
  process.env.MESH_AUTH_SESSION_TOUCH_INTERVAL_MS,
  2 * 60 * 1000,
  0,
  AUTH_SESSION_TTL_MS,
);
const AUTH_COOKIE_NAME      = String(process.env.MESH_AUTH_COOKIE_NAME || 'mesh_auth').trim() || 'mesh_auth';
const AUTH_COOKIE_PATH      = String(process.env.MESH_AUTH_COOKIE_PATH || '/').trim() || '/';
const AUTH_COOKIE_SAME_SITE = String(process.env.MESH_AUTH_COOKIE_SAMESITE || 'Strict').trim() || 'Strict';
const AUTH_COOKIE_SECURE    = parseBooleanFlag(process.env.MESH_AUTH_COOKIE_SECURE, process.env.NODE_ENV === 'production');

const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const DEMO_USER_ENABLED      = parseBooleanFlag(process.env.MESH_DEMO_USER_ENABLED, !IS_PRODUCTION);
const DEMO_USER_EMAIL        = String(process.env.MESH_DEMO_USER_EMAIL || 'edgar@test.com').trim().toLowerCase();
const DEMO_USER_EMAIL_ALIASES = String(process.env.MESH_DEMO_USER_EMAIL_ALIASES || '')
  .split(',')
  .map((entry) => String(entry || '').trim().toLowerCase())
  .filter(Boolean);
const DEMO_USER_PASSWORD = String(process.env.MESH_DEMO_USER_PASSWORD || '12345').trim();

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

let lastAuthStoreErrorLogAt = 0;

// ── Auth functions ──

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

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

async function issueAuthSession(userId, metadata = {}) {
  const session = await secureDb.createSession(userId, AUTH_SESSION_TTL_MS, metadata);
  return session.token;
}

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

    return { token, user, session };
  } catch (error) {
    reportAuthStoreError('resolve-session', error);
    return null;
  }
}

async function requireAuth(req, res, next) {
  const resolved = await resolveAuthUserFromRequest(req);
  if (!resolved) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return;
  }

  req.authUser    = resolved.user;
  req.authToken   = resolved.token;
  req.authSession = resolved.session;
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

async function getStoredCredentialsForUser(userId) {
  const values = await secureDb.getUserStoreValues(userId, [
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

  return {
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
};
