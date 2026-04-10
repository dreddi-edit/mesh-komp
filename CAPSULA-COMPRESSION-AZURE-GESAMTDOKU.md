# Mesh Capsula Compression + Azure Integration (Vollstaendige Analyse)

Stand: 2026-04-07

Diese Datei fasst die komplette Capsula/Compression-Logik und die vollstaendige Azure-Anbindung in Mesh zusammen.
Die Analyse basiert auf dem aktuellen Code in Gateway, Worker, Compression-Core, Function-Fanout, Frontend und Tests.

---

## 1) Scope der Analyse

Gepruefte Kernquellen:

- `server.js` (Gateway)
- `mesh-core/src/server.js` (Worker)
- `mesh-core/src/compression-core.cjs` (Capsula/Transport/Recovery Core)
- `mesh-core/src/tree-sitter-worker.cjs` (Code-Capsule Parsing Worker)
- `mesh-core/src/MeshServer.js` (Mesh-Tunnel Compression)
- `workspace-metadata-store.cjs` (Cosmos Persistenz)
- `workspace-upload-utils.cjs` (Blob-Pfadschema)
- `mesh-functions/src/functions/blob-capsule-indexer.js` (Event Grid Trigger)
- `mesh-functions/src/shared/blob-capsule-processor.cjs` (Blob -> Capsula -> Cosmos Pipeline)
- `app.html` (Browser Upload/Offload/Open-File Pfade)
- `assets/mesh-client.js` (Browser-seitige Brotli Compression)
- `llm-compress.js` (Legacy/heuristische LLM-Kompression)
- `test/compression-core.test.js`, `test/assistant-integration.test.js`, `test/compression-benchmark.test.js`, `benchmarks/compression-benchmark.js`
- `AZURE-ARCHITECTURE.md` (Live-Ressourcen und Deploy-Architektur)

---

## 2) Architektur-Ueberblick (Compression + Azure)

### 2.1 Laufzeitkomponenten

- Gateway (`server.js`)
  - Public API unter `/api/assistant/...`
  - Auth, UI, Fallback
  - Offload-Config fuer Browser
  - Tunnel zum Worker via komprimiertem Envelope (`meshTunnelRequest`)

- Worker (`mesh-core/src/server.js`)
  - Workspace-Koordination
  - Local-Path Modus und Upload-Workspace Modus
  - Build/Read/Recover von Workspace Records (Capsula/Transport)
  - Blob lesen/schreiben/kopieren/loeschen
  - Cosmos-basierte Workspace-Dateiabfragen

- Compression-Core (`mesh-core/src/compression-core.cjs`)
  - Einheitliches Record-Format (`formatVersion=2`)
  - Capsule-Erzeugung (code/config/sql/markup/docs)
  - Focused Capsule (query-aware)
  - Transport Envelope (`mesh-envelope-v2`) mit Digest-Validierung
  - Recovery ueber Span-IDs und Byte-/Line-Ranges
  - Legacy-Migration alter Brotli-Records

- Azure Fan-Out (`mesh-functions/...`)
  - Event Grid Trigger pro Blob-Erstellung
  - Blob streamen, indexierbaren Text extrahieren
  - `buildWorkspaceFileRecord(...)` ausfuehren
  - Ergebnis in Cosmos upserten

- Browser (`app.html`)
  - Liest Offload-Config
  - Uploads direkt nach Azure Blob (PUT + SAS)
  - Meldet nur Metadaten an Gateway (`/workspace/offload/ingest`)
  - Oeffnet Originaldateien bevorzugt direkt ueber `storage.readUrl`

### 2.2 Persistenzprinzip

Upload-Workspaces:

- Source of Truth fuer Originalinhalt: Azure Blob
- Source of Truth fuer Metadaten, Status, Capsula: Cosmos
- Worker/Gateway Memory nur Cache/Koordination, nicht dauerhafte Primarquelle

---

## 3) Compression/Capsula Logik im Detail

## 3.1 Workspace Record Format (v2)

`buildWorkspaceFileRecord(path, rawText, options)` erzeugt ein strukturiertes Record-Objekt mit:

- `rawStorage`
  - lokal typischerweise `utf8-base64`
  - blob-backed typischerweise `external-azure-blob` (kein voller Raw-Dump)
- `capsuleBase`
  - parser-agnostische Basisstruktur
- `capsuleCache`
  - gerenderte Haupt-Capsule (inkl. SpanMap)
- `focusedCapsuleCache`
  - query-spezifische Capsules
- `transportEnvelope`
  - chunk-basierte, validierbare Transport-Repräsentation
- `compressionStats`
  - raw/capsule/transport bytes + ratio + budget flags

## 3.2 Capsule Erzeugung

Pipeline in `compression-core`:

1. Dateityp erkennen (`detectFileType`)
   - code/config/sql/markup/docs + Sprache/Parserfamilie
2. Basis-Capsule bauen (`buildBaseCapsule`)
   - Code: Tree-Sitter Worker (`tree-sitter-worker.cjs`)
   - Config/SQL/Markup/Docs: spezialisierte Builder
   - Fallbacks: heuristisch, optional `llm-compress`
3. Capsule auf Budget clampen (`buildClampedCapsule`)
   - Modi: `verbose -> compact -> dense -> emergency`
   - Tokenbudget ~20% von Raw-Token-Schaetzung
4. Rendern in textuelle `mesh-capsule-v2` Darstellung

Wichtige Eigenschaften:

- SpanMap (`@sp_*`) referenziert genaue Rohbereiche
- parserFamily + parseOk + fallbackReason werden mitgefuehrt
- Recovery-Eligibility wird aus SpanMap abgeleitet

## 3.3 Focused Capsule

`buildWorkspaceFileView(..., "focused", { query })`:

- scored Section-Items gegen Query-Tokens
- priorisiert relevante Teile, behaelt aber P0-Struktur
- cached pro Query-Hash (`getFocusedCacheKey`)

## 3.4 Transport Envelope (`mesh-envelope-v2`)

`buildTransportEnvelope(...)`:

- chunked raw-bytes (Default chunk size 32 KiB)
- Content-Encoding:
  - bevorzugt `zstd-chunked` wenn Runtime verfuegbar
  - sonst `brotli-chunked`
- pro Chunk:
  - `rawOffset`, `rawLength`, `compressedBytes`, `digest`
- global:
  - raw/compressed bytes, digest, chunkCount, spanIndex

`decodeTransportEnvelope(...)` validiert strikt:

- envelope version
- chunk count/size limits
- chunk digest
- contiguous raw offsets
- raw length + global digest
- spanIndex boundaries

Damit ist Transport nicht nur komprimiert, sondern auch konsistenzgeprueft.

## 3.5 Recovery

`recoverWorkspaceFileRecord(meta, request)` liefert:

- exakte Ausschnitte per `spanIds`
- byte-range recovery
- line-range recovery

`suggestRecoverySpanIds(meta, query, limit)` rankt relevante spans fuer gezielte Nachladung.

## 3.6 Legacy Migration

`ensureWorkspaceFileRecord(...)` migriert alte Formate lazy:

- aus `rawStorage`
- oder `rawText`
- oder `transportEnvelope`
- oder `compressedBase64` (Legacy Brotli)

Danach wird auf v2-Record vereinheitlicht.

## 3.7 Payload-Strategie fuer Blob-backed Records

Wenn `storage.provider === "azure-blob"`:

- `persistRawContent` und `persistTransportChunks` koennen deaktiviert werden
- `stripWorkspaceRecordPayload(...)` entfernt grosse Roh-/Chunk-Payloads
- Record behaelt nur noetige Metadaten + Kompressionsartefakte

Ziel: Cosmos bleibt leichtgewichtig, Blob bleibt Source of Truth fuer Originalinhalt.

## 3.8 Modellbezogene Kompression im Gateway

Neben Workspace-Capsules existiert ein separater Model-Codec (`mc2`) in `server.js`:

- komprimiert kapselbasierte Kontextbloecke fuer LLM-Transport
- markiert Kontext mit `<mesh_workspace_capsules ...>`
- unterstuetzt codec encode/decode Pfade (`/api/assistant/codec/decode`)
- haelt `contentCompressed` und dekodierten `content` konsistent

Das ist getrennt von Datei-Capsules, aber baut auf denselben Capsule-Inhalten auf.

## 3.9 Weitere Kompressionspfade

- Mesh Tunnel (Gateway <-> Worker)
  - Brotli-komprimierter JSON Envelope (`application/octet-stream` + `X-Mesh-Encoding: brotli`)
- `mesh-core/src/MeshServer.js`
  - optional Minify (HTML/JS), danach Brotli Q11
- Browser `assets/mesh-client.js`
  - optionale WASM-Brotli Q11 fuer Client-Payloads
- `llm-compress.js`
  - eigenstaendiges CLI/Legacy-Heuristiktool (smart/skeleton/lean/llm80)

---

## 4) Azure Anbindung im Detail

## 4.1 Verwendete Azure-Dienste

Laut `AZURE-ARCHITECTURE.md` (aktuell live):

- Gateway Web App: `mesh-gateway-303137`
- Worker Web App: `mesh-worker-303137`
- Blob Storage Account: `meshoffload303137`
- Function App: `mesh-capsule-fanout-303137`
- Cosmos DB Account: `meshcosmosne303137`

## 4.2 Blob-Pfadschema

Gemeinsame Konvention in `workspace-upload-utils.cjs`:

`mesh-workspace/<sessionId>/<workspaceId>/<folderSlug>/files/<relativePath>`

Vorteile:

- deterministic pathing
- Function kann `workspaceId`, `sessionId`, `path` direkt aus Blob-Pfad ableiten

## 4.3 Browser Upload Flow (Azure Offload)

Frontend (`app.html`):

1. `GET /api/assistant/workspace/offload-config`
2. Erhaelt `azureBlob.uploadBaseUrl`, `sasToken`, chunk limits
3. Baut pro Datei Blob-Zielpfad
4. Fuehrt direkte Browser-Uploads nach Blob via `PUT` aus (`x-ms-blob-type: BlockBlob`)
5. Sendet Metadaten-only an `POST /api/assistant/workspace/offload/ingest`

Bei Fehlern:

- automatischer Fallback auf direkten `/api/assistant/workspace/select` Upload

## 4.4 Gateway Offload und Ingest

In `server.js`:

- Offload-Konfig aus Env (`createWorkspaceOffloadConfig`)
- `workspaceOffloadClientConfig()` liefert browser-sichere Konfig
- `ingestWorkspaceChunkFromOffload(...)` verarbeitet 2 Modi:
  - direkte Dateiliste mit Blob-Storage-Refs
  - blobPath auf ein Chunk-JSON, das zuerst geladen wird
- leitet Ergebnis in `workspace.select` (Worker oder local fallback)

## 4.5 Worker Koordination

In `mesh-core/src/server.js`:

- `seedWorkspaceManifest(...)` legt `pending` in Cosmos an
- Background Indexer Queue (`enqueueForIndexing` / `runIndexerForWorkspace`)
- fuer jede Datei:
  - Blob lesen (`readWorkspaceBlobText`)
  - `buildWorkspaceFileRecord`
  - `upsertWorkspaceFileRecord(..., status=completed)`
- Summary wird laufend nachgezogen (`syncUploadWorkspaceSummary`)

## 4.6 Function Fan-Out (Blob Event -> Capsula)

`mesh-functions/src/functions/blob-capsule-indexer.js`:

- Event Grid trigger pro Blob
- ruft `processBlobCapsuleEvent(event, context)`
- bei Fehler: `markWorkspaceFileFailed(...)` in Cosmos

`blob-capsule-processor.cjs`:

- Blob auth aus Connection String, Shared Key oder BaseURL+SAS
- streamt Blob (klein inline, gross via Temp-File)
- erkennt Binaerdateien (`[binary or unreadable]`)
- begrenzt indexierbaren Text (`MESH_WORKSPACE_MAX_FILE_CHARS`)
- erstellt v2-Record ueber Compression-Core
- speichert completed Record in Cosmos

## 4.7 Cosmos Datenmodell

`workspace-metadata-store.cjs`:

- DB + Container Setup (optional auto-create)
- Container defaults:
  - `workspace_workspaces`
  - `workspace_files`
- Partition Key: `/workspaceId`
- Kernoperationen:
  - `seedWorkspaceManifest`
  - `upsertWorkspaceFileRecord`
  - `markWorkspaceFileFailed`
  - `listWorkspaceFiles`
  - `recomputeWorkspaceSummary`

Retry/Robustness:

- retryfaehige Codes (408/409/412/423/429/449/500/503)
- exponential/backoff-aehnlicher Delay
- bulk seeding mit schrittweiser chunk-Verkleinerung

## 4.8 Datei lesen/schreiben/mutieren in Upload-Workspaces

Lesen (original):

- API liefert bei Blob-backed Dateien `storage.readUrl`
- Frontend liest Inhalt direkt per `fetch(readUrl)`

Schreiben/Create:

- Blob write zuerst
- danach neues komprimiertes Record in Cosmos

Rename:

- Blob copy -> source delete
- Cosmos upsert target + delete source

Delete:

- Blob delete
- Cosmos delete + summary recompute

---

## 5) API und Action Map (relevant fuer Capsula/Azure)

## 5.1 Gateway HTTP Endpunkte

- `GET /api/assistant/workspace/offload-config`
- `POST /api/assistant/workspace/offload/ingest`
- `POST /api/assistant/workspace/select`
- `GET /api/assistant/workspace/files`
- `GET /api/assistant/workspace/file`
- `POST /api/assistant/workspace/recovery`
- `POST /api/assistant/workspace/file` (create)
- `PUT /api/assistant/workspace/file` (save)
- `DELETE /api/assistant/workspace/file`
- `POST /api/assistant/workspace/rename`
- `POST /api/assistant/workspace/batch`

## 5.2 Worker Tunnel Actions

- `workspace.select`
- `workspace.files`
- `workspace.file.open`
- `workspace.capsule.open`
- `workspace.transport.open`
- `workspace.recovery.fetch`
- `workspace.file.create`
- `workspace.file.save`
- `workspace.file.rename`
- `workspace.file.delete`
- `workspace.batch`

---

## 6) Environment Variablen (komprimiert nach Bereich)

## 6.1 Gateway/Worker Blob Offload

- `MESH_AZURE_OFFLOAD_ENABLED`
- `MESH_AZURE_BLOB_BASE_URL`
- `MESH_AZURE_BLOB_CONTAINER`
- `MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN`
- `MESH_AZURE_BLOB_INGEST_SAS_TOKEN`
- `MESH_AZURE_BLOB_READ_SAS_TOKEN`
- `MESH_AZURE_BLOB_DELETE_SAS_TOKEN`
- `MESH_AZURE_BLOB_SAS_TOKEN`

## 6.2 Cosmos

- `MESH_COSMOS_ENDPOINT`
- `MESH_COSMOS_KEY`
- `MESH_COSMOS_DATABASE`
- `MESH_COSMOS_WORKSPACE_FILES_CONTAINER`
- `MESH_COSMOS_WORKSPACES_CONTAINER`
- `MESH_COSMOS_CREATE_CONTAINERS`

## 6.3 Function Blob Zugriff

- `MESH_FUNCTION_AZURE_STORAGE_CONNECTION_STRING`
- `AzureWebJobsStorage`
- `MESH_AZURE_STORAGE_ACCOUNT`
- `MESH_AZURE_STORAGE_KEY`
- alternativ BaseURL + Read-SAS

## 6.4 Performance/Compression Steuerung

- `MESH_WORKSPACE_BROTLI_QUALITY`
- `MESH_TUNNEL_BROTLI_QUALITY`
- `MESH_TRANSPORT_CHUNK_PARALLELISM`
- `MESH_CAPSULE_MAX_TREE_SITTER_BYTES`
- `MESH_CAPSULE_MAX_TREE_WALK_NODES`
- `MESH_CAPSULE_MAX_SYMBOLS`
- `MESH_CAPSULE_MAX_LLM_FALLBACK_BYTES`
- `MESH_FUNCTION_INLINE_BUFFER_BYTES`
- `MESH_FUNCTION_STREAM_CHUNK_BYTES`
- `MESH_WORKSPACE_MAX_FILE_CHARS`

---

## 7) Validierung durch Tests und Benchmarks

## 7.1 Unit/Contract Tests

`test/compression-core.test.js` verifiziert u.a.:

- Record v2 Aufbau
- Capsule/Focused/Transport Views
- Recovery und Span-Handhabung
- Legacy Migration (`compressedBase64` -> v2)
- Transport Tamper-Schutz (digest/range Validation)

## 7.2 Integrationstest Gateway vs Worker

`test/assistant-integration.test.js` verifiziert:

- gleiche Workspace CRUD/Capsule/Recovery Vertragsflaeche
  - lokal fallback gateway
  - worker-backed gateway
- parity auf Encoding, Capsule-Mode, Recovery, rename/delete/create flows

## 7.3 Benchmark Suite

`benchmarks/compression-benchmark.js` + Test:

- fixture families: code/config/sql/markup/docs
- compares raw vs capsule vs focused vs recovery vs transport vs llm80
- aggregiert ratio-Metriken je Familie

---

## 8) End-to-End Sequenzen

## 8.1 Upload-Workspace (Azure)

1. Browser liest Offload-Config
2. Browser uploaded Dateien direkt nach Blob
3. Browser sendet Metadaten an Offload-Ingest
4. Gateway/Worker seeden `pending` Manifest in Cosmos
5. Event Grid triggert Function pro Blob
6. Function baut Capsula/Transport Record und upsertet `completed`
7. UI pollt `workspace/files` und zeigt Fortschritt/Dateien

## 8.2 Datei oeffnen

- `view=original`: bevorzugt direkter Blob Read ueber `storage.readUrl`
- `view=capsule`: aus Cosmos/Record `capsuleCache.rendered`
- `view=focused`: query-spezifische Capsule
- `view=transport`: Envelope Manifest + Metadaten

## 8.3 Recovery

- Client sendet query oder spanIds
- Backend liefert exakt rekonstruierten Rohtext aus spans/ranges

---

## 9) Relevante Grenzen und Verhalten

- Sehr grosse Dateien werden fuer Indexing gekappt (Truncation Note)
- Binaerdaten werden als `[binary or unreadable]` behandelt
- Bei fehlender Worker-Erreichbarkeit: lokaler Gateway-Fallback
- Bei nicht verfuegbarem Azure Offload im Browser: direkter Upload-Fallback via `/workspace/select`
- Blob in West Europe und Cosmos in North Europe erzeugt zusaetzliche Netzwerklatenz

---

## 10) Kurzfazit

Die aktuelle Architektur trennt sauber zwischen:

- Originalinhalt (Blob)
- Metadaten + Capsula + Fortschritt (Cosmos)
- Koordination/Serving (Gateway + Worker)
- CPU-intensiver per-Datei Capsula-Erzeugung (Function Fan-Out)

Die Compression-Logik ist mehrstufig und robust:

- strukturelle Capsule fuer LLM-Kontext
- focused/query-aware Capsule
- validierbarer Transport-Envelope
- exakte Recovery ueber Span-Handles
- Legacy-Migration und Fallbacks fuer Runtime/Parser-Ausfaelle

Damit ist der Stack sowohl fuer grosse Upload-Workspaces als auch fuer modellseitig token-effiziente Kontextbereitstellung ausgelegt.