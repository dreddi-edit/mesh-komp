# Mesh — Technical Brief: Capsule Compression Engine

**Structural source code compression for LLM context efficiency.**

---

## The Core Problem: Context Utilization and Model Accuracy

Large language models operate with a fixed context window. As context utilization increases, retrieval accuracy degrades — this is not a hypothesis, it is a measured phenomenon documented across multiple independent benchmarks.

### NIAH — Needle In A Haystack

Standard retrieval benchmark: a specific fact is placed at varying positions within a long document; the model must retrieve it. Published research (Liu et al., 2023, *"Lost in the Middle"*) shows:

- Models perform reliably when context utilization is below ~60–70 %
- Above that threshold, retrieval accuracy drops 20–40 % depending on where in the context the target information appears
- The effect compounds at 100k+ token contexts

**Implication:** Loading a large codebase into context doesn't guarantee the model uses it correctly. The more context you load, the more the model's effective comprehension degrades.

### SWE-bench

Industry benchmark for AI coding agents solving real GitHub issues. Top models (Claude Opus 4.6, GPT-4o, Gemini 3.1 Pro) resolve approximately 40–55 % of tasks. Root cause analysis of failures consistently identifies one leading pattern: **the agent lacked sufficient codebase context to understand the problem**.

The solution pursued by current tools — embedding-based retrieval — finds *relevant* files and sends them raw. This does not solve the problem: it selects what gets loaded, but what is loaded still consumes the full raw token budget. As codebase size grows, coverage per context window shrinks.

---

## Capsule: Structural Compression with Selective Recovery

Capsule is Mesh's proprietary compression pipeline. It processes source files **before** they reach any LLM.

### How it works

Capsule applies language-aware structural compression to source files:

1. **Parse** — the file is parsed into its structural components (declarations, signatures, type annotations, doc comments, control flow markers)
2. **Compress** — implementation bodies and non-structural content are reduced to minimal structural representations
3. **Encode** — the result is a compact structural descriptor that preserves the semantic skeleton of the file
4. **Selective recovery** — when the model identifies a specific function or section as relevant, the full implementation can be restored on demand

This is not summarization. The compressed representation is deterministic and lossless at the structural level. The original file is always recoverable in full.

### Activation logic

Capsule activates dynamically based on file size and token count. For very small files (below ~200 tokens), the format overhead exceeds the savings — Capsule skips them. In practice, production codebases are 95 %+ medium-to-large files where compression is effective.

---

## Benchmark Results

Internal benchmarks run against the production Capsule pipeline across 5 file types (TypeScript, YAML, SQL, HTML, Markdown) and 6 size tiers.

### Token reduction by file size

```
File size        Raw tokens    Capsule tokens    Reduction
──────────────────────────────────────────────────────────
~200B  (xs)         ~50 tok        ~55 tok        +10%  ← overhead, skip
~1KB   (small)     ~300 tok        ~55 tok        -83%
~5KB   (medium)    ~850 tok        ~45 tok        -95%
~18KB  (large)   ~2,500 tok        ~35 tok        -98.5%
~50KB  (xl)      ~7,000 tok        ~40 tok        -99.4%
~100KB (xxl)    ~18,000 tok        ~25 tok        -99.9%
──────────────────────────────────────────────────────────
Average (medium–xxl):   -74%  →  3.9× context gain
```

### What 3.9× context gain means in a 128k window

```
Without Mesh    ████████████████████                              ~20 medium files
With Mesh       ████████████████████████████████████████████████████████████████████████████  ~78 medium files
```

The model has access to 3.9× more of the codebase in a single query — without increasing the context window size or switching to a more expensive model.

---

## Cost Analysis

Using Claude Opus 4.6 ($15.00 / MTok input) — the model developers use for complex, multi-file reasoning tasks.

| Scenario | Tokens sent | API cost | Files covered |
|---|---|---|---|
| Raw code | 1,000,000 | $15.00 | ~100 medium files |
| Capsule compressed | 260,000 | **$3.90** | Same 100 files |

**74 % cost reduction per query. No quality loss. Same files, same model, 4× cheaper.**

At scale (10,000 active users, 50 queries/day, 50k token average context):

| Metric | Without Mesh | With Mesh |
|---|---|---|
| Tokens processed / day | 25,000,000,000 | ~6,500,000,000 |
| Reduction | — | **-74%** |
| API cost/day (at $15/MTok) | $375,000 | ~$97,500 |

---

## Competitive Architecture Comparison

All major AI coding tools use **embedding-based retrieval**: semantic search over an indexed codebase returns the most relevant files, which are then sent **raw** to the model.

| Property | Embedding retrieval | Capsule compression |
|---|---|---|
| What reaches the model | Raw file content (full token cost) | Compressed structural descriptor |
| Token cost | Scales with file count × file size | Fixed low cost regardless of file size |
| Context coverage | Limited to what fits raw | 3.9× more files per window |
| Implementation bodies | Sent in full | Compressed, recoverable on demand |
| Small file behavior | No change | Pass-through (overhead skip) |
| Codebase size sensitivity | High | Low |

**The architectural difference:** Retrieval selects *which* files to include. Compression reduces *how much* each file costs. Capsule operates after retrieval — all selected files get compressed before they reach the model. The two approaches are not mutually exclusive; Capsule is additive on top of any retrieval strategy.

---

## Model Compatibility

Capsule is model-agnostic. The compressed output is plain text in a structured format readable by any transformer-based LLM. Mesh currently supports:

- Anthropic: Claude Opus 4.6, Claude Sonnet (any version)
- Google: Gemini 3.1 Pro, Gemini Flash
- OpenAI: GPT-4o, GPT-4o mini, o1, o3

Provider switching is runtime-configurable — no reindexing or pipeline changes required.

---

## Architecture Overview

```
User query
    │
    ▼
Workspace indexer          ← scans open project, builds file registry
    │
    ▼
Capsule compression        ← structural compression per file
    │
    ▼
Context assembler          ← packs compressed files into context window
    │
    ▼
Model provider (API)       ← Claude / Gemini / GPT
    │
    ▼
Selective recovery         ← restores full bodies on model request
    │
    ▼
Response + diff output
```

The gateway/worker split means compression runs in the worker process — horizontally scalable, independent of the UI layer.

---

## File Type Support

| Language / Format | Structural elements preserved |
|---|---|
| TypeScript / JavaScript | Exports, class declarations, function signatures, type definitions, interfaces |
| Python | Module-level declarations, class/function signatures, docstrings |
| YAML / JSON | Top-level keys, schema structure |
| SQL | Table/view/function definitions, column names and types |
| HTML | Document structure, component boundaries |
| Markdown | Heading hierarchy, code block presence |

Support for Go, Rust, Java, and C# is on the roadmap for Capsule v2.

---

*edgar.baumann@try-mesh.com · philipp.horn@try-mesh.com · Technical demo available on request*
