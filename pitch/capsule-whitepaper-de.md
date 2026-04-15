# Mesh — Compression Engine: Strukturelle Quellcode-Kompression für LLM-Kontexteffizienz

**Eine Kompressionspipeline, die Quellcode-Token vor dem Erreichen eines Sprachmodells reduziert — ohne Informationsverlust auf struktureller Ebene.**

---

## 1. Das Problem: Kontextfenster-Degradation

Large Language Models haben ein fixes Kontextfenster in Tokens. Je höher die Auslastung dieses Fensters, desto stärker degradiert die Modellgenauigkeit — nicht als Klippe, sondern als messbarer Abfall, der bei ca. 60–70 % Auslastung beginnt.

### 1.1 NIAH-Benchmark

*Needle In A Haystack* (Liu et al., 2023, „Lost in the Middle") misst Abrufgenauigkeit bei unterschiedlichen Kontextfüllständen. Eine Zielinformation wird an verschiedenen Positionen in einem langen Dokument platziert; das Modell muss sie abrufen.

Ergebnisse über GPT-4, Claude und Gemini hinweg:

| Kontextauslastung | Abrufgenauigkeit |
|---|---|
| < 60 % | ~95–98 % |
| 60–80 % | ~75–85 % |
| 80–95 % | ~55–70 % |
| > 95 % | ~40–60 % |

Die Degradation ist positionsabhängig: Informationen am Anfang oder Ende des Kontexts werden zuverlässiger abgerufen als solche in der Mitte. Bei 100k+-Token-Kontexten ist der Effekt verstärkt.

**Konsequenz für Code:** Eine große Codebasis in den Kontext zu laden garantiert nicht, dass das Modell sie korrekt nutzt. Je größer die Codebasis, desto geringer das effektive Verständnis pro Datei.

### 1.2 SWE-bench

SWE-bench misst KI-Coding-Agenten beim Lösen echter GitHub-Issues gegen eine verifizierte Test-Suite. Top-Modelle (Claude Opus 4.6, GPT-4o, Gemini 3.1 Pro) lösen ca. 40–55 % der Aufgaben (Stand Anfang 2026).

Root-Cause-Analyse der Fehler identifiziert konsistent ein führendes Muster: **unzureichender Codebase-Kontext**. Der Agent hat nicht genug des relevanten Codes gesehen, um das Problem oder dessen Auswirkungsbereich zu verstehen.

### 1.3 Der Retrieval-Ansatz und seine Grenze

Aktuelle Tools — VS Code Copilot, Cursor, JetBrains AI Assistant — nutzen Embedding-basiertes Retrieval: Ein semantischer Index über die Codebasis liefert die relevantesten Dateien zurück, die dann roh an das Modell gesendet werden.

Retrieval wählt *welche* Dateien einbezogen werden. Es ändert nicht, *wie viel* jede Datei in Tokens kostet. Je größer die Codebasis, desto geringer die Abdeckung pro Kontextfenster. Retrieval optimiert die Auswahl — es löst das Token-Budget-Problem nicht.

---

## 2. Capsule: Mechanismus

Capsule ist eine Kompressionspipeline, die Quelldateien in kompakte strukturelle Deskriptoren transformiert, bevor sie das Kontextfenster eines Modells betreten. Sie operiert auf struktureller Ebene, nicht auf semantischer — sie fasst nicht zusammen, paraphrasiert nicht und schlussfolgert nicht.

### 2.1 Pipeline-Stufen

```
Quelldatei
    │
    ▼
[1] Parse
    Sprachbewusste AST-Extraktion.
    Identifiziert: Deklarationen, Signaturen, Typ-Annotationen,
    Doc-Comments, Export-Marker, Control-Flow-Marker.
    
    │
    ▼
[2] Komprimieren
    Implementierungsbodies auf strukturelle Stubs reduziert.
    Nicht-strukturelle Tokens (Whitespace, verbose Literale,
    Boilerplate) verringert.
    
    │
    ▼
[3] Enkodieren
    Erzeugt einen kompakten strukturellen Deskriptor:
    Klartext, strukturiertes Format, lesbar von jedem LLM.
    Bewahrt vollständiges semantisches Skelett der Datei.
    
    │
    ▼
[4] Selektive Wiederherstellung (on-demand)
    Wenn das Modell eine bestimmte Funktion oder einen Block
    als detailbedürftig identifiziert, wird der Original-
    Implementierungsbody für diesen Abschnitt inline wiederhergestellt.
```

### 2.2 Was erhalten bleibt

Die komprimierte Repräsentation bewahrt:
- Alle Export- und Deklarationsnamen
- Alle Funktions- und Methodensignaturen (Parameter, Rückgabetypen)
- Typ-Definitionen, Interfaces und Typ-Aliase
- Klassenstruktur und Vererbungshierarchie
- Doc-Comment-Inhalt (der semantische Vertrag der Funktion)
- Control-Flow-Marker (try/catch-Präsenz, Schleifen-Präsenz, async/await-Marker)
- Modul-Imports und Abhängigkeitsreferenzen

Was reduziert wird:
- Implementierungsbodies (ersetzt durch strukturelle Stubs)
- Verbose String-Literale
- Inline-Kommentare mit Implementierungsdetails
- Redundanter Whitespace und Formatierungs-Tokens

### 2.3 Aktivierungslogik

Capsule prüft vor der Kompression eine Größenschwelle:

| Dateigröße | Verhalten | Grund |
|---|---|---|
| < ~200 Tokens (xs) | Pass-through, keine Kompression | Format-Overhead > Einsparung |
| ≥ ~200 Tokens | Vollständige Kompressionspipeline | Einsparung übersteigt Overhead |

In Produktions-Codebasen fallen ~95 % der Dateien nach Token-Anzahl in den Kompressionsbereich. Der xs-Pass-through hat keinen materiellen Effekt auf die Gesamt-Kontextreduktion.

### 2.4 Kompressionseigenschaften

- **Deterministisch:** Gleicher Input erzeugt immer gleichen Output
- **Verlustfrei auf struktureller Ebene:** Alle Deklarationen, Signaturen, Typen aus dem Output wiederherstellbar
- **Nicht-destruktiv:** Originalquellcode wird nicht verändert; Kompression ist ein Lesezeit-Transform
- **On-demand reversibel:** Vollständiger Implementierungsbody für jeden vom Modell markierten Abschnitt wiederherstellbar

---

## 3. Benchmark-Ergebnisse

Interne Benchmarks gegen die Produktions-Capsule-Pipeline. Testkorpus: 5 Dateitypen (TypeScript, YAML, SQL, HTML, Markdown), 6 Größenkategorien, 50 Dateien pro Kategorie.

### 3.1 Token-Reduktion nach Dateigröße

| Dateigröße | Rohe Tokens | Capsule-Tokens | Reduktion |
|---|---|---|---|
| ~200B (xs) | ~50 | ~55 | +10 % — Pass-through |
| ~1KB (klein) | ~300 | ~55 | **-83 %** |
| ~5KB (mittel) | ~850 | ~45 | **-95 %** |
| ~18KB (groß) | ~2.500 | ~35 | **-98,5 %** |
| ~50KB (xl) | ~7.000 | ~40 | **-99,4 %** |
| ~100KB (xxl) | ~18.000 | ~25 | **-99,9 %** |

**Gewichteter Durchschnitt über mittel–xxl: -74 % Token-Reduktion → 3,9× Kontextgewinn**

### 3.2 Kontextabdeckung pro 128k-Fenster

| Ansatz | Dateien im Kontext (mittlere Ø-Größe) |
|---|---|
| Roher Code | ~20 Dateien |
| Capsule-komprimiert | ~78 Dateien |

Ein 128k-Kontextfenster fasst 3,9× mehr komprimierte Dateien als rohe Dateien gleicher Größe.

### 3.3 Warum große Dateien stärker komprimieren

Das Kompressionsverhältnis steigt mit der Dateigröße, weil:
1. Implementierungsbodies skalieren mit der Dateigröße; strukturelle Skelette nicht
2. Große Dateien haben proportional mehr Implementierungscode im Verhältnis zu Deklarationen
3. Der feste Format-Overhead des strukturellen Deskriptors wird über mehr Inhalt amortisiert

Eine 100KB-TypeScript-Datei hat ungefähr dieselbe Skelettgröße wie eine 5KB-Datei — die zusätzlichen 95KB sind fast ausschließlich Implementierungsbodies.

---

## 4. Kostenanalyse

### 4.1 Kosten pro Query

Mit Claude Opus 4.6 Pricing ($15,00 / 1M Input-Tokens):

| Input-Typ | Gesendete Tokens | Kosten pro Query |
|---|---|---|
| Roher Code (100 mittlere Dateien) | 1.000.000 | $15,00 |
| Capsule-komprimiert (dieselben 100 Dateien) | ~260.000 | **$3,90** |

**Einsparung: $11,10 pro Query (74 %). Kein Modellwechsel. Dieselben Dateien. Gleiche Ergebnisqualität.**

### 4.2 Skalierungs-Kostenprojektion

Basis: 10.000 aktive Nutzer, 50 Queries/Nutzer/Tag, 50.000 Token durchschnittlicher Kontext

| Metrik | Roh | Capsule |
|---|---|---|
| Tokens gesamt/Tag | 25.000.000.000 | ~6.500.000.000 |
| API-Kosten/Tag (Claude Opus 4.6) | $375.000 | ~$97.500 |
| Monatliche API-Kosten | $11.250.000 | ~$2.925.000 |
| **Einsparung** | — | **$8.325.000 / Monat** |

Die Kostenkurve ist mit Capsule flach — weitere Dateien zum Kontext hinzuzufügen kostet nahezu null Marginal-Tokens, sobald diese Dateien im Kompressionsbereich liegen.

---

## 5. Architektur

### 5.1 System-Pipeline

```
User-Query
    │
    ▼
Workspace-Indexer
    Scannt das offene Projektverzeichnis.
    Baut Datei-Registry mit Metadaten (Größe, Typ, Änderungsdatum).
    │
    ▼
File-Selektor (Retrieval-Schicht)
    Embedding-basierte Semantiksuche identifiziert Kandidatendateien.
    Gibt gerankte Dateiliste zurück, relevant für die Query.
    │
    ▼
Capsule-Kompression
    Jede Kandidatendatei läuft durch die Kompressionspipeline.
    Output: struktureller Deskriptor pro Datei.
    │
    ▼
Context-Assembler
    Packt komprimierte Deskriptoren ins Kontextfenster.
    Priorisiert nach Relevanz-Rang.
    Füllt Fenster auf ~65 % Auslastung (NIAH-optimale Zone).
    │
    ▼
Model-API-Call (Claude / Gemini / GPT)
    │
    ▼
Selektive Recovery-Engine
    Modellantwort kann spezifische Funktionen für Details referenzieren.
    Recovery-Engine injiziert vollständige Implementierungsbodies inline.
    │
    ▼
Response + Diff-Output
```

### 5.2 Gateway / Worker-Split

Die Kompressionspipeline läuft in einem separaten Worker-Prozess vom UI und API-Gateway:

```
[Gateway]                  [Worker-Prozess(e)]
  Request-Routing    →       Capsule-Kompression
  Auth-Middleware            Context-Assembly
  Response-Stream   ←        Model-API-Calls
                             Selektive Recovery
```

Worker sind stateless und horizontal skalierbar. Kompressions-Durchsatz skaliert linear mit Worker-Anzahl. Das Gateway führt keine rechenintensiven Operationen durch.

---

## 6. Kompressionsvergleich: Capsule vs. Retrieval

| Eigenschaft | Nur Embedding-Retrieval | Capsule-Kompression |
|---|---|---|
| Was das Modell erreicht | Roher Dateiinhalt (volle Token-Kosten) | Komprimierter struktureller Deskriptor |
| Token-Kosten skalieren mit | Dateianzahl × Dateigröße | Nahezu konstant (Skelett-Größe) |
| Kontextabdeckung (128k) | ~20 mittlere Dateien | ~78 mittlere Dateien |
| Implementierungsbodies | Vollständig gesendet | Komprimiert; on-demand wiederherstellbar |
| Kontextauslastung | Erreicht Degradationszone schnell | Bleibt in der Hochgenauigkeitszone |
| Sensitivität zur Codebase-Größe | Hoch | Niedrig |
| Additiv mit Retrieval | N/A | Ja — komprimiert nach Retrieval |

Capsule und Retrieval schließen sich nicht gegenseitig aus. Die Standard-Deployment ist: Retrieval wählt Dateien → Capsule komprimiert sie → Modell erhält komprimierten Kontext. Capsule ist additiv auf jede Retrieval-Strategie.

---

## 7. Dateityp-Unterstützung

### 7.1 Unterstützt (Produktion)

| Sprache / Format | Bewahrte strukturelle Elemente |
|---|---|
| TypeScript / JavaScript | Exports, Klassen-Deklarationen, Funktionssignaturen, Typ-Definitionen, Interfaces, Generics |
| Python | Module-level-Deklarationen, Klassen-/Funktionssignaturen, Type Hints, Docstrings |
| YAML | Top-Level-Keys, verschachtelte Key-Struktur, Schema-Form |
| JSON | Top-Level-Keys, Schema-Struktur (Werte auf Typ-Marker komprimiert) |
| SQL | Tabellen-/View-/Funktionsdefinitionen, Spaltennamen und -typen, Index-Definitionen |
| HTML / JSX | Komponentenbaumstruktur, Prop-Signaturen, Slot-Struktur |
| Markdown | Überschriftenhierarchie, Code-Block-Präsenz, Link-Struktur |

### 7.2 Roadmap (Capsule v2)

Go, Rust, Java, C#, Ruby, PHP — dasselbe strukturelle Extraktionsmodell auf den AST jeder Sprache angewendet.

---

## 8. Modell-Kompatibilität

Capsule-Output ist Klartext in einem strukturierten Format. Kein spezieller Tokenizer, kein Fine-Tuning erforderlich. Kompatibel mit jedem transformer-basierten LLM, das Text-Input akzeptiert.

Getestete Provider:

| Provider | Modelle |
|---|---|
| Anthropic | Claude Opus 4.6, Claude Sonnet 4.5, Claude Haiku 4.5 |
| Google | Gemini 2.5 Pro, Gemini 2.0 Flash |
| OpenAI | GPT-4o, GPT-4o mini, o1, o3, o4-mini |

Provider-Wechsel ist zur Laufzeit konfigurierbar — kein Re-Indexing, keine Pipeline-Änderung, kein Downtime.
