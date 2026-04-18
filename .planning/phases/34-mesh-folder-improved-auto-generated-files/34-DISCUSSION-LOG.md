# Phase 34: .mesh Folder — Improved Auto-Generated Files - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 34-mesh-folder-improved-auto-generated-files
**Areas discussed:** File organization, Content format, Refresh behavior

---

## File Organization

| Option | Description | Selected |
|--------|-------------|----------|
| 3-file approach | project.md + files.md + rules.md — clean separation, no duplication | ✓ |
| Single file | One big .mesh/README.md with all sections | |
| Keep dependency-map separate | 3 files + dependency-map.md stays as its own file | |

**User's choice:** 3-file approach
**Notes:** User also selected "you decide everything" — gave Claude full discretion within discussed areas.

---

## Content Format

| Option | Description | Selected |
|--------|-------------|----------|
| Clean markdown + frontmatter | Professional README style — YAML header, ## sections, tables, no emojis | |
| Structured JSON | Machine-readable JSON files — better for tooling | |
| Keep markdown, just clean up | Same format but remove emojis, improve quality | |

**User's choice:** "mix between json and md" — structured data in JSON, narrative in markdown

### Follow-up: JSON/Markdown Split

| Option | Description | Selected |
|--------|-------------|----------|
| project.json + 2 markdown files | Structured data in JSON, narrative in markdown | ✓ |
| All markdown with JSON blocks | .md files with embedded JSON fenced code blocks | |
| All JSON | Everything machine-readable | |

**User's choice:** project.json + 2 markdown files

---

## Refresh Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Every workspace open | Regenerate on each open — always fresh | |
| On file changes | Watch for changes, regenerate after indexing | ✓ |
| On demand only | User triggers regeneration explicitly | |

**User's choice:** On file changes

---

## Claude's Discretion

- Exact JSON schema for project.json
- Directory tree depth/limits in files.md
- Whether to keep TODO/FIXME scanning
- Exact wording of coding rules in rules.md
- Sensitive data scrubbing approach

## Deferred Ideas

None — discussion stayed within phase scope.
