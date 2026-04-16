# Mesh. v2 IDE — Roadmap

## Milestone: app-v2 Feature Parity + Antigravity Mashup

**Goal:** Make `app-v2.html` a master mashup of all `app.html` features plus Antigravity IDE features, with Mesh branding, clean UI organization, and full interactivity.

**Constraint:** Only `app-v2.html` may be edited. All other files are read-only.

---

### Phase 1: Editor Chrome — Tabs, Breadcrumb, Explorer Actions
**Goal:** Add editor tab bar (Welcome tab), breadcrumb navigation, and explorer header action buttons (New File, New Folder, Refresh, Collapse All, Open Folder) matching app.html.
**Status:** completed
**Scope:**
- Editor tabs bar with Welcome tab above the center area
- Breadcrumb bar below tabs
- Explorer header action icons (5 buttons from app.html)
- SCM badge count on activity bar icon

### Phase 2: Source Control Panel — Full Git UI
**Goal:** Replace placeholder SCM panel with full git UI: branch display, commit message input, commit/pull/push buttons, changes section with badge count.
**Status:** completed
**Scope:**
- Branch name display with icon
- Commit message input + commit button
- Pull/Push action buttons
- Changes section with count badge
- Init repository fallback state

### Phase 3: Chat Input & Agent Panel Upgrade
**Goal:** Add full chat input area to agent panel: textarea with send button, attach file button, mode selector (Agent/Planning/Ask), matching app.html's chat panel UX.
**Status:** completed
**Scope:**
- Chat message area (scrollable, empty state)
- Chat input row: attach button, mode selector, model selector
- Chat input box: textarea + send button
- Richer agent panel header with Mesh logo

### Phase 4: Surface Switcher — Editor / Terminal / Voice-Coding
**Goal:** Add top bar surface switcher tabs and implement Terminal Surface and Voice-Coding Surface full-page views matching app.html.
**Status:** completed
**Scope:**
- Surface switcher tabs in top bar center (Editor / Terminal / Voice-Coding)
- Terminal Surface: full-page view with Single/Grid toggle, split panes (4 slots)
- Voice-Coding Surface: intro state with orb, "Jetzt starten" button, live state with left (orb + controls) and right (viewer log) panels
- Surface switching hides sidebar/panels when in Terminal or Voice mode

### Phase 5: Context Menu, Auth Overlay & Status Bar Enrichment
**Goal:** Add right-click context menu, auth login overlay, and full status bar matching app.html.
**Status:** completed
**Scope:**
- Context menu: New File, New Folder, Copy Path, Delete (with separator lines)
- Auth overlay: login form with email/password, Mesh logo, error display
- Status bar left: Mesh Cloud, branch name (⑂ main), errors, terminal toggle button, indexing progress
- Status bar right: cursor position (Ln/Col), Spaces, UTF-8, LF, language, Mesh AI brand

### Phase 6: Resize Handles & Panel Polish
**Goal:** Add draggable resize handles between sidebar/editor/chat panels and terminal panel. Final polish pass on spacing, transitions, and interaction details.
**Status:** completed
**Scope:**
- Vertical resize handle between sidebar and editor
- Vertical resize handle between editor and agent panel
- Horizontal resize handle between editor and bottom panel
- Smooth drag behavior with min/max constraints
- Marketplace view (iframe placeholder)
- Operations panel in sidebar
- Transition animations for panel show/hide

### Phase 7: Clean Transition — app-v2 becomes app.html + Light UI Default
**Goal:** Promote app-v2.html to be the new app.html. Align DOM IDs/classes with what app-workspace.js expects, replace inline CSS/JS with external assets, set light theme as default. Delete old app.html, remove app-v2.html.
**Status:** completed
**Scope:**
- Strip inline CSS, load app-workspace.css
- Set data-theme="light" as default
- Align ~50 DOM element IDs to match app-workspace.js selectors
- Align class names to match app-workspace.css selectors
- Add missing DOM elements (monaco, graphView, opsView, file tree, index progress, etc.)
- Load all CDN libraries (d3, lottie, monaco, idb-keyval, xterm, xterm-addon-fit)
- Load all local JS (app-workspace.js, app-graph.js, _bus.js, 20 feature scripts)
- Strip inline JS (replaced by external scripts)
- Copy app-v2.html → app.html, delete app-v2.html

### Phase 8: Fix compression analytics showing real data + improve dependency graph animations and live updates when code changes

**Goal:** Compression analytics show real per-file data from the live compression map. Dependency graph nodes animate in with stagger entrance, cross-fade on rebuild, and update live when code changes.
**Status:** completed
**Depends on:** Phase 7

---

### Phase 9: Performance — In-Process Caching (Zero-Cost Quick Wins)

**Goal:** Eliminate redundant DynamoDB round-trips on every API request by adding TTL-based in-process caches for session resolution and BYOK credential lookups.
**Status:** completed
**Depends on:** Phase 8
**Scope:**
- TTL cache for `resolveSession` (auth.js) — cache session + user lookup for 30s, saving 2 DynamoDB calls per authenticated request
- TTL cache for `getStoredCredentialsForUser` (auth.js) — cache BYOK key bundle for 60s, saving 1 DynamoDB GSI query per `/api/assistant/chat` request
- Cache invalidation on explicit logout and credential update
- No external dependencies — pure in-process Maps with TTL, same pattern as `inferFilesCache`

**Success Criteria:**
- Auth middleware makes 0 DynamoDB calls for requests within TTL window
- Credential fetches hit cache on repeat requests within 60s
- Logout immediately invalidates both caches
- No observable behavior change for end users

---

### Phase 10: Performance — libuv Thread Pool + pm2 Cluster Mode

**Goal:** Expand libuv's shared async I/O thread pool and configure pm2 cluster mode so all vCPUs are utilized, preventing thread pool saturation under concurrent S3 + Brotli workloads.
**Status:** completed
**Depends on:** Phase 9
**Scope:**
- `UV_THREADPOOL_SIZE=16` in `.env.example` and `ecosystem.config.js` (must be set before Node starts — pool is initialized at process boot, not in application code)
- `ecosystem.config.js` with `exec_mode: cluster`, `instances: max`, graceful shutdown, CloudWatch agent log paths
- Deploy workflow updated: `pm2 reload ecosystem.config.js` for zero-downtime reloads

**Success Criteria:**
- Concurrent S3 PutObject + Brotli compress calls don't starve each other's libuv threads
- pm2 cluster mode active on multi-vCPU instances
- Zero-downtime `pm2 reload` on deploy

---

### Phase 11: Performance — CloudFront + ALB + Auto Scaling (Infrastructure Scale)

**Goal:** Put CloudFront in front of S3 for workspace blob caching, add an Application Load Balancer, and configure Auto Scaling for the EC2 fleet — eliminating the single point of failure and enabling horizontal scale.
**Status:** completed
**Depends on:** Phase 10
**Scope:**
- CloudFront distribution pointing at S3 workspace bucket — cache workspace blobs at edge, TTL 1h
- Application Load Balancer (ALB) in front of EC2, health check on `/api/health`
- Launch Template + Auto Scaling Group (min 1, max 3, target 60% CPU)
- pm2 cluster mode on each instance (use all vCPUs)
- Update deploy pipeline: rsync → all instances via ASG lifecycle hook or SSM
- S3 pre-signed URL flow updated to use CloudFront domain

**Success Criteria:**
- EC2 instance termination causes zero downtime (ALB routes to healthy instance)
- S3 GetObject latency drops >50% for repeat workspace loads (CloudFront hit)
- Auto Scaling triggers correctly under CPU load test
- Deploy pipeline updates all running instances without downtime

---

### Phase 12: CloudWatch Observability

**Goal:** Add structured JSON logging to the Node.js backend (replacing raw pm2 text output), create a CloudWatch dashboard with ALB 5xx rate, p50/p99 latency, EC2 CPU, DynamoDB consumed capacity, and enable ALB access logs to S3.
**Status:** not started
**Depends on:** Phase 11

**Scope:**
- Replace `console.log`/`console.error` calls in `src/` with a structured JSON logger (winston or pino) — fields: `level`, `ts`, `requestId`, `userId`, `msg`, `err`
- CloudWatch Log Group + metric filters for 5xx errors and slow requests (>2s)
- CloudWatch Dashboard: ALB RequestCount, HTTPCode_ELB_5XX_Count, TargetResponseTime p50/p99, EC2 CPUUtilization, DynamoDB ConsumedReadCapacityUnits/ConsumedWriteCapacityUnits
- ALB access logs enabled → S3 prefix `alb-logs/`
- CloudFormation updates for the dashboard + log group resources

**Success Criteria:**
- Structured JSON log lines appear in CloudWatch Logs (not raw pm2 text)
- CloudWatch dashboard visible with all 6 widgets populated after a request
- ALB access logs appear in S3 under `alb-logs/`
- Zero regression in existing request handling

---

### Phase 13: Cold-Start Latency Fix

**Goal:** Parallelize the serial DynamoDB calls on the first authenticated request. Session resolve + credential fetch currently happen sequentially; use Promise.all to cut cold-start by 100–200ms.
**Status:** not started
**Depends on:** Phase 12

**Scope:**
- Audit `src/core/auth.js` and request handler path for sequential `await` calls that can be parallelized
- Replace serial session-resolve + credential-fetch chain with `Promise.all` where safe
- Ensure cache invalidation logic remains correct after parallelization
- Benchmark before/after with local load test (autocannon or wrk)

**Success Criteria:**
- Cold-start authenticated request time drops ≥80ms measured locally
- All 145 existing tests continue to pass
- No race condition between session cache and credential cache writes

---

### Phase 14: Branded CloudFront Error Pages

**Goal:** Create S3-hosted branded Mesh HTML error pages for 502/503/504 and wire them into the CloudFront distribution so users see a Mesh-branded page instead of a raw browser error when the origin is down.
**Status:** not started
**Depends on:** Phase 13

**Scope:**
- Create `infra/error-pages/502.html`, `503.html`, `504.html` — Mesh-branded, dark theme matching app.html, human-readable message + retry button
- Upload error pages to S3 workspace bucket under `/_errors/` prefix
- CloudFormation update: add `CustomErrorResponses` to the CloudFront distribution (502 → `/_errors/502.html`, 503 → `/_errors/503.html`, 504 → `/_errors/504.html`), TTL 30s
- Deploy script for uploading error pages as part of the standard deploy pipeline

**Success Criteria:**
- Simulated ALB outage (stop pm2) returns branded 503 page from CloudFront, not browser default
- Error pages load in <200ms (served from CloudFront edge, not origin)
- Error pages pass HTML validation (no inline JS, valid charset)

---

### Phase 15: Compression Engine — Full Language Coverage + Pipeline Quality

**Goal:** Extend the capsule compression pipeline to produce rich structural capsules for all major programming languages (C++, C#, Rust, Java, Swift, Kotlin, Ruby, PHP), fix the `.wasm`/`.min.js` indexing bugs, and harden the heuristic fallback path so every file type delivers maximum useful signal to the LLM regardless of whether a tree-sitter grammar exists.
**Status:** not started
**Depends on:** Phase 14

**Scope:**
- Add tree-sitter grammars for: Rust (`tree-sitter-rust`), C++ (`tree-sitter-cpp`), C# (`tree-sitter-c-sharp`), Java (`tree-sitter-java`), Swift (`tree-sitter-swift`), Kotlin (`tree-sitter-kotlin`), Ruby (`tree-sitter-ruby`), PHP (`tree-sitter-php`)
- Register all new languages in `CODE_LANGUAGE_MAP` in `mesh-core/src/compression-core.cjs`
- Fix `LOCAL_WORKSPACE_SKIP_EXTENSIONS` in `src/core/index.js` to exclude `.wasm`, `*.min.js`, `*.min.css`
- Improve heuristic fallback capsule: extract function/class/method signatures via regex for any language not in `CODE_LANGUAGE_MAP`, instead of producing a plain text outline
- Add `*.min.js` / `*.min.css` to skip-extensions (minified files waste token budget)
- Extend `test/compression-core.test.js` with fixture files for each new language
- Update `mesh-core/package.json` with new grammar dependencies

**Success Criteria:**
- `.rs`, `.cpp`, `.cs`, `.java`, `.swift`, `.kt`, `.rb`, `.php` files produce `capsuleType: "structure"` capsules with symbols extracted
- `.wasm` files are excluded from indexing
- `*.min.js` / `*.min.css` files are excluded from indexing
- Heuristic fallback for unknown extensions produces at least function/class name extraction
- All new grammars covered by at least one passing test in `test/compression-core.test.js`
- Zero regressions in existing JS/TS/Python/Go capsule output

---

**Success Criteria (Milestone):**
- Every visible feature in app.html is present in app-v2.html
- All Antigravity IDE features (from screenshot) are preserved
- All buttons are clickable with appropriate feedback
- Mesh branding throughout (logo, colors, naming)
- Clean, organized UI matching production quality
- Keyboard shortcuts work (⌘B, ⌘`, ⌘⇧P, ⌘⇧F, ⌘⇧E, ⌘⇧G, ⌘,)
