'use strict';

/**
 * Auth service — coordinates authentication and session management.
 * Routes call this service rather than core directly.
 */

/**
 * @typedef {object} AuthServiceDeps
 * @property {object} core  Full core exports (auth, secureDb)
 * @property {object} config  Application config
 * @property {object} logger  Logger instance
 */

/**
 * @typedef {object} AuthService
 * @property {Function} login
 * @property {Function} logout
 * @property {Function} getSession
 * @property {Function} listSessions
 * @property {Function} revokeSessions
 * @property {Function} getStoredCredentials
 * @property {Function} saveStoredCredentials
 */

/**
 * Creates an auth service instance with injected dependencies.
 *
 * @param {AuthServiceDeps} deps
 * @returns {AuthService}
 */
function createAuthService({ core, config, logger }) {
  /**
   * Authenticates a user with email and password.
   * Returns the session token and user record on success.
   *
   * @param {string} email
   * @param {string} password
   * @param {object} sessionMeta  { userAgent, ipAddress }
   * @returns {Promise<{ token: string, user: object, expiresAt: number }>}
   * @throws {Error} on invalid credentials or service unavailability
   */
  async function login(email, password, sessionMeta) {
    const {
      normalizeEmail,
      DEMO_USER_ENABLED, DEMO_USER_EMAIL, DEMO_USER_EMAIL_ALIASES, DEMO_USER_PASSWORD,
      verifyPassword, ensureDemoUserRecord,
      AUTH_SESSION_TTL_MS, issueAuthSession,
      pruneExpiredSessions, sanitizeAuthUser,
      secureDb,
    } = core;

    const normalizedEmail = normalizeEmail(email);

    let isDemoLogin = false;
    if (DEMO_USER_ENABLED && DEMO_USER_PASSWORD) {
      const acceptedDemoEmails = new Set([
        normalizeEmail(DEMO_USER_EMAIL),
        ...DEMO_USER_EMAIL_ALIASES.map((e) => normalizeEmail(e)).filter(Boolean),
      ]);
      const { timingSafeEqual } = require('crypto');
      const pwBuf = Buffer.from(password);
      const demoBuf = Buffer.from(DEMO_USER_PASSWORD);
      const passwordMatches = pwBuf.length === demoBuf.length && timingSafeEqual(pwBuf, demoBuf);
      isDemoLogin = acceptedDemoEmails.has(normalizedEmail) && passwordMatches;
    }

    let user = await secureDb.getUserByEmail(normalizedEmail);
    if (isDemoLogin && (!user || !verifyPassword(password, user.passwordHash))) {
      user = (await ensureDemoUserRecord()) || (await secureDb.getUserByEmail(normalizedEmail));
    }
    if (!user || !verifyPassword(password, user.passwordHash)) {
      const err = new Error('Invalid email or password.');
      err.code = 'INVALID_CREDENTIALS';
      err.statusCode = 401;
      throw err;
    }

    await pruneExpiredSessions();
    const token = await issueAuthSession(user.id, sessionMeta);
    return {
      token,
      user: sanitizeAuthUser(user),
      expiresAt: Date.now() + AUTH_SESSION_TTL_MS,
      expiresInMs: AUTH_SESSION_TTL_MS,
    };
  }

  /**
   * Invalidates a session token and removes it from the store.
   *
   * @param {string} token
   * @returns {Promise<void>}
   */
  async function logout(token) {
    const { secureDb, invalidateSessionCache } = core;
    if (token) {
      await secureDb.deleteSession(token);
      invalidateSessionCache(token);
    }
  }

  /**
   * Resolves the current session for a request.
   *
   * @param {object} req  Express request (used by resolveAuthUserFromRequest)
   * @returns {Promise<{ user: object, session: object }|null>}
   */
  async function getSession(req) {
    const { resolveAuthUserFromRequest, pruneExpiredSessions, secureDb, sanitizeAuthUser } = core;
    await pruneExpiredSessions();
    const resolved = await resolveAuthUserFromRequest(req);
    if (!resolved) return null;
    const session = await secureDb.readSession(resolved.token);
    return { user: sanitizeAuthUser(resolved.user), session };
  }

  /**
   * Lists all active sessions for a user.
   *
   * @param {string} userId
   * @param {string} [currentSessionId]
   * @returns {Promise<object[]>}
   */
  async function listSessions(userId, currentSessionId) {
    const { secureDb, pruneExpiredSessions } = core;
    await pruneExpiredSessions();
    return secureDb.listSessionsByUser(userId);
  }

  /**
   * Revokes sessions for a user.
   *
   * @param {string} userId
   * @param {string} mode  'all' | 'others' | 'single'
   * @param {string} [targetSessionId]
   * @param {string} [currentSessionId]
   * @returns {Promise<{ deleted: number, signedOut: boolean }>}
   */
  async function revokeSessions(userId, mode, targetSessionId, currentSessionId) {
    const { secureDb, invalidateSessionCacheForUser, invalidateSessionCache } = core;

    if (mode === 'all') {
      const deleted = await secureDb.deleteSessionsByUser(userId);
      invalidateSessionCacheForUser(userId);
      return { deleted, signedOut: true };
    }
    if (mode === 'others') {
      const deleted = await secureDb.deleteSessionsByUser(userId, { excludeIds: [currentSessionId] });
      invalidateSessionCacheForUser(userId);
      return { deleted, signedOut: false };
    }
    if (!targetSessionId) {
      const err = new Error('Session ID is required.');
      err.code = 'MISSING_SESSION_ID';
      err.statusCode = 400;
      throw err;
    }
    const deleted = await secureDb.deleteSessionById(userId, targetSessionId);
    if (!deleted) {
      const err = new Error('Session not found.');
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    invalidateSessionCacheForUser(userId);
    const signedOut = targetSessionId === currentSessionId;
    return { deleted: 1, signedOut };
  }

  /**
   * Returns stored API credentials for a user.
   *
   * @param {string} userId
   * @returns {Promise<object>}
   */
  async function getStoredCredentials(userId) {
    return core.getStoredCredentialsForUser(userId);
  }

  /**
   * Saves API credentials for a user.
   *
   * @param {string} userId
   * @param {object} credentials
   * @returns {Promise<object>}
   */
  async function saveStoredCredentials(userId, credentials) {
    return core.saveStoredCredentialsForUser(userId, credentials);
  }

  return {
    login,
    logout,
    getSession,
    listSessions,
    revokeSessions,
    getStoredCredentials,
    saveStoredCredentials,
  };
}

module.exports = { createAuthService };
