# Mesh. Roadmap

## Active Milestone: v2.2 — Live App Bug Fix & Editor Overhaul (Continued)

**Goal:** Fix the remaining broken surfaces deferred from v2.1 — marketplace search proxying, settings auth, voice Polly TTS, UI polish (FOUC, false indexing), and .mesh content quality enriched with v2.15 symbol data.

**Phases:** 6 (Phase 37–42)
**Requirements:** 12 mapped

---

### Phase 37: Terminal — Server-PTY-Fallback

**Goal:** Terminal works on servers where node-pty is unavailable — fallback to child_process shell with visible warning; local agent proxy checked before PTY guard so agent-connected users always get a terminal.

**Status:** complete
**Depends on:** None
**Requirements:** TERM-04, TERM-05

**Success Criteria:**
1. When node-pty is unavailable, a fallback shell spawns via child_process with a yellow warning message
2. Local agent proxy check runs before PTY availability check — agent users unaffected by missing PTY
3. Standard commands (git, ls, npm) work in fallback mode; interactive programs show appropriate messaging

---

### Phase 38: Marketplace — CORS-Proxy & Extension Display

**Goal:** Extension search routed through a server-side proxy so the browser never calls Open VSX directly; extension cards display consistently with name, publisher, description, and install action.

**Status:** planned
**Depends on:** None
**Requirements:** MKT-01, MKT-02

**Success Criteria:**
1. `/api/assistant/marketplace/search?q=...` proxies to Open VSX API server-side — browser makes no direct cross-origin calls
2. Extension cards show name, publisher, version, description, download count, and install button
3. Search works with empty query (trending/popular) and with keyword query
4. Install flow unchanged — still uses existing `/api/assistant/extensions/install` endpoint

---

### Phase 39: Settings — Auth-Fix & Theme-Default

**Goal:** Settings page accessible without spurious login redirect when already authenticated; default theme follows OS preference on first load.

**Status:** planned
**Depends on:** None
**Requirements:** SETT-04, SETT-05

**Success Criteria:**
1. Navigating to `/settings` from the workspace while logged in loads settings without redirect to login
2. On first load (no saved preference), theme follows OS `prefers-color-scheme` — dark OS = dark theme, light OS = light theme
3. Saved theme preference still overrides system default on subsequent loads

---

### Phase 40: Voice Agent — Polly TTS End-to-End

**Goal:** Voice agent TTS output uses Amazon Polly neural voices end-to-end — no Azure TTS dependency remaining; Polly integration complete and working in production.

**Status:** planned
**Depends on:** None
**Requirements:** VOIC-03

**Success Criteria:**
1. Voice agent speaks responses using Polly neural TTS with no Azure SDK calls in the audio path
2. Voice works with `MESH_VOICE_POLLY_VOICE` env var to select voice; defaults to Joanna neural
3. No regression in voice agent STT (Transcribe) or agent reasoning — only TTS output path changed

---

### Phase 41: UI — FOUC & False Indexing Fix

**Goal:** Correct theme applied before first paint on all pages; indexing status indicator only visible during active indexing.

**Status:** planned
**Depends on:** None
**Requirements:** UIEL-07, UIEL-08

**Success Criteria:**
1. No flash of wrong theme on page load — theme class applied synchronously before first paint on `app.njk`, `settings.njk`, and `index.njk`
2. "Indexing..." indicator in status bar only shows when workspace indexing is actively running — hidden on fresh load and when no folder is open
3. No visual regression on theme switching after fix

---

### Phase 42: .mesh Folder — Content Quality

**Goal:** `.mesh` folder files enriched with v2.15 symbol and file-role data — per-file role descriptions, symbol counts, and workspace-specific rules instead of generic templates.

**Status:** planned
**Depends on:** Phase 46 (v2.15 symbol + file-role data available on records)
**Requirements:** MESH-02, MESH-03, MESH-04

**Success Criteria:**
1. `.mesh/files.md` includes a per-file role column derived from `record.fileRole` (built in Phase 45 CAP-04)
2. `.mesh/project.json` includes `symbolCount` and top 5 exported symbol names per file
3. `.mesh/rules.md` contains workspace-specific patterns (detected stack, conventions, entry points) — not generic placeholder text

---

## Traceability

| Requirement | Phase | Category |
|-------------|-------|----------|
| TERM-04 | Phase 37 | Terminal |
| TERM-05 | Phase 37 | Terminal |
| MKT-01 | Phase 38 | Marketplace |
| MKT-02 | Phase 38 | Marketplace |
| SETT-04 | Phase 39 | Settings |
| SETT-05 | Phase 39 | Settings |
| VOIC-03 | Phase 40 | Voice |
| UIEL-07 | Phase 41 | UI |
| UIEL-08 | Phase 41 | UI |
| MESH-02 | Phase 42 | .mesh |
| MESH-03 | Phase 42 | .mesh |
| MESH-04 | Phase 42 | .mesh |

**Coverage:** 12/12 requirements mapped ✓

---

**Milestone Success Criteria:**
- Marketplace search works in production without CORS errors
- Settings accessible without spurious auth redirect
- Voice agent speaks with Polly neural voices
- No FOUC on any page; indexing indicator accurate
- .mesh files contain real workspace-derived content

---

<details>
<summary>Archive: v2.15 — Compression Intelligence (complete 2026-04-19)</summary>

All 4 phases complete. Symbol index (Phase 43), Semantic Query Index (Phase 44), Capsule Quality (Phase 45), Targeted Reads + Chunking (Phase 46). 30/30 tests green.

Requirements: SYM-01..04, IDX-01..04, CAP-01..04, READ-01..04 — all complete.

</details>

<details>
<summary>Archive: v2.2 Phase 36 — Monaco Neueinbau (complete)</summary>

Monaco Editor self-hosted from node_modules, AMD loader, no CDN, no polling, no FOUC in editor. EDIT-04..07 complete.

</details>
