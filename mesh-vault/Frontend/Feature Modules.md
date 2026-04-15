---
tags: [frontend]
---

# Feature Modules

All feature modules live in `assets/features/`. They are loaded by `views/app.html` and communicate via `window.MeshActions`, `window.MeshState`, and the event bus.

## Event Bus

`assets/features/_bus.js` — lightweight event bus and shared bootstrapping anchor. Most feature modules import from here.

## Feature Modules Reference

| File | Purpose |
|------|---------|
| `streaming-chat.js` | Chat streaming UI on top of the workbench shell |
| `voice-chat.js` | Voice UI, orb/timeline state, approval prompts, WebSocket client for voice session |
| `voice-audio-worklet.js` | Audio worklet for mic capture and speaker playback |
| `command-palette.js` | Command palette UI and command wiring |
| `quick-open.js` | Quick-open file UX (⌘P equivalent) |
| `content-search.js` | Full-text search over workspace files |
| `at-mentions.js` | @mention insertion in chat |
| `agentic-edits.js` | Applies agent-driven edits to files |
| `background-agent.js` | Background agent execution |
| `inline-edit.js` | Inline editing inside the Monaco editor |
| `checkpoints.js` | Checkpointing around edits and agent operations |
| `reindex-on-save.js` | Single-file reindex hooks after file saves |
| `diff-editor.js` | Monaco diff editor tab/view support |
| `split-editor.js` | Split-editor support for multiple panes |
| `capsule-viewer.js` | Visualizer for compressed/capsule file representations |
| `capsula-status.js` | Status display around capsule/compression state |
| `context-budget.js` | Token/context budget visualization |
| `problems-panel.js` | Problem/error panel integration |
| `span-nav.js` | Navigation to referenced spans/locations |
| `meshrules.js` | Feature logic for Mesh rules/instructions interactions |
| `chat-threads.js` | Thread/session behavior for chat history |
| `ai-review.js` | AI review flow over workspace or code selections |

## Dependency Graph (`assets/app-graph.js`)

Rendered via D3. Key behaviours added in recent phases:
- **Staggered entrance animation** — nodes fade and translate in with a per-node delay on initial render and after re-layout
- **Empty-explorer persistence** — `#emptyExp` element is preserved across `renderTree()` DOM wipes (does not disappear when tree is re-rendered)

## Communication Pattern

Feature modules communicate with the shell via:

```javascript
window.MeshActions.someAction(payload)   // trigger an action
window.MeshState.someValue               // read state
```

And with each other via the event bus:
```javascript
bus.emit('event-name', data)
bus.on('event-name', handler)
```

## Voice-Specific Modules

`voice-chat.js` is the most complex feature module:
- Manages WebSocket connection to `/api/realtime`
- Streams PCM audio from `voice-audio-worklet.js`
- Gates mic on `session.ready`
- Mounts orb into the Voice-Coding surface
- Mirrors transcripts and run state into the viewer panel

`voice-audio-worklet.js` runs in a separate AudioWorklet context:
- Captures mic input as PCM
- Plays back TTS audio from the server
