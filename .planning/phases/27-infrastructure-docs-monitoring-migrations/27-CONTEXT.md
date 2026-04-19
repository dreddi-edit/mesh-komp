# Phase 27: Infrastructure — Docs + Monitoring + Migrations - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Add OpenAPI documentation, structured error monitoring via CloudWatch, and DynamoDB schema documentation with migration strategy. Final polish phase.

</domain>

<decisions>
## Implementation Decisions

### OpenAPI Documentation
- **D-01:** OpenAPI/Swagger specification covering all `/api/*` routes with request/response schemas
- **D-02:** Phase 20 Zod schemas can be converted to OpenAPI schemas (zod-to-openapi or similar)
- **D-03:** Serve Swagger UI at a documentation endpoint (e.g., `/api/docs`)
- **D-04:** Route files to document: `auth.routes.js` (253 lines), `app.routes.js` (604 lines), `assistant-workspace.routes.js` (478 lines), `assistant-chat.routes.js` (768 lines), `assistant-git.routes.js` (332 lines)

### CloudWatch Error Monitoring
- **D-05:** CloudWatch metric filters configured for error codes from Phase 19's typed error class hierarchy
- **D-06:** Metrics: error rate by code (ValidationError, NotFoundError, AuthError, etc.), 5xx rate, latency
- **D-07:** Phase 12 already set up CloudWatch Log Group (`/mesh/app`), dashboard, and metric filters for 5xx/slow requests — build on top of this
- **D-08:** `src/logger.js` NDJSON output is already captured by CloudWatch Agent — metric filters parse the `code` field from typed errors

### DynamoDB Schema Documentation
- **D-09:** Document all DynamoDB tables: keys, GSIs, attributes, access patterns
- **D-10:** Tables used: users, sessions, user stores (per `secure-db.js`), workspace metadata (per `workspace-metadata-store.cjs`)
- **D-11:** Migration strategy: how to add/modify DynamoDB attributes and tables safely
- **D-12:** Version tracking for schema changes (attribute in a config table or documentation-based)

### Claude's Discretion
- OpenAPI spec format (YAML vs JSON)
- Whether to auto-generate from Zod or hand-write
- CloudWatch alarm thresholds
- DynamoDB migration tooling (scripts vs. CloudFormation vs. manual documentation)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Missing Infrastructure
- `.planning/codebase/CONCERNS.md` §6 (Missing Infrastructure) — No API docs, no structured error monitoring, no database migrations

### Data Layer
- `.planning/codebase/ARCHITECTURE.md` §4 (Data Layer) — `secure-db.js` (521 lines) DynamoDB+SQLite, `workspace-metadata-store.cjs` (519 lines)
- `.planning/codebase/INTEGRATIONS.md` §DynamoDB — Tables, config keys, encryption details

### API Routes
- `.planning/codebase/ARCHITECTURE.md` §2 (Routes) — All 8 route files with endpoints
- `.planning/codebase/CONVENTIONS.md` §Response Format — `{ ok: true/false }` envelope for OpenAPI schemas

### CloudWatch (Phase 12 baseline)
- `.planning/codebase/INTEGRATIONS.md` §CloudWatch — Current minimal CloudWatch usage
- Phase 12 set up Log Group, Dashboard, ALB metric filters — this phase adds error-code-level filters

### Error Classes (Phase 19 dependency)
- Phase 19 typed error hierarchy — error codes used for CloudWatch metric filters

### Requirements
- `.planning/REQUIREMENTS.md` — INFRA-02, INFRA-03, INFRA-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/logger.js` — NDJSON output already consumed by CloudWatch Agent
- Phase 19 error classes — error `code` field parsed by metric filters
- Phase 20 Zod schemas — convertible to OpenAPI schemas
- `infra/cloudformation.yml` — existing CloudWatch resources from Phase 12 to extend

### Established Patterns
- CloudFormation is the single source of truth for AWS infrastructure
- All DynamoDB access goes through `secure-db.js` or `workspace-metadata-store.cjs`
- API response format: `{ ok: true, data }` / `{ ok: false, error }` — defines OpenAPI response schemas

### Integration Points
- `infra/cloudformation.yml` — new CloudWatch MetricFilter resources for error codes
- `src/routes/` — all route files documented in OpenAPI spec
- `secure-db.js` + `workspace-metadata-store.cjs` — schema documented
- `src/config/index.js` — DynamoDB table name config keys

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 27-infrastructure-docs-monitoring-migrations*
*Context gathered: 2026-04-16*
