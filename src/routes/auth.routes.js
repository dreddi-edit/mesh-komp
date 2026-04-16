'use strict';

const express = require('express');
const { authLimiter, getClientIp } = require('../middleware/rate-limiter');

function readClientIp(req) {
  return getClientIp(req);
}

function inferSessionLabel(session = {}) {
  const ua = String(session.userAgent || '').toLowerCase();
  if (!ua) return 'Unknown device';
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'Mac';
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('linux')) return 'Linux';
  if (ua.includes('android')) return 'Android';
  return 'Device';
}

function formatRelativeActivity(timestampMs) {
  const deltaMs = Math.max(0, Date.now() - Number(timestampMs || 0));
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes <= 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function summarizeSession(session, currentSessionId) {
  const userAgent = String(session?.userAgent || '').trim();
  const browser = /safari/i.test(userAgent) && !/chrome|chromium|crios|edg/i.test(userAgent)
    ? 'Safari'
    : /chrome|crios/i.test(userAgent)
    ? 'Chrome'
    : /firefox|fxios/i.test(userAgent)
    ? 'Firefox'
    : /edg/i.test(userAgent)
    ? 'Edge'
    : 'Browser';

  const platform = /iphone/i.test(userAgent)
    ? 'iPhone'
    : /ipad/i.test(userAgent)
    ? 'iPad'
    : /mac os|macintosh/i.test(userAgent)
    ? 'Mac'
    : /windows/i.test(userAgent)
    ? 'Windows'
    : /android/i.test(userAgent)
    ? 'Android'
    : /linux/i.test(userAgent)
    ? 'Linux'
    : inferSessionLabel(session);

  return {
    id: String(session?.id || ''),
    label: String(session?.label || `${platform} — ${browser}`).trim(),
    platform,
    browser,
    userAgent,
    ipAddress: String(session?.ipAddress || '').trim(),
    current: String(session?.id || '') === String(currentSessionId || ''),
    createdAt: Number(session?.createdAt || 0),
    lastSeenAt: Number(session?.lastSeenAt || 0),
    expiresAt: Number(session?.expiresAt || 0),
    lastActiveLabel: formatRelativeActivity(session?.lastSeenAt),
  };
}

/**
 * @param {object} core  Subset of exports from src/core/index.js
 * @returns {import('express').Router}
 */
function createAuthRouter(core) {
  const {
    normalizeEmail,
    DEMO_USER_ENABLED, DEMO_USER_EMAIL, DEMO_USER_EMAIL_ALIASES, DEMO_USER_PASSWORD,
    verifyPassword, ensureDemoUserRecord,
    AUTH_SESSION_TTL_MS, issueAuthSession,
    setAuthCookie, clearAuthCookie,
    readAuthCookieToken, readAuthTokenFromRequest,
    resolveAuthUserFromRequest, requireAuth,
    pruneExpiredSessions, sanitizeAuthUser, reportAuthStoreError,
    invalidateSessionCache, invalidateSessionCacheForUser,
    secureDb,
  } = core;

  const router = express.Router();

  router.post("/api/auth/login", authLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      res.status(400).json({ ok: false, error: "Email and password are required." });
      return;
    }

    try {
      let isDemoLogin = false;
      if (DEMO_USER_ENABLED && DEMO_USER_PASSWORD) {
        const acceptedDemoEmails = new Set([
          normalizeEmail(DEMO_USER_EMAIL),
          ...DEMO_USER_EMAIL_ALIASES.map((entry) => normalizeEmail(entry)).filter(Boolean),
        ]);
        // Use timing-safe comparison to prevent timing-oracle enumeration of the demo password.
        const { timingSafeEqual } = require('crypto');
        const pwBuf = Buffer.from(password);
        const demoBuf = Buffer.from(DEMO_USER_PASSWORD);
        const passwordMatches = pwBuf.length === demoBuf.length && timingSafeEqual(pwBuf, demoBuf);
        isDemoLogin = acceptedDemoEmails.has(email) && passwordMatches;
      }
      let user = await secureDb.getUserByEmail(email);

      if (isDemoLogin && (!user || !verifyPassword(password, user.passwordHash))) {
        user = (await ensureDemoUserRecord()) || (await secureDb.getUserByEmail(email));
      }

      if (!user || !verifyPassword(password, user.passwordHash)) {
        res.status(401).json({ ok: false, error: "Invalid email or password." });
        return;
      }

      await pruneExpiredSessions();
      const token = await issueAuthSession(user.id, {
        userAgent: req.headers['user-agent'],
        ipAddress: readClientIp(req),
      });
      setAuthCookie(res, token);
      const expiresInMs = AUTH_SESSION_TTL_MS;
      res.json({
        ok: true,
        expiresAt: Date.now() + expiresInMs,
        expiresInMs,
        user: sanitizeAuthUser(user),
      });
    } catch (error) {
      reportAuthStoreError("login", error);
      res.status(503).json({ ok: false, error: "Authentication service temporarily unavailable." });
    }
  });

  router.get("/api/auth/session", async (req, res) => {
    try {
      const directCookieToken = readAuthCookieToken(req);
      const resolvedCookie = directCookieToken ? await secureDb.readSession(directCookieToken) : null;

      await pruneExpiredSessions();
      const resolved = await resolveAuthUserFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: "Session not found." });
        return;
      }

      const session = await secureDb.readSession(resolved.token);
      const expiresAt = Number(session?.expiresAt || 0);

      res.json({
        ok: true,
        expiresAt,
        user: sanitizeAuthUser(resolved.user),
      });
    } catch (error) {
      reportAuthStoreError("session", error);
      res.status(503).json({ ok: false, error: "Authentication service temporarily unavailable." });
    }
  });

  router.get("/api/auth/sessions", requireAuth, async (req, res) => {
    try {
      await pruneExpiredSessions();
      const sessions = await secureDb.listSessionsByUser(req.authUser.id);
      const summaries = sessions
        .map((session) => summarizeSession(session, req.authSession?.id))
        .sort((a, b) => {
          if (a.current && !b.current) return -1;
          if (b.current && !a.current) return 1;
          return Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0);
        });

      res.json({ ok: true, sessions: summaries });
    } catch (error) {
      reportAuthStoreError("sessions", error);
      res.status(503).json({ ok: false, error: "Session list unavailable." });
    }
  });

  router.post("/api/auth/sessions/revoke", requireAuth, async (req, res) => {
    const mode     = String(req.body?.mode      || "single").trim().toLowerCase();
    const targetId = String(req.body?.sessionId || "").trim();
    const currentId = String(req.authSession?.id || "");

    try {
      if (mode === "all") {
        const deleted = await secureDb.deleteSessionsByUser(req.authUser.id);
        invalidateSessionCacheForUser(req.authUser.id);
        clearAuthCookie(res);
        res.json({ ok: true, deleted, signedOut: true });
        return;
      }

      if (mode === "others") {
        const deleted = await secureDb.deleteSessionsByUser(req.authUser.id, { excludeIds: [currentId] });
        invalidateSessionCacheForUser(req.authUser.id);
        res.json({ ok: true, deleted, signedOut: false });
        return;
      }

      if (!targetId) {
        res.status(400).json({ ok: false, error: "Session ID is required." });
        return;
      }

      const deleted = await secureDb.deleteSessionById(req.authUser.id, targetId);
      if (!deleted) {
        res.status(404).json({ ok: false, error: "Session not found." });
        return;
      }

      // Use user-level invalidation: we have sessionId but not the token.
      // Clearing all user entries is safe and conservative.
      invalidateSessionCacheForUser(req.authUser.id);
      const signedOut = targetId === currentId;
      if (signedOut) clearAuthCookie(res);
      res.json({ ok: true, deleted: 1, signedOut });
    } catch (error) {
      reportAuthStoreError("revoke-session", error);
      res.status(503).json({ ok: false, error: "Session revoke failed." });
    }
  });

  router.post("/api/auth/logout", async (req, res) => {
    const token = readAuthTokenFromRequest(req);
    if (token) {
      try {
        await secureDb.deleteSession(token);
        invalidateSessionCache(token);
      } catch (error) {
        reportAuthStoreError("logout", error);
      }
    }
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createAuthRouter };
