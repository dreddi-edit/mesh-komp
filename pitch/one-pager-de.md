# Mesh — Executive Summary

**Die KI-native Entwicklungsumgebung für Voice und Workspace-Intelligenz.**

---

## Das Problem

KI-Coding-Tools stoßen an eine Wand: Kontextfenster sind endlich, echte Codebasen nicht. Teams bezahlen für Tokens, nicht für Mehrwert — rohen Code an ein LLM zu senden verbrennt 99 % des Budgets für Rauschen. API-Kosten sind ein echter Budgetposten. Voice bleibt komplett ungenutzt. Und kein Tool löst das Komprimierungsproblem.

---

## Die Lösung

Mesh ist eine KI-native Entwicklungsumgebung (Web-App + Desktop), die auf einer proprietären Kompressionspipeline aufbaut — **Capsule** — die Quellcode strukturell komprimiert, bevor er ein LLM erreicht. Kombiniert mit Voice-First-Interaktion und einer einheitlichen Workbench ist es das einzige Tool, das Kontext, Kosten und Workflow gleichzeitig löst.

- **Capsule-Kompression** — 74 % durchschnittliche Token-Reduktion, 3,9× mehr Codebasis pro Kontextfenster, 75 % niedrigere API-Kosten. Hält die Kontextauslastung in der Hochgenauigkeitszone, die NIAH-Benchmarks zeigen. Mehr Codebase-Kontext = weniger SWE-bench-artige Fehler durch fehlende Informationen.
- **Unified Workbench** — Editor, Terminal, KI-Chat und Dependency Graph in einer Oberfläche; kein Kontextwechsel
- **Voice-Driven Agent** — Absicht aussprechen, funktionierenden Code erhalten; der Agent liest komprimierten Codebase-Kontext, generiert Änderungen, erklärt sie

---

## Produkt

MVP vollständig. Drei Oberflächen:

| Oberfläche | Was sie tut |
|---------|-------------|
| **Editor** | Monaco + KI-Chat + Live-Dependency-Graph + Workspace-Intelligenz |
| **Terminal** | Dedizierter Terminal-Workspace, kein unteres Panel |
| **Voice-Coding** | Sprachgesteuerter Agent: sag, was du gebaut haben willst, sieh es passieren |

Gebaut auf einer Gateway/Worker-Architektur — skaliert von Indie-Devs zu Teams ohne Neu-Engineering.

---

## Markt

- **TAM:** $28 Mrd. Entwicklertools-Markt, 12 % CAGR
- **SAM:** $4,2 Mrd. KI-gestütztes IDE/Assistant-Segment
- **SOM (3 Jahre):** ~$120 Mio. — Indie-Devs + kleine Teams, Europa + Nordamerika

Cursor hat in zwei Jahren $400 Mio. ARR bei $20/Monat erreicht. Entwickler zahlen für Tools, die echte Zeit sparen.

---

## Business-Modell

| Tier | Preis | Kernwert |
|------|-------|-----------|
| Free | €0 | Editor + Terminal + begrenztes KI |
| Pro | €19/Mo | Unbegrenztes KI + Voice + vollständige Workspace-Intelligenz |
| Teams | €49/Seat/Mo | Geteilter Workspace-Kontext + Admin-Controls |

---

## Traction

- MVP vollständig funktionsfähig über alle drei Oberflächen
- Capsule-Pipeline gemessen: **74 % Token-Reduktion, 3,9× Kontextgewinn** — echte Produktionszahlen
- 8 Entwicklungsphasen abgeschlossen und verifiziert
- **Nächster Schritt:** 100 Beta-Nutzer → Voice-Engagement und reale Token-Einsparungen messen

---

## Wettbewerb

**VS Code + Copilot** (75,9 % Marktanteil, SO 2025) — wirklich weiterentwickelt: Multi-Modell, echte Agents, Enterprise-Indexierung. Immer noch ein 2015er-Editor mit nachgerüsteter KI. Keine Kompression, kein Voice-Agent.

**Cursor** — Bester dedizierter KI-Editor, Fortune-500-Adoption. Hat Speech-to-Text-Input (Diktat), keinen Voice-Coding-Agent. Embedding-Retrieval, rohe Tokens ans Modell. Nur Desktop, keine Kompression.

**Google Antigravity** *(Nov. 2025, kostenlos)* — VS-Code-Fork mit Multi-Agent-Orchestrierung, Multi-Modell. Ernstzunehmen — aber nur Desktop, kein Voice-Agent, keine Kompression.

**Der entscheidende Unterschied:** Alle drei rufen Code per Embeddings ab und senden ihn roh — Kosten skalieren mit Codebase-Größe. Capsule komprimiert vor dem Modell — Kosten bleiben flach.

**Mesh's Burggraben:** Voice-Coding-Agent + strukturelle Kompression + vollständige Web-App (keine Installation). Niemand sonst hat alle drei.

---

## Team

**Edgar Baumann, Co-Founder** — Hat Mesh von Grund auf gebaut. Student, WU Wien.

**Philipp Horn, Co-Founder** — Student, WHU. Starkes unternehmerisches Gespür — Business-Strategie, GTM und Wachstum.

---

## Die Forderung

**€500.000 Seed-Runde**
- 55 % Engineering (Voice-Pipeline + Workspace-Intelligenz)
- 25 % Growth (Developer-Community, Content, OSS-Präsenz)
- 15 % Infrastruktur (KI-Inferenz im Maßstab)
- 5 % Operations

18 Monate Runway bis zum Product-Market-Fit-Signal mit 1.000 zahlenden Pro-Nutzern.

---

*edgar.baumann@try-mesh.com · philipp.horn@try-mesh.com · Demo auf Anfrage verfügbar*
