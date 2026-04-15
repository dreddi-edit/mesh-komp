# Mesh — Pitch Deck

> *Die Entwicklungsumgebung, die mit dir denkt.*

---

## Folie 1 — Cover

**Mesh**
Die KI-native Entwicklungsumgebung

Edgar Baumann & Philipp Horn — Co-Founder
Wien, Österreich · 2026

---

## Folie 2 — Problem

### KI-Coding-Tools stoßen an eine Wand — und die heißt Kontext.

Jedes KI-Coding-Tool kämpft mit derselben Grundbeschränkung: **LLM-Kontextfenster sind endlich. Echte Codebasen nicht.**

- **KI-Assistenten halluzinieren**, weil sie immer nur einen Bruchteil der Codebasis sehen
- **API-Kosten explodieren**, wenn Teams mehr Code in den Kontext laden — bezahlt wird für Tokens, nicht für Mehrwert
- **Große Dateien sind das größte Problem** — ein einzelnes 50-KB-Modul füllt fast ein 128k-Kontextfenster
- **Voice ist komplett ungenutzt** — Entwickler tippen noch jeden Befehl, obwohl Sprechen schneller wäre

> Rohen Code an ein LLM zu senden ist wie ein Wörterbuch per Fax zu verschicken, um eine einzige Frage zu beantworten.
> 99 % Rauschen. 1 % Signal. Und du bezahlst für beides.

> Der durchschnittliche Entwickler verbringt 42 % seiner Zeit damit, Code zu verstehen — nicht zu schreiben.
> *(Stack Overflow Developer Survey 2023)*

---

## Folie 3 — Lösung

### Mesh: Eine Umgebung. Voller Kontext. Voice + KI.

Mesh ist eine KI-native Entwicklungsumgebung — als Web-App und Desktop-App — die drei Dinge kombiniert, die kein anderes Tool zusammen bietet:

| Was | Wie es funktioniert |
|------|-------------|
| **Capsule-Kompression** | Proprietäre Pipeline reduziert Token-Verbrauch durchschnittlich um 74 % — 3,9× mehr Codebasis pro Kontextfenster, 75 % niedrigere API-Kosten, bessere Modellgenauigkeit |
| **Unified Workbench** | Editor + Terminal + KI-Chat + Dependency Graph — eine Oberfläche, kein Wechsel |
| **Voice-Driven Agent** | Absicht aussprechen. Mesh liest komprimierten Codebase-Kontext, generiert Änderungen, erklärt sie |

---

## Folie 4 — Die Kompressionsmaschine

### Die Technologie, die alles andere erst möglich macht.

Mesh's Workspace-Intelligenz basiert auf einer proprietären Komprimierungs-Pipeline — **Capsule** — die Quellcode strukturell komprimiert, bevor er ein LLM erreicht.

Das ist keine Zusammenfassung. Es ist strukturelle Kompression mit selektiver Wiederherstellung — die vollständige Datei kann auf Anfrage rekonstruiert werden.

**Warum Kontextqualität zählt — drei unabhängige Benchmarks:**

**A — NIAH (Needle In A Haystack):** Standard-Benchmark, der misst, ob ein LLM eine bestimmte Information in einem langen Kontext finden kann. Forschung zeigt konsistent: Modelle verschlechtern sich deutlich, wenn der Kontext über ~60–70 % Auslastung liegt (»Lost in the Middle«-Effekt — Liu et al., 2023). Bei 100k+-Token-Kontexten sinkt die Abrufgenauigkeit um 20–40 %. Capsule hält die Auslastung niedrig — das Modell arbeitet immer in der Hochgenauigkeitszone.

**B — SWE-bench:** Der Standard-Benchmark für KI-Coding-Agenten. Top-Agenten (Claude, GPT-4o, Gemini) lösen ~40–55 % der Aufgaben. Ein häufiger Ausfallmodus: Der Agent hat nicht genug Codebase-Kontext, um das Problem vollständig zu verstehen. Capsule adressiert das direkt — mehr Codebasis passt in den Kontext.

**C — Capsule interne Benchmarks** *(Produktionspipeline, 5 Dateitypen, 6 Größenkategorien)*:

**Wie viel kleiner macht Capsule deinen Code?**
*(TypeScript, YAML, SQL, HTML, Markdown — echte Produktionszahlen)*

```
Dateigröße     Rohe Tokens   Nach Capsule     Einsparung
─────────────────────────────────────────────────────────
~1KB  (klein)     300 Tok  ████░░░░░░  55 Tok   -83%
~5KB  (mittel)    850 Tok  ██░░░░░░░░  45 Tok   -95%
~18KB (groß)    2.500 Tok  █░░░░░░░░░  35 Tok   -98,5%
~50KB (XL)      7.000 Tok  ░░░░░░░░░░  40 Tok   -99,4%
~100KB (XXL)   18.000 Tok  ░░░░░░░░░░  25 Tok   -99,9%
─────────────────────────────────────────────────────────
Durchschnitt über alle Größen:    -74%  →  3,9× Kontextgewinn
```

> **Ehrlicher Vorbehalt:** Sehr kleine Dateien unter ~200 Tokens werden mit Capsule *größer* — der Format-Overhead überwiegt. Capsule aktiviert sich automatisch nur, wenn Kompression sinnvoll ist. In echten Codebasen sind 95 %+ der Dateien mittelgroß bis groß.

**Was 3,9× Kontextgewinn in einem 128k-Fenster bedeutet:**

```
Ohne Mesh   ████████████████████  ~20 mittlere Dateien
Mit Mesh    ████████████████████████████████████████████████████████████████████████████  ~78 mittlere Dateien
```

**Die Kostenrechnung (Claude Opus 4.6 — $15/MTok Input):**

| | Gesendete Tokens | API-Kosten | Codebase-Abdeckung |
|---|---|---|---|
| Roher Code | 1.000.000 | ~$15,00 | ~100 mittlere Dateien |
| Capsule | 260.000 | **~$3,90** | Dieselben 100 Dateien |

**74 % Kostenreduktion pro Query. Kein Qualitätsverlust. Dieselben Dateien, dasselbe Modell, 4× günstiger.**

**Nachhaltigkeitseffekt:**

Bei 10.000 aktiven Nutzern, 50 Queries/Tag, durchschnittlich 50k Token Kontext pro Query:
- Ohne Mesh: **25 Milliarden Tokens/Tag** verarbeitet
- Mit Mesh: **~6,5 Milliarden Tokens/Tag**
- **~18,5 Milliarden weniger Tokens täglich** — proportional weniger Rechenleistung, Strom und Kühlwasser

> *Mesh ist nicht nur günstiger für Entwickler. Es ist günstiger für den Planeten.*

---

## Folie 5 — Produkt

### Gebaut für die Art, wie Entwickler wirklich denken.

**Drei Oberflächen, ein Flow:**

**Editor**
Monaco-basierter Editor mit KI-Chat-Panel, Datei-Explorer, Live-Dependency-Graph und Workspace-Intelligence-Sidebar. Die KI kennt deine gesamte Codebasis, bevor du fragst — komprimiert, indexiert, immer aktuell.

**Terminal**
Dedizierter Terminal-Workspace — kein unteres Panel, eine vollständige Oberfläche. Läuft neben dem Editor ohne Kontextverlust.

**Voice-Coding**
Sprachgesteuerter Agent. Sage *»Refactore die Auth-Middleware auf JWT«* — Mesh liest die relevanten Dateien via Capsule, generiert die Änderung und erklärt sie. Kein Tippen erforderlich.

**Was es einzigartig macht:**
- Capsule-Kompressionspipeline — 74 % weniger Tokens, gleiche Intelligenz
- Dependency Graph, der sich live bei Codeänderungen aktualisiert
- Persistentes Workspace-Memory über Sessions hinweg
- Multi-Modell: funktioniert mit Claude Opus/Sonnet, Gemini und anderen — kein Provider-Lock-in

---

## Folie 6 — Markt

### Jeder Entwickler ist ein potenzieller Nutzer. Wir starten mit denen, die die Kosten am stärksten spüren.

**TAM:** Globaler Entwicklertools-Markt — **$28 Mrd.** (2024), 12 % CAGR

**SAM:** KI-gestütztes IDE / Coding-Assistant-Segment — **$4,2 Mrd.** (2025 est.)

**SOM (3-Jahres-Ziel):** Indie-Entwickler + kleine Teams in Europa und Nordamerika — **~$120 Mio.**

**Warum jetzt:**
- LLMs haben die Schwelle überschritten, ab der Voice-to-Code wirklich nutzbar ist
- Cursor hat bewiesen, dass Entwickler für KI-native Editoren zahlen (~$400 Mio. ARR in 2 Jahren)
- API-Kosten sind jetzt ein echter Budgetposten für Dev-Teams — Kompression hat ROI
- Green-Tech-Druck: Unternehmen tracken KI-Energieverbrauch zunehmend

---

## Folie 7 — Traction

### Frühphase — echtes Fundament.

- **MVP fertig** — Editor, Terminal, Voice-Coding-Oberflächen vollständig funktionsfähig
- **Capsule-Pipeline live** — gemessen bei 74 % durchschnittlicher Token-Reduktion über alle Dateitypen
- **Architektur skalierbar** — Gateway/Worker-Split, Multi-Provider-KI-Unterstützung
- **Aktive Entwicklung** — 8 abgeschlossene Phasen mit verifizierten Abschlüssen

**Nächster Meilenstein:** Erste 100 Beta-Nutzer → Retention, Voice-Feature-Engagement und reale Token-Einsparungen messen

---

## Folie 8 — Business-Modell

### Freemium → Pro → Teams

**Free-Tier**
- Vollständiger Editor + Terminal
- KI-Chat (begrenzte Requests/Monat)
- Basis-Workspace-Indexierung

**Pro — €19/Monat**
- Unbegrenzte KI-Requests
- Vollständige Capsule-Kompression (große Codebasis-Unterstützung)
- Voice-Coding-Agent
- Priority Model Access

**Teams — €49/Seat/Monat**
- Alles in Pro
- Geteilte Workspace-Intelligenz
- Team-weiter Codebase-Kontext
- Admin-Controls + Usage-Analytics

**Warum das funktioniert:**
Cursor berechnet $20/Monat und hat $400 Mio. ARR erreicht. Entwickler zahlen für Tools, die Zeit sparen. Mesh spart Zeit *und* Geld bei API-Kosten — doppeltes Wertversprechen.

---

## Folie 9 — Wettbewerb

### Wir sind keine Extension. Wir sind die Umgebung.

Der echte Wettbewerb ist dort, wo Entwickler bereits leben.

| | Mesh | VS Code + Copilot | Cursor | Google Antigravity |
|---|---|---|---|---|
| Voice-Driven Coding Agent | ✅ | ❌ | Nur STT² | ❌ |
| Strukturelle Token-Kompression | ✅ | ❌ | ❌ | ❌ |
| Vollständiger Codebase-KI-Kontext | ✅ | Teilweise¹ | Teilweise¹ | Teilweise¹ |
| Web-App verfügbar | ✅ | Teilweise³ | ❌ | ❌ |
| KI-nativ von Grund auf | ✅ | ❌ (nachgerüstet) | ✅ | ✅ |
| Multi-Modell | ✅ | ✅ | ✅ | ✅ |
| Agent-Orchestrierung | ✅ | ✅ (Copilot Agents) | ✅ | ✅ (Multi-Agent) |

*¹ Embedding-basiertes Retrieval — findet relevante Dateien, sendet rohe Tokens ans Modell*
*² Cursor hat Speech-to-Text-Input (in Chat-Box diktieren) — kein sprachgesteuerter Coding-Agent*
*³ VS Code for the Web (vscode.dev) existiert, aber: kein Terminal, kein Debugger, eingeschränkte Extensions*

**VS Code + Copilot** — 75,9 % der Entwickler (Stack Overflow 2025). Copilot hat sich stark weiterentwickelt: Multi-Modell (Claude Opus 4.6, GPT-5 mini, Gemini), echte Agents, MCP-Integration, Enterprise-Codebase-Indexierung. Wirklich leistungsfähig — aber immer noch eine 2015er-Editor-Architektur mit nachgerüsteter KI. Keine Kompression, kein Voice-Agent.

**Cursor** — Bester dedizierter KI-Editor (Fortune-500-Adoption). VS-Code-Fork, Multi-Modell, starke Agent-Story. Hat Speech-to-Text-Input (`Ctrl+M`), aber das ist Diktieren-in-Chat, kein Voice-Coding-Agent. Embedding-basiertes `@codebase`-Retrieval. Nur Desktop, keine strukturelle Kompression.

**Google Antigravity** *(veröffentlicht November 2025, kostenlose Preview)* — VS-Code-Fork mit Multi-Agent-Manager-Ansicht. Unterstützt Gemini, Claude, GPT. Nur Desktop, kein Voice-Agent, keine Kompression.

**Der entscheidende Unterschied:** Alle drei nutzen Embeddings zum *Abrufen* von Code und senden ihn dann roh. Token-Kosten skalieren mit der Codebase-Größe. Capsule *komprimiert strukturell*, bevor das Modell irgendetwas sieht — Kosten bleiben flach, unabhängig von der Codebase-Größe.

**Wo Mesh einzigartig gewinnt:** Die einzige Umgebung, in der du deine Absicht sprichst *und* das Modell deine gesamte Codebasis zu einem Bruchteil der Kosten sieht.

---

## Folie 10 — Team

### Gebaut von Entwicklern, für Entwickler.

**Edgar Baumann — Co-Founder**
- Hat Mesh von Grund auf gebaut
- Student, WU Wien
- Fasziniert von der Lücke zwischen wie Entwickler denken und wie Tools sie arbeiten lassen

**Philipp Horn — Co-Founder**
- Student, WHU
- Starkes unternehmerisches Gespür — Business-Strategie, GTM und Wachstum

**Warum wir gewinnen werden:**
Mesh entstand aus echtem Schmerz, nicht aus einer Marktanalyse. Das Team hat das Tool gebaut, das es brauchte und das nicht existierte.

---

## Folie 11 — Vision

### In 5 Jahren wird das Senden von rohem Code an eine KI so verschwenderisch wirken wie das Drucken von E-Mails.

**12 Monate:** 1.000 zahlende Pro-Nutzer, Capsule-Kompression als Branchen-Referenz-Benchmark, erste Team-Accounts

**24 Monate:** 10.000 Nutzer, Mesh als Standard für token-effizientes KI-Coding, Series A, offenes Capsule-SDK für Drittanbieter-Integrationen

**5 Jahre:** Die Standard-Umgebung für Entwickler, die schneller denken als tippen — und eine Kompressionsinfrastruktur-Schicht, die andere KI-Tools antreibt

---

## Folie 12 — Die Forderung

### Seed-Runde: €500.000

**Mittelverwendung:**
| Bereich | % | Zweck |
|---|---|---|
| Engineering | 55 % | 2 Senior-Engineers — Voice-Pipeline + Capsule v2 |
| Growth | 25 % | Developer-Marketing, Open-Source-Präsenz, Content |
| Infrastruktur | 15 % | Cloud-Kosten für KI-Inferenz im Maßstab |
| Operations | 5 % | Legal, Tools, Büro |

**Was wir über Kapital hinaus brauchen:**
- Zugang zu Entwickler-Communities (ProductHunt, Hacker News, Dev-Discord-Ökosysteme)
- Go-to-Market-Mentorship — B2C SaaS für Entwickler
- Verbindungen zu nachhaltigkeitsfokussierten Investoren (Green-AI-Winkel)
- Verbindungen zu Series-A-Investoren

**Runway:** 18 Monate bis zum Product-Market-Fit-Signal

---

## Folie 13 — Warum jetzt. Warum wir.

### Vier Dinge sind zusammengekommen, die noch nie zusammengekommen sind:

1. **Token-Kosten sind jetzt ein Budgetposten** — Teams spüren den API-Kostenschmerz bei jedem komplexen Query
2. **Kontextqualität beeinflusst Ausgabequalität direkt** — NIAH und SWE-bench machen das messbar
3. **Kein Tool komprimiert auf Infrastrukturebene** — Retrieval (Embeddings) ist der Branchenstandard, aber es reduziert nicht, was das Modell erreicht
4. **Green AI entsteht** als Beschaffungskriterium — 74 % weniger Tokens bedeutet proportional weniger Rechenleistung und Energie

Mesh ist das einzige Tool, das **Kompression als Infrastruktur** behandelt — nicht als Feature, nicht als Nachgedanke, sondern als die zentrale Architekturschicht, auf der jede KI-Interaktion aufbaut.

**Wir bauen kein Plugin. Wir bauen die Effizienzschicht, die jede KI-Entwicklungsumgebung braucht — und eine Workbench darüber.**

---

*edgar.baumann@try-mesh.com · philipp.horn@try-mesh.com · Demo auf Anfrage verfügbar*
