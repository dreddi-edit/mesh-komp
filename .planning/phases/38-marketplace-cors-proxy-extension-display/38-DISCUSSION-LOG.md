# Phase 38: Marketplace — CORS-Proxy & Extension Display — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 38-marketplace-cors-proxy-extension-display
**Areas discussed:** Proxy-Endpunkt Design, Extension Card Display, Fehler & Fallback

---

## Proxy-Endpunkt Design

| Option | Description | Selected |
|--------|-------------|----------|
| Neue Route /api/marketplace/search | Eigenständiger Endpunkt, sauber abgegrenzt | ✓ |
| In assistant.routes.js erweitern | Neben dem Install-Endpunkt | |
| Separate marketplace.routes.js | Eigene Route-Datei für komplette Marketplace-Logik | |

**User's choice:** Neue Route `/api/marketplace/search`
**Notes:** Sauber abgegrenzt, leicht auffindbar

---

| Option | Description | Selected |
|--------|-------------|----------|
| In-Memory Cache, 5min TTL | Gleiche Suchanfragen treffen Open VSX nicht mehrfach | ✓ |
| Kein Cache — reiner Pass-through | Immer frisch, aber mehr Last und Latenz | |
| Cache mit konfigurierbarer TTL | TTL per Env-Var einstellbar | |

**User's choice:** In-Memory Cache, 5min TTL

---

| Option | Description | Selected |
|--------|-------------|----------|
| Timeout 8s, Fehler direkt durchreichen | 504 mit strukturierter Fehlermeldung bei Timeout | ✓ |
| Timeout 8s + 1 Retry | Bei Netzwerkfehler einmal wiederholen | |
| Timeout 15s, kein Retry | Längeres Warten | |

**User's choice:** Timeout 8s, direkt durchreichen (kein Retry)

---

## Extension Card Display

| Option | Description | Selected |
|--------|-------------|----------|
| Name, Publisher, Description, Downloads, Version | Status quo — alles was ein User braucht | ✓ |
| Wie oben + Last Updated Datum | Zeigt ob Extension aktiv gepflegt wird | |
| Wie oben + Kategorie-Tags | Tags-Chips, braucht mehr UI | |

**User's choice:** Bestehende Card-Felder unverändert lassen

---

| Option | Description | Selected |
|--------|-------------|----------|
| Open VSX Icon-URL, Fallback dicebear | Reales Icon wenn vorhanden, sonst Identicon | ✓ |
| Immer Initials-Avatar | Konsistenter Look, kein externer Bild-Request | |

**User's choice:** Status quo beibehalten

---

## Fehler & Fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Fehlertext + Retry-Button | Klar + einfacher Weg es nochmal zu versuchen | ✓ |
| Fehlertext + automatischer Retry nach 5s | Unsichtbar, kann verwirrend sein | |
| Nur Fehlertext (Status quo) | User muss manuell neu laden | |

**User's choice:** Fehlertext + Retry-Button

---

| Option | Description | Selected |
|--------|-------------|----------|
| Loading-Skeleton mit Spinner | Visuelles Feedback, weniger Layout-Shift | ✓ |
| Text 'Fetching the global registry...' | Status quo, kein Layout-Shift | |

**User's choice:** Loading-Skeleton mit Spinner

---

## Claude's Discretion

- Route file placement (neue marketplace.routes.js oder in assistant.routes.js)
- Skeleton card-Markup — muss `.mp-card` Dimensionen ungefähr matchen
- Cache-Eviction-Strategie — einfaches TTL-Expiry reicht

## Deferred Ideas

- Extension ratings/stars — separate API, out of scope
- Kategorie-Tag-Filtering — neue UI-Fähigkeit, eigene Phase
- Extension Detail Page / README Preview — neues Surface
