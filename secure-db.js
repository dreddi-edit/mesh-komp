const crypto = require("crypto");
const os = require("os");

let CosmosClientCtor = null;
try {
  ({ CosmosClient: CosmosClientCtor } = require("@azure/cosmos"));
} catch {
  CosmosClientCtor = null;
}

const CIPHER_ALGORITHM = "aes-256-gcm";
const KEY_ENV_NAME = "MESH_DATA_ENCRYPTION_KEY";
const IS_PRODUCTION = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
let warnedFallbackSecret = false;

/**
 * Derives a machine-stable dev fallback secret from non-sensitive system properties.
 * This is NOT cryptographically secret — it only prevents a known constant from being
 * baked into source code. Production deployments must set MESH_DATA_ENCRYPTION_KEY.
 */
function deriveMachineSecret() {
  return crypto
    .createHash("sha256")
    .update(`mesh-dev:${os.hostname()}:${os.homedir()}`)
    .digest("hex");
}

function resolvedSecret() {
  const envSecret = String(process.env[KEY_ENV_NAME] || process.env.AUTH_SECRET || "").trim();
  if (envSecret) return envSecret;
  if (IS_PRODUCTION) {
    throw new Error(`[mesh-secure-db] ${KEY_ENV_NAME} must be set in production.`);
  }
  if (!warnedFallbackSecret) {
    warnedFallbackSecret = true;
    console.warn(
      `[mesh-secure-db] ${KEY_ENV_NAME} is not set. Using machine-derived dev secret — set the env var before going to production.`
    );
  }
  return deriveMachineSecret();
}

function encryptionKey() {
  return crypto.createHash("sha256").update(resolvedSecret()).digest();
}

function encryptJson(value) {
  const payload = JSON.stringify(value === undefined ? null : value);
  const iv = crypto.randomBytes(12);
  const key = encryptionKey();
  const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, encrypted]).toString("base64");
}

function decryptJson(encoded) {
  const packed = Buffer.from(String(encoded || ""), "base64");
  if (!packed.length) return null;
  if (packed[0] !== 1) throw new Error("Unsupported encrypted payload version.");
  if (packed.length < 1 + 12 + 16) throw new Error("Encrypted payload is invalid.");

  const iv = packed.subarray(1, 13);
  const tag = packed.subarray(13, 29);
  const encrypted = packed.subarray(29);
  const key = encryptionKey();
  const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  return JSON.parse(decrypted);
}

function toIsoNow() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashSessionToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
}

function trim(val) {
  return String(val || "").trim();
}

// Global cosmos components
const endpoint = trim(process.env.MESH_COSMOS_ENDPOINT || "");
const key = trim(process.env.MESH_COSMOS_KEY || "");
const databaseId = trim(process.env.MESH_COSMOS_DATABASE || "mesh-db");
const enabled = Boolean(endpoint && key && CosmosClientCtor);

// In-memory fallback when Cosmos DB is not configured (dev/test only).
// Data lives only for the lifetime of the process — acceptable for local dev.
const memUsers = new Map();
const memSessions = new Map();
const memStores = new Map();

let dbInitPromise = null;

async function initDb() {
  if (!enabled) throw new Error("Cosmos DB is not configured for auth.");
  if (dbInitPromise) return dbInitPromise;
  
  dbInitPromise = (async () => {
    const client = new CosmosClientCtor({ endpoint, key });
    const { database } = await client.databases.createIfNotExists({ id: databaseId });
    
    // Containers
    const { container: usersContainer } = await database.containers.createIfNotExists({
      id: "auth_users",
      partitionKey: { paths: ["/email"] } // user email as partition key
    });
    
    const { container: sessionsContainer } = await database.containers.createIfNotExists({
      id: "auth_sessions",
      partitionKey: { paths: ["/userId"] }
    });
    
    const { container: storesContainer } = await database.containers.createIfNotExists({
      id: "auth_stores",
      partitionKey: { paths: ["/userId"] }
    });

    return { usersContainer, sessionsContainer, storesContainer };
  })();
  return dbInitPromise;
}

async function upsertUser(user) {
  const now = toIsoNow();
  const email = normalizeEmail(user?.email);
  const id = String(user?.id || crypto.randomUUID());
  if (!email) return null;

  const existing = await getUserByEmail(email);

  const doc = {
    id: existing?.id || id,
    email,
    name: String(user?.name || existing?.name || email.split("@")[0] || "operator").trim() || "operator",
    role: String(user?.role || existing?.role || "operator").trim() || "operator",
    passwordHash: String(user?.passwordHash || existing?.passwordHash || "").trim(),
    createdAt: String(existing?.createdAt || user?.createdAt || now),
    updatedAt: now,
  };

  if (!enabled) {
    memUsers.set(email, doc);
    return doc;
  }

  const { usersContainer } = await initDb();
  await usersContainer.items.upsert(doc);
  return doc;
}

async function getUserByEmail(email) {
  const normEmail = normalizeEmail(email);
  if (!normEmail) return null;

  if (!enabled) {
    return memUsers.get(normEmail) || null;
  }

  const { usersContainer } = await initDb();
  const iterator = usersContainer.items.query({
    query: "SELECT * FROM c WHERE c.email = @email",
    parameters: [{ name: "@email", value: normEmail }]
  });
  const { resources } = await iterator.fetchAll();
  return resources?.[0] || null;
}

async function getUserById(userId) {
  const id = String(userId || "");
  if (!id) return null;

  if (!enabled) {
    for (const user of memUsers.values()) {
      if (user.id === id) return user;
    }
    return null;
  }

  const { usersContainer } = await initDb();
  const iterator = usersContainer.items.query(
    { query: "SELECT * FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] },
    { enableCrossPartitionQuery: true }
  );
  const { resources } = await iterator.fetchAll();
  return resources?.[0] || null;
}

async function createSession(userId, ttlMs, metadata = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const doc = {
    id: hashSessionToken(token),
    userId: String(userId || ""),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + Math.max(60_000, Number(ttlMs) || 0),
    userAgent: trim(metadata.userAgent || ""),
    ipAddress: trim(metadata.ipAddress || ""),
    label: trim(metadata.label || ""),
  };

  if (!enabled) {
    memSessions.set(doc.id, doc);
    return { token, expiresAt: doc.expiresAt };
  }

  const { sessionsContainer } = await initDb();
  await sessionsContainer.items.create(doc);
  return { token, expiresAt: doc.expiresAt };
}

async function readSession(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  const hashId = hashSessionToken(token);

  if (!enabled) {
    const doc = memSessions.get(hashId);
    return doc ? { ...doc, token } : null;
  }

  const { sessionsContainer } = await initDb();
  const iterator = sessionsContainer.items.query(
    { query: "SELECT * FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: hashId }] },
    { enableCrossPartitionQuery: true }
  );
  const { resources } = await iterator.fetchAll();
  if (!resources?.length) return null;
  return { ...resources[0], token };
}

async function touchSession(rawToken, timestampMs) {
  const session = await readSession(rawToken);
  if (!session) return;
  session.lastSeenAt = Number(timestampMs) || Date.now();

  if (!enabled) {
    const hashId = hashSessionToken(rawToken);
    const existing = memSessions.get(hashId);
    if (existing) existing.lastSeenAt = session.lastSeenAt;
    return;
  }

  const { sessionsContainer } = await initDb();
  await sessionsContainer.items.upsert(session);
}

async function deleteSession(rawToken) {
  const session = await readSession(rawToken);
  if (!session) return;

  if (!enabled) {
    memSessions.delete(session.id);
    return;
  }

  const { sessionsContainer } = await initDb();
  try {
    await sessionsContainer.item(session.id, session.userId).delete();
  } catch (e) {
    if (e.code !== 404) throw e;
  }
}

async function pruneExpiredSessions() {
  const now = Date.now();

  if (!enabled) {
    for (const [id, doc] of memSessions) {
      if (Number(doc.expiresAt || 0) <= now) memSessions.delete(id);
    }
    return;
  }

  const { sessionsContainer } = await initDb();
  const iterator = sessionsContainer.items.query(
    { query: "SELECT * FROM c WHERE c.expiresAt <= @now", parameters: [{ name: "@now", value: now }] },
    { enableCrossPartitionQuery: true }
  );
  const { resources } = await iterator.fetchAll();
  for (const doc of resources) {
    try {
      await sessionsContainer.item(doc.id, doc.userId).delete();
    } catch {}
  }
}

async function listSessionsByUser(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return [];

  if (!enabled) {
    return [...memSessions.values()].filter((doc) => doc.userId === uid);
  }

  const { sessionsContainer } = await initDb();
  const iterator = sessionsContainer.items.query({
    query: "SELECT * FROM c WHERE c.userId = @uid",
    parameters: [{ name: "@uid", value: uid }]
  }, { partitionKey: uid });
  const { resources } = await iterator.fetchAll();
  return Array.isArray(resources) ? resources : [];
}

async function deleteSessionById(userId, sessionId) {
  const uid = String(userId || "").trim();
  const sid = String(sessionId || "").trim();
  if (!uid || !sid) return false;

  if (!enabled) {
    return memSessions.delete(sid);
  }

  const { sessionsContainer } = await initDb();
  try {
    await sessionsContainer.item(sid, uid).delete();
    return true;
  } catch (error) {
    if (error?.code === 404) return false;
    throw error;
  }
}

async function deleteSessionsByUser(userId, options = {}) {
  if (!enabled) return 0;
  const uid = String(userId || "").trim();
  if (!uid) return 0;
  const excluded = new Set((Array.isArray(options.excludeIds) ? options.excludeIds : []).map((value) => String(value || "").trim()).filter(Boolean));
  const sessions = await listSessionsByUser(uid);
  let deleted = 0;
  for (const session of sessions) {
    if (!session?.id || excluded.has(String(session.id))) continue;
    const ok = await deleteSessionById(uid, session.id);
    if (ok) deleted += 1;
  }
  return deleted;
}

async function setUserStoreValue(userId, storeKey, value) {
  const uid = String(userId || "").trim();
  const key = String(storeKey || "").trim();
  if (!uid || !key) return;

  const docId = `${uid}:${key}`;
  const doc = {
    id: docId,
    userId: uid,
    storeKey: key,
    payloadEnc: encryptJson(value || {}),
    updatedAt: toIsoNow()
  };

  if (!enabled) {
    memStores.set(docId, doc);
    return;
  }

  const { storesContainer } = await initDb();
  await storesContainer.items.upsert(doc);
}

async function getUserStoreValue(userId, storeKey, fallbackValue = {}) {
  const uid = String(userId || "").trim();
  const key = String(storeKey || "").trim();
  if (!uid || !key) return fallbackValue;

  if (!enabled) {
    const doc = memStores.get(`${uid}:${key}`);
    if (!doc || !doc.payloadEnc) return fallbackValue;
    try {
      const parsed = decryptJson(doc.payloadEnc);
      return (parsed === null || parsed === undefined) ? fallbackValue : parsed;
    } catch {
      return fallbackValue;
    }
  }

  const { storesContainer } = await initDb();
  try {
    const { resource } = await storesContainer.item(`${uid}:${key}`, uid).read();
    if (!resource || !resource.payloadEnc) return fallbackValue;
    const parsed = decryptJson(resource.payloadEnc);
    return (parsed === null || parsed === undefined) ? fallbackValue : parsed;
  } catch (e) {
    return fallbackValue;
  }
}

async function getUserStoreValues(userId, storeKeys = []) {
  const uid = String(userId || "").trim();
  if (!uid) return {};

  let allRows;
  if (!enabled) {
    allRows = [...memStores.values()].filter((doc) => doc.userId === uid);
  } else {
    const { storesContainer } = await initDb();
    const iterator = storesContainer.items.query({
      query: "SELECT * FROM c WHERE c.userId = @uid",
      parameters: [{ name: "@uid", value: uid }]
    }, { partitionKey: uid });
    const { resources } = await iterator.fetchAll();
    allRows = resources || [];
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
    const normalized = String(key || "").trim();
    if (!normalized) continue;
    picked[normalized] = all[normalized] === undefined ? {} : all[normalized];
  }
  return picked;
}

// Obsolete function kept empty to avoid breaking legacy calls
async function migrateLegacyAuthStore() {
  return 0;
}

module.exports = {
  DB_FILE: "azure-cosmos-db",
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
};
