# Mesh — Executive Summary

**The AI-native coding environment built around voice and workspace intelligence.**

---

## The Problem

AI coding tools are hitting a wall: context windows are finite, real codebases are not. Teams pay for tokens, not value — sending raw code to an LLM burns 99% of the budget on noise. API costs are now a real budget line item. Voice remains completely untapped. And no tool compresses the problem away.

---

## The Solution

Mesh is an AI-native coding environment (web app + desktop) built around a proprietary compression pipeline — **Capsule** — that structurally compresses source code before it reaches any LLM. Combined with voice-first interaction and a unified workbench, it's the only tool that solves context, cost, and workflow simultaneously.

- **Capsule Compression** — 74% average token reduction, 3.9× more codebase per context window, 75% lower API costs. Keeps context utilization in the high-accuracy zone NIAH benchmarks show models need. More codebase context = fewer SWE-bench-style failures from missing information.
- **Unified Workbench** — Editor, Terminal, AI chat, and Dependency Graph in one surface; zero context switching
- **Voice-Driven Agent** — speak intent, get working code; the agent reads compressed codebase context, generates changes, explains them

---

## Product

MVP complete. Three surfaces:

| Surface | What it does |
|---------|-------------|
| **Editor** | Monaco + AI chat + live dependency graph + workspace intelligence |
| **Terminal** | Dedicated terminal workspace, not a bottom panel |
| **Voice-Coding** | Speech-driven agent: say what you want built, watch it happen |

Built on a gateway/worker architecture — scales from indie devs to teams without re-engineering.

---

## Market

- **TAM:** $28B developer tools market, 12% CAGR
- **SAM:** $4.2B AI-enhanced IDE/assistant segment
- **SOM (3yr):** ~$120M — indie devs + small teams, Europe + North America

Cursor crossed $400M ARR in two years at $20/month. Developers pay for tools that save real time.

---

## Business Model

| Tier | Price | Key value |
|------|-------|-----------|
| Free | €0 | Editor + terminal + limited AI |
| Pro | €19/mo | Unlimited AI + voice + full workspace intelligence |
| Teams | €49/seat/mo | Shared workspace context + admin controls |

---

## Traction

- MVP fully functional across all three surfaces
- Capsule pipeline benchmarked: **74% token reduction, 3.9× context gain** — real production numbers
- 8 development phases shipped and verified
- **Next:** 100 beta users → measure voice engagement and real-world token savings

---

## Competition

**VS Code + Copilot** (75.9% market share, SO 2025) — genuinely evolved: multi-model, real Agents, enterprise indexing. Still a 2015 editor with AI layered on. No compression, no voice agent.

**Cursor** — Best dedicated AI editor, Fortune 500 adoption. Has speech-to-text input (dictation), not a voice coding agent. Embedding retrieval, raw tokens to model. Desktop-only, no compression.

**Google Antigravity** *(Nov 2025, free)* — VS Code fork with multi-agent orchestration, multi-model. Serious — but desktop-only, no voice agent, no compression.

**The key distinction:** All three retrieve code with embeddings and send it raw — cost scales with codebase size. Capsule compresses before the model sees it — cost stays flat.

**Mesh's moat:** Voice coding agent + structural compression + full web app (no install). No one else has all three.

---

## Team

**Edgar Baumann, Co-Founder** — Built Mesh end-to-end. Student, WU Wien.

**Philipp Horn, Co-Founder** — Student, WHU. Strong entrepreneurial instinct — business strategy, GTM, and growth.

---

## The Ask

**€500k seed round**
- 55% engineering (voice pipeline + workspace intelligence)
- 25% growth (developer community, content, OSS presence)
- 15% infrastructure (AI inference at scale)
- 5% ops

18-month runway to product-market fit signal with 1,000 paying Pro users.

---

*edgar.baumann@try-mesh.com · philipp.horn@try-mesh.com · Demo available on request*
