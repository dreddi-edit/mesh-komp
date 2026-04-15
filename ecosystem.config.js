'use strict';
/**
 * PM2 Ecosystem Configuration — Mesh Gateway
 *
 * Usage:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js --env production   # zero-downtime reload
 *   pm2 save                                           # persist process list
 *
 * UV_THREADPOOL_SIZE must be set here (not in .env) because libuv initialises
 * the thread pool before the first `require()` — setting it in application
 * code is too late.
 */

module.exports = {
  apps: [
    {
      name: 'mesh-gateway',
      script: 'src/server.js',

      // ── Concurrency ──────────────────────────────────────────────────────────
      // "max" = one worker per logical CPU. Each worker has its own Node.js
      // process (separate heap, GC, and thread pool). PM2 load-balances across
      // workers using a round-robin TCP proxy.
      // On the t2.micro (1 vCPU) this collapses to a single process — same as
      // fork mode — with no overhead penalty.
      instances: 'max',
      exec_mode: 'cluster',

      // ── Performance ──────────────────────────────────────────────────────────
      // UV_THREADPOOL_SIZE: 4x vCPUs, capped at 128. Prevents pool saturation
      // when concurrent Brotli compressions, S3 PutObject calls, and fs reads
      // compete for libuv worker threads.
      env: {
        UV_THREADPOOL_SIZE: '16',
        NODE_ENV: 'development',
      },
      env_production: {
        UV_THREADPOOL_SIZE: '16',
        NODE_ENV: 'production',
      },

      // ── Reliability ──────────────────────────────────────────────────────────
      // Restart on crash; exponential back-off prevents rapid restart loops.
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      exp_backoff_restart_delay: 100,

      // ── Graceful shutdown ────────────────────────────────────────────────────
      // 10 s for in-flight requests to drain before SIGKILL.
      kill_timeout: 10000,
      wait_ready: false,

      // ── Logging ──────────────────────────────────────────────────────────────
      // Combined log to stdout; PM2 streams it so systemd / CloudWatch can
      // capture it via standard log forwarding.
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
    },
  ],
};
