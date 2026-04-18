# Mesh. v2.2 — Live App Bug Fix & Editor Overhaul Roadmap

## Milestone: v2.2 Live App Bug Fix & Editor Overhaul

**Goal:** Die Live-App tatsächlich zum Laufen bringen — Monaco zuverlässig neu einbauen, Terminal-PTY-Fallback, Marketplace-CORS-Proxy, Settings-Auth-Fix, Voice-Speech, FOUC-Eliminierung, und .mesh-Inhaltsqualität.

**Phases:** 7 (Phase 36–42, continuing from v2.1)
**Requirements:** 16 mapped

---

### Phase 36: Editor — Monaco Kompletter Neueinbau

**Goal:** Monaco Editor vollständig neu implementieren — AMD loader aus node_modules self-hosted, Worker korrekt konfiguriert, kein CDN, kein Polling, kein FOUC im Editor.

**Status:** planned
**Depends on:** None (first phase)
**Requirements:** EDIT-04, EDIT-05, EDIT-06, EDIT-07
**UI hint:** yes

**Key decisions from research:**
- AMD loader (`vs/loader.js`) synchron aus `/assets/monaco/` serven — kein CDN, kein `defer`
- Worker via `data:` URL Pattern (CSP-safe, kein Blob URL)
- Express-Route oder Static-Middleware für `/assets/monaco/` → `node_modules/monaco-editor/min/`
- Alten `initMonaco` polling code in `app-workspace.js` komplett ersetzen

**Success Criteria:**
1. Monaco Editor erscheint sofort beim Öffnen einer Datei — kein Spinner, kein Delay
2. Syntax Highlighting für JS, TS, Python, CSS, HTML, JSON, Markdown funktioniert korrekt
3. Keine grauen Worker-Lade-Kreise erscheinen
4. Kein externer CDN-Request in den DevTools Network-Tab für Monaco
5. Editor lädt auch bei langsamer Verbindung zuverlässig (kein Race Condition)

---

### Phase 37: Terminal — Server-PTY-Fallback

**Goal:** Terminal öffnet sofort eine Shell via Server-PTY (node-pty) wenn kein lokaler Agent verbunden ist — Connect-Dialog bleibt optional, ist aber nicht mehr der einzige Weg.

**Status:** planned
**Depends on:** None
**Requirements:** TERM-04, TERM-05
**UI hint:** yes

**Success Criteria:**
1. Terminal Tab öffnen startet sofort eine Shell — kein "Waiting for agent" Dialog
2. Shell läuft auf dem Server (zeigt Server-Hostname, nicht lokale Maschine)
3. Eingabe und Ausgabe funktionieren korrekt
4. Connect-Dialog für lokalen Agent ist weiterhin zugänglich (optional, nicht erzwungen)
5. Terminal-Status-Dot zeigt "connected" sobald PTY-Session läuft

---

### Phase 38: Marketplace — CORS-Proxy & Extension Display

**Goal:** Extensions Marketplace zeigt Extensions korrekt an — Backend-Proxy für Open VSX Registry löst CORS-Problem, kein broken placeholder mehr.

**Status:** planned
**Depends on:** None
**Requirements:** MKT-01, MKT-02
**UI hint:** yes

**Success Criteria:**
1. Marketplace zeigt beim Öffnen eine Liste von Extensions (min. 20 trending)
2. Extension Cards zeigen Name, Publisher, Description, Version korrekt
3. Suche nach Extensions (z.B. "Python", "Prettier") liefert relevante Ergebnisse
4. Kein CORS-Fehler in der Browser-Console
5. Bei API-Fehler zeigt die UI eine verständliche Fehlermeldung (kein broken placeholder)

---

### Phase 39: Settings — Auth-Fix & Theme-Default

**Goal:** Zurücknavigieren zum Workspace navigiert direkt zu `/app` ohne Auth-Redirect, und Settings öffnen standardmäßig im Dark Theme.

**Status:** planned
**Depends on:** None
**Requirements:** SETT-04, SETT-05
**UI hint:** yes

**Success Criteria:**
1. "← Workspace" Button in Settings navigiert direkt zur App — kein Login-Screen dazwischen
2. Settings öffnen mit Dark Theme wenn der User noch keine Präferenz gesetzt hat
3. Theme-Wechsel zwischen Dark/Light wird korrekt gespeichert und beim nächsten Öffnen angewendet
4. Die URL `try-mesh.com/settings` (ohne returnTo-Params) funktioniert korrekt
5. Kein unerwarteter Auth-Redirect bei valider Session

---

### Phase 40: Voice Agent — Polly Speech Synthesis

**Goal:** Voice Agent gibt Audio-Antworten über AWS Polly im Browser aus — Speech-to-Speech funktioniert end-to-end.

**Status:** planned
**Depends on:** None
**Requirements:** VOIC-03
**UI hint:** yes

**Success Criteria:**
1. Nach einer Spracheingabe antwortet der Voice Agent mit Audio (nicht nur Text)
2. Audio wird über den Browser abgespielt (AudioContext)
3. Voice Orb zeigt "speaking" State während Audio läuft
4. Polly-Synthesize wird über das Backend getriggert (AWS-Credentials aus Env-Vars)
5. Bei fehlendem AWS-Polly-Setup erscheint eine klare Fehlermeldung statt Stille

---

### Phase 41: UI — FOUC & False Indexing Fix

**Goal:** Alle UI-Elemente die vor JS-Initialisierung sichtbar sind verstecken, und "Indexing..." Status-Bar-Indicator nur zeigen wenn tatsächlich ein Folder geöffnet ist.

**Status:** planned
**Depends on:** None
**Requirements:** UIEL-07, UIEL-08
**UI hint:** yes

**Success Criteria:**
1. Beim App-Laden erscheinen keine UI-Elemente kurz und verschwinden dann wieder
2. Status Bar zeigt kein "Indexing..." beim Start ohne geöffneten Folder
3. "Indexing..." erscheint korrekt wenn ein Folder geöffnet und indexiert wird
4. Kein Layout-Shift (CLS) beim Laden der App
5. Die App wirkt sofort polished beim ersten Laden — kein flackern

---

### Phase 42: .mesh Folder — Content Quality

**Goal:** `.mesh` Folder enthält strukturierte, projektspezifische Inhalte statt Boilerplate — `project.json` mit echten Metadaten, `files.md` mit sinnvollen Beschreibungen, `rules.md` mit abgeleiteten Konventionen.

**Status:** planned
**Depends on:** None
**Requirements:** MESH-02, MESH-03, MESH-04
**UI hint:** no

**Success Criteria:**
1. `.mesh/project.json` enthält: Name, Beschreibung, Stack, Einstiegspunkte — abgeleitet aus `package.json` und Workspace-Scan
2. `.mesh/files.md` enthält eine strukturierte Dateiliste mit kurzen Zweck-Beschreibungen (kein dump)
3. `.mesh/rules.md` enthält mindestens 5 konkrete, projektspezifische Konventionen (nicht generisch)
4. Alle drei Dateien haben YAML-Frontmatter mit `generated`, `workspace`, `version`
5. Inhalte regenerieren sich sinnvoll bei erneutem Indexieren

---

## Traceability

| Requirement | Phase | Category |
|-------------|-------|----------|
| EDIT-04 | Phase 36 | Editor |
| EDIT-05 | Phase 36 | Editor |
| EDIT-06 | Phase 36 | Editor |
| EDIT-07 | Phase 36 | Editor |
| TERM-04 | Phase 37 | Terminal |
| TERM-05 | Phase 37 | Terminal |
| MKT-01 | Phase 38 | Marketplace |
| MKT-02 | Phase 38 | Marketplace |
| SETT-04 | Phase 39 | Settings |
| SETT-05 | Phase 39 | Settings |
| VOIC-03 | Phase 40 | Voice Agent |
| UIEL-07 | Phase 41 | UI Elements |
| UIEL-08 | Phase 41 | UI Elements |
| MESH-02 | Phase 42 | .mesh Folder |
| MESH-03 | Phase 42 | .mesh Folder |
| MESH-04 | Phase 42 | .mesh Folder |

**Coverage:** 16/16 requirements mapped ✓

---

**Milestone Success Criteria:**
- Monaco Editor lädt zuverlässig ohne CDN, Spinner oder Race Conditions
- Terminal öffnet sofort eine Shell ohne lokalen Agent
- Marketplace zeigt Extensions via Backend-Proxy
- Settings navigiert zurück ohne Auth-Redirect, Dark Theme als Default
- Voice Agent gibt Audio aus
- App lädt ohne FOUC, kein falsches "Indexing..."
- .mesh Folder enthält projektspezifische, lesbare Inhalte
