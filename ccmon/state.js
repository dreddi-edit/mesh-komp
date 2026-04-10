'use strict';

const { getContextLimit } = require('./pricing.js');

const SPARKLINE_WINDOW = 16;
const MAX_FEED_SIZE = 50;

/**
 * Create a zeroed session state for the current monitoring session.
 * @returns {object}
 */
function createSession() {
  return {
    startedAt: new Date(),
    requests: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUSD: 0,
    model: 'unknown',
    contextTokens: 0,
    contextLimit: 200_000,
    lastSpeed: 0,
    peakSpeed: 0,
    totalLatencyMs: 0,
    sparkIn: [],
    sparkOut: [],
    sparkCost: [],
    sparkSpeed: [],
    feed: [],
    lastEvent: null,
  };
}

/**
 * Apply a new assistant event to the session state. Returns a new state object.
 * Speed and latency are approximated from timestamp deltas between consecutive events.
 * @param {object} session
 * @param {object} event
 * @param {object | null} prevEvent - the previous event, for delta calculations
 * @returns {object}
 */
function applyEvent(session, event, prevEvent) {
  const latencyMs = prevEvent
    ? Math.max(0, event.timestamp - prevEvent.timestamp)
    : 0;

  const speed = latencyMs > 0
    ? Math.round((event.tokensOut / latencyMs) * 1000)
    : session.lastSpeed;

  const peakSpeed = Math.max(session.peakSpeed, speed);

  const feedEntry = {
    time: event.timestamp,
    tokensIn: event.tokensIn,
    tokensOut: event.tokensOut,
    cacheRead: event.cacheRead,
    costUSD: event.costUSD,
    speed,
    latencyMs,
  };

  return {
    ...session,
    requests: session.requests + 1,
    tokensIn: session.tokensIn + event.tokensIn,
    tokensOut: session.tokensOut + event.tokensOut,
    cacheRead: session.cacheRead + event.cacheRead,
    cacheWrite: session.cacheWrite + event.cacheWrite,
    costUSD: session.costUSD + event.costUSD,
    model: event.model,
    contextTokens: event.tokensIn,
    contextLimit: getContextLimit(event.model),
    lastSpeed: speed,
    peakSpeed,
    totalLatencyMs: session.totalLatencyMs + latencyMs,
    sparkIn:    [...session.sparkIn,    event.tokensIn  ].slice(-SPARKLINE_WINDOW),
    sparkOut:   [...session.sparkOut,   event.tokensOut ].slice(-SPARKLINE_WINDOW),
    sparkCost:  [...session.sparkCost,  event.costUSD   ].slice(-SPARKLINE_WINDOW),
    sparkSpeed: [...session.sparkSpeed, speed           ].slice(-SPARKLINE_WINDOW),
    feed: [...session.feed, feedEntry].slice(-MAX_FEED_SIZE),
    lastEvent: event,
  };
}

module.exports = { createSession, applyEvent, SPARKLINE_WINDOW, MAX_FEED_SIZE };
