# Mesh Azure Architecture

Stand: 2026-04-06

Diese Datei beschreibt die aktuell eingesetzte Azure-Architektur von `try-mesh.com` auf Basis der laufenden Infrastruktur und der aktuellen Codebasis in diesem Repository.

## 1. Kurzfassung

Mesh läuft aktuell auf vier zentralen Azure-Bausteinen:

1. Gateway Web App
   - Name: `mesh-gateway-303137`
   - Aufgabe: HTTP-Frontend, Auth, UI-Assets, API-Gateway, Fallback-Logik

2. Worker Web App
   - Name: `mesh-worker-303137`
   - Aufgabe: lokaler Workspace-Index für Local-Path-Workspaces, Git-Operationen, Blob-backed Workspace-Koordination, Fallback-Verarbeitung

3. Azure Blob Storage
   - Account: `meshoffload303137`
   - Blob endpoint: `https://meshoffload303137.blob.core.windows.net/`
   - Aufgabe: Source-of-Truth für hochgeladene Workspace-Dateien

4. Serverless Fan-Out Layer
   - Function App: `mesh-capsule-fanout-303137`
   - Trigger: Event Grid auf Blob-Erstellung
   - Aufgabe: pro Datei die Capsula-Metadaten berechnen und in Cosmos DB schreiben

5. Cosmos DB
   - Account: `meshcosmosne303137`
   - Endpoint: `https://meshcosmosne303137.documents.azure.com:443/`
   - Aufgabe: dauerhafte Metadaten- und Fortschrittsspeicherung für Upload-Workspaces

## 2. Live-Ressourcen

Diese Ressourcen sind aktuell live:

### Resource Group

- `mesh-rg`

### Web Apps

- Gateway: `mesh-gateway-303137`
- Worker: `mesh-worker-303137`

### Function App

- `mesh-capsule-fanout-303137`
- Hostname: `mesh-capsule-fanout-303137.azurewebsites.net`
- Typ laut Azure: `functionapp,linux`
- Status: `Running`

### Blob Storage

- Account: `meshoffload303137`
- Typ: `StorageV2`
- Region: `westeurope`
- SKU: `Standard_LRS`
- Blob Endpoint: `https://meshoffload303137.blob.core.windows.net/`

### Cosmos DB

- Account: `meshcosmosne303137`
- Typ: `GlobalDocumentDB`
- Region: `North Europe`
- Endpoint: `https://meshcosmosne303137.documents.azure.com:443/`

Wichtig:
- Blob Storage liegt in `West Europe`.
- Cosmos DB liegt aktuell in `North Europe`.
- Das ist bewusst so akzeptiert, weil Cosmos in West Europe beim Setup kapazitiv blockiert war.

## 3. Systemrollen im Detail

## 3.1 Gateway

Der Gateway ist die öffentliche Entry-Schicht.

Er übernimmt:

- Serving von `app.html` und statischen Assets
- Login/Session/Auth
- API-Endpunkte unter `/api/...`
- Weiterleitung an den Worker über `meshTunnelRequest(...)`
- lokale Fallback-Logik, falls der Worker nicht erreichbar ist
- Auslieferung der Offload-Konfiguration an das Frontend

Relevante Stellen:

- Offload-Konfiguration: [server.js](/Users/edgarbaumann/Downloads/mesh-komp/server.js#L1551)
- Workspace-File-Open-Routing: [server.js](/Users/edgarbaumann/Downloads/mesh-komp/server.js#L7251)
- Workspace-File-Listing-Routing: [server.js](/Users/edgarbaumann/Downloads/mesh-komp/server.js#L7233)

## 3.2 Worker

Der Worker ist die serverseitige Arbeitsinstanz für Workspace-Operationen.

Er übernimmt aktuell zwei Betriebsarten:

1. Local-Path-Workspaces
   - Dateien werden direkt vom Server-Dateisystem gelesen
   - Indexing läuft lokal im Worker
   - Git-Operationen laufen hier

2. Upload-Workspaces
   - Originaldateien liegen in Azure Blob
   - Dateimetadaten und Capsula-Index liegen in Cosmos DB
   - Der Worker ist Koordinator und Reader, nicht mehr Primärrechner für die Upload-Capsules

Relevante Stellen:

- Blob-Konfiguration: [mesh-core/src/server.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-core/src/server.js#L135)
- Persistenz des Worker-Workspace-State: [mesh-core/src/server.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-core/src/server.js#L176)
- Upload-Workspace-Listing anhand `workspaceId`: [mesh-core/src/server.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-core/src/server.js#L1179)
- Upload-Workspace-File-Open aus Cosmos: [mesh-core/src/server.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-core/src/server.js#L1201)

## 3.3 Azure Blob Storage

Blob Storage ist bei Browser-Uploads der dauerhafte Speicher für die Originaldateien.

Blob ist damit:

- Source-of-Truth für `view=original`
- nicht nur temporärer Transit
- von Worker und Azure Functions lesbar
- vom Browser direkt beschreibbar per SAS

Das Frontend lädt die rohen `File`-Objekte direkt als Blob hoch, nicht mehr als JSON mit vollem Dateitext.

Relevante Stellen:

- Browser-Upload per `PUT`: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L2946)
- Blob-Upload in Chunk-Orchestrierung: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L3035)

## 3.4 Azure Functions Fan-Out

Die Function App übernimmt die CPU-intensive Erzeugung der Capsula-Metadaten pro hochgeladener Datei.

Trigger-Modell:

- Event Grid Event bei Blob-Erstellung
- Jede Blob-Datei erzeugt eine unabhängige Function-Ausführung

Die Function ist damit stateless und horizontal skalierbar.

Relevante Stellen:

- Function-Definition: [mesh-functions/src/functions/blob-capsule-indexer.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/functions/blob-capsule-indexer.js#L1)
- Host-Konfiguration: [mesh-functions/host.json](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/host.json#L1)
- Blob-zu-Capsula-Processing: [mesh-functions/src/shared/blob-capsule-processor.cjs](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/shared/blob-capsule-processor.cjs#L1)

## 3.5 Cosmos DB

Cosmos DB ist das durable Metadaten-Backend für Upload-Workspaces.

Es speichert:

- Workspace-Summary-Dokumente
- Datei-Dokumente mit Status und Capsula-Metadaten

Es speichert nicht:

- keine kompletten rohen Dateiinhalte als Cache
- keine gigantischen Base64-Bodies für Upload-Workspaces

Relevante Stellen:

- Store-Initialisierung: [workspace-metadata-store.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-metadata-store.cjs#L63)
- Container-Defaults:
  - `workspace_files`
  - `workspace_workspaces`

## 4. End-to-End-Flows

## 4.1 Browser Upload Workflow

Der aktuelle Upload-Pfad für Browser-Workspaces läuft so:

1. User wählt einen Ordner im Browser.
2. Das Frontend erzeugt `workspaceId` und `sessionId`.
3. Für jede Datei wird ein kanonischer Blob-Pfad gebaut.
4. Der Browser lädt die Datei direkt per `PUT` in Azure Blob Storage.
5. Danach sendet das Frontend nur Metadaten an den Ingest-Endpunkt.
6. Gateway leitet das Manifest an den Worker weiter.
7. Worker seeded das Workspace-Manifest in Cosmos mit `pending`-Dateieinträgen.
8. Sobald die Blobs im Container landen, feuert Event Grid.
9. Die Function verarbeitet jede Datei einzeln, baut Capsula-Metadaten und schreibt sie in Cosmos.
10. UI pollt Fortschritt und zeigt Dateien nach und nach als indexiert an.

Die wichtigsten Frontend-Stellen:

- Manifest-Seeding über `/api/assistant/workspace/select`: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L2890)
- Metadata-only Ingest über `/api/assistant/workspace/offload/ingest`: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L2921)
- Blob Upload via Browser: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L2946)
- Chunk-Orchestrierung: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L2972)

## 4.2 Local Path Workflow

Der Local-Path-Pfad ist getrennt vom Azure-Upload-Pfad.

Hier gilt:

- Dateien bleiben auf dem Server-Dateisystem
- kein Browser-Upload zu Blob
- kein Function-Fan-Out
- Worker indexiert direkt
- Git arbeitet gegen `rootPath`

Dieser Pfad bleibt wichtig für serverseitige Repo-Arbeit.

## 4.3 Datei-Öffnen im Editor

Für Upload-Workspaces:

1. Frontend ruft `/api/assistant/workspace/file?path=...&view=original&workspaceId=...`
2. Gateway fragt Worker oder Fallback
3. Antwort enthält bei Upload-Dateien `storage.readUrl`
4. Frontend lädt den Inhalt direkt von Azure Blob über diese URL

Das passiert in:

- Request: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L3704)
- Direktes Azure-Read im Browser: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L3731)
- Gateway-Anreicherung mit Read-URL: [server.js](/Users/edgarbaumann/Downloads/mesh-komp/server.js#L7260)

Für Local-Path-Workspaces:

- Der Worker liest direkt von Disk

## 4.4 Datei-Mutationen

Upload-Workspaces können derzeit weiterhin bearbeitet werden.

Operationen:

- Save
- Create
- Rename
- Delete

Bei Blob-backed Workspaces bedeutet das:

- Originaldatei wird in Blob geschrieben, kopiert oder gelöscht
- Metadaten werden in Cosmos aktualisiert

Frontend sendet dafür inzwischen stabil `workspaceId` und `sessionId` mit, damit Multi-Instance-Deployments nicht wieder in alte Workspaces zurückfallen.

Relevante Stellen:

- Save-Request: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L3539)
- Create-Request: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L3984)
- Gateway-Routen: [server.js](/Users/edgarbaumann/Downloads/mesh-komp/server.js#L7287)

## 5. Blob-Namensschema

Upload-Dateien folgen einem kanonischen Pfadschema:

```txt
mesh-workspace/<sessionId>/<workspaceId>/<folderSlug>/files/<relativePath>
```

Beispiel:

```txt
mesh-workspace/session-123/workspace-456/my-repo/files/src/index.js
```

Das wird gebaut in:

- [workspace-upload-utils.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-upload-utils.cjs#L17)
- [workspace-upload-utils.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-upload-utils.cjs#L21)

Und geparst in:

- [workspace-upload-utils.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-upload-utils.cjs#L25)

Warum das wichtig ist:

- Die Function kann `workspaceId`, `sessionId` und `path` direkt aus dem Blob-Pfad ableiten.
- Dadurch braucht sie keinen Worker-Lookup, um eine Datei korrekt zuzuordnen.

## 6. Cosmos-Datenmodell

## 6.1 Workspace Summary Container

Container:

- `workspace_workspaces`

Typisches Dokument:

```json
{
  "id": "workspaceId",
  "workspaceId": "workspaceId",
  "folderName": "repo-name",
  "rootPath": "",
  "sourceKind": "upload",
  "sessionId": "sessionId",
  "status": "processing",
  "fileCountTotal": 100000,
  "fileCountPending": 85000,
  "fileCountCompleted": 14900,
  "fileCountFailed": 100,
  "indexedAt": "2026-04-06T20:00:00.000Z",
  "createdAt": "2026-04-06T19:50:00.000Z",
  "updatedAt": "2026-04-06T20:00:01.000Z"
}
```

Erzeugung und Pflege:

- [workspace-metadata-store.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-metadata-store.cjs#L141)
- [workspace-metadata-store.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-metadata-store.cjs#L165)

## 6.2 File Container

Container:

- `workspace_files`

Typisches Dokument:

```json
{
  "id": "workspaceId:path/to/file.js",
  "workspaceId": "workspaceId",
  "folderName": "repo-name",
  "sourceKind": "upload",
  "sessionId": "sessionId",
  "path": "src/index.js",
  "status": "completed",
  "originalSize": 12345,
  "storage": {
    "provider": "azure-blob",
    "blobPath": "mesh-workspace/.../files/src/index.js",
    "azureBlobUrl": "https://.../workspace-offload/mesh-workspace/.../files/src/index.js"
  },
  "capsuleCache": { "...": "..." },
  "capsuleBase": { "...": "..." },
  "spanIndex": [ "..."],
  "fileTypeInfo": { "...": "..." },
  "compressionStats": { "...": "..." },
  "transportEnvelope": {
    "manifestText": "...",
    "chunks": []
  }
}
```

Wichtig:

- Für Blob-backed Upload-Records werden rohe Payload-Daten nicht mehr dauerhaft im Cache gehalten.
- `rawStorage.contentBase64` soll hier nicht wieder als großer Payload-Dump landen.
- `transportEnvelope.chunks` wird für diese Architektur nicht als Raw-Payload-Persistenz benutzt.

Seed-Pfad:

- `pending`-Einträge werden beim Manifest-Seeding angelegt:
  [workspace-metadata-store.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-metadata-store.cjs#L200)

## 7. Function-Fan-Out im Detail

## 7.1 Trigger

Die Function ist als Event-Grid-Function registriert:

- Name: `workspaceBlobCapsuleIndexer`
- Definition: [mesh-functions/src/functions/blob-capsule-indexer.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/functions/blob-capsule-indexer.js#L4)

Die Host-Konfiguration setzt:

- `maxEventsPerBatch: 1`
- `preferredBatchSizeInKilobytes: 64`

Siehe:

- [mesh-functions/host.json](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/host.json#L13)

Das bedeutet praktisch:

- Jede Blob-Erstellung wird möglichst einzeln abgearbeitet.
- Das unterstützt den gewünschten Fan-Out-Charakter.

## 7.2 Blob-Verarbeitung

Die Function arbeitet so:

1. Event Grid liefert Blob-URL.
2. Der Blob-Pfad wird geparst.
3. Die Function lädt den Blob als Stream.
4. Kleine Dateien können inline gelesen werden.
5. Größere Dateien werden auf Temp-Disk gespult.
6. Daraus wird indexierbarer Text extrahiert.
7. `buildWorkspaceFileRecord(...)` baut die Capsula-Struktur.
8. Ergebnis wird in Cosmos upserted.

Code:

- Blob-Service-Aufbau: [mesh-functions/src/shared/blob-capsule-processor.cjs](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/shared/blob-capsule-processor.cjs#L47)
- Streaming-Extraktion: [mesh-functions/src/shared/blob-capsule-processor.cjs](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/shared/blob-capsule-processor.cjs#L119)
- Temp-Spool für große Dateien: [mesh-functions/src/shared/blob-capsule-processor.cjs](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/shared/blob-capsule-processor.cjs#L158)
- Endgültige Verarbeitung: [mesh-functions/src/shared/blob-capsule-processor.cjs](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/shared/blob-capsule-processor.cjs#L204)

## 7.3 OOM-Schutz

Die Function vermeidet bewusst Voll-Laden in RAM.

Wichtige Schutzmechanismen:

- Zeichenlimit: `MESH_WORKSPACE_MAX_FILE_CHARS`, Default `25_000_000`
- Inline-Buffer-Limit: `MESH_FUNCTION_INLINE_BUFFER_BYTES`, Default `8 MiB`
- Größere Blobs werden zunächst auf Temp-Disk geschrieben
- Binärdaten werden früh erkannt und als `[binary or unreadable]` behandelt

Das ist wichtig für große Dateien wie 500 MB.

Grenze:

- Die Rohdatei wird nicht komplett als Base64 im Cache gehalten.
- Für die Capsula-Erstellung wird aber weiterhin indexierbarer Text erzeugt, begrenzt und ggf. mit Truncation-Note versehen.

## 8. Worker/Cosmos-Koordination

Der Worker ist für Upload-Workspaces heute primär ein Koordinator.

Beim Manifest-Ingest macht er:

- Validierung
- Seeding von `pending`-Dateieinträgen in Cosmos
- Aktualisierung der Workspace-Summary
- Rückgabe eines `processing`-Status an die UI

Die eigentliche CPU-Arbeit pro Datei passiert dann im Function-Fan-Out.

Das ist die zentrale Entlastung gegenüber der alten Architektur.

## 9. Frontend-Verhalten mit Azure

Das Frontend arbeitet heute in drei Azure-bezogenen Modi:

## 9.1 Upload

- Browser lädt direkt nach Blob
- nicht mehr als kompletter Text-Read in JSON
- Metadaten werden separat ingestet

## 9.2 Progress

- UI pollt weiter normal über Gateway
- Dateien erscheinen zuerst als `pending/indexing`
- später als `completed`
- Fehler werden als `failed` sichtbar

## 9.3 Read

- Bei `view=original` für Upload-Dateien:
  - Gateway liefert eine Blob-Read-URL
  - Browser lädt den Inhalt direkt aus Azure Blob

Das reduziert Last auf Gateway und Worker.

## 10. Wichtige Environment Variablen

## 10.1 Blob / Offload

Verwendete Variablen in Gateway und Worker:

- `MESH_AZURE_OFFLOAD_ENABLED`
- `MESH_AZURE_BLOB_BASE_URL`
- `MESH_AZURE_BLOB_CONTAINER`
- `MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN`
- `MESH_AZURE_BLOB_INGEST_SAS_TOKEN`
- `MESH_AZURE_BLOB_READ_SAS_TOKEN`
- `MESH_AZURE_BLOB_DELETE_SAS_TOKEN`
- `MESH_AZURE_BLOB_SAS_TOKEN`

Konfigurationsaufbau:

- Gateway Offload-Config: [server.js](/Users/edgarbaumann/Downloads/mesh-komp/server.js#L1551)
- Worker Blob-Config: [mesh-core/src/server.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-core/src/server.js#L135)

## 10.2 Cosmos

- `MESH_COSMOS_ENDPOINT`
- `MESH_COSMOS_KEY`
- `MESH_COSMOS_DATABASE`
- `MESH_COSMOS_WORKSPACE_FILES_CONTAINER`
- `MESH_COSMOS_WORKSPACES_CONTAINER`
- `MESH_COSMOS_CREATE_CONTAINERS`

Store-Aufbau:

- [workspace-metadata-store.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-metadata-store.cjs#L70)

## 10.3 Function Blob-Zugang

Die Function kann Blob-Zugriff aus mehreren Quellen aufbauen:

1. `MESH_FUNCTION_AZURE_STORAGE_CONNECTION_STRING`
2. `AzureWebJobsStorage`
3. `MESH_AZURE_STORAGE_ACCOUNT` + `MESH_AZURE_STORAGE_KEY`
4. Blob Base URL + Read-SAS

Siehe:

- [mesh-functions/src/shared/blob-capsule-processor.cjs](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/shared/blob-capsule-processor.cjs#L47)

## 11. Persistenzmodell

## 11.1 Was dauerhaft in Azure liegt

Für Upload-Workspaces dauerhaft in Azure:

- Originaldateien in Blob Storage
- Workspace-Metadaten in Cosmos

## 11.2 Was nicht der primäre Speicher ist

Nicht primär für Upload-Workspaces:

- Worker-Prozessspeicher
- Gateway-Prozessspeicher
- `.mesh-worker-workspace-cache.json` als alleinige Truth-Quelle

Diese Rolle ist heute reduziert.

## 11.3 User-Daten

Benutzer-Settings und API Keys liegen getrennt davon in verschlüsselter SQLite.

Laut Deploy-Runbook:

- `MESH_SECURE_DB_FILE=/home/data/mesh-secure.db`

In der produktiven Umgebung wurde faktisch bereits `/home/data/mesh-secure-v2.db` beobachtet, ohne dass die Persistenzprüfung fehlgeschlagen ist.

Das ist getrennt von Blob/Cosmos und gehört nicht zur Workspace-Ingestion-Pipeline.

## 12. Betriebsrelevante Besonderheiten

## 12.1 Multi-Instance-Problem und WorkspaceId

Wichtig für den Betrieb:

- Gateway und Worker laufen skaliert
- deshalb darf Upload-Workspace-Kontext nicht implizit aus irgendeinem einzelnen Worker-Instanzzustand kommen

Darum wird jetzt `workspaceId` explizit durchgereicht bei:

- File-Listing
- File-Open
- Save/Create/Delete/Rename

Relevante Stellen:

- Frontend Refresh/File Open: [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html#L3656)
- Gateway Routing: [server.js](/Users/edgarbaumann/Downloads/mesh-komp/server.js#L7233)
- Worker Listing per `workspaceId`: [mesh-core/src/server.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-core/src/server.js#L1179)

## 12.2 Tree-Collapse

Beim Laden eines Workspace werden Ordner aktuell standardmäßig eingeklappt.

Das ist reine UI-Logik, aber wichtig für große Repos.

## 12.3 Cosmos-Throttling

Beim Manifest-Seeding kann Cosmos `429` liefern.

Dafür gibt es inzwischen:

- Retry
- Backoff
- kleinere Batch-Größen bei Wiederholungen

Diese Robustheit sitzt in:

- [workspace-metadata-store.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-metadata-store.cjs#L52)
- [workspace-metadata-store.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-metadata-store.cjs#L200)

## 13. Grenzen der aktuellen Architektur

Die aktuelle Architektur ist deutlich besser skaliert als die alte Worker-only-Variante, aber nicht magisch unbegrenzt.

Wichtige reale Grenzen:

1. Cosmos DB RU-Verbrauch
   - sehr große Manifest-Seeds und viele gleichzeitige Function-Upserts können throttlen

2. Event Grid / Function Burst-Verhalten
   - Fan-Out ist hoch, aber real von Azure-Limits, Cold Starts und Concurrency-Grenzen abhängig

3. Text-Extraktion
   - Die Function streamt und begrenzt Text, aber die Capsula-Qualität orientiert sich weiterhin an `buildWorkspaceFileRecord(...)`

4. Cross-Region-Latenz
   - Blob in West Europe, Cosmos in North Europe erzeugt zusätzliche Latenz

## 14. Typische Troubleshooting-Fragen

## 14.1 Upload hängt oder erscheint nicht

Prüfen:

- Blob landet im Container?
- Cosmos-Manifest-Seeding erfolgreich?
- Gibt es `429`-Throttling?
- Kommen Event Grid Events in der Function an?

## 14.2 Datei bleibt auf `indexing`

Prüfen:

- Existiert das File-Dokument in `workspace_files`?
- Hat es Status `pending`, `processing`, `completed` oder `failed`?
- Gibt es Function Errors?

## 14.3 Editor kann Datei nicht öffnen

Prüfen:

- Enthält die API-Antwort `storage.readUrl`?
- Ist die SAS noch gültig?
- Ist der Blob noch vorhanden?

## 14.4 Falscher Workspace springt wieder rein

Prüfen:

- Wird `workspaceId` bei Listing und File-Open tatsächlich mitgesendet?
- Trifft man eventuell einen alten Browser-Cache?

## 15. Relevante Dateien im Repo

Gateway:

- [server.js](/Users/edgarbaumann/Downloads/mesh-komp/server.js)

Worker:

- [mesh-core/src/server.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-core/src/server.js)
- [mesh-core/src/compression-core.cjs](/Users/edgarbaumann/Downloads/mesh-komp/mesh-core/src/compression-core.cjs)

Frontend:

- [app.html](/Users/edgarbaumann/Downloads/mesh-komp/app.html)

Cosmos Store:

- [workspace-metadata-store.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-metadata-store.cjs)

Blob Naming Utils:

- [workspace-upload-utils.cjs](/Users/edgarbaumann/Downloads/mesh-komp/workspace-upload-utils.cjs)

Functions:

- [mesh-functions/package.json](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/package.json)
- [mesh-functions/host.json](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/host.json)
- [mesh-functions/src/functions/blob-capsule-indexer.js](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/functions/blob-capsule-indexer.js)
- [mesh-functions/src/shared/blob-capsule-processor.cjs](/Users/edgarbaumann/Downloads/mesh-komp/mesh-functions/src/shared/blob-capsule-processor.cjs)

Deploy-Runbook:

- [DEPLOY.md](/Users/edgarbaumann/Downloads/mesh-komp/DEPLOY.md)

## 16. Executive Summary

Die aktuelle Azure-Architektur ist jetzt so geschnitten:

- Gateway ist die öffentliche API- und UI-Schicht.
- Worker ist Koordinator plus Local-Path-Executor.
- Blob ist der durable Dateispeicher für Browser-Uploads.
- Event Grid + Azure Functions übernehmen die per-Datei-Capsula-Berechnung im Fan-Out.
- Cosmos DB hält den skalierbaren, querybaren Metadaten- und Fortschrittsspeicher.

Für Upload-Workspaces bedeutet das praktisch:

- Originalbytes liegen in Blob.
- Fortschritt und Capsula liegen in Cosmos.
- UI spricht mit Gateway.
- Gateway und Worker lesen Metadaten aus Cosmos.
- Der Editor liest Originaldateien direkt aus Blob über Read-URLs.

Das ist die derzeit produktive Azure-Arbeitsweise von Mesh.
