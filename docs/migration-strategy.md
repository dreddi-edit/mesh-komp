# DynamoDB Migration Strategy

This document defines patterns for safely evolving the Mesh DynamoDB schema (Users, Sessions, User Store tables). All changes must be backward-compatible at the data layer and deployed without downtime.

See `docs/dynamodb-schema.md` for the current schema reference.

---

## 1. Adding New Attributes

DynamoDB is schemaless — you can write a new attribute to any item without a migration.

**Steps:**

1. Add the write path: update `secure-db.js` to include the new attribute in the relevant `PutCommand` or `UpdateCommand`.
2. Add the read path: update the consuming function to read the new attribute, with a safe default for items that predate the change.
3. Never assume the attribute exists on old records — always use `item?.newAttr ?? defaultValue`.

**Example:**

```javascript
// Before — old read
const role = String(item.role || 'operator');

// After — new attribute added with backward-compatible default
const mfaEnabled = Boolean(item.mfaEnabled ?? false);
```

No DynamoDB table modification or CloudFormation update needed.

---

## 2. Adding New Tables

1. Add a CloudFormation `AWS::DynamoDB::Table` resource to `infra/cloudformation.yml`.
2. Add the table name env var to `src/config/index.js` under `buildConfig()`:
   ```javascript
   MESH_DYNAMO_NEW_TABLE: String(env.MESH_DYNAMO_NEW_TABLE || `${tablePrefix}-new-table`).trim(),
   ```
3. Add the table name constant to `secure-db.js`:
   ```javascript
   const DYNAMO_NEW_TABLE = trim(process.env.MESH_DYNAMO_NEW_TABLE || `${DYNAMO_TABLE_PREFIX}-new-table`);
   ```
4. Implement access functions (get/put/delete/query) following the existing patterns in `secure-db.js`.
5. Update `docs/dynamodb-schema.md` with the new table schema.

Deploy via CloudFormation — the table is created before the new application code is deployed.

---

## 3. Modifying Existing Attributes

### 3a. Renaming an Attribute

Use a dual-write + drain window:

1. **Phase 1 (write both):** Update the write path to write both `oldAttr` and `newAttr`.
2. **Phase 2 (read from new, fall back to old):**
   ```javascript
   const value = item.newAttr ?? item.oldAttr ?? defaultValue;
   ```
3. **Phase 3 (drain):** Wait until all items have been written at least once after Phase 1 deploy. For high-traffic tables, one deploy cycle (24h) is usually sufficient.
4. **Phase 4 (remove old):** Stop writing `oldAttr`. Drop the fallback read.

Never jump from Phase 1 to Phase 4 in a single deploy — old items may not have been re-written yet.

### 3b. Changing an Attribute Type

Run a migration script against DynamoDB Local first, then against production:

```javascript
'use strict';
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.MESH_DYNAMO_USERS_TABLE || 'mesh-users';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

async function migrate() {
  let lastKey;
  let migrated = 0;
  do {
    const result = await client.send(new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey: lastKey,
      FilterExpression: 'attribute_exists(legacyAttr)',
    }));
    for (const item of (result.Items || [])) {
      await client.send(new UpdateCommand({
        TableName: TABLE,
        Key: { id: item.id },
        UpdateExpression: 'SET newAttr = :v REMOVE legacyAttr',
        ExpressionAttributeValues: { ':v': transformValue(item.legacyAttr) },
      }));
      migrated += 1;
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  console.log(`Migrated ${migrated} items`);
}

migrate().catch(console.error);
```

Run with `node scripts/migrate-YYYY-MM-DD-description.js`. Store migration scripts under `scripts/migrations/`.

### 3c. Modifying or Adding a GSI

GSIs cannot be modified in place — they must be replaced:

1. Add the new GSI with a different name to the CloudFormation table resource. DynamoDB allows up to 20 GSIs per table.
2. Deploy and wait for the new GSI to backfill (status: ACTIVE). Monitor via AWS Console or CLI.
3. Update application code to use the new GSI name.
4. Deploy application code.
5. Remove the old GSI from CloudFormation in the next release.

---

## 4. Schema version Tracking

Add a `SchemaVersion` sentinel item in the Users table (or a dedicated config table) to track applied migrations:

```javascript
// src/db/schema-version.js
'use strict';
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const SCHEMA_VERSION_PK = '__schema_version__';
const CURRENT_SCHEMA_VERSION = 1;

async function getSchemaVersion(client, tableName) {
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: { id: SCHEMA_VERSION_PK },
  }));
  return Number(result.Item?.version ?? 0);
}

async function setSchemaVersion(client, tableName, version) {
  await client.send(new PutCommand({
    TableName: tableName,
    Item: { id: SCHEMA_VERSION_PK, version, updatedAt: new Date().toISOString() },
  }));
}

async function migrateIfNeeded(client, tableName) {
  const current = await getSchemaVersion(client, tableName);
  if (current >= CURRENT_SCHEMA_VERSION) return;

  if (current < 1) {
    // Migration 1: example — backfill role attribute
    await applyMigration1(client, tableName);
    await setSchemaVersion(client, tableName, 1);
  }
  // Add future migrations as: if (current < N) { ... }
}

module.exports = { migrateIfNeeded, CURRENT_SCHEMA_VERSION };
```

Call `migrateIfNeeded` at server startup (after DynamoDB client is initialized, before serving traffic).

---

## 5. Safety Rules

| Rule | Rationale |
|------|-----------|
| Never delete attributes or tables without a drain window | Old items may still have the old shape; consumers may still read old schema |
| Always add backward-compatible defaults for new attributes | Items written before the migration lack the new attribute |
| Test migrations against DynamoDB Local before production | Avoids consuming production WCUs on a broken scan |
| CloudFormation handles table and GSI creation; migration scripts handle data | Separates infrastructure change from data change — each is independently rollbackable |
| Store migration scripts in `scripts/migrations/` with date prefix | Creates an audit trail; scripts are idempotent by checking version first |
| Never run a `Scan` + batch-update in a tight loop without throttling | DynamoDB capacity can be exhausted — use `ExclusiveStartKey` pagination and add `sleep()` between pages in production |

---

## 6. DynamoDB Local for Testing

Use DynamoDB Local during development and migration testing:

```bash
# Start DynamoDB Local (Docker)
docker run -p 8000:8000 amazon/dynamodb-local

# Point application at local DynamoDB
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
  MESH_DYNAMO_ENABLED=true \
  AWS_REGION=us-east-1 \
  node -e "require('./secure-db')"  # test connectivity
```

DynamoDB Local does not enforce IAM — all operations are permitted. It does enforce key schema and GSI constraints.
