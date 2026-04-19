---
phase: 45
slug: capsule-quality-improvements
status: complete
researched: 2026-04-19
---

# Phase 45: Capsule Quality Improvements — Research

## Summary

Phase 45 is purely additive capsule rendering. All data (symbols[], callSites[], dependencies[]) already exists from Phase 43. The work is: (1) detect which symbols are exported, (2) render three new capsule sections in buildCodeCapsule and worker, (3) add a File Roles table to buildFilesMd.

No new indexing. No new data collection. The data is ready — render it.

---

## Validation Architecture

### Test Requirements by Capability

| Capability | Test File | What to verify |
|-----------|-----------|----------------|
| CAP-01: exports section | test/capsule-exports.test.cjs | capsule includes `exports` section; entries have name+signature; isExported propagates |
| CAP-02: calls section | test/capsule-calls.test.cjs | capsule includes `calls` section; format is `callee → file:L${line}`; only resolved callSites |
| CAP-03: resolved-imports section | test/capsule-imports.test.cjs | capsule includes `resolved-imports` section; only workspace-internal imports |
| CAP-04: file roles | test/file-roles.test.cjs | buildFilesMd output includes `## File Roles` table; files bucketed by role |

---

## Codebase Findings

### 1. `buildCodeCapsule` — Where New Sections Go

**File:** `mesh-core/src/compression-core.cjs` ~line 735  
**File (worker):** `mesh-core/src/tree-sitter-worker.cjs` ~line 340

Both files share identical section assembly structure:
```javascript
const importsSection = createSection("imports", "P0");
const symbolsSection = createSection("symbols", "P0");
const routesSection  = createSection("routes", "P1");
const literalsSection = createSection("literals", "P1");
const elisionsSection = createSection("elisions", "P2");
```

Return value (line 936 in compression-core.cjs):
```javascript
sections: [importsSection, symbolsSection, routesSection, literalsSection, elisionsSection]
  .flatMap(section => {
    section.items = dedupeByText(section.items);
    return section.items.length ? [section] : [];
  })
```

**New sections to add:** `exportsSection` (P0), `callsSection` (P1), `resolvedImportsSection` (P1) — added to both files, included in the flatMap return.

### 2. `isExported` Detection

**Current state:** `symbolDeclarations` array (line 744/872 in compression-core.cjs) does NOT have `isExported` field. The parent-check approach requires tree-sitter's `.parent` property.

**Reality check:** tree-sitter nodes have a `.parent` getter but it walks up the tree — expensive for deep trees. A better approach for JS/TS is to check the node's *grandparent* type at declaration time:
- `export_statement` wraps: `function_declaration`, `class_declaration`, `lexical_declaration`
- For `export default function`, the wrapper is `export_default_declaration`

**Practical approach (works with current tree-sitter API):**
When `type` matches a `definitionLike` node, check `node.parent?.type`:
```javascript
const exportTypes = new Set(['export_statement', 'export_default_declaration']);
const isExported = exportTypes.has(node.parent?.type || '');
```
OR use the signature text fallback (already computed):
```javascript
const isExported = /^export\s/.test(signaturePreview(node, rawText));
```
**Recommended:** Signature text scan (`/^export\b/.test(sig)`) — simpler, no parent traversal, works for JS/TS CommonJS `module.exports` won't trigger it but those are already excluded from AST exports. Fallback handles Python/Go/Rust where export is not keyword-based (mark as `isExported: false`).

### 3. `callSites` Shape After Phase 43

Pre-enrichment (buildWorkspaceFileRecord):
```javascript
callSites: [{ callerLine: 2, calleeName: 'login' }]  // unresolved
```

Post-enrichment (enrichWorkspaceRecords pass 2):
```javascript
callSites: [{ callerLine: 2, calleeName: 'login', resolvedFile: 'src/auth.js', resolvedLine: 58 }]
```

**For CAP-02:** The capsule is built during `buildWorkspaceFileRecord` — at that point `callSites` is unresolved (no `resolvedFile`). The capsule cache is updated after enrichment. However, `buildCodeCapsule` receives `rawText` + `fileType` only — it doesn't have access to the file record's `callSites[]`.

**Key architectural constraint:** `buildCodeCapsule(pathValue, rawText, fileType)` is a pure transformation function. It doesn't receive the file record. The `callSitesRaw` it produces flows to `buildWorkspaceFileRecord` → `callSites`. 

**Solutions:**
1. Pass `callSites` (resolved) into `buildCodeCapsule` as an option — requires signature change
2. Add a post-enrichment step that re-renders the capsule's `calls` section from resolved `callSites[]`
3. Build `calls` section in `buildWorkspaceFileRecord` after enrichment, inject into `capsuleBase.sections`

**Recommendation: Option 3** — After enrichment (in `enrichWorkspaceRecords` Pass 2), after resolving callSites, re-inject a `calls` section into the stored capsule. This keeps `buildCodeCapsule` pure and doesn't require re-running full capsule generation.

Actually **simpler Option 2**: Add an optional `resolvedCallSites` parameter to `buildCodeCapsule`. When present (from `buildWorkspaceFileRecord` which has access to post-enrichment data), use it to build the `calls` section. Since capsule rendering happens at record build time AND capsule cache is rebuilt after enrichment... 

**Simplest correct approach:** Add `callSites` parameter to `buildBaseCapsule` (the wrapper called from `buildWorkspaceFileRecord`). At call time from `buildWorkspaceFileRecord`, pass `baseCapsule.callSitesRaw` (which will be post-resolution after enrichment injects resolved data). Actually the enrichment updates `fileRecord.callSites` but doesn't re-render the capsule.

**Cleanest plan:** In `buildWorkspaceFileRecord`, after building `baseCapsule`, build the `calls` section inline from `baseCapsule.callSitesRaw` — these will only have `calleeName` (unresolved), so the section will only show `calleeName` (no file:line). After enrichment updates `callSites[]` with resolution, a separate step can update the capsule section. For this phase: build the section from whatever callSites data is available at capsule render time.

**Revised recommendation:** Build `calls` section from `callSitesRaw` in `buildCodeCapsule` showing just `calleeName` for unresolved. Post-enrichment, the `buildRichCapsulesFromRecord` or capsule update step re-renders with resolved data.

Actually simpler: the CONTEXT.md says Phase 45 renders from `callSites[]` which is the post-enrichment field. Since capsule sections ARE re-built when workspace is loaded (capsuleCache is populated from `buildWorkspaceFileRecord`), and `callSites[]` is the post-enrichment field... the cleanest approach is:

**Final recommendation for CAP-02:** Add `externalCallSites` optional parameter to `buildCodeCapsule`. In `buildWorkspaceFileRecord`, pass `null` (pre-enrichment). After enrichment in Pass 2 of `enrichWorkspaceRecords`, call a new `buildCallsSection(fileRecord.callSites)` utility and push it into `fileRecord.capsuleBase.sections` + invalidate `capsuleCache`. OR: just render the `calls` section from whatever callSites are on the file record at capsule build time — the capsule will be incomplete pre-enrichment but will be correct after enrichment runs.

**Pragmatic final decision:** Add `callSites` as an optional param to `buildBaseCapsule`. Default is `[]`. In `buildWorkspaceFileRecord`, pass `baseCapsule.callSitesRaw` (these are unresolved). After enrichment in Pass 2, after setting `fileRecord.callSites = resolved`, also rebuild the calls section in `fileRecord.capsuleBase.sections`. Keep it simple.

### 4. `resolved-imports` Section (CAP-03)

`buildWorkspaceFileRecord` builds `dependencies[]` by resolving imports from `importsSection.items[].metadata.source`. The `resolved-imports` section should list only workspace-internal resolutions.

**Location:** Build inside `buildWorkspaceFileRecord` (not `buildCodeCapsule`) since `workspaceFilePaths` is only available there. Add the new section to `record.capsuleBase.sections` after building.

Format per line: `originalImportSource → resolvedWorkspacePath`  
Example: `'./auth-service' → src/auth-service.js`

### 5. `buildFilesMd` — File Roles (CAP-04)

**File:** `mesh-core/src/workspace-operations.js` line 1123  

Current function builds:
1. Directory Structure
2. Dependency Hubs (already uses dependencies[])
3. API Surface (reads `exports`/`functions`/`routes` capsule sections — **already there!**)

**Discovery:** `buildFilesMd` already reads capsule section named `exports` for its "API Surface" block. So if we add an `exports` capsule section (CAP-01), it will automatically appear in `buildFilesMd` API Surface. However CAP-04 requires role classification, not just API surface.

Add a **File Roles** table after the API Surface block. Classification from path:
```javascript
function classifyFileRole(relPath) {
  if (/\.(test|spec)\.(cjs|js|ts|mjs)$/.test(relPath)) return 'test';
  if (/\btest\b/.test(relPath)) return 'test';
  if (/\.routes\.(js|ts)$/.test(relPath) || /\broutes\b/.test(relPath)) return 'route-handler';
  if (/server\.(js|ts)$/.test(relPath) || relPath === 'index.js') return 'entry-point';
  if (/\.(config|rc)\.(js|ts|cjs)$/.test(relPath) || relPath.includes('config')) return 'config';
  if (/middleware\.(js|ts)$/.test(relPath) || /\bmiddleware\b/.test(relPath)) return 'middleware';
  if (/service\.(js|ts|cjs)$/.test(relPath) || /\bservice\b/.test(relPath)) return 'service';
  if (/\b(model|schema)\b/.test(relPath)) return 'model';
  return 'util';
}
```

### 6. Worker Duplication

`tree-sitter-worker.cjs` is self-contained (can't import from compression-core.cjs). It has its own `walkTree`, `symbolDeclarations`, `callSitesRaw` logic that mirrors compression-core.cjs.

**What needs duplicating in worker:**
- `isExported` flag on symbolDeclarations entries (same logic as compression-core)
- `exportsSection` building logic from symbolDeclarations
- `callsSection` rendering from callSitesRaw (unresolved — just calleeName:line)

The `resolved-imports` section requires `workspaceFilePaths` from outside, so it's built in `buildWorkspaceFileRecord`, NOT in the capsule builder — no worker change needed for CAP-03.

### 7. `buildTextFallbackCapsule` (heuristic path)

At line 1287, returns `symbolDeclarations`, `sections`. This path also needs:
- `isExported` flag: use signature scan on `heuristicSymbolDeclarations` entries
- `exportsSection`: build from heuristic declarations where `isExported: true`
- No callSites in heuristic path (tree-sitter unavailable)
- No resolved-imports (no workspaceFilePaths access)

---

## Plan Structure Recommendation

**3 plans, 2 waves:**

### Plan 45-01 (Wave 1): Export surface + isExported flag
- Add `isExported` to symbolDeclarations in compression-core.cjs walkTree
- Add `exportsSection` (P0) to buildCodeCapsule sections
- Mirror in tree-sitter-worker.cjs
- Mirror isExported + exportsSection in buildTextFallbackCapsule
- Test: CAP-01 suite

### Plan 45-02 (Wave 1): Calls section + resolved-imports section  
- Add `callsSection` (P1) to buildCodeCapsule from callSitesRaw (calleeName-only pre-enrichment)
- After enrichment Pass 2 in workspace-operations.js: rebuild calls section with resolved file:line
- Add `resolvedImportsSection` (P1) in buildWorkspaceFileRecord (has workspaceFilePaths)
- Worker: add callsSection from callSitesRaw
- Tests: CAP-02 and CAP-03 suites

### Plan 45-03 (Wave 2, depends on 45-01): File roles in buildFilesMd
- Add `classifyFileRole()` utility function in workspace-operations.js
- Add `## File Roles` table to buildFilesMd output
- Test: CAP-04 suite

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Worker duplication drift | Medium | Both files use identical createSection/pushSectionItem — same code pattern, easy to copy |
| Calls section pre/post enrichment gap | Medium | Build from callSitesRaw (callee-name only) in capsule; enrich step updates to resolved after Pass 2 |
| `node.parent` unavailable | Low | Use signature text scan instead — `/^export\b/.test(sig)` |
| buildFilesMd already has "API Surface" conflict | Low | The new File Roles table is additive, not a replacement |
| callSites field name mismatch (calleeName vs calleeSymbol) | Low | Confirmed: field is `calleeName` in both compression-core.cjs (line 628) and worker (line 527) |

---

## Key Line Numbers (Verified)

| Location | File | Line |
|----------|------|------|
| buildCodeCapsule section definitions | compression-core.cjs | 738–742 |
| walkTree symbolDeclarations.push | compression-core.cjs | 872–878 |
| buildCodeCapsule sections flatMap return | compression-core.cjs | 936–947 |
| buildWorkspaceFileRecord symbols + callSites fields | compression-core.cjs | 2411–2413 |
| buildWorkspaceFileRecord dependencies[] build | compression-core.cjs | 2396–2410 |
| buildTextFallbackCapsule heuristicSymbolDeclarations | compression-core.cjs | 1305–1332 |
| Worker section definitions | tree-sitter-worker.cjs | 340–344 |
| Worker symbolDeclarations.push | tree-sitter-worker.cjs | 477–483 |
| Worker callSitesRaw population | tree-sitter-worker.cjs | 525–529 |
| Worker return | tree-sitter-worker.cjs | 636–641 |
| buildFilesMd function | workspace-operations.js | 1123 |
| buildFilesMd API Surface block | workspace-operations.js | 1171–1197 |
