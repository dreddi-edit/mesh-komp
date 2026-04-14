---
tags: [architecture, benchmark]
---

# Compression Benchmark

## TL;DR

Mesh's capsule pipeline reduces LLM token cost by **~94% on typical source files**. A 20-file workspace that would cost ~16,000 tokens uncompressed needs only ~1,000 tokens with capsules — a **16× reduction**.

The capsule pipeline beats the legacy `llm-compress` heuristic by **1.5–3.7×** on large files, because capsules use AST awareness to discard low-priority code while preserving structural shape.

## How to Read the Numbers

The benchmark runs five file types (code, config, SQL, markup, docs) at three sizes each (small, medium, large) through the full pipeline.

| Metric | What It Measures | Lower = Better? |
|--------|-----------------|:---------------:|
| **Capsule %** | Tokens the LLM sees, as % of the original file | Yes |
| **Focused %** | Tokens after query-driven filtering (e.g. "show auth logic") | Yes |
| **Transport %** | Wire/storage bytes (zstd/Brotli compressed), as % of raw | Yes |
| **llm80 %** | Legacy `llm-compress` heuristic, for comparison | — |

## The Key Result: Large Files

This is the number that matters — real workspace files are typically hundreds to thousands of tokens.

| File Type | Raw Tokens | Capsule Tokens | Saved | Savings |
|-----------|----------:|---------------:|------:|--------:|
| Code (.ts) | 1,149 | 77 | 1,072 | **93.3%** |
| Config (.yaml) | 574 | 46 | 528 | **92.0%** |
| SQL (.sql) | 993 | 64 | 929 | **93.6%** |
| Markup (.html) | 826 | 45 | 781 | **94.5%** |
| Docs (.md) | 1,037 | 46 | 991 | **95.6%** |

**Average: ~93.8% token reduction on large files.**

![[Assets/benchmark-graphics/compression-benchmark-large-file-savings.svg|1400]]

## Capsule vs Legacy llm-compress

On large files, the capsule pipeline consistently wins:

| Type | Capsule | llm-compress | Capsule Advantage |
|------|--------:|-------------:|------------------:|
| Code | 6.7% | 19.5% | **2.9×** better |
| Config | 7.9% | 19.6% | **2.5×** better |
| SQL | 6.5% | 9.7% | **1.5×** better |
| Markup | 5.4% | 20.0% | **3.7×** better |
| Docs | 4.4% | 11.5% | **2.6×** better |

The gap widens with file size — tree-sitter AST analysis can aggressively prune low-value spans in ways line-based heuristics cannot.

![[Assets/benchmark-graphics/compression-benchmark-vs-legacy.svg|1400]]

## Small Files: Where Compression Doesn't Help

For very small files (under ~50 tokens), the capsule header overhead can exceed the original content. Config and markup small fixtures expand past 100% — the pipeline detects this (`capsuleMode: emergency`) but still attaches structure.

In practice, files this small now use **tiny-passthrough** (≤150 tokens bypass the pipeline entirely and are included verbatim with a minimal header).

## Recovery: Getting Exact Source Back

When a capsule is too compressed for a task, the assistant pulls exact source via span IDs:

| File | Spans Pulled | Bytes Recovered | % of Raw |
|------|:------------:|----------------:|---------:|
| Code | 4 | 1,319 | 28.7% |
| Config | 4 | 47 | 2.1% |
| SQL | 4 | 1,325 | 33.4% |
| Markup | 4 | 95 | 2.9% |
| Docs | 4 | 959 | 23.1% |

Code and SQL recover larger blocks (function bodies, view definitions are the natural span unit). Config and markup have compact recoverable spans (individual keys, attributes).

Pattern: reason with compressed context first → pull exact source fragments only when needed.

![[Assets/benchmark-graphics/compression-benchmark-recovery.svg|1400]]

## Full Results Table

<details>
<summary>All 15 fixtures (click to expand)</summary>

| ID | Raw Bytes | Raw Tokens | Capsule % | Focused % | Transport % | llm80 % |
|----|----------:|-----------:|----------:|----------:|------------:|--------:|
| code:small | 412 | 103 | 74.8% | 87.4% | 54.9% | 43.0% |
| code:medium | 1,549 | 388 | 20.0% | 23.3% | 17.7% | 19.8% |
| code:large | 4,593 | 1,149 | 6.7% | 7.8% | 8.0% | 19.5% |
| config:small | 185 | 47 | 131.4% | 171.4% | 73.5% | 92.4% |
| config:medium | 757 | 190 | 24.0% | 30.4% | 25.9% | 22.7% |
| config:large | 2,294 | 574 | 7.9% | 10.0% | 12.8% | 19.6% |
| sql:small | 329 | 83 | 77.8% | 94.5% | 67.2% | 51.4% |
| sql:medium | 1,322 | 331 | 19.4% | 23.6% | 17.9% | 19.5% |
| sql:large | 3,972 | 993 | 6.5% | 7.8% | 6.6% | 9.7% |
| markup:small | 308 | 77 | 80.8% | 98.7% | 53.3% | 55.5% |
| markup:medium | 1,124 | 281 | 15.9% | 20.4% | 17.0% | 19.1% |
| markup:large | 3,304 | 826 | 5.4% | 6.9% | 6.9% | 20.0% |
| docs:small | 343 | 86 | 53.4% | 69.1% | 61.2% | 28.6% |
| docs:medium | 1,378 | 345 | 13.4% | 17.3% | 17.9% | 14.7% |
| docs:large | 4,146 | 1,037 | 4.4% | 5.7% | 7.5% | 11.5% |

</details>

## Parser Coverage

All fixture families parsed successfully:

| Family | Parser | Parse OK |
|--------|--------|:--------:|
| Code (.ts) | tree-sitter | ✓ |
| Config (.yaml) | yaml | ✓ |
| SQL (.sql) | node-sql-parser | ✓ |
| Markup (.html) | tree-sitter | ✓ |
| Docs (.md) | marked | ✓ |

Unsupported extensions fall back to `heuristic` parser.

## Running the Benchmark

```bash
npm run bench:compression
# or
node benchmarks/compression-benchmark.js
node benchmarks/compression-benchmark.js --json   # JSON output
```

**Last run:** 2026-04-11
**Node.js:** 22+ (zstd transport enabled)
**Stack:** rawStorage = Brotli-9, transport = zstd-chunked @ 256 KB/chunk
