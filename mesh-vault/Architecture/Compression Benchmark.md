---
tags: [architecture, benchmark]
---

# Compression Benchmark

Results from `benchmarks/compression-benchmark.js` — run against five fixture families (code, config, SQL, markup, docs) at three sizes each (small, medium, large).

**Last run:** 2026-04-11  
**Node.js:** 22+ (zstd transport enabled)  
**Raw compression stack:** rawStorage = Brotli-9, transport = zstd-chunked @ 256 KB/chunk  
**Re-run:** `npm run bench:compression` or `node benchmarks/compression-benchmark.js`  
**Re-run (JSON):** `node benchmarks/compression-benchmark.js --json`

---

## What the Numbers Mean

| Column | Meaning |
|--------|---------|
| **raw tokens** | Claude token estimate of the uncompressed file |
| **capsule %** | Tokens sent to the LLM as the base capsule, as % of raw |
| **focused %** | Tokens after query-driven focused capsule (query scoring applied) |
| **recovery %** | Bytes of exact source pulled back via span recovery, as % of raw |
| **transport %** | Bytes of the Brotli/zstd transport envelope, as % of raw bytes |
| **llm80 %** | Legacy `llm-compress` heuristic for comparison |

Capsule and focused ratios measure **LLM token cost** — lower is better.  
Transport ratio measures **storage / wire cost** — lower is better.  
Recovery ratio shows how much source you get back when you need exact spans — ideally a small targeted pull.

---

## Full Results

| ID | raw B | raw tok | capsule % | capsule tok | focused % | transport % | llm80 % |
|----|------:|--------:|----------:|------------:|----------:|------------:|--------:|
| code:small | 412 | 103 | 74.8% | 77 | 87.4% | 54.9% | 43.0% |
| code:medium | 1,549 | 388 | 20.0% | 78 | 23.3% | 17.7% | 19.8% |
| code:large | 4,593 | 1,149 | 6.7% | 77 | 7.8% | 8.0% | 19.5% |
| config:small | 185 | 47 | 131.4% | 61 | 171.4% | 73.5% | 92.4% |
| config:medium | 757 | 190 | 24.0% | 46 | 30.4% | 25.9% | 22.7% |
| config:large | 2,294 | 574 | 7.9% | 46 | 10.0% | 12.8% | 19.6% |
| sql:small | 329 | 83 | 77.8% | 64 | 94.5% | 67.2% | 51.4% |
| sql:medium | 1,322 | 331 | 19.4% | 65 | 23.6% | 17.9% | 19.5% |
| sql:large | 3,972 | 993 | 6.5% | 64 | 7.8% | 6.6% | 9.7% |
| markup:small | 308 | 77 | 80.8% | 63 | 98.7% | 53.3% | 55.5% |
| markup:medium | 1,124 | 281 | 15.9% | 45 | 20.4% | 17.0% | 19.1% |
| markup:large | 3,304 | 826 | 5.4% | 45 | 6.9% | 6.9% | 20.0% |
| docs:small | 343 | 86 | 53.4% | 46 | 69.1% | 61.2% | 28.6% |
| docs:medium | 1,378 | 345 | 13.4% | 46 | 17.3% | 17.9% | 14.7% |
| docs:large | 4,146 | 1,037 | 4.4% | 46 | 5.7% | 7.5% | 11.5% |

> **config:small and markup:small expand** past 100% because the capsule header/structure overhead exceeds the source for files under ~50 tokens. The pipeline detects this (`capsuleMode: emergency`) but still attaches structure. Files this small should use raw or focused mode instead.

---

## Token Savings at Scale — Large Files

This is the number that matters for real workspaces, where files are typically hundreds to thousands of tokens.

| File type | raw tokens | capsule tokens | **tokens saved** | **savings** |
|-----------|----------:|---------------:|-----------------:|------------:|
| code | 1,149 | 77 | 1,072 | **93.3%** |
| config | 574 | 46 | 528 | **92.0%** |
| SQL | 993 | 64 | 929 | **93.6%** |
| markup | 826 | 45 | 781 | **94.5%** |
| docs | 1,037 | 46 | 991 | **95.6%** |

**Average token reduction on large files: ~93.8%**

A 20-file workspace of typical source files (~800 tokens each) would cost ~16,000 tokens uncompressed. With capsules: ~1,000 tokens total — a **16× reduction**.

---

## Capsule vs Legacy llm-compress (large files only)

| Type | capsule % | llm80 % | capsule advantage |
|------|----------:|--------:|------------------:|
| code | 6.7% | 19.5% | **2.9×** |
| config | 7.9% | 19.6% | **2.5×** |
| SQL | 6.5% | 9.7% | **1.5×** |
| markup | 5.4% | 20.0% | **3.7×** |
| docs | 4.4% | 11.5% | **2.6×** |

The capsule pipeline beats llm-compress by 1.5–3.7× on large files. The gap widens with file size because capsules use tree-sitter AST awareness to aggressively discard low-priority spans while preserving structural shape — something line-based heuristics cannot replicate.

---

## Average Ratios by Family (all sizes)

| Family | avg capsule | avg focused | avg transport | avg llm80 |
|--------|------------:|------------:|--------------:|----------:|
| code | 33.8% | 39.5% | 26.9% | 27.4% |
| config | 54.4% | 70.6% | 37.4% | 44.9% |
| SQL | 34.6% | 42.0% | 30.6% | 26.9% |
| markup | 34.1% | 42.0% | 25.7% | 31.5% |
| docs | 23.7% | 30.7% | 28.8% | 18.2% |

Config is the hardest to compress semantically (dense key-value pairs, little structural hierarchy). Docs compress best because Markdown sections map cleanly to span priorities.

---

## Recovery: Exact Source On Demand

When the capsule is too stripped for a task, the assistant pulls exact source fragments via span IDs:

| File | spans pulled | bytes recovered | % of raw |
|------|-------------:|----------------:|---------:|
| code:large | 4 | 1,319 | 28.7% |
| config:large | 4 | 47 | 2.1% |
| sql:large | 4 | 1,325 | 33.4% |
| markup:large | 4 | 95 | 2.9% |
| docs:large | 4 | 959 | 23.1% |

Config and markup have compact recoverable spans (individual keys / attributes). Code and SQL recover larger blocks because function bodies and view definitions are the natural span unit.

Recovery endpoint: `workspace.recovery.fetch` on Worker.

---

## Parser Coverage

All fixture families parsed successfully with dedicated parsers:

| Family | Parser | Parse OK |
|--------|--------|:--------:|
| code (.ts) | tree-sitter | ✓ |
| config (.yaml) | yaml | ✓ |
| SQL (.sql) | node-sql-parser | ✓ |
| markup (.html) | tree-sitter | ✓ |
| docs (.md) | marked | ✓ |

Fallback (`heuristic`) triggers for unsupported extensions. See `mesh-core/src/compression-core.cjs` → `buildWorkspaceFileRecord` for the parser dispatch.

---

## Benchmark Source

```
benchmarks/compression-benchmark.js   ← runner + fixture builders + reporter
mesh-core/src/compression-core.cjs     ← buildWorkspaceFileRecord, buildWorkspaceFileView
llm-compress.js                        ← legacy comparison baseline
```

The benchmark builds synthetic fixtures across five file types and three sizes, runs the full pipeline (initial record → capsule tiers → focused capsule → recovery), and compares against the legacy llm-compress baseline.
