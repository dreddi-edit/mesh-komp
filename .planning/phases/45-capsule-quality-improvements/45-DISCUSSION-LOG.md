# Phase 45: Capsule Quality Improvements — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 45-capsule-quality-improvements
**Areas discussed:** Export detection, Capsule rendering format, Outgoing call refs format, File roles in workspace summary

---

## Export Detection (CAP-01)

| Option | Description | Selected |
|--------|-------------|----------|
| AST parent-check | Check if symbol node's parent is export_statement/export_declaration during walkTree pass | ✓ |
| Signature text scan | Scan signature string for 'export' keyword — zero AST changes | |
| You decide | Claude picks based on existing tree-sitter walk structure | |

**User's choice:** AST parent-check (Recommended)
**Notes:** Accurate for JS/TS; fallback to signature heuristic for other languages.

---

## Capsule Rendering Format (CAP-01/02/03)

| Option | Description | Selected |
|--------|-------------|----------|
| New dedicated sections | Add 'exports', 'calls', 'resolved-imports' sections using createSection/pushSectionItem | ✓ |
| Augment existing sections | Mark exports inline in symbols section, annotate imports with resolved path | |

**User's choice:** New dedicated sections (Recommended)
**Notes:** Clean separation, fits existing createSection/pushSectionItem pattern exactly.

---

## Outgoing Call Refs Format (CAP-02)

| Option | Description | Selected |
|--------|-------------|----------|
| calleeSymbol → resolvedFile:line | One entry per unique (callee, resolvedFile) pair | ✓ |
| callerLine: calleeSymbol → file:line | Include caller line number too | |
| You decide | Claude picks based on existing capsule section structure | |

**User's choice:** calleeSymbol → resolvedFile:line (Recommended)
**Notes:** Matches Phase 43 target chain format: "login() → auth-service.ts:58".

---

## File Roles in Workspace Summary (CAP-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Role classification per file | Classify each file into bucket (entry-point, route-handler, service, etc.), add File Roles table to buildFilesMd | ✓ |
| Per-file narrative summary | One-line description per file from top exported symbols | |
| Top files per role bucket | Only list top 2-3 files per role | |

**User's choice:** Role classification per file (Recommended)
**Notes:** Path pattern matching first (*.test.* → test, *.routes.* → route-handler), symbol fallback for ambiguous files.

---

## Claude's Discretion

- Priority of exports section in capsule (suggest P0)
- Max items per exports/calls sections before truncation (suggest 40/30)
- resolved-imports section priority (P1 or P2)
- Exact role classification heuristics beyond main buckets
- Worker path duplication scope (only isExported flag needed)

## Deferred Ideas

- Python `__all__` export detection — future phase
- Symbol-level call chain injection into chat prompt — Phase 44 concern
- Capsule diff rendering — new capability, future phase
