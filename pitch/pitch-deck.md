# Mesh — Pitch Deck

> *The coding environment that thinks with you.*

---

## Slide 1 — Cover

**Mesh**
The AI-Native Coding Environment

Edgar Baumann & Philipp Horn — Co-Founders
Vienna, Austria · 2026

---

## Slide 2 — Problem

### AI coding tools are hitting a wall — and it's called context.

Every AI coding tool faces the same fundamental constraint: **LLM context windows are finite, and real codebases are not.**

- **AI assistants hallucinate** because they can only see a fraction of your codebase at once
- **API costs explode** as teams load more code into context — paying for tokens, not value
- **Large files are the worst offenders** — a single 50KB module consumes most of a 128k context window
- **Voice is completely untapped** — developers still type every command, even when speaking is faster

> Sending raw code to an LLM is like faxing a dictionary to answer a single question.
> You're paying for 99% noise to get 1% signal.

> The average developer spends 42% of their time understanding code, not writing it.
> *(Stack Overflow Developer Survey 2023)*

---

## Slide 3 — Solution

### Mesh: One environment. Full context. Voice + AI.

Mesh is an AI-native coding environment — available as a web app and desktop app — that combines three things no other tool does together:

| What | How it works |
|------|-------------|
| **Capsule Compression** | Proprietary pipeline reduces token usage by 74% on average — 3.9× more codebase per context window, 75% lower API costs, better model accuracy |
| **Unified Workbench** | Editor + Terminal + AI chat + Dependency Graph — one surface, zero switching |
| **Voice-Driven Agent** | Speak your intent. Mesh reads compressed codebase context, generates changes, explains them |

---

## Slide 4 — The Compression Engine

### The technology that makes everything else possible.

Mesh's workspace intelligence is built on a proprietary compression pipeline — **Capsule** — that structurally compresses source code before it ever reaches an LLM.

This isn't summarization. It's structural compression with selective recovery — the full file can be reconstructed on demand.

**Why context quality matters — three independent benchmarks:**

**A — NIAH (Needle In A Haystack):** Standard benchmark measuring whether an LLM can retrieve a specific fact buried in a long context. Research consistently shows models degrade significantly when context is above ~60–70% utilization ("Lost in the Middle" effect — Liu et al., 2023). At 100k+ token contexts, retrieval accuracy drops 20–40% depending on where in the context the information appears. Capsule keeps context utilization low regardless of codebase size — the model always operates in the high-accuracy zone.

**B — SWE-bench:** The standard benchmark for AI coding agents solving real GitHub issues. Top agents (Claude, GPT-4o, Gemini) resolve ~40–55% of tasks. A leading failure mode: the agent lacks sufficient codebase context to understand the problem fully. Capsule directly addresses this — more codebase fits in context, fewer failures from missing information.

**C — Capsule internal benchmarks** *(production pipeline, 5 file types, 6 size tiers)*:

**How much smaller does Capsule make your code?**
*(TypeScript, YAML, SQL, HTML, Markdown — real production numbers)*

```
File size      Raw tokens    After Capsule    Savings
─────────────────────────────────────────────────────
~1KB  (small)     300 tok  ████░░░░░░  55 tok   -83%
~5KB  (medium)    850 tok  ██░░░░░░░░  45 tok   -95%
~18KB (large)   2,500 tok  █░░░░░░░░░  35 tok   -98.5%
~50KB (XL)      7,000 tok  ░░░░░░░░░░  40 tok   -99.4%
~100KB (XXL)   18,000 tok  ░░░░░░░░░░  25 tok   -99.9%
─────────────────────────────────────────────────────
Average across all file sizes:    -74%  →  3.9× context gain
```

> **Honest caveat:** Tiny files under ~200 tokens get *larger* with Capsule — the format overhead exceeds the savings. Capsule activates automatically only when compression is worthwhile. Real codebases are 95%+ medium-to-large files.

**What 3.9× context gain means in a 128k window:**

```
Without Mesh   ████████████████████  ~20 medium files
With Mesh      ████████████████████████████████████████████████████████████████████████████  ~78 medium files
```

**The cost math (Claude Opus 4.6 — $15/MTok input, the model developers actually use for complex tasks):**

| | Tokens sent | API cost | Context coverage |
|---|---|---|---|
| Raw code | 1,000,000 | ~$15.00 | ~100 medium files |
| Capsule | 260,000 | **~$3.90** | Same 100 files |

**74% cost reduction per query. No quality loss. Same files, same model, 4× cheaper.**

**Sustainability impact:**

At 10,000 active users, 50 queries/day, average query context of 50k tokens:
- Without Mesh: **25 billion tokens/day** processed
- With Mesh: **~6.5 billion tokens/day**
- **~18.5 billion fewer tokens daily** — proportionally less compute, electricity, and data center cooling water

> *Mesh isn't just cheaper for developers. It's cheaper for the planet.*

---

## Slide 5 — Product

### Built for the way developers actually think.

**Three surfaces, one flow:**

**Editor**
Monaco-based editor with AI chat panel, file explorer, live dependency graph, and workspace intelligence sidebar. The AI knows your entire codebase before you ask — compressed, indexed, always current.

**Terminal**
Dedicated terminal workspace mode — not a bottom panel, a full surface. Runs alongside the editor without losing context.

**Voice-Coding**
Speech-driven agent. Say *"refactor the auth middleware to use JWT"* — Mesh reads the relevant files via Capsule, generates the change, and explains it. No typing required.

**What makes it different:**
- Capsule compression pipeline — 74% fewer tokens, same intelligence
- Dependency graph that updates live as code changes
- Persistent workspace memory across sessions
- Multi-model: works with Claude Opus/Sonnet, Gemini, and others — not locked to one provider

---

## Slide 6 — Market

### Every developer is a potential user. We're starting with the ones who feel the cost most.

**TAM:** Global developer tools market — **$28B** (2024), growing at 12% CAGR

**SAM:** AI-enhanced IDE / coding assistant segment — **$4.2B** (2025 est.)

**SOM (3-year target):** Indie developers + small teams in Europe and North America — **~$120M**

**Why now:**
- LLMs crossed the threshold where voice-to-code is genuinely usable
- Cursor proved developers will pay for AI-native editors (~$400M ARR in 2 years)
- API costs are now a real budget line item for dev teams — compression has ROI
- Green tech pressure: enterprises increasingly track AI energy spend

---

## Slide 7 — Traction

### Early stage — real foundation.

- **MVP complete** — Editor, Terminal, Voice-Coding surfaces fully functional
- **Capsule pipeline live** — benchmarked at 74% average token reduction across all file types
- **Architecture designed for scale** — gateway/worker split, multi-provider AI support
- **Active development** — 8 shipped phases with verified completion

**Next milestone:** First 100 beta users → measure retention, voice feature engagement, and real-world token savings

---

## Slide 8 — Business Model

### Freemium → Pro → Teams

**Free tier**
- Full editor + terminal
- AI chat (limited requests/month)
- Basic workspace indexing

**Pro — €19/month**
- Unlimited AI requests
- Full Capsule compression (large codebase support)
- Voice-coding agent
- Priority model access

**Teams — €49/seat/month**
- Everything in Pro
- Shared workspace intelligence
- Team-level codebase context
- Admin controls + usage analytics

**Why this works:**
Cursor charges $20/month and crossed $400M ARR. Developers pay for tools that save time. Mesh saves time *and* money on API costs — double the value proposition.

---

## Slide 9 — Competition

### We're not an extension. We're the environment.

The real competition is where developers already live.

| | Mesh | VS Code + Copilot | Cursor | Google Antigravity |
|---|---|---|---|---|
| Voice-driven coding agent | ✅ | ❌ | STT only² | ❌ |
| Structural token compression | ✅ | ❌ | ❌ | ❌ |
| Whole-codebase AI context | ✅ | Partial¹ | Partial¹ | Partial¹ |
| Web app available | ✅ | Partial³ | ❌ | ❌ |
| AI-native from ground up | ✅ | ❌ (retrofitted) | ✅ | ✅ |
| Multi-model | ✅ | ✅ | ✅ | ✅ |
| Agent orchestration | ✅ | ✅ (Copilot Agents) | ✅ | ✅ (multi-agent) |

*¹ Embedding-based retrieval — finds relevant files, sends raw tokens to model*
*² Cursor has speech-to-text input (dictate into chat box) — not a voice-driven coding agent*
*³ VS Code for the Web (vscode.dev) exists but has no terminal, no debugger, and limited extension support — Copilot functionality is restricted*

**VS Code + Copilot** — 75.9% of developers (Stack Overflow 2025). Copilot evolved significantly: multi-model (Claude Opus 4.6, GPT-5 mini, Gemini), real Agents that plan and self-correct, MCP integration, enterprise codebase indexing. Genuinely powerful — but still a 2015 editor architecture with AI layered on top. No compression, no voice agent, fragmented experience across plugins.

**Cursor** — Best dedicated AI editor (Fortune 500 adoption). VS Code fork, multi-model, strong agent story. Has speech-to-text input (`Ctrl+M`) but that's dictation-to-chat, not a voice coding agent. Embedding-based `@codebase` retrieval — finds relevant files, sends them raw to the model. Desktop-only, no structural compression.

**Google Antigravity** *(released November 2025, free preview)* — VS Code fork with multi-agent manager view. Supports Gemini, Claude, GPT. Strong agent orchestration story. Desktop-only, no voice agent, no compression.

**The distinction that matters:** All three use embeddings to *retrieve* code then send it raw. Token cost scales with codebase size. Capsule *structurally compresses* before the model sees anything — cost stays flat regardless of codebase size.

**Where Mesh wins uniquely:** The only environment where you speak your intent *and* the model sees your entire codebase at a fraction of the cost. Voice agent + compression together — no one else has both.

---

## Slide 10 — Team

### Built by developers, for developers.

**Edgar Baumann — Co-Founder**
- Built Mesh end-to-end
- Student, WU Wien
- Obsessed with the gap between how developers think and how tools make them work

**Philipp Horn — Co-Founder**
- Student, WHU
- Strong entrepreneurial instinct — business strategy, GTM, and growth

**Why we'll win:**
Mesh comes from felt pain, not a market analysis. The team built the tool they needed and it didn't exist.

---

## Slide 11 — Vision

### In 5 years, sending raw code to an AI will seem as wasteful as printing emails.

**12 months:** 1,000 paying Pro users, Capsule compression as the industry reference benchmark, first team accounts

**24 months:** 10,000 users, Mesh as the standard for token-efficient AI coding, Series A, open Capsule SDK for third-party integrations

**5 years:** The default environment for developers who think faster than they type — and a compression infrastructure layer that powers other AI tools


---

## Slide 12 — The Ask

### Seed round: €500k

**Use of funds:**
| Allocation | % | Purpose |
|---|---|---|
| Engineering | 55% | 2 senior engineers — voice pipeline + Capsule v2 |
| Growth | 25% | Developer marketing, open source presence, content |
| Infrastructure | 15% | Cloud costs for AI inference at scale |
| Operations | 5% | Legal, tools, office |

**What we need beyond capital:**
- Access to developer communities (ProductHunt, Hacker News, dev Discord ecosystems)
- Go-to-market mentorship — B2C SaaS for developers
- Connections to sustainability-focused investors (green AI angle)
- Connections to follow-on investors for Series A

**Runway:** 18 months to product-market fit signal

---

## Slide 13 — Why Now. Why Us.

### Four things aligned that have never aligned before:

1. **Token costs are now a budget line item** — teams feel the API cost pain on every complex query
2. **Context quality directly impacts output quality** — NIAH and SWE-bench make this measurable
3. **No tool compresses at the infrastructure layer** — retrieval (embeddings) is the industry default, but it doesn't reduce what reaches the model
4. **Green AI is emerging** as a procurement criterion — 74% fewer tokens means proportionally less compute and energy

Mesh is the only tool that treats **compression as infrastructure** — not as a feature, not as an afterthought, but as the core architectural layer every AI interaction is built on.

**We're not building a plugin. We're building the efficiency layer that every AI coding environment needs — and a workbench on top of it.**

---

*edgar.baumann@try-mesh.com · philipp.horn@try-mesh.com · Demo available on request*
