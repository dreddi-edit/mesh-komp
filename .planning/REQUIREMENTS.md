# Requirements: Mesh v2.1 — App Functionality & UX Fix Sweep

**Defined:** 2026-04-17
**Core Value:** Make every surface of the Mesh IDE actually work end-to-end — settings, terminal, editor, UI controls, voice agent, analytics, graph, and .mesh output.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Settings

- [x] **SETT-01**: User can view settings pages styled consistently with the app and landing pages
- [x] **SETT-02**: User can navigate back from settings to workspace without passing through login screen
- [x] **SETT-03**: User can change settings and have them persist across sessions

### Terminal

- [x] **TERM-01**: User can see terminal text clearly (proper foreground color contrast)
- [x] **TERM-02**: User can select and copy text from the terminal
- [x] **TERM-03**: Terminal connects to the user's local machine, not the EC2 instance

### Editor

- [x] **EDIT-01**: User sees syntax-highlighted, properly spaced code in the Monaco editor
- [x] **EDIT-02**: User sees a welcome screen with recent workspaces when no file is open
- [x] **EDIT-03**: Status bar does not show "Indexing..." when no folder is open

### UI Elements

- [x] **UIEL-01**: Pause button (top right) performs its intended action when clicked
- [x] **UIEL-02**: Closing the agent chat panel does not leave a gap in the layout
- [x] **UIEL-03**: "Open Agent Manager" button opens the agent manager
- [x] **UIEL-04**: Context window indicator shows actual context window size, not max output tokens
- [x] **UIEL-05**: Model selection dropdown appears only once (remove duplicate)
- [x] **UIEL-06**: Agent/planning mode options appear only once above chat input (remove duplicate)

### Voice Agent

- [x] **VOIC-01**: Voice agent responds with synthesized speech, not just text
- [x] **VOIC-02**: Voice agent stops listening gracefully after a response instead of spamming "sorry I didn't get that"

### Analytics

- [ ] **ANLY-01**: Operations & Compression Analytics shows real, meaningful data
- [ ] **ANLY-02**: Analytics does not display nonsensical local server log entries

### Graph

- [ ] **GRPH-01**: Mesh graph visual style (colors, typography, layout) matches the rest of the app

### .mesh Folder

- [x] **MESH-01**: Auto-generated .mesh folder files have proper structure and useful content

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Deferred from v2.0
- **QUAL-DEFERRED-01**: Deduplicate normalizeEmail (blocked by circular dep)
- **QUAL-DEFERRED-02**: Split mesh-core monolith
- **QUAL-DEFERRED-03**: Complete global mutable state refactor (DI pattern partial)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| New features or capabilities | This milestone is fix/polish only |
| Backend refactoring | Covered in v2.0, not revisited here |
| CI/CD pipeline changes | Already set up in v2.0 |
| Security hardening | Already addressed in v2.0 Phases 19-20 |
| Performance optimization | Already addressed in v2.0 Phases 9-13 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SETT-01 | Phase 28 (verified: Phase 35) | Pending |
| SETT-02 | Phase 28 (verified: Phase 35) | Pending |
| SETT-03 | Phase 28 (verified: Phase 35) | Pending |
| TERM-01 | Phase 29 | Complete |
| TERM-02 | Phase 29 | Complete |
| TERM-03 | Phase 29 | Complete |
| EDIT-01 | Phase 30 | Complete |
| EDIT-02 | Phase 30 | Complete |
| EDIT-03 | Phase 30 | Complete |
| UIEL-01 | Phase 31 | Complete |
| UIEL-02 | Phase 31 | Complete |
| UIEL-03 | Phase 31 | Complete |
| UIEL-04 | Phase 31 | Complete |
| UIEL-05 | Phase 31 | Complete |
| UIEL-06 | Phase 31 | Complete |
| VOIC-01 | Phase 32 | Complete |
| VOIC-02 | Phase 32 | Complete |
| ANLY-01 | Phase 33 (verified: Phase 35) | Pending |
| ANLY-02 | Phase 33 (verified: Phase 35) | Pending |
| GRPH-01 | Phase 33 (verified: Phase 35) | Pending |
| MESH-01 | Phase 34 | Complete |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-17*
*Last updated: 2026-04-17 after roadmap creation*
