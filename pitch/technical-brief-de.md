# Mesh — Technisches Briefing: Capsule Compression Engine

**Strukturelle Quellcode-Kompression für LLM-Kontexteffizienz.**

---

## Das Kernproblem: Kontextauslastung und Modellgenauigkeit

Large Language Models arbeiten mit einem fixen Kontextfenster. Je höher die Kontextauslastung, desto stärker degradiert die Abrufgenauigkeit — das ist keine Hypothese, sondern ein gemessenes Phänomen, das in mehreren unabhängigen Benchmarks dokumentiert ist.

### NIAH — Needle In A Haystack

Standard-Retrieval-Benchmark: Eine bestimmte Information wird an verschiedenen Positionen in einem langen Dokument platziert; das Modell muss sie abrufen. Veröffentlichte Forschung (Liu et al., 2023, *»Lost in the Middle«*) zeigt:

- Modelle performen zuverlässig, wenn die Kontextauslastung unter ~60–70 % liegt
- Oberhalb dieser Schwelle sinkt die Abrufgenauigkeit um 20–40 %, abhängig davon, wo im Kontext die Zielinformation steht
- Der Effekt verstärkt sich bei 100k+-Token-Kontexten

**Implikation:** Eine große Codebasis in den Kontext zu laden garantiert nicht, dass das Modell sie korrekt nutzt. Je mehr Kontext geladen wird, desto stärker degradiert das effektive Verständnis des Modells.

### SWE-bench

Branchen-Benchmark für KI-Coding-Agenten, die echte GitHub-Issues lösen. Top-Modelle (Claude Opus 4.6, GPT-4o, Gemini 3.1 Pro) lösen ca. 40–55 % der Aufgaben. Root-Cause-Analysen der Fehler identifizieren konsistent ein führendes Muster: **Der Agent hatte nicht genug Codebase-Kontext, um das Problem vollständig zu verstehen.**

Der von aktuellen Tools verfolgte Ansatz — Embedding-basiertes Retrieval — findet *relevante* Dateien und sendet sie roh. Das löst das Problem nicht: Es wählt aus, was geladen wird, aber was geladen wird, verbraucht weiterhin das volle Token-Budget in rohem Format. Je größer die Codebasis, desto geringer die Abdeckung pro Kontextfenster.

---

## Capsule: Strukturelle Kompression mit selektiver Wiederherstellung

Capsule ist Mesh's proprietäre Kompressionspipeline. Sie verarbeitet Quelldateien **bevor** sie ein LLM erreichen.

### Funktionsweise

Capsule wendet sprachbewusste strukturelle Kompression auf Quelldateien an:

1. **Parse** — Die Datei wird in ihre strukturellen Komponenten zerlegt (Deklarationen, Signaturen, Typ-Annotationen, Doc-Comments, Control-Flow-Marker)
2. **Komprimieren** — Implementierungsbodies und nicht-struktureller Inhalt werden auf minimale strukturelle Repräsentationen reduziert
3. **Enkodieren** — Das Ergebnis ist ein kompakter struktureller Deskriptor, der das semantische Skelett der Datei bewahrt
4. **Selektive Wiederherstellung** — Wenn das Modell eine bestimmte Funktion oder einen Abschnitt als relevant identifiziert, kann die vollständige Implementierung auf Anfrage wiederhergestellt werden

Das ist keine Zusammenfassung. Die komprimierte Repräsentation ist deterministisch und auf Strukturebene verlustfrei. Die Originaldatei ist jederzeit vollständig wiederherstellbar.

### Aktivierungslogik

Capsule aktiviert sich dynamisch basierend auf Dateigröße und Token-Anzahl. Für sehr kleine Dateien (unter ~200 Tokens) überwiegt der Format-Overhead die Einsparungen — Capsule überspringt sie. In der Praxis bestehen Produktions-Codebasen zu 95 %+ aus mittelgroßen bis großen Dateien, bei denen Kompression effektiv ist.

---

## Benchmark-Ergebnisse

Interne Benchmarks laufen gegen die Produktions-Capsule-Pipeline über 5 Dateitypen (TypeScript, YAML, SQL, HTML, Markdown) und 6 Größenkategorien.

### Token-Reduktion nach Dateigröße

```
Dateigröße       Rohe Tokens   Capsule-Tokens    Reduktion
──────────────────────────────────────────────────────────
~200B  (xs)         ~50 Tok        ~55 Tok        +10%  ← Overhead, wird übersprungen
~1KB   (klein)     ~300 Tok        ~55 Tok        -83%
~5KB   (mittel)    ~850 Tok        ~45 Tok        -95%
~18KB  (groß)    ~2.500 Tok        ~35 Tok        -98,5%
~50KB  (xl)      ~7.000 Tok        ~40 Tok        -99,4%
~100KB (xxl)    ~18.000 Tok        ~25 Tok        -99,9%
──────────────────────────────────────────────────────────
Durchschnitt (mittel–xxl):   -74%  →  3,9× Kontextgewinn
```

### Was 3,9× Kontextgewinn in einem 128k-Fenster bedeutet

```
Ohne Mesh    ████████████████████                              ~20 mittlere Dateien
Mit Mesh     ████████████████████████████████████████████████████████████████████████████  ~78 mittlere Dateien
```

Das Modell hat in einem einzigen Query Zugang zu 3,9× mehr der Codebasis — ohne die Kontextfenstergröße zu erhöhen oder zu einem teureren Modell zu wechseln.

---

## Kostenanalyse

Mit Claude Opus 4.6 ($15,00 / MTok Input) — das Modell, das Entwickler für komplexe Multi-File-Reasoning-Aufgaben nutzen.

| Szenario | Gesendete Tokens | API-Kosten | Abgedeckte Dateien |
|---|---|---|---|
| Roher Code | 1.000.000 | $15,00 | ~100 mittlere Dateien |
| Capsule-komprimiert | 260.000 | **$3,90** | Dieselben 100 Dateien |

**74 % Kostenreduktion pro Query. Kein Qualitätsverlust. Dieselben Dateien, dasselbe Modell, 4× günstiger.**

Im Maßstab (10.000 aktive Nutzer, 50 Queries/Tag, durchschnittlich 50k Token Kontext):

| Metrik | Ohne Mesh | Mit Mesh |
|---|---|---|
| Tokens verarbeitet / Tag | 25.000.000.000 | ~6.500.000.000 |
| Reduktion | — | **-74 %** |
| API-Kosten/Tag (bei $15/MTok) | $375.000 | ~$97.500 |

---

## Vergleich der Architekturansätze im Wettbewerb

Alle großen KI-Coding-Tools nutzen **Embedding-basiertes Retrieval**: Semantische Suche über eine indexierte Codebasis liefert die relevantesten Dateien zurück, die dann **roh** an das Modell gesendet werden.

| Eigenschaft | Embedding-Retrieval | Capsule-Kompression |
|---|---|---|
| Was das Modell erreicht | Roher Dateiinhalt (volle Token-Kosten) | Komprimierter struktureller Deskriptor |
| Token-Kosten | Skalieren mit Dateianzahl × Dateigröße | Fixer niedriger Preis unabhängig von Dateigröße |
| Kontextabdeckung | Limitiert auf was roh passt | 3,9× mehr Dateien pro Fenster |
| Implementierungsbodies | Vollständig gesendet | Komprimiert, auf Anfrage wiederherstellbar |
| Verhalten bei kleinen Dateien | Keine Änderung | Pass-through (Overhead-Skip) |
| Sensitivität zur Codebase-Größe | Hoch | Niedrig |

**Der architektonische Unterschied:** Retrieval wählt *welche* Dateien einbezogen werden. Kompression reduziert *wieviel* jede Datei kostet. Capsule operiert nach dem Retrieval — alle ausgewählten Dateien werden komprimiert, bevor sie das Modell erreichen. Die beiden Ansätze schließen sich nicht gegenseitig aus; Capsule ist additiv auf jede Retrieval-Strategie.

---

## Modell-Kompatibilität

Capsule ist modell-agnostisch. Der komprimierte Output ist Klartext in einem strukturierten Format, das von jedem transformer-basierten LLM lesbar ist. Mesh unterstützt derzeit:

- Anthropic: Claude Opus 4.6, Claude Sonnet (alle Versionen)
- Google: Gemini 3.1 Pro, Gemini Flash
- OpenAI: GPT-4o, GPT-4o mini, o1, o3

Provider-Wechsel ist zur Laufzeit konfigurierbar — kein Re-Indexing oder Pipeline-Änderungen erforderlich.

---

## Architekturübersicht

```
User-Query
    │
    ▼
Workspace-Indexer          ← scannt offenes Projekt, baut Datei-Registry
    │
    ▼
Capsule-Kompression        ← strukturelle Kompression pro Datei
    │
    ▼
Context-Assembler          ← packt komprimierte Dateien ins Kontextfenster
    │
    ▼
Model-Provider (API)       ← Claude / Gemini / GPT
    │
    ▼
Selektive Wiederherstellung ← stellt vollständige Bodies auf Modellanfrage wieder her
    │
    ▼
Response + Diff-Output
```

Der Gateway/Worker-Split bedeutet, dass Kompression im Worker-Prozess läuft — horizontal skalierbar, unabhängig von der UI-Schicht.

---

## Dateityp-Unterstützung

| Sprache / Format | Bewahrte strukturelle Elemente |
|---|---|
| TypeScript / JavaScript | Exports, Klassen-Deklarationen, Funktionssignaturen, Typ-Definitionen, Interfaces |
| Python | Module-level-Deklarationen, Klassen-/Funktionssignaturen, Docstrings |
| YAML / JSON | Top-Level-Keys, Schema-Struktur |
| SQL | Tabellen-/View-/Funktionsdefinitionen, Spaltennamen und -typen |
| HTML | Dokumentstruktur, Komponentengrenzen |
| Markdown | Überschriftenhierarchie, Code-Block-Präsenz |

Unterstützung für Go, Rust, Java und C# ist für Capsule v2 auf der Roadmap.

---

*edgar.baumann@try-mesh.com · philipp.horn@try-mesh.com · Technische Demo auf Anfrage verfügbar*
