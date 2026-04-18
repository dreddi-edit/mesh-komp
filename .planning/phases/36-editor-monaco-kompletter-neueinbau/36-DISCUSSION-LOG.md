# Phase 36: Editor — Monaco Kompletter Neueinbau - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 36-editor-monaco-kompletter-neueinbau
**Areas discussed:** Editor Technology, Hosting, Workers, Scope

---

## Editor Technology

| Option | Description | Selected |
|--------|-------------|----------|
| Monaco bleiben (self-hosted) | Monaco per npm, AMD loader synchron, VS Code Look & Feel | ✓ |
| Zu CodeMirror 6 wechseln | Leichter, modernes ESM, andere API | |

**User's choice:** Monaco behalten — "was du am besten findest" → Monaco ist für ein IDE-Produkt die richtige Wahl.

---

## Installation

| Option | Description | Selected |
|--------|-------------|----------|
| npm install monaco-editor | Saubere Dependency, Express Static Route | ✓ |
| Dateien ins assets/ kopieren | Manuell, kein npm Update | |

**User's choice:** npm install (beste Option per Claude-Empfehlung)

---

## Workers

| Option | Description | Selected |
|--------|-------------|----------|
| data: URL Pattern | CSP-safe, kein Blob, kein CDN-Fetch aus Worker | ✓ |
| Blob URL | Bisheriger Ansatz, CSP-problematisch | |

**User's choice:** data: URL (beste Option per Claude-Empfehlung)

---

## Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Nur Monaco anfassen | xterm.js, d3, marked bleiben CDN | ✓ |
| Alle CDN-Deps ersetzen | Mehr Arbeit, kein Bug-Fix-Nutzen | |

**User's choice:** Nur Monaco (beste Option per Claude-Empfehlung)

---

## Claude's Discretion

- Cache-Header Konfiguration für Monaco-Route
- Monaco-Versionswahl (0.52.2 — Parität mit bisherigem CDN-Tag)
- Script-Tag Reihenfolge in app.njk

## Deferred Ideas

- xterm.js, marked, d3, idb-keyval self-hosten — out of scope
- Monaco LSP/IntelliSense — eigene Phase
- Monaco Diff-Editor — eigene Phase
