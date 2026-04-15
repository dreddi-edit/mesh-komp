# Claude Code — Ubuntu EC2 Kontext

Diese Datei erklärt dem Claude Code auf der Ubuntu-Maschine alles Wichtige über die Umgebung.

---

## Die Maschine

| Feld | Wert |
|------|------|
| Provider | AWS EC2 |
| OS | Ubuntu 22.04 LTS |
| Public IP | 44.204.222.251 |
| SSH Key | `claude-code-ec2.pem` (liegt auf dem Mac unter `~/.ssh/`) |
| User | `ubuntu` |
| Disk | 20 GB |

---

## Repos auf dieser Maschine

| Pfad | Was es ist |
|------|-----------|
| `~/mesh-komp` | Hauptrepo — mesh Gateway + Worker + Frontend |
| `~/obsidian-vault` | Obsidian-Vault Kopie (Dokumentation) |

---

## GitHub

- **Account:** `dreddi-edit`
- **Repo:** `dreddi-edit/mesh-komp`
- **gh CLI:** installiert, eingeloggt als `dreddi-edit`
- **Token:** gespeichert in `~/.config/gh/hosts.yml` und `~/.git-credentials` (dauerhaft)
- **git user:** Edgar Baumann / edgar@try-mesh.com

GitHub-Operationen funktionieren direkt — kein Login nötig:
```bash
gh repo clone dreddi-edit/mesh-komp
git push origin main
gh pr create
gh run list
```

---

## Stack

| Tool | Version/Status |
|------|---------------|
| Node.js | installiert |
| npm | installiert |
| Claude Code (`claude`) | `/usr/bin/claude` |
| gh CLI | installiert, authentifiziert |
| git | installiert |

---

## Verhältnis Mac ↔ Ubuntu ↔ Produktion

```
Mac (Edgar arbeitet hier)
  │
  ├─ /Users/edgarbaumann/Downloads/mesh-komp   ← lokales Repo
  │
  └─► git push → main
            │
            ├─► GitHub Actions → EC2 Gateway (35.175.88.93) → try-mesh.com
            │
            └─► Ubuntu (44.204.222.251) ~/mesh-komp
                  └─ Claude Code läuft hier (Handy-Zugriff)
                     → muss git pull machen um aktuell zu sein
```

**Wichtig:** Mac und Ubuntu sind unabhängige Kopien des Repos. Änderungen fließen nur über `git push` / `git pull`.

---

## Produktionsumgebung (AWS)

Das Produktivsystem läuft **nicht** auf dieser Ubuntu-Maschine. Es läuft auf AWS:

| Resource | Details |
|----------|---------|
| Compute | EC2 t2.micro — `35.175.88.93` (us-east-1) |
| Domain | `try-mesh.com` (Cloudflare → EC2) |
| Datenbank | DynamoDB (`mesh-users`, `mesh-sessions`, `mesh-stores`) |
| AI | AWS Bedrock (Claude Sonnet 4.6) |

Deploy passiert automatisch via GitHub Actions bei jedem Push auf `main` (rsync → PM2 restart) — siehe `DEPLOY.md`.

---

## Was diese Ubuntu-Maschine ist

Diese EC2-Instanz ist eine **Entwicklungsmaschine** — kein Produktivsystem. Edgar nutzt sie um von unterwegs (Handy) mit Claude Code zu arbeiten. 

Typische Workflows hier:
- Code lesen und verstehen
- Kleinere Änderungen machen
- `git push` um Änderungen nach GitHub zu schicken
- GitHub Actions beobachten (`gh run watch`)

---

## Wichtige Befehle

```bash
# Repo aktuell halten
cd ~/mesh-komp && git pull origin main

# Deploy-Status beobachten
gh run list --repo dreddi-edit/mesh-komp --limit 5
gh run watch --repo dreddi-edit/mesh-komp

# Produktion prüfen
curl -I https://try-mesh.com/

# Claude Code starten
claude
```

---

*Erstellt: 2026-04-10*
