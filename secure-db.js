'use strict';

const crypto = require('crypto');
const os = require('os');

let DynamoDBClient, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand, UpdateCommand;
try {
  ({ DynamoDBClient } = require('@aws-sdk/client-dynamodb'));
  ({ DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb'));
} catch {
  DynamoDBClient = null;
}

const CIPHER_ALGORITHM = 'aes-256-gcm';
const KEY_ENV_NAME = 'MESH_DATA_ENCRYPTION_KEY';
const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
let warnedFallbackSecret = false;

/**
 * Derives a machine-stable dev fallback secret from non-sensitive system properties.
 * This is NOT cryptographically secret — it only prevents a known constant from being
 * baked into source code. Production deployments must set MESH_DATA_ENCRYPTION_KEY.
 */
function deriveMachineSecret() {
  return crypto
    .createHash('sha256')
    .update(`mesh-dev:${os.hostname()}:${os.homedir()}`)
    .digest('hex');
}

function resolvedSecret() {
  const envSecret = String(process.env[KEY_ENV_NAME] || process.env.AUTH_SECRET || '').trim();
  if (envSecret) return envSecret;
  if (IS_PRODUCTION) {
    throw new Error(`[mesh-secure-db] ${KEY_ENV_NAME} must be set in production.`);
  }
  if (!warnedFallbackSecret) {
    warnedFallbackSecret = true;
    console.warn(
      `[mesh-secure-db] ${KEY_ENV_NAME} is not set. Using machine-derived dev secret — set the env var before going to production.`,
    );
  }
  return deriveMachineSecret();
}

function encryptionKey() {
  return crypto.createHash('sha256').update(resolvedSecret()).digest();
}

function encryptJson(value) {
  const payload = JSON.stringify(value === undefined ? null : value);
  const iv = crypto.randomBytes(12);
  const key = encryptionKey();
  const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, encrypted]).toString('base64');
}

function decryptJson(encoded) {
  const packed = Buffer.from(String(encoded || ''), 'base64');
  if (!packed.length) return null;
  if (packed[0] !== 1) throw new Error('Unsupported encrypted payload version.');
  if (packed.length < 1 + 12 + 16) throw new Error('Encrypted payload is invalid.');

  const iv = packed.subarray(1, 13);
  const tag = packed.subarray(13, 29);
  const encrypted = packed.subarray(29);
  const key = encryptionKey();
  const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted);
}

function toIsoNow() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashSessionToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function trim(val) {
  return String(val || '').trim();
}

// ── DynamoDB configuration ────────────────────────────────────────────────────

const DYNAMO_REGION = trim(process.env.AWS_REGION_BEDROCK || process.env.AWS_REGION || 'us-east-1');
const DYNAMO_TABLE_PREFIX = trim(process.env.MESH_DYNAMO_TABLE_PREFIX || 'mesh');
const DYNAMO_USERS_TABLE = trim(process.env.MESH_DYNAMO_USERS_TABLE || `${DYNAMO_TABLE_PREFIX}-users`);
const DYNAMO_SESSIONS_TABLE = trim(process.env.MESH_DYNAMO_SESSIONS_TABLE || `${DYNAMO_TABLE_PREFIX}-sessions`);
const DYNAMO_STORES_TABLE = trim(process.env.MESH_DYNAMO_STORES_TABLE || `${DYNAMO_TABLE_PREFIX}-stores`);

const dynamoEnabled = Boolean(
  DynamoDBClient &&
  (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_WEB_IDENTITY_TOKEN_FILE) &&
  process.env.MESH_DYNAMO_ENABLED !== 'false',
);

// In-memory fallback when DynamoDB is not configured (dev/test only).
// Data lives only for the lifetime of the process — acceptable for local dev.
const memUsers = new Map();
const memSessions = new Map();
const memStores = new Map();

let _docClient = null;

/**
 * Returns a DynamoDB DocumentClient, creating it once on first call.
 *
 * @returns {import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient}
 */
function getDocClient() {
  if (_docClient) return _docClient;
  const opts = { region: DYNAMO_REGION };
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    opts.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }
  _docClient = DynamoDBDocumentClient.from(new DynamoDBClient(opts), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return _docClient;
}

// ── Users ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} user
 * @returns {Promise<object|null>}
 */
async function upsertUser(user) {
  const now = toIsoNow();
  const email = normalizeEmail(user?.email);
  const id = String(user?.id || crypto.randomUUID());
  if (!email) return null;

  const existing = await getUserByEmail(email);

  const resolvedId = existing?.id || id;
  const doc = {
    id: resolvedId,
    userId: resolvedId,
    email,
    name: String(user?.name || existing?.name || email.split('@')[0] || 'operator').trim() || 'operator',
    role: String(user?.role || existing?.role || 'operator').trim() || 'operator',
    passwordHash: String(user?.passwordHash || existing?.passwordHash || '').trim(),
    createdAt: String(existing?.createdAt || user?.createdAt || now),
    updatedAt: now,
  };

  if (!dynamoEnabled) {
    memUsers.set(email, doc);
    return doc;
  }

  await getDocClient().send(new PutCommand({ TableName: DYNAMO_USERS_TABLE, Item: doc }));
  return doc;
}

/**
 * @param {string} email
 * @returns {Promise<object|null>}
 */
async function getUserByEmail(email) {
  const normEmail = normalizeEmail(email);
  if (!normEmail) return null;

  if (!dynamoEnabled) {
    return memUsers.get(normEmail) || null;
  }

  // GSI: email-index on DYNAMO_USERS_TABLE with PK=email
  const result = await getDocClient().send(new QueryCommand({
    TableName: DYNAMO_USERS_TABLE,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': normEmail },
    Limit: 1,
  }));
  return result.Items?.[0] || null;
}

/**
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getUserById(userId) {
  const id = String(userId || '');
  if (!id) return null;

  if (!dynamoEnabled) {
    for (const user of memUsers.values()) {
      if (user.id === id) return user;
    }
    return null;
  }

  const result = await getDocClient().send(new GetCommand({
    TableName: DYNAMO_USERS_TABLE,
    Key: { id },
  }));
  return result.Item || null;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {number} ttlMs
 * @param {object} metadata
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
async function createSession(userId, ttlMs, metadata = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + Math.max(60_000, Number(ttlMs) || 0);
  const doc = {
    id: hashSessionToken(token),
    userId: String(userId || ''),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    // DynamoDB TTL expects epoch seconds
    ttl: Math.floor(expiresAt / 1000),
    userAgent: trim(metadata.userAgent || ''),
    ipAddress: trim(metadata.ipAddress || ''),
    label: trim(metadata.label || ''),
  };

  if (!dynamoEnabled) {
    memSessions.set(doc.id, doc);
    return { token, expiresAt: doc.expiresAt };
  }

  await getDocClient().send(new PutCommand({ TableName: DYNAMO_SESSIONS_TABLE, Item: doc }));
  return { token, expiresAt: doc.expiresAt };
}

/**
 * @param {string} rawToken
 * @returns {Promise<object|null>}
 */
async function readSession(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return null;
  const hashId = hashSessionToken(token);

  if (!dynamoEnabled) {
    const doc = memSessions.get(hashId);
    return doc ? { ...doc, token } : null;
  }

  const result = await getDocClient().send(new GetCommand({
    TableName: DYNAMO_SESSIONS_TABLE,
    Key: { id: hashId },
  }));
  if (!result.Item) return null;
  return { ...result.Item, token };
}

/**
 * @param {string} rawToken
 * @param {number} timestampMs
 */
async function touchSession(rawToken, timestampMs) {
  const session = await readSession(rawToken);
  if (!session) return;

  if (!dynamoEnabled) {
    const hashId = hashSessionToken(rawToken);
    const existing = memSessions.get(hashId);
    if (existing) existing.lastSeenAt = Number(timestampMs) || Date.now();
    return;
  }

  await getDocClient().send(new UpdateCommand({
    TableName: DYNAMO_SESSIONS_TABLE,
    Key: { id: session.id },
    UpdateExpression: 'SET lastSeenAt = :ts',
    ExpressionAttributeValues: { ':ts': Number(timestampMs) || Date.now() },
  }));
}

/**
 * @param {string} rawToken
 */
async function deleteSession(rawToken) {
  const session = await readSession(rawToken);
  if (!session) return;

  if (!dynamoEnabled) {
    memSessions.delete(session.id);
    return;
  }

  await getDocClient().send(new DeleteCommand({
    TableName: DYNAMO_SESSIONS_TABLE,
    Key: { id: session.id },
  }));
}

/**
 * Prune expired sessions from the in-memory store.
 * DynamoDB handles TTL-based expiry natively via the `ttl` attribute — no manual pruning needed.
 */
async function pruneExpiredSessions() {
  const now = Date.now();

  if (!dynamoEnabled) {
    for (const [id, doc] of memSessions) {
      if (Number(doc.expiresAt || 0) <= now) memSessions.delete(id);
    }
  }
  // DynamoDB TTL deletes expired items automatically — no action needed here.
}

/**
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
async function listSessionsByUser(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return [];

  if (!dynamoEnabled) {
    return [...memSessions.values()].filter((doc) => doc.userId === uid);
  }

  // GSI: userId-index on DYNAMO_SESSIONS_TABLE with PK=userId
  const result = await getDocClient().send(new QueryCommand({
    TableName: DYNAMO_SESSIONS_TABLE,
    IndexName: 'userId-index',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': uid },
  }));
  return result.Items || [];
}

/**
 * @param {string} userId
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
async function deleteSessionById(userId, sessionId) {
  const uid = String(userId || '').trim();
  const sid = String(sessionId || '').trim();
  if (!uid || !sid) return false;

  if (!dynamoEnabled) {
    return memSessions.delete(sid);
  }

  await getDocClient().send(new DeleteCommand({
    TableName: DYNAMO_SESSIONS_TABLE,
    Key: { id: sid },
  }));
  return true;
}

/**
 * @param {string} userId
 * @param {{ excludeIds?: string[] }} options
 * @returns {Promise<number>}
 */
async function deleteSessionsByUser(userId, options = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return 0;
  const excluded = new Set(
    (Array.isArray(options.excludeIds) ? options.excludeIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const sessions = await listSessionsByUser(uid);
  let deleted = 0;
  for (const session of sessions) {
    if (!session?.id || excluded.has(String(session.id))) continue;
    const ok = await deleteSessionById(uid, session.id);
    if (ok) deleted += 1;
  }
  return deleted;
}

// ── User Store ────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {string} storeKey
 * @param {object} value
 */
async function setUserStoreValue(userId, storeKey, value) {
  const uid = String(userId || '').trim();
  const key = String(storeKey || '').trim();
  if (!uid || !key) return;

  const docId = `${uid}:${key}`;
  const doc = {
    id: docId,
    userId: uid,
    storeKey: key,
    payloadEnc: encryptJson(value || {}),
    updatedAt: toIsoNow(),
  };

  if (!dynamoEnabled) {
    memStores.set(docId, doc);
    return;
  }

  await getDocClient().send(new PutCommand({ TableName: DYNAMO_STORES_TABLE, Item: doc }));
}

/**
 * @param {string} userId
 * @param {string} storeKey
 * @param {object} fallbackValue
 * @returns {Promise<object>}
 */
async function getUserStoreValue(userId, storeKey, fallbackValue = {}) {
  const uid = String(userId || '').trim();
  const key = String(storeKey || '').trim();
  if (!uid || !key) return fallbackValue;

  if (!dynamoEnabled) {
    const doc = memStores.get(`${uid}:${key}`);
    if (!doc || !doc.payloadEnc) return fallbackValue;
    try {
      const parsed = decryptJson(doc.payloadEnc);
      return (parsed === null || parsed === undefined) ? fallbackValue : parsed;
    } catch {
      return fallbackValue;
    }
  }

  try {
    const result = await getDocClient().send(new GetCommand({
      TableName: DYNAMO_STORES_TABLE,
      Key: { id: `${uid}:${key}` },
    }));
    if (!result.Item || !result.Item.payloadEnc) return fallbackValue;
    const parsed = decryptJson(result.Item.payloadEnc);
    return (parsed === null || parsed === undefined) ? fallbackValue : parsed;
  } catch {
    return fallbackValue;
  }
}

/**
 * @param {string} userId
 * @param {string[]} storeKeys
 * @returns {Promise<Record<string, object>>}
 */
async function getUserStoreValues(userId, storeKeys = []) {
  const uid = String(userId || '').trim();
  if (!uid) return {};

  let allRows;
  if (!dynamoEnabled) {
    allRows = [...memStores.values()].filter((doc) => doc.userId === uid);
  } else {
    // GSI: userId-index on DYNAMO_STORES_TABLE with PK=userId
    const result = await getDocClient().send(new QueryCommand({
      TableName: DYNAMO_STORES_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': uid },
    }));
    allRows = result.Items || [];
  }

  const all = {};
  for (const row of allRows) {
    try {
      all[row.storeKey] = decryptJson(row.payloadEnc);
    } catch {
      all[row.storeKey] = {};
    }
  }

  if (!Array.isArray(storeKeys) || storeKeys.length === 0) return all;
  const picked = {};
  for (const key of storeKeys) {
    const normalized = String(key || '').trim();
    if (!normalized) continue;
    picked[normalized] = all[normalized] === undefined ? {} : all[normalized];
  }
  return picked;
}

// Kept for API compatibility — no-op after DynamoDB migration
async function migrateLegacyAuthStore() {
  return 0;
}

// ── Agent Tokens ──────────────────────────────────────────────────────────────

/**
 * Finds an existing agent token for a user.
 * Scans in-memory or queries DynamoDB by userId index.
 *
 * @param {string} userId
 * @returns {Promise<string|null>} raw token or null
 */
async function findAgentTokenByUserId(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;

  if (!dynamoEnabled) {
    for (const [, doc] of memSessions) {
      if (doc.type === 'agent-token' && doc.userId === uid) {
        return doc.rawToken || null;
      }
    }
    return null;
  }

  try {
    const result = await getDocClient().send(new QueryCommand({
      TableName: DYNAMO_SESSIONS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: '#t = :type',
      ExpressionAttributeNames: { '#t': 'type' },
      ExpressionAttributeValues: { ':uid': uid, ':type': 'agent-token' },
      Limit: 1,
    }));
    const item = result.Items?.[0];
    return item?.rawToken || null;
  } catch {
    return null;
  }
}

/**
 * Creates a long-lived agent token for a user (idempotent).
 * Stored in the sessions table with type='agent-token'.
 * Returns existing token if one already exists.
 *
 * @param {string} userId
 * @returns {Promise<string>} raw token
 */
async function createAgentToken(userId) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('userId is required');

  const existing = await findAgentTokenByUserId(uid);
  if (existing) return existing;

  const token = crypto.randomBytes(32).toString('hex');
  const hashId = hashSessionToken(token);
  const doc = {
    id: hashId,
    type: 'agent-token',
    userId: uid,
    rawToken: token,
    createdAt: toIsoNow(),
  };

  if (!dynamoEnabled) {
    memSessions.set(hashId, doc);
    return token;
  }

  await getDocClient().send(new PutCommand({ TableName: DYNAMO_SESSIONS_TABLE, Item: doc }));
  return token;
}

/**
 * Verifies an agent token and returns the associated userId.
 *
 * @param {string} rawToken
 * @returns {Promise<string|null>} userId or null if invalid
 */
async function findAgentToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return null;
  const hashId = hashSessionToken(token);

  if (!dynamoEnabled) {
    const doc = memSessions.get(hashId);
    return (doc?.type === 'agent-token') ? doc.userId : null;
  }

  try {
    const result = await getDocClient().send(new GetCommand({
      TableName: DYNAMO_SESSIONS_TABLE,
      Key: { id: hashId },
    }));
    const doc = result.Item;
    return (doc?.type === 'agent-token') ? doc.userId : null;
  } catch {
    return null;
  }
}

module.exports = {
  DB_FILE: 'aws-dynamodb',
  KEY_ENV_NAME,
  upsertUser,
  getUserByEmail,
  getUserById,
  createSession,
  readSession,
  touchSession,
  deleteSession,
  deleteSessionById,
  deleteSessionsByUser,
  pruneExpiredSessions,
  listSessionsByUser,
  setUserStoreValue,
  getUserStoreValue,
  getUserStoreValues,
  migrateLegacyAuthStore,
  createAgentToken,
  findAgentToken,
};
