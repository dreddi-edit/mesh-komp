'use strict';

/**
 * MESH — Startup environment validation
 *
 * Called once at server boot before any routes or database connections.
 * In production: missing critical vars are fatal errors.
 * In all environments: missing recommended vars produce warnings.
 *
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function runStartupChecks() {
  const errors = [];
  const warnings = [];

  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';

  if (!nodeEnv) {
    warnings.push('NODE_ENV is not set. Defaulting to development behaviour.');
  }

  // ── Production-critical vars ────────────────────────────────────────────────

  const encryptionKey = String(process.env.MESH_DATA_ENCRYPTION_KEY || process.env.AUTH_SECRET || '').trim();
  if (isProduction && !encryptionKey) {
    errors.push('MESH_DATA_ENCRYPTION_KEY must be set in production. All encrypted user data depends on this value.');
  }

  const cosmosEndpoint = String(process.env.MESH_COSMOS_ENDPOINT || '').trim();
  const cosmosKey = String(process.env.MESH_COSMOS_KEY || '').trim();
  if (isProduction && (!cosmosEndpoint || !cosmosKey)) {
    errors.push('MESH_COSMOS_ENDPOINT and MESH_COSMOS_KEY must both be set in production. Auth and user storage require Cosmos DB.');
  }

  // ── Recommended vars (all environments) ─────────────────────────────────────

  const anthropicKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) {
    warnings.push('ANTHROPIC_API_KEY is not set. Chat and assistant features will be unavailable.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = { runStartupChecks };
