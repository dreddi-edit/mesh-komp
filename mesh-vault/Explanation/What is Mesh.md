---
tags: [explanation, intro]
---

# What is Mesh?

> A plain-language introduction for anyone seeing Mesh for the first time.

---

## The Problem It Solves

When you work in a large codebase, AI assistants hit a wall: there's too much code to fit into the model's context window. The typical workarounds are:

1. **Send the whole file** — expensive, slow, often hits token limits
2. **Cherry-pick lines manually** — tedious, easy to miss the relevant part
3. **Give up and describe the code in words** — inaccurate

Mesh solves this with a technique called **capsule compression**. Instead of sending raw code, it sends a structured summary — a capsule — that preserves the shape of the code (types, function signatures, structure) while discarding the low-priority body text.

---

## How It Works — Step by Step

```
Your Workspace
      │
      ▼
  Tree-sitter
  (parses every file into an AST — a structural map)
      │
      ▼
  Capsule Generator
  (builds a tiered summary: ultra / medium / loose)
      │
      ├──► Ultra capsule    →  signatures only, ~3% of original
      ├──► Medium capsule   →  signatures + key comments
      └──► Loose capsule    →  signatures + inline bodies
      │
      ▼
  Focused Capsule (optional)
  (query-filtered: "show me auth logic" → only auth spans)
      │
      ▼
  AI Model
  (sees the capsule, not the raw source)
      │
      ▼
  Span Recovery (when needed)
  (AI requests exact source for a specific function → only that function is sent)
```

The result: a 1,000-token file becomes a ~65-token capsule. A 20-file workspace fits comfortably in a single context window.

---

## The Three Surfaces

![[../Assets/explanation/mesh-surfaces-diagram.svg|1200]]

### Editor
The main IDE. It looks and feels like VS Code: file explorer on the left, Monaco editor in the center, an AI chat panel on the right. The difference: every file in your workspace is already compressed and indexed. The AI chat works on the full workspace, not just the open file.

### Terminal
A full page terminal tied to your active workspace. Run commands, see output, and ask the AI about what happened — all in the same session.

### Voice Coding
A speech-first mode. You speak → your words go to Amazon Transcribe (speech-to-text) → a tool-capable AI agent responds → the reply is spoken back via Amazon Polly (text-to-speech). You can ask it to read files, make edits, run git commands, or hand off long tasks to the typed agent.

---

## What "Capsule Tiers" Mean

| Tier | What's included | When it's used |
|------|----------------|----------------|
| **Ultra** | Function/class names + return types only | Initial workspace scan |
| **Medium** | Signatures + key doc comments | Browsing / search |
| **Loose** | Signatures + inline comments + short bodies | Active editing |
| **Focused** | Query-filtered spans only | "Show me auth logic" |
| **Full source** | Verbatim code via span recovery | Precision edits |

The AI moves between tiers automatically: start broad (ultra), zoom in (medium/loose), pull exact source only when needed.

---

## Token Savings — The Numbers

On real-world large files, capsule compression reduces the tokens the AI sees by an average of **93.8%**:

![[../Assets/benchmark-graphics/compression-benchmark-large-file-savings.svg|1200]]

Compared to the previous heuristic compression (llm-compress), the AST-aware capsule pipeline is **1.5–3.7× more efficient**:

![[../Assets/benchmark-graphics/compression-benchmark-vs-legacy.svg|1200]]

---

## The Workspace Model

When you use Mesh, you either:
- **Upload a folder** from your computer — Mesh indexes it once and stores it
- **Point to a local path** — Mesh watches the folder live (requires the desktop shell or a local agent)

Once indexed, the workspace is available to every surface: editor, terminal, voice. The dependency graph view shows you how files relate to each other.

---

## BYOK — Bring Your Own Key

Mesh works with your own AI provider keys. You can connect:
- **Anthropic** (Claude)
- **OpenAI** (GPT)
- **Google** (Gemini)

Your keys are encrypted with AES-256-GCM before storage and never logged. You can also use Mesh's built-in Bedrock connection (no key needed).

---

## In One Sentence

> Mesh is a browser IDE that compresses your entire codebase into a structured summary before sending it to an AI — so the AI always has full workspace context, at a fraction of the cost.

---

*Next: [[Architecture Overview]] — how the system is actually built*
*Or: [[../Architecture/Compression Pipeline]] — technical deep dive on capsule generation*
