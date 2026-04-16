---
phase: 27
plan: "03"
title: "DynamoDB Schema Documentation + Migration Strategy"
status: complete
started: 2026-04-17T02:30:00Z
completed: 2026-04-17T02:50:00Z
---

# Summary: 27-03 DynamoDB Schema Documentation + Migration Strategy

## What was built

### Task 1: Document DynamoDB schema — DONE
`docs/dynamodb-schema.md`: Full schema reference for all 4 storage backends:

1. **Users Table** (`mesh-users`): PK `id`, GSI `email-index`, attributes including passwordHash/createdAt/updatedAt, access patterns via getUserById/getUserByEmail/upsertUser
2. **Sessions Table** (`mesh-sessions`): PK `id` (SHA-256 of raw token), GSI `userId-index`, TTL attribute for DynamoDB auto-expiry, all CRUD + list access patterns
3. **User Store Table** (`mesh-stores`): PK `id` (`${userId}:${storeKey}` composite), AES-256-GCM encrypted `payloadEnc`, access via getUserStoreValue/setUserStoreValue/getUserStoreValues
4. **Workspace Metadata Store** (Cosmos DB, not DynamoDB): `workspace_files` and `workspace_workspaces` containers, full attribute list and access patterns

Sourced directly from `secure-db.js`, `workspace-metadata-store.cjs`, and `src/config/index.js`.

### Task 2: Create migration strategy document — DONE
`docs/migration-strategy.md`: 6-section migration guide:

1. **Adding new attributes** — write + read with backward-compatible defaults
2. **Adding new tables** — CloudFormation + config + access functions sequence
3. **Modifying existing attributes** — rename (dual-write drain pattern), type change (migration script with ScanCommand pagination), GSI modification (create new → verify → delete old)
4. **Schema version tracking** — `SchemaVersion` sentinel item + `migrateIfNeeded()` pattern with sequential version checks
5. **Safety rules** — table of 6 rules with rationale
6. **DynamoDB Local** — Docker setup for migration testing

## Key files
- `docs/dynamodb-schema.md` — all tables with keys, GSIs, attributes, access patterns
- `docs/migration-strategy.md` — add/modify/remove patterns + version tracking

## Self-Check: PASSED
- `grep "Users Table" docs/dynamodb-schema.md` — matches
- `grep "Sessions Table" docs/dynamodb-schema.md` — matches
- `grep "Workspace Metadata" docs/dynamodb-schema.md` — matches
- `grep "Partition key" docs/dynamodb-schema.md` — 7 matches
- `grep "Schema version" docs/migration-strategy.md` — matches (section header)
- `grep "migration" docs/migration-strategy.md` — matches
- `grep "CloudFormation" docs/migration-strategy.md` — matches
