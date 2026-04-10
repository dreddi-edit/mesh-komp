# AI Workbench Mega-Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Mesh AI workbench into a VS Code/Antigravity-level IDE with 20+ features across AI power, editor quality, Capsula intelligence, and workflow.

**Architecture:** Smart Layering approach — each feature is a standalone JS module under `assets/features/` that hooks into the existing `app-workspace.js` state via a lightweight event bus (`window.MeshBus`). Backend features add routes to `src/routes/assistant.routes.js` and helpers to `src/core/index.js`. No build system required — features are loaded via `<script>` tags.

**Tech Stack:** Vanilla JS modules, Monaco Editor API, Server-Sent Events (streaming), Express routes, existing Capsula compression pipeline.

---

## Foundation: Event Bus + Feature Loader

### Task 0: Create the MeshBus event system and feature loader

**Files:**
- Create: `assets/features/_bus.js`
- Modify: `app.html` (add script tags)
- Modify: `assets/app-workspace.js` (expose state + emit events)

The bus allows features to subscribe to state changes and actions without modifying core code.

---

## Phase 1: AI Power Features

### Task 1: Streaming Chat Responses (SSE)
**Files:**
- Create: `assets/features/streaming-chat.js`
- Modify: `src/routes/assistant.routes.js` (add `/api/assistant/chat/stream` endpoint)
- Modify: `src/core/index.js` (add `streamModelChat` function)

### Task 2: @-Mentions Context Picker
**Files:**
- Create: `assets/features/at-mentions.js`
- Modify: `assets/app-workspace.css` (mention dropdown styles)

### Task 3: Multi-File Agentic Edits with Diff Preview
**Files:**
- Create: `assets/features/agentic-edits.js`
- Modify: `src/routes/assistant.routes.js` (add `/api/assistant/apply-edits` endpoint)

### Task 4: Cmd+K Inline Edit
**Files:**
- Create: `assets/features/inline-edit.js`

### Task 5: Inline Completion Backend
**Files:**
- Modify: `src/routes/assistant.routes.js` (add `/api/inline-complete` SSE endpoint)

### Task 6: Background Agent Mode
**Files:**
- Create: `assets/features/background-agent.js`
- Modify: `src/routes/assistant.routes.js` (add `/api/assistant/agent/run` endpoint)

### Task 7: AI Code Review in Diff View
**Files:**
- Create: `assets/features/ai-review.js`

## Phase 2: Editor Features

### Task 8: Command Palette (Cmd+Shift+P)
**Files:**
- Create: `assets/features/command-palette.js`

### Task 9: Split Editor / Multi-Pane
**Files:**
- Create: `assets/features/split-editor.js`

### Task 10: Diff Editor Integration
**Files:**
- Create: `assets/features/diff-editor.js`

### Task 11: Content Search (Grep in Files)
**Files:**
- Create: `assets/features/content-search.js`

### Task 12: Problems Panel (Live Errors)
**Files:**
- Create: `assets/features/problems-panel.js`

### Task 13: Quick Open (Cmd+P)
**Files:**
- Create: `assets/features/quick-open.js`

## Phase 3: Capsula Intelligence

### Task 14: Capsula Status Overlay in Explorer
**Files:**
- Create: `assets/features/capsula-status.js`

### Task 15: Focused Capsule Viewer Tab
**Files:**
- Create: `assets/features/capsule-viewer.js`

### Task 16: Span Navigation (Click @sp_xxx -> Editor)
**Files:**
- Create: `assets/features/span-nav.js`

### Task 17: Context Budget Visualizer
**Files:**
- Create: `assets/features/context-budget.js`

### Task 18: Re-Index on Save
**Files:**
- Create: `assets/features/reindex-on-save.js`

## Phase 4: Workflow

### Task 19: Checkpoint/Snapshot System
**Files:**
- Create: `assets/features/checkpoints.js`
- Modify: `src/routes/assistant.routes.js` (add checkpoint endpoints)

### Task 20: .meshrules Custom AI Rules
**Files:**
- Create: `assets/features/meshrules.js`

### Task 21: Chat History/Threads
**Files:**
- Create: `assets/features/chat-threads.js`
- Modify: `src/routes/assistant.routes.js` (add thread endpoints)

---
