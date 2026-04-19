'use strict';

const express = require('express');

// ── Constants ──────────────────────────────────────────────────────────────────

const OPEN_VSX_SEARCH_URL = 'https://open-vsx.org/api/-/search';
const CACHE_TTL_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const SEARCH_PAGE_SIZE = 30;

// ── In-memory cache ────────────────────────────────────────────────────────────

const searchCache = new Map();

/**
 * Normalize query string to a stable cache key.
 * Empty string is the "trending" bucket — whitespace-only queries collapse to it.
 *
 * @param {string} query
 * @returns {string}
 */
function buildCacheKey(query) {
  return (query || '').toLowerCase().trim();
}

// ── Router factory ─────────────────────────────────────────────────────────────

/**
 * Creates the marketplace router.
 * No auth required — Open VSX is a public API, and the marketplace page itself
 * is session-gated at the Nunjucks template level.
 *
 * @returns {import('express').Router}
 */
function createMarketplaceRouter() {
  const router = express.Router();

  /**
   * GET /api/marketplace/search
   * Proxies extension search to Open VSX API with in-memory caching.
   *
   * @query {string} [q] - Search query. Omit for trending extensions.
   * @returns {object} Open VSX response shape: { extensions: [...] } or { results: [...] }
   */
  router.get('/api/marketplace/search', async (req, res) => {
    const query = (req.query.q || '').trim();
    const cacheKey = buildCacheKey(query);

    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.data);
    }

    const upstreamUrl = query
      ? `${OPEN_VSX_SEARCH_URL}?q=${encodeURIComponent(query)}&size=${SEARCH_PAGE_SIZE}`
      : `${OPEN_VSX_SEARCH_URL}?size=${SEARCH_PAGE_SIZE}`;

    try {
      const upstreamRes = await fetch(upstreamUrl, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: { Accept: 'application/json' }
      });

      if (!upstreamRes.ok) {
        return res.status(502).json({
          ok: false,
          error: 'Open VSX Registry returned an error',
          code: 'UPSTREAM_ERROR'
        });
      }

      const data = await upstreamRes.json();
      searchCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return res.json(data);

    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        return res.status(504).json({
          ok: false,
          error: 'Open VSX Registry unavailable',
          code: 'UPSTREAM_TIMEOUT'
        });
      }
      return res.status(502).json({
        ok: false,
        error: 'Open VSX Registry unavailable',
        code: 'UPSTREAM_ERROR'
      });
    }
  });

  return router;
}

module.exports = { createMarketplaceRouter };
