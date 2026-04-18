# Requirements: Mesh v2.2 — Live App Bug Fix & Editor Overhaul

**Defined:** 2026-04-18
**Core Value:** Die Live-App soll tatsächlich funktionieren — Monaco zuverlässig laden, Terminal sofort nutzbar, Marketplace Extensions anzeigen, Settings korrekt navigieren, Voice Agent Audio ausgeben, und .mesh Folder sinnvollen Inhalt erzeugen.

## v1 Requirements

### Editor (Monaco — kompletter Neueinbau)

- [ ] **EDIT-04**: Monaco Editor lädt zuverlässig ohne Lade-Spinner oder Race Conditions beim App-Start
- [ ] **EDIT-05**: Monaco Worker (TypeScript, JSON, CSS) funktionieren korrekt — keine grauen Lade-Kreise
- [ ] **EDIT-06**: Syntax Highlighting für JS, TS, Python, CSS, HTML, JSON, Markdown funktioniert korrekt
- [ ] **EDIT-07**: Monaco lädt ohne externe CDN-Abhängigkeit (self-hosted aus node_modules)

### Terminal

- [ ] **TERM-04**: Terminal öffnet sofort eine Shell ohne dass ein lokaler Agent installiert werden muss
- [ ] **TERM-05**: Terminal-Fallback nutzt Server-PTY (node-pty) wenn kein lokaler Agent verbunden ist

### Marketplace

- [ ] **MKT-01**: Extensions Marketplace zeigt Extensions korrekt an (kein broken placeholder)
- [ ] **MKT-02**: Open VSX Registry wird über einen Backend-Proxy geladen (kein direkter Browser-CORS-Fetch)

### Settings

- [ ] **SETT-04**: Zurücknavigieren vom Settings zum Workspace leitet nicht durch den Auth-Screen
- [ ] **SETT-05**: Settings öffnen standardmäßig im Dark Theme (nicht Light)

### Voice Agent

- [ ] **VOIC-03**: Voice Agent gibt Audio-Antworten über AWS Polly aus (Speech-to-Speech funktioniert im Browser)

### UI / FOUC

- [ ] **UIEL-07**: Beim App-Start sind keine UI-Elemente sichtbar bevor JavaScript initialisiert hat (kein FOUC)
- [ ] **UIEL-08**: Status Bar zeigt kein "Indexing..." beim App-Start ohne geöffneten Workspace-Folder

### .mesh Folder

- [ ] **MESH-02**: `.mesh/project.json` enthält strukturierte, sinnvolle Projektmetadaten (kein Boilerplate)
- [ ] **MESH-03**: `.mesh/files.md` enthält eine lesbare Übersicht der Workspace-Dateien mit Zweck-Beschreibungen
- [ ] **MESH-04**: `.mesh/rules.md` enthält projektspezifische Coding-Konventionen (nicht generische Platzhalter)

## v2 Requirements

Deferred to future release.

- Lokaler Terminal-Agent (mesh-local package) mit echter UI für Setup-Flow
- Monaco Language Server Protocol (LSP) für echtes IntelliSense
- Monaco Diff-Editor für Git-Diffs

## Out of Scope

| Feature | Reason |
|---------|--------|
| Monaco IntelliSense / LSP | Erfordert separaten Language Server — zu groß für dieses Milestone |
| Terminal Multi-Split | Infrastruktur vorhanden, aber kein User-Request |
| Voice Agent neue Features | Erst Basis-Speech zum Laufen bringen |
| Marketplace Extension Installation | Backend-Endpunkt existiert, aber echte Installation erfordert Extension-Runtime |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EDIT-04 | Phase 36 | Planned |
| EDIT-05 | Phase 36 | Planned |
| EDIT-06 | Phase 36 | Planned |
| EDIT-07 | Phase 36 | Planned |
| TERM-04 | Phase 37 | Planned |
| TERM-05 | Phase 37 | Planned |
| MKT-01 | Phase 38 | Planned |
| MKT-02 | Phase 38 | Planned |
| SETT-04 | Phase 39 | Planned |
| SETT-05 | Phase 39 | Planned |
| VOIC-03 | Phase 40 | Planned |
| UIEL-07 | Phase 41 | Planned |
| UIEL-08 | Phase 41 | Planned |
| MESH-02 | Phase 42 | Planned |
| MESH-03 | Phase 42 | Planned |
| MESH-04 | Phase 42 | Planned |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-18*
