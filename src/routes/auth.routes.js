'use strict';

const express = require('express');
const { authLimiter, getClientIp } = require('../middleware/rate-limiter');
const { validate } = require('../middleware/validate');
const { loginSchema, sessionRevokeSchema } = require('../schemas');

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
    setAuthCookie, clearAuthCookie,
    readAuthTokenFromRequest,
    requireAuth,
    reportAuthStoreError,
    createAgentToken,
  } = core;

  const router = express.Router();

  router.post("/api/auth/login", authLimiter, validate(loginSchema), async (req, res) => {
    const { authService } = req.app.locals.services;
    try {
      const result = await authService.login(
        req.body.email,
        req.body.password,
        { userAgent: req.headers['user-agent'], ipAddress: readClientIp(req) }
      );
      setAuthCookie(res, result.token);
      res.json({ ok: true, expiresAt: result.expiresAt, expiresInMs: result.expiresInMs, user: result.user });
    } catch (error) {
      if (error.statusCode === 401) {
        res.status(401).json({ ok: false, error: error.message });
        return;
      }
      reportAuthStoreError("login", error);
      res.status(503).json({ ok: false, error: "Authentication service temporarily unavailable." });
    }
  });

  router.get("/api/auth/session", async (req, res) => {
    const { authService } = req.app.locals.services;
    try {
      const result = await authService.getSession(req);
      if (!result) {
        res.status(401).json({ ok: false, error: "Session not found." });
        return;
      }
      res.json({ ok: true, expiresAt: Number(result.session?.expiresAt || 0), user: result.user });
    } catch (error) {
      reportAuthStoreError("session", error);
      res.status(503).json({ ok: false, error: "Authentication service temporarily unavailable." });
    }
  });

  router.get("/api/auth/sessions", requireAuth, async (req, res) => {
    const { authService } = req.app.locals.services;
    try {
      const sessions = await authService.listSessions(req.authUser.id, req.authSession?.id);
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

  router.post("/api/auth/sessions/revoke", requireAuth, validate(sessionRevokeSchema), async (req, res) => {
    const { authService } = req.app.locals.services;
    const mode      = req.body.mode;
    const targetId  = String(req.body?.sessionId || "").trim();
    const currentId = String(req.authSession?.id || "");

    try {
      const result = await authService.revokeSessions(req.authUser.id, mode, targetId, currentId);
      if (result.signedOut) clearAuthCookie(res);
      res.json({ ok: true, deleted: result.deleted, signedOut: result.signedOut });
    } catch (error) {
      if (error.statusCode === 400) { res.status(400).json({ ok: false, error: error.message }); return; }
      if (error.statusCode === 404) { res.status(404).json({ ok: false, error: error.message }); return; }
      reportAuthStoreError("revoke-session", error);
      res.status(503).json({ ok: false, error: "Session revoke failed." });
    }
  });

  router.post("/api/auth/logout", async (req, res) => {
    const { authService } = req.app.locals.services;
    const token = readAuthTokenFromRequest(req);
    try {
      await authService.logout(token);
    } catch (error) {
      reportAuthStoreError("logout", error);
    }
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  /**
   * POST /api/v1/terminal/agent-token
   * Creates or returns an existing long-lived agent token for the authenticated user.
   * Used by the connect dialog to generate the npx mesh-local command.
   */
  router.post("/api/v1/terminal/agent-token", requireAuth, async (req, res) => {
    try {
      const userId = req.authUser?.id || req.authUser?.userId || req.authUser?.email;
      const token = await createAgentToken(userId);
      const serverUrl = `${req.protocol}://${req.get('host')}`;
      return res.json({
        data: {
          token,
          command: `npx mesh-local --token=${token} --server=${serverUrl}`,
          meshUrl: `mesh://launch-agent?token=${token}&server=${encodeURIComponent(serverUrl)}`,
        },
        error: null,
      });
    } catch (err) {
      return res.status(500).json({ error: { code: 'AGENT_TOKEN_ERROR', message: 'Failed to generate agent token' }, data: null });
    }
  });

  /**
   * GET /api/v1/terminal/agent-status
   * Returns whether a local agent is currently connected for the authenticated user.
   * Polled by the browser connect dialog (every 1.5s) to detect when agent connects.
   */
  router.get("/api/v1/terminal/agent-status", requireAuth, async (req, res) => {
    try {
      const userId = req.authUser?.id || req.authUser?.userId || req.authUser?.email;
      const isConnected = req.app.locals.agentConnections?.has(userId) ?? false;
      return res.json({ data: { connected: isConnected }, error: null });
    } catch (err) {
      return res.status(500).json({ error: { code: 'STATUS_ERROR', message: 'Failed to check agent status' }, data: null });
    }
  });

  return router;
}

module.exports = { createAuthRouter };
