'use strict';

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const PITCH_DIR = __dirname;
const OUT_DIR = path.join(PITCH_DIR, 'export');
fs.mkdirSync(OUT_DIR, { recursive: true });

const TEMPLATE = fs.readFileSync(path.join(PITCH_DIR, 'pdf-template.html'), 'utf8');

// Read brand SVG for inline embedding
const ICON_SVG = fs.readFileSync(
  path.join(PITCH_DIR, '../assets/brand/icon-color.svg'), 'utf8'
).replace(/<svg/, '<svg width="24" height="24"');

function page(content) {
  return `<div class="page">${content}</div>`;
}

function pf(content, label, pg, contact = 'edgar.baumann@try-mesh.com · philipp.horn@try-mesh.com') {
  return `<div class="page">
${content}
<div class="page-footer">
  <span>${label}</span>
  <span>${contact}</span>
  <span>${pg}</span>
</div>
</div>`;
}

function hdr(tag) {
  return `<div class="page-header">
<div class="brand-lockup">
  ${ICON_SVG}
  <span class="brand-name">Mesh.</span>
</div>
<span class="header-tag">${tag}</span>
</div>`;
}

function cover(eyebrow, title, subtitle, founders, stats, contact, year = '2026') {
  const statsHtml = stats.map(s =>
    `<div class="cover-stat"><div class="cover-stat-value">${s.value}</div><div class="cover-stat-label">${s.label}</div></div>`
  ).join('');
  const foundersHtml = founders.map(f =>
    `<div><div class="cover-founder-name">${f.name}</div><div class="cover-founder-role">${f.role}</div></div>`
  ).join('');
  return `<div class="cover">
<div class="cover-top-bar"></div>
<div class="cover-body">
  <div class="cover-eyebrow">${eyebrow}</div>
  <div class="cover-logo">${ICON_SVG}<span class="cover-title">${title}</span></div>
  <div class="cover-subtitle">${subtitle}</div>
  <div class="cover-rule"></div>
  <div class="cover-founders">${foundersHtml}</div>
  <div class="cover-stats">${statsHtml}</div>
</div>
<div class="cover-footer">
  <span class="cover-footer-contact">${contact}</span>
  <span class="cover-footer-year">Confidential · ${year}</span>
</div>
</div>`;
}

const FOUNDERS_EN = [
  { name: 'Edgar Baumann', role: 'Co-Founder · WU Wien' },
  { name: 'Philipp Horn',  role: 'Co-Founder · WHU' },
];

const FOUNDERS_DE = [
  { name: 'Edgar Baumann', role: 'Co-Founder · WU Wien' },
  { name: 'Philipp Horn',  role: 'Co-Founder · WHU' },
];

const STATS_MAIN = [
  { value: '74%',   label: 'avg token reduction (Capsule)' },
  { value: '3.9×',  label: 'more codebase per context window' },
  { value: '€500k', label: 'seed ask · 18mo runway' },
];

const STATS_MAIN_DE = [
  { value: '74%',   label: 'Ø Token-Reduktion (Capsule)' },
  { value: '3,9×',  label: 'mehr Codebasis pro Kontextfenster' },
  { value: '€500k', label: 'Seed · 18 Monate Runway' },
];

const STATS_TECH = [
  { value: '74%',   label: 'avg token reduction' },
  { value: '3.9×',  label: 'context gain per 128k window' },
  { value: '$3.90', label: 'vs $15.00/MTok · Claude Opus 4.6' },
];

const STATS_TECH_DE = [
  { value: '74%',   label: 'Ø Token-Reduktion' },
  { value: '3,9×',  label: 'Kontextgewinn im 128k-Fenster' },
  { value: '$3,90', label: 'vs $15,00/MTok · Claude Opus 4.6' },
];

const CONTACT = 'edgar.baumann@try-mesh.com · philipp.horn@try-mesh.com';

// ─────────────────────────────────────────────────────────────
// BENCHMARKS (shared component)
// ─────────────────────────────────────────────────────────────
function bmTable(lang = 'en') {
  const rows = lang === 'en'
    ? [
        { label: '~200B (xs) — pass-through', pct: 10,   val: '+10%', cls: 'neg' },
        { label: '~1 KB (small)',              pct: 83,   val: '−83%', cls: 'pos' },
        { label: '~5 KB (medium)',             pct: 95,   val: '−95%', cls: 'pos' },
        { label: '~18 KB (large)',             pct: 98.5, val: '−98.5%', cls: 'pos' },
        { label: '~50 KB (XL)',                pct: 99.4, val: '−99.4%', cls: 'pos' },
        { label: '~100 KB (XXL)',              pct: 99.9, val: '−99.9%', cls: 'pos' },
      ]
    : [
        { label: '~200B (xs) — wird übersprungen', pct: 10,   val: '+10%', cls: 'neg' },
        { label: '~1 KB (klein)',                   pct: 83,   val: '−83%', cls: 'pos' },
        { label: '~5 KB (mittel)',                  pct: 95,   val: '−95%', cls: 'pos' },
        { label: '~18 KB (groß)',                   pct: 98.5, val: '−98,5%', cls: 'pos' },
        { label: '~50 KB (XL)',                     pct: 99.4, val: '−99,4%', cls: 'pos' },
        { label: '~100 KB (XXL)',                   pct: 99.9, val: '−99,9%', cls: 'pos' },
      ];

  const colLabel = lang === 'en' ? 'File size' : 'Dateigröße';
  const colRed   = lang === 'en' ? 'Token reduction' : 'Token-Reduktion';
  const colSave  = lang === 'en' ? 'Saving' : 'Einsparung';
  const avgLabel = lang === 'en' ? 'Average (small–XXL)' : 'Durchschnitt (klein–XXL)';
  const avgVal   = lang === 'en' ? '−74% → 3.9×' : '−74% → 3,9×';

  const rowsHtml = rows.map(r => `
<div class="bm-row">
  <div class="bm-label">${r.label}</div>
  <div class="bm-track"><div class="bm-fill${r.cls === 'neg' ? ' skip' : ''}" style="width:${r.pct}%"></div></div>
  <div class="bm-val ${r.cls}">${r.val}</div>
</div>`).join('');

  return `<div class="benchmark-table">
<div class="bm-header">
  <div class="bm-col">${colLabel}</div>
  <div class="bm-col">${colRed}</div>
  <div class="bm-col" style="text-align:right;">${colSave}</div>
</div>
${rowsHtml}
<div class="bm-row" style="border-top:1.5px solid #cdd3e3;margin-top:4pt;padding-top:6pt;border-bottom:none;">
  <div class="bm-label" style="font-weight:700;color:#1a1f36;">${avgLabel}</div>
  <div class="bm-track"><div class="bm-fill" style="width:74%"></div></div>
  <div class="bm-val total">${avgVal}</div>
</div>
</div>`;
}

function ctxVisual(lang = 'en') {
  const l1 = lang === 'en' ? 'Without Mesh' : 'Ohne Mesh';
  const l2 = lang === 'en' ? 'With Capsule' : 'Mit Capsule';
  const t1 = lang === 'en' ? '~20 medium files — 100% utilized' : '~20 Dateien — 100% ausgelastet';
  const t2 = lang === 'en' ? '~78 medium files — 26% utilized' : '~78 Dateien — 26% ausgelastet';
  const v1 = lang === 'en' ? '<span style="color:#c0392b;">100%</span>' : '<span style="color:#c0392b;">100%</span>';
  const v2 = lang === 'en' ? '<span style="color:#0a7c4e;">26%</span>' : '<span style="color:#0a7c4e;">26%</span>';
  return `<div style="margin:10pt 0;">
<div class="ctx-row">
  <div class="ctx-label">${l1}</div>
  <div class="ctx-track"><div class="ctx-fill raw"><span class="ctx-fill-text">${t1}</span></div></div>
  <div class="ctx-val">${v1}</div>
</div>
<div class="ctx-row">
  <div class="ctx-label">${l2}</div>
  <div class="ctx-track"><div class="ctx-fill capsule"><span class="ctx-fill-text">${t2}</span></div></div>
  <div class="ctx-val">${v2}</div>
</div>
</div>`;
}

// ─────────────────────────────────────────────────────────────
// PITCH DECK — ENGLISH
// ─────────────────────────────────────────────────────────────
function buildPitchDeckEN() {
  const pages = [];

  pages.push(cover(
    'Seed Round · 2026',
    'Mesh.',
    'The AI-native coding environment — web app &amp; desktop. Voice-driven. Compression-first.',
    FOUNDERS_EN, STATS_MAIN, CONTACT
  ));

  // 2 — Problem
  pages.push(pf(`
${hdr('Problem')}
<div class="slide-label">The Problem</div>
<h1>AI coding tools are hitting a wall — and it's called context.</h1>
<p class="lead">Every AI tool faces the same constraint: LLM context windows are finite, and real codebases are not.</p>
<ul>
  <li><strong>AI assistants hallucinate</strong> because they only see a fraction of the codebase at once</li>
  <li><strong>API costs explode</strong> as teams load more code — paying for tokens, not for answers</li>
  <li><strong>Large files are the worst offenders</strong> — a single 50 KB module consumes most of a 128k window</li>
  <li><strong>Voice is completely untapped</strong> — developers still type every command, even when speaking is 3× faster</li>
</ul>
<div class="callout"><p>Sending raw code to an LLM is like faxing a dictionary to answer a single question. You're paying for 99% noise to get 1% signal.</p></div>
<p style="font-size:8.5pt;color:#8e97b0;margin-top:8pt;">The average developer spends 42% of their time understanding code, not writing it. <em>(Stack Overflow Developer Survey 2023)</em></p>
`, 'Mesh — Pitch Deck 2026', '2'));

  // 3 — Solution
  pages.push(pf(`
${hdr('Solution')}
<div class="slide-label">The Solution</div>
<h1>One environment. Full context. Voice + AI.</h1>
<p class="lead">Mesh combines three capabilities no other tool has together — as a web app and desktop app.</p>
<div class="stat-row">
  <div class="stat-box">
    <div class="stat-box-value">74%</div>
    <div class="stat-box-title">Capsule Compression</div>
    <div class="stat-box-label">Proprietary structural compression — 3.9× more codebase per context window, 75% lower API costs, better accuracy</div>
  </div>
  <div class="stat-box">
    <div class="stat-box-value" style="font-size:14pt;padding-top:2pt;">⌨</div>
    <div class="stat-box-title">Unified Workbench</div>
    <div class="stat-box-label">Editor + Terminal + AI chat + Dependency Graph — one surface, zero context switching</div>
  </div>
  <div class="stat-box">
    <div class="stat-box-value" style="font-size:14pt;padding-top:2pt;">🎙</div>
    <div class="stat-box-title">Voice-Driven Agent</div>
    <div class="stat-box-label">Speak your intent. Mesh reads compressed codebase context, generates code changes, explains them</div>
  </div>
</div>
<div class="callout"><p>The only tool that solves <strong>context, cost, and workflow</strong> at the same time.</p></div>
`, 'Mesh — Pitch Deck 2026', '3'));

  // 4 — Compression (why it matters + benchmarks)
  pages.push(pf(`
${hdr('Compression Engine')}
<div class="slide-label">The Technology</div>
<h1>The engine that makes everything else possible.</h1>
<p class="lead">Capsule compresses source code structurally before it reaches any LLM. Not summarization — the full file is always recoverable on demand.</p>
<h2>Why context quality matters</h2>
<h3>A — NIAH (Needle In A Haystack)</h3>
<p>Models degrade at &gt;60–70% context utilization — "Lost in the Middle" effect (Liu et al., 2023). At 100k+ tokens, retrieval accuracy drops 20–40% based on position in context. <strong>Capsule keeps utilization low regardless of codebase size.</strong></p>
${ctxVisual('en')}
<h3>B — SWE-bench</h3>
<p>Top agents (Claude Opus 4.6, GPT-4o, Gemini) solve ~40–55% of real GitHub issues. The leading failure mode: <strong>insufficient codebase context</strong>. More files in context = fewer failures from missing information.</p>
<h2>C — Capsule benchmark results</h2>
${bmTable('en')}
`, 'Mesh — Pitch Deck 2026', '4'));

  // 5 — Product
  pages.push(pf(`
${hdr('Product')}
<div class="slide-label">Product</div>
<h1>Built for the way developers actually think.</h1>
<p class="lead">Three surfaces, one flow. Web app + desktop — no install required for the web version.</p>
<table>
  <thead><tr><th>Surface</th><th>What it does</th></tr></thead>
  <tbody>
    <tr><td><strong>Editor</strong></td><td>Monaco-based editor with AI chat panel, file explorer, live dependency graph, and workspace intelligence sidebar. The AI knows your entire codebase before you ask — compressed, indexed, always current.</td></tr>
    <tr><td><strong>Terminal</strong></td><td>Dedicated terminal workspace — not a bottom panel but a full surface. Runs alongside the editor without losing context.</td></tr>
    <tr><td><strong>Voice-Coding</strong></td><td>Speech-driven agent. Say <em>"refactor the auth middleware to use JWT"</em> — Mesh reads the relevant files via Capsule, generates the change, and explains it. No typing required.</td></tr>
  </tbody>
</table>
<h2>Key differentiators</h2>
<ul>
  <li><strong>Capsule compression</strong> — 74% fewer tokens, same intelligence, 75% lower API cost</li>
  <li><strong>Live dependency graph</strong> — updates in real time as code changes</li>
  <li><strong>Persistent workspace memory</strong> across sessions</li>
  <li><strong>Multi-model</strong> — Claude Opus/Sonnet, Gemini, GPT — no provider lock-in</li>
</ul>
`, 'Mesh — Pitch Deck 2026', '5'));

  // 6 — Market
  pages.push(pf(`
${hdr('Market')}
<div class="slide-label">Market Opportunity</div>
<h1>Every developer is a potential user.</h1>
<p class="lead">We're starting with those who feel the API cost pain most — indie developers and small teams.</p>
<div class="stat-row">
  <div class="stat-box"><div class="stat-box-value">$28B</div><div class="stat-box-label">TAM — Global developer tools (2024, 12% CAGR)</div></div>
  <div class="stat-box"><div class="stat-box-value">$4.2B</div><div class="stat-box-label">SAM — AI-enhanced IDE / coding assistant segment (2025)</div></div>
  <div class="stat-box"><div class="stat-box-value">$120M</div><div class="stat-box-label">SOM (3yr) — Indie devs + small teams, Europe + North America</div></div>
</div>
<h2>Why now</h2>
<ul>
  <li>LLMs crossed the threshold where voice-to-code is genuinely usable</li>
  <li>Cursor proved developers pay for AI-native editors — <strong>~$400M ARR in 2 years at $20/month</strong></li>
  <li>API costs are a real budget line item for dev teams — compression has measurable ROI</li>
  <li>Green tech pressure: enterprises increasingly track and report AI energy spend</li>
</ul>
`, 'Mesh — Pitch Deck 2026', '6'));

  // 7 — Competition
  pages.push(pf(`
${hdr('Competition')}
<div class="slide-label">Competitive Landscape</div>
<h1>We're not an extension. We're the environment.</h1>
<table>
  <thead><tr><th></th><th>Mesh</th><th>VS Code + Copilot</th><th>Cursor</th><th>Google Antigravity</th></tr></thead>
  <tbody>
    <tr><td>Voice-driven coding agent</td><td class="check">✓</td><td class="cross">✗</td><td class="partial">STT only ²</td><td class="cross">✗</td></tr>
    <tr><td>Structural token compression</td><td class="check">✓</td><td class="cross">✗</td><td class="cross">✗</td><td class="cross">✗</td></tr>
    <tr><td>Whole-codebase AI context</td><td class="check">✓</td><td class="partial">Partial ¹</td><td class="partial">Partial ¹</td><td class="partial">Partial ¹</td></tr>
    <tr><td>Web app (no install)</td><td class="check">✓</td><td class="partial">Partial ³</td><td class="cross">✗</td><td class="cross">✗</td></tr>
    <tr><td>AI-native architecture</td><td class="check">✓</td><td class="cross">✗ (retrofitted)</td><td class="check">✓</td><td class="check">✓</td></tr>
    <tr><td>Multi-model</td><td class="check">✓</td><td class="check">✓</td><td class="check">✓</td><td class="check">✓</td></tr>
  </tbody>
</table>
<div class="footnotes">
  <p>¹ Embedding retrieval — finds relevant files, sends them raw to the model</p>
  <p>² Cursor has speech-to-text input (Ctrl+M dictation into chat) — not a voice-driven coding agent</p>
  <p>³ VS Code for the Web exists but has no terminal, no debugger, and limited extension support</p>
</div>
<div class="callout" style="margin-top:10pt;"><p>All three retrieve code with embeddings and send it raw — cost scales with codebase size. <strong>Capsule compresses before the model sees it — cost stays flat.</strong></p></div>
`, 'Mesh — Pitch Deck 2026', '7'));

  // 8 — Business Model
  pages.push(pf(`
${hdr('Business Model')}
<div class="slide-label">Business Model</div>
<h1>Freemium → Pro → Teams</h1>
<div class="pricing-grid">
  <div class="pricing-card">
    <div class="pricing-tier">Free</div>
    <div class="pricing-price">€0</div>
    <div class="pricing-period">forever</div>
    <div class="pricing-feature">Full editor + terminal</div>
    <div class="pricing-feature">AI chat (limited requests/mo)</div>
    <div class="pricing-feature">Basic workspace indexing</div>
  </div>
  <div class="pricing-card featured">
    <div class="pricing-tier">Pro — most popular</div>
    <div class="pricing-price">€19</div>
    <div class="pricing-period">per month</div>
    <div class="pricing-feature">Unlimited AI requests</div>
    <div class="pricing-feature">Full Capsule compression</div>
    <div class="pricing-feature">Voice-coding agent</div>
    <div class="pricing-feature">Priority model access</div>
  </div>
  <div class="pricing-card">
    <div class="pricing-tier">Teams</div>
    <div class="pricing-price">€49</div>
    <div class="pricing-period">per seat / month</div>
    <div class="pricing-feature">Everything in Pro</div>
    <div class="pricing-feature">Shared workspace intelligence</div>
    <div class="pricing-feature">Team codebase context</div>
    <div class="pricing-feature">Admin controls + analytics</div>
  </div>
</div>
<div class="callout"><p>Cursor charges $20/month and crossed $400M ARR. Mesh saves time <em>and</em> API costs — a double value proposition that compounds at the team tier.</p></div>
`, 'Mesh — Pitch Deck 2026', '8'));

  // 9 — Traction
  pages.push(pf(`
${hdr('Traction')}
<div class="slide-label">Traction</div>
<h1>Early stage — real foundation.</h1>
<ul>
  <li><strong>MVP complete</strong> — Editor, Terminal, and Voice-Coding surfaces are fully functional</li>
  <li><strong>Capsule pipeline live and benchmarked</strong> — 74% average token reduction across all file types and sizes</li>
  <li><strong>Architecture built for scale</strong> — gateway/worker split, multi-provider AI support, horizontal scaling</li>
  <li><strong>Active development velocity</strong> — 8 shipped phases with verified completion</li>
</ul>
<div class="highlight">
  <div class="highlight-badge">Next milestone</div>
  <div class="highlight-title">First 100 beta users</div>
  <div class="highlight-sub">Measure retention, voice feature engagement, and real-world token savings to validate the core thesis</div>
</div>
`, 'Mesh — Pitch Deck 2026', '9'));

  // 10 — Team
  pages.push(pf(`
${hdr('Team')}
<div class="slide-label">Team</div>
<h1>Built by developers, for developers.</h1>
<div class="team-grid">
  <div class="team-card">
    <div class="team-name">Edgar Baumann</div>
    <div class="team-title">Co-Founder · WU Wien</div>
    <div class="team-detail">Built Mesh end-to-end — architecture, compression pipeline, voice agent, and frontend. Driven by the gap between how developers think and how their tools make them work.</div>
  </div>
  <div class="team-card">
    <div class="team-name">Philipp Horn</div>
    <div class="team-title">Co-Founder · WHU</div>
    <div class="team-detail">Strong entrepreneurial instinct — business strategy, GTM, and growth.</div>
  </div>
</div>
<div class="callout"><p>Mesh comes from felt pain, not a market analysis. We built the tool we needed, and it didn't exist.</p></div>
`, 'Mesh — Pitch Deck 2026', '10'));

  // 11 — Vision + Ask combined (tight)
  pages.push(pf(`
${hdr('Vision & The Ask')}
<div class="slide-label">Vision</div>
<h1>In 5 years, sending raw code to an AI will seem as wasteful as printing emails.</h1>
<table style="margin:12pt 0 18pt;">
  <thead><tr><th>Horizon</th><th>Goal</th></tr></thead>
  <tbody>
    <tr><td><strong>12 months</strong></td><td>1,000 paying Pro users · Capsule as the industry reference benchmark · first team accounts</td></tr>
    <tr><td><strong>24 months</strong></td><td>10,000 users · Series A · open Capsule SDK for third-party integrations</td></tr>
    <tr><td><strong>5 years</strong></td><td>The default environment for developers who think faster than they type — plus a compression infrastructure layer powering other AI tools</td></tr>
  </tbody>
</table>
<div class="slide-label" style="margin-top:4pt;">Seed Round</div>
<h1>€500,000 · 18-month runway</h1>
<div class="funds-bar">
  <div class="funds-seg" style="background:#005fb8;width:55%;">55% Engineering</div>
  <div class="funds-seg" style="background:#1a73e8;width:25%;">25% Growth</div>
  <div class="funds-seg" style="background:#4a90d9;width:15%;">15% Infra</div>
  <div class="funds-seg" style="background:#7db3e8;color:#1a1f36;width:5%;">5%</div>
</div>
<div class="funds-legend">
  <div class="funds-leg-item"><div class="funds-dot" style="background:#005fb8;"></div>Engineering — 2 senior engineers, voice pipeline + Capsule v2</div>
  <div class="funds-leg-item"><div class="funds-dot" style="background:#1a73e8;"></div>Growth — developer marketing, OSS, content</div>
  <div class="funds-leg-item"><div class="funds-dot" style="background:#4a90d9;"></div>Infrastructure — AI inference at scale</div>
  <div class="funds-leg-item"><div class="funds-dot" style="background:#7db3e8;"></div>Operations — legal, tools</div>
</div>
<p style="text-align:center;margin-top:16pt;font-size:8.5pt;color:#8e97b0;">${CONTACT} · Demo available on request</p>
`, 'Mesh — Pitch Deck 2026', '11'));

  return pages.join('\n');
}

// ─────────────────────────────────────────────────────────────
// PITCH DECK — GERMAN
// ─────────────────────────────────────────────────────────────
function buildPitchDeckDE() {
  const pages = [];

  pages.push(cover(
    'Seed-Runde · 2026',
    'Mesh.',
    'Die KI-native Entwicklungsumgebung — Web-App &amp; Desktop. Sprachgesteuert. Kompression als Kern.',
    FOUNDERS_DE, STATS_MAIN_DE, CONTACT
  ));

  pages.push(pf(`
${hdr('Problem')}
<div class="slide-label">Das Problem</div>
<h1>KI-Coding-Tools stoßen an eine Wand — und die heißt Kontext.</h1>
<p class="lead">Alle KI-Entwicklungstools kämpfen mit derselben Grundeinschränkung: Kontextfenster sind endlich, echte Codebasen nicht.</p>
<ul>
  <li><strong>KI-Assistenten halluzinieren</strong>, weil sie immer nur einen Bruchteil der Codebasis sehen können</li>
  <li><strong>API-Kosten explodieren</strong>, wenn Teams mehr Code in den Kontext laden — bezahlt wird für Tokens, nicht für Antworten</li>
  <li><strong>Große Dateien sind das Hauptproblem</strong> — ein einzelnes 50-KB-Modul füllt schon fast ein 128k-Fenster</li>
  <li><strong>Voice bleibt ungenutzt</strong> — Entwickler tippen noch jeden Befehl, obwohl Sprechen dreimal so schnell wäre</li>
</ul>
<div class="callout"><p>Rohen Code an ein LLM schicken ist wie ein Wörterbuch per Fax zu verschicken, um eine einzige Frage zu beantworten. Du bezahlst für 99 % Rauschen und bekommst 1 % Signal.</p></div>
<p style="font-size:8.5pt;color:#8e97b0;margin-top:8pt;">Entwickler verbringen im Schnitt 42 % ihrer Zeit damit, Code zu <em>verstehen</em> — nicht zu schreiben. <em>(Stack Overflow Developer Survey 2023)</em></p>
`, 'Mesh — Pitch Deck 2026', '2', CONTACT));

  pages.push(pf(`
${hdr('Lösung')}
<div class="slide-label">Die Lösung</div>
<h1>Eine Umgebung. Voller Kontext. Voice + KI.</h1>
<p class="lead">Mesh verbindet drei Dinge, die kein anderes Tool in dieser Kombination bietet — als Web-App und Desktop-App.</p>
<div class="stat-row">
  <div class="stat-box">
    <div class="stat-box-value">74%</div>
    <div class="stat-box-title">Capsule-Kompression</div>
    <div class="stat-box-label">Strukturelle Kompression — 3,9× mehr Codebasis pro Kontextfenster, 75 % niedrigere API-Kosten, bessere Genauigkeit</div>
  </div>
  <div class="stat-box">
    <div class="stat-box-value" style="font-size:14pt;padding-top:2pt;">⌨</div>
    <div class="stat-box-title">Unified Workbench</div>
    <div class="stat-box-label">Editor + Terminal + KI-Chat + Dependency Graph — eine Oberfläche, kein Kontextwechsel</div>
  </div>
  <div class="stat-box">
    <div class="stat-box-value" style="font-size:14pt;padding-top:2pt;">🎙</div>
    <div class="stat-box-title">Voice-Driven Agent</div>
    <div class="stat-box-label">Absicht aussprechen. Mesh liest den komprimierten Codebase-Kontext, generiert Änderungen und erklärt sie</div>
  </div>
</div>
<div class="callout"><p>Das einzige Tool, das <strong>Kontext, Kosten und Workflow</strong> gleichzeitig löst.</p></div>
`, 'Mesh — Pitch Deck 2026', '3', CONTACT));

  pages.push(pf(`
${hdr('Kompressionsmaschine')}
<div class="slide-label">Die Technologie</div>
<h1>Die Maschine, die alles andere erst möglich macht.</h1>
<p class="lead">Capsule komprimiert Quellcode strukturell, bevor er ein LLM erreicht. Keine Zusammenfassung — die vollständige Datei ist jederzeit wiederherstellbar.</p>
<h2>Warum Kontextqualität entscheidend ist</h2>
<h3>A — NIAH (Needle In A Haystack)</h3>
<p>Modelle verschlechtern sich stark ab ~60–70 % Kontextauslastung — „Lost in the Middle"-Effekt (Liu et al., 2023). Bei 100k+-Token-Kontexten sinkt die Abrufgenauigkeit um 20–40 %. <strong>Capsule hält die Auslastung unabhängig von der Codebase-Größe niedrig.</strong></p>
${ctxVisual('de')}
<h3>B — SWE-bench</h3>
<p>Spitzenmodelle lösen ~40–55 % echter GitHub-Issues. Der häufigste Ausfallgrund: <strong>zu wenig Codebase-Kontext</strong>. Mehr Dateien im Kontext bedeutet weniger Fehler durch fehlende Informationen.</p>
<h2>C — Capsule Benchmark-Ergebnisse</h2>
${bmTable('de')}
`, 'Mesh — Pitch Deck 2026', '4', CONTACT));

  pages.push(pf(`
${hdr('Produkt')}
<div class="slide-label">Produkt</div>
<h1>Gebaut für die Art, wie Entwickler wirklich denken.</h1>
<p class="lead">Drei Oberflächen, ein durchgängiger Flow. Web-App + Desktop — die Web-Version braucht keine Installation.</p>
<table>
  <thead><tr><th>Oberfläche</th><th>Was sie leistet</th></tr></thead>
  <tbody>
    <tr><td><strong>Editor</strong></td><td>Monaco-Editor mit KI-Chat-Panel, Datei-Explorer, Live-Dependency-Graph und Workspace-Intelligence-Sidebar. Die KI kennt die gesamte Codebasis, bevor du die erste Frage stellst — komprimiert, indexiert, immer aktuell.</td></tr>
    <tr><td><strong>Terminal</strong></td><td>Eigenständiger Terminal-Workspace — kein Randpanel, sondern eine vollwertige Oberfläche. Läuft neben dem Editor, ohne Kontext zu verlieren.</td></tr>
    <tr><td><strong>Voice-Coding</strong></td><td>Sprachgesteuerter Agent. Sag <em>„Auth-Middleware auf JWT umbauen"</em> — Mesh liest die relevanten Dateien via Capsule, generiert die Änderung und erklärt sie.</td></tr>
  </tbody>
</table>
<h2>Was Mesh einzigartig macht</h2>
<ul>
  <li><strong>Capsule-Kompression</strong> — 74 % weniger Tokens, gleiche Intelligenz, 75 % niedrigere API-Kosten</li>
  <li><strong>Live-Dependency-Graph</strong> — aktualisiert sich in Echtzeit bei jeder Codeänderung</li>
  <li><strong>Persistentes Workspace-Memory</strong> über Sessions hinweg</li>
  <li><strong>Multi-Modell</strong> — Claude, Gemini, GPT — kein Provider-Lock-in</li>
</ul>
`, 'Mesh — Pitch Deck 2026', '5', CONTACT));

  pages.push(pf(`
${hdr('Markt')}
<div class="slide-label">Marktchance</div>
<h1>Jeder Entwickler ist ein potenzieller Nutzer.</h1>
<p class="lead">Wir starten bei denen, die den API-Kostendruck am stärksten spüren — Indie-Entwickler und kleine Teams.</p>
<div class="stat-row">
  <div class="stat-box"><div class="stat-box-value">$28 Mrd.</div><div class="stat-box-label">TAM — Globaler Entwicklertools-Markt (2024, 12 % CAGR)</div></div>
  <div class="stat-box"><div class="stat-box-value">$4,2 Mrd.</div><div class="stat-box-label">SAM — KI-gestützte IDEs &amp; Coding-Assistants (2025)</div></div>
  <div class="stat-box"><div class="stat-box-value">$120 Mio.</div><div class="stat-box-label">SOM (3 Jahre) — Indie-Devs + kleine Teams, Europa + Nordamerika</div></div>
</div>
<h2>Warum jetzt</h2>
<ul>
  <li>LLMs sind erstmals gut genug für echtes Voice-to-Code — die Technologie ist reif</li>
  <li>Cursor hat bewiesen, dass Entwickler für KI-native Editoren zahlen — <strong>~$400 Mio. ARR in zwei Jahren bei $20/Monat</strong></li>
  <li>API-Kosten stehen in Dev-Team-Budgets — Kompression hat messbaren ROI</li>
  <li>Green-Tech-Anforderungen wachsen: Unternehmen erfassen und berichten KI-Energieverbrauch zunehmend</li>
</ul>
`, 'Mesh — Pitch Deck 2026', '6', CONTACT));

  pages.push(pf(`
${hdr('Wettbewerb')}
<div class="slide-label">Wettbewerbslandschaft</div>
<h1>Kein Plugin. Die Umgebung.</h1>
<table>
  <thead><tr><th></th><th>Mesh</th><th>VS Code + Copilot</th><th>Cursor</th><th>Google Antigravity</th></tr></thead>
  <tbody>
    <tr><td>Voice-Coding-Agent</td><td class="check">✓</td><td class="cross">✗</td><td class="partial">Nur STT ²</td><td class="cross">✗</td></tr>
    <tr><td>Strukturelle Token-Kompression</td><td class="check">✓</td><td class="cross">✗</td><td class="cross">✗</td><td class="cross">✗</td></tr>
    <tr><td>Vollständiger Codebase-Kontext</td><td class="check">✓</td><td class="partial">Teilweise ¹</td><td class="partial">Teilweise ¹</td><td class="partial">Teilweise ¹</td></tr>
    <tr><td>Web-App (keine Installation)</td><td class="check">✓</td><td class="partial">Teilweise ³</td><td class="cross">✗</td><td class="cross">✗</td></tr>
    <tr><td>KI-nativ von Grund auf</td><td class="check">✓</td><td class="cross">✗ (nachgerüstet)</td><td class="check">✓</td><td class="check">✓</td></tr>
    <tr><td>Multi-Modell</td><td class="check">✓</td><td class="check">✓</td><td class="check">✓</td><td class="check">✓</td></tr>
  </tbody>
</table>
<div class="footnotes">
  <p>¹ Embedding-Retrieval — wählt relevante Dateien aus, sendet sie roh ans Modell</p>
  <p>² Cursor hat Speech-to-Text-Eingabe (Ctrl+M, Diktat in die Chat-Box) — kein Voice-Coding-Agent</p>
  <p>³ VS Code for the Web existiert, hat aber kein Terminal, keinen Debugger und eingeschränkte Extensions</p>
</div>
<div class="callout" style="margin-top:10pt;"><p>Alle drei rufen Code per Embeddings ab und senden ihn roh — Kosten skalieren mit der Codebase-Größe. <strong>Capsule komprimiert, bevor das Modell auch nur eine Zeile sieht — Kosten bleiben konstant.</strong></p></div>
`, 'Mesh — Pitch Deck 2026', '7', CONTACT));

  pages.push(pf(`
${hdr('Business-Modell')}
<div class="slide-label">Business-Modell</div>
<h1>Freemium → Pro → Teams</h1>
<div class="pricing-grid">
  <div class="pricing-card">
    <div class="pricing-tier">Free</div>
    <div class="pricing-price">€0</div>
    <div class="pricing-period">dauerhaft</div>
    <div class="pricing-feature">Vollständiger Editor + Terminal</div>
    <div class="pricing-feature">KI-Chat (begrenzte Anfragen/Monat)</div>
    <div class="pricing-feature">Basis-Workspace-Indexierung</div>
  </div>
  <div class="pricing-card featured">
    <div class="pricing-tier">Pro — meistgewählt</div>
    <div class="pricing-price">€19</div>
    <div class="pricing-period">pro Monat</div>
    <div class="pricing-feature">Unbegrenzte KI-Anfragen</div>
    <div class="pricing-feature">Volle Capsule-Kompression</div>
    <div class="pricing-feature">Voice-Coding-Agent</div>
    <div class="pricing-feature">Bevorzugter Modellzugang</div>
  </div>
  <div class="pricing-card">
    <div class="pricing-tier">Teams</div>
    <div class="pricing-price">€49</div>
    <div class="pricing-period">pro Seat / Monat</div>
    <div class="pricing-feature">Alles aus Pro</div>
    <div class="pricing-feature">Geteilte Workspace-Intelligenz</div>
    <div class="pricing-feature">Team-weiter Codebase-Kontext</div>
    <div class="pricing-feature">Admin-Controls + Analytics</div>
  </div>
</div>
<div class="callout"><p>Cursor nimmt $20/Monat und hat $400 Mio. ARR erreicht. Mesh spart Zeit <em>und</em> API-Kosten — ein doppeltes Wertversprechen, das im Team-Tier noch stärker wirkt.</p></div>
`, 'Mesh — Pitch Deck 2026', '8', CONTACT));

  pages.push(pf(`
${hdr('Traction · Team · Forderung')}
<div class="slide-label">Traction</div>
<h1>Frühphase — stabiles Fundament.</h1>
<ul>
  <li><strong>MVP vollständig funktionsfähig</strong> — Editor, Terminal und Voice-Coding laufen produktionsreif</li>
  <li><strong>Capsule live und gemessen</strong> — 74 % Ø Token-Reduktion über alle Dateitypen und -größen</li>
  <li><strong>Skalierbare Architektur</strong> — Gateway/Worker-Split, Multi-Provider-KI, horizontale Skalierung</li>
</ul>
<div class="highlight" style="margin-bottom:14pt;">
  <div class="highlight-badge">Nächster Meilenstein</div>
  <div class="highlight-title">Erste 100 Beta-Nutzer</div>
  <div class="highlight-sub">Retention, Voice-Feature-Engagement und reale Token-Einsparungen messen</div>
</div>
<div class="slide-label">Team</div>
<div class="team-grid">
  <div class="team-card">
    <div class="team-name">Edgar Baumann</div>
    <div class="team-title">Co-Founder · WU Wien</div>
    <div class="team-detail">Hat Mesh von Grund auf gebaut — Architektur, Kompressionspipeline, Voice-Agent und Frontend.</div>
  </div>
  <div class="team-card">
    <div class="team-name">Philipp Horn</div>
    <div class="team-title">Co-Founder · WHU</div>
    <div class="team-detail">Ausgeprägtes unternehmerisches Denken — Strategie, Go-to-Market und Wachstum.</div>
  </div>
</div>
<hr>
<div class="slide-label" style="margin-top:4pt;">Seed-Runde</div>
<strong style="font-size:14pt;color:#1a1f36;">€500.000 · 18 Monate Runway</strong>
<div class="funds-bar" style="margin-top:8pt;">
  <div class="funds-seg" style="background:#005fb8;width:55%;">55 % Engineering</div>
  <div class="funds-seg" style="background:#1a73e8;width:25%;">25 % Growth</div>
  <div class="funds-seg" style="background:#4a90d9;width:15%;">15 % Infra</div>
  <div class="funds-seg" style="background:#7db3e8;color:#1a1f36;width:5%;">5 %</div>
</div>
<p style="text-align:center;margin-top:14pt;font-size:8.5pt;color:#8e97b0;">${CONTACT} · Demo auf Anfrage verfügbar</p>
`, 'Mesh — Pitch Deck 2026', '9', CONTACT));

  return pages.join('\n');
}

// ─────────────────────────────────────────────────────────────
// ONE-PAGER — ENGLISH
// ─────────────────────────────────────────────────────────────
function buildOnePagerEN() {
  return pf(`
${hdr('Executive Summary')}
<div class="slide-label">Executive Summary</div>
<h1>The AI-native coding environment built around voice and workspace intelligence.</h1>
<div class="stat-row" style="margin:12pt 0;">
  <div class="stat-box"><div class="stat-box-value">74%</div><div class="stat-box-label">avg token reduction via Capsule compression</div></div>
  <div class="stat-box"><div class="stat-box-value">3.9×</div><div class="stat-box-label">more codebase per context window</div></div>
  <div class="stat-box"><div class="stat-box-value">€500k</div><div class="stat-box-label">seed ask · 18-month runway to PMF</div></div>
</div>
<h2>Problem</h2>
<p>AI coding tools are hitting a wall: context windows are finite, real codebases are not. Teams pay for tokens, not value. API costs are now a real budget line item. Voice remains completely untapped. No existing tool compresses the problem away.</p>
<h2>Solution</h2>
<p>Mesh is an AI-native coding environment (web app + desktop) built on <strong>Capsule</strong> — a proprietary structural compression pipeline that reduces token usage by 74% on average. Combined with voice-first interaction and a unified workbench, it's the only tool that solves context, cost, and workflow simultaneously.</p>
<h2>Product</h2>
<table>
  <thead><tr><th>Surface</th><th>What it does</th></tr></thead>
  <tbody>
    <tr><td><strong>Editor</strong></td><td>Monaco + AI chat + live dependency graph + workspace intelligence</td></tr>
    <tr><td><strong>Terminal</strong></td><td>Dedicated workspace, not a bottom panel</td></tr>
    <tr><td><strong>Voice-Coding</strong></td><td>Speech-driven agent — say what you want built, watch it happen</td></tr>
  </tbody>
</table>
<h2>Market &amp; Model</h2>
<p><strong>TAM</strong> $28B · <strong>SAM</strong> $4.2B · <strong>SOM (3yr)</strong> ~$120M. Freemium: Free / Pro €19/mo / Teams €49/seat. Cursor crossed $400M ARR at $20/month in two years. Mesh saves time <em>and</em> API costs — a double value proposition.</p>
<h2>Competition</h2>
<p>VS Code + Copilot, Cursor, and Google Antigravity all use embedding retrieval and send raw tokens to the model. Cost scales with codebase size. Capsule compresses before the model sees anything — cost stays flat. Mesh's moat: <strong>voice coding agent + structural compression + full web app</strong>. No competitor has all three.</p>
<h2>Team</h2>
<div class="team-grid">
  <div class="team-card"><div class="team-name">Edgar Baumann</div><div class="team-title">Co-Founder · WU Wien</div><div class="team-detail">Built Mesh end-to-end.</div></div>
  <div class="team-card"><div class="team-name">Philipp Horn</div><div class="team-title">Co-Founder · WHU</div><div class="team-detail">Strong entrepreneurial instinct — strategy, GTM, and growth.</div></div>
</div>
`, 'Mesh — One-Pager 2026', 'Confidential', CONTACT);
}

// ─────────────────────────────────────────────────────────────
// ONE-PAGER — GERMAN
// ─────────────────────────────────────────────────────────────
function buildOnePagerDE() {
  return pf(`
${hdr('Executive Summary')}
<div class="slide-label">Executive Summary</div>
<h1>Die KI-native Entwicklungsumgebung für sprachgesteuertes Coding und Workspace-Intelligenz.</h1>
<div class="stat-row" style="margin:12pt 0;">
  <div class="stat-box"><div class="stat-box-value">74%</div><div class="stat-box-label">Ø Token-Reduktion durch Capsule-Kompression</div></div>
  <div class="stat-box"><div class="stat-box-value">3,9×</div><div class="stat-box-label">mehr Codebasis pro Kontextfenster</div></div>
  <div class="stat-box"><div class="stat-box-value">€500k</div><div class="stat-box-label">Seed · 18 Monate Runway bis PMF</div></div>
</div>
<h2>Problem</h2>
<p>KI-Coding-Tools stoßen an eine Wand: Kontextfenster sind begrenzt, echte Codebasen nicht. Teams bezahlen für Tokens, nicht für Ergebnisse. API-Kosten stehen als Budgetposten in den Büchern. Voice wird nicht genutzt. Kein bestehendes Tool löst das Komprimierungsproblem.</p>
<h2>Lösung</h2>
<p>Mesh ist eine KI-native Entwicklungsumgebung (Web-App + Desktop), die auf <strong>Capsule</strong> aufbaut — einer proprietären strukturellen Kompressionspipeline, die Token-Verbrauch um durchschnittlich 74 % senkt. Zusammen mit sprachgesteuerter Interaktion und einer einheitlichen Workbench ist Mesh das einzige Tool, das Kontext, Kosten und Workflow gleichzeitig löst.</p>
<h2>Produkt</h2>
<table>
  <thead><tr><th>Oberfläche</th><th>Was sie leistet</th></tr></thead>
  <tbody>
    <tr><td><strong>Editor</strong></td><td>Monaco + KI-Chat + Live-Dependency-Graph + Workspace-Intelligenz</td></tr>
    <tr><td><strong>Terminal</strong></td><td>Eigenständiger Workspace, kein Randpanel</td></tr>
    <tr><td><strong>Voice-Coding</strong></td><td>Sprachgesteuerter Agent — sag, was gebaut werden soll, sieh es entstehen</td></tr>
  </tbody>
</table>
<h2>Markt &amp; Modell</h2>
<p><strong>TAM</strong> $28 Mrd. · <strong>SAM</strong> $4,2 Mrd. · <strong>SOM (3 Jahre)</strong> ~$120 Mio. Freemium: Free / Pro €19/Monat / Teams €49/Seat. Cursor hat in zwei Jahren $400 Mio. ARR bei $20/Monat erreicht. Mesh spart Zeit <em>und</em> API-Kosten — ein doppeltes Wertversprechen.</p>
<h2>Wettbewerb</h2>
<p>VS Code + Copilot, Cursor und Google Antigravity setzen alle auf Embedding-Retrieval und schicken rohe Tokens ans Modell. Kosten skalieren mit der Codebase-Größe. Capsule komprimiert, bevor das Modell irgendetwas sieht — Kosten bleiben konstant. Meshs Alleinstellungsmerkmal: <strong>Voice-Coding-Agent + strukturelle Kompression + vollständige Web-App</strong>. Diese Kombination hat kein Konkurrent.</p>
<h2>Team</h2>
<div class="team-grid">
  <div class="team-card"><div class="team-name">Edgar Baumann</div><div class="team-title">Co-Founder · WU Wien</div><div class="team-detail">Hat Mesh von Grund auf gebaut.</div></div>
  <div class="team-card"><div class="team-name">Philipp Horn</div><div class="team-title">Co-Founder · WHU</div><div class="team-detail">Ausgeprägtes unternehmerisches Denken — Strategie, GTM und Wachstum.</div></div>
</div>
`, 'Mesh — One-Pager 2026', 'Vertraulich', CONTACT);
}

// ─────────────────────────────────────────────────────────────
// TECHNICAL BRIEF — ENGLISH
// ─────────────────────────────────────────────────────────────
function buildTechBriefEN() {
  const pages = [];

  pages.push(cover(
    'Technical Brief · 2026',
    'Mesh.',
    'Structural source code compression for LLM context efficiency.',
    FOUNDERS_EN, STATS_TECH, CONTACT
  ));

  pages.push(pf(`
${hdr('The Problem')}
<div class="slide-label">Context Degradation</div>
<h1>More context doesn't mean better answers — it can mean worse ones.</h1>
<p class="lead">LLMs operate with a fixed context window. As utilization increases, retrieval accuracy degrades — this is a measured phenomenon, not a hypothesis.</p>
<h2>NIAH — Needle In A Haystack</h2>
<p>Standard retrieval benchmark: a specific fact is placed at varying positions in a long document; the model must retrieve it. Published research (Liu et al., 2023, <em>"Lost in the Middle"</em>) shows:</p>
<ul>
  <li>Models perform reliably below ~60–70% context utilization</li>
  <li>Above that threshold, retrieval accuracy drops <strong>20–40%</strong> depending on where the target appears</li>
  <li>The effect compounds at 100k+ token contexts</li>
</ul>
${ctxVisual('en')}
<h2>SWE-bench</h2>
<p>Industry benchmark for AI coding agents solving real GitHub issues. Top models (Claude Opus 4.6, GPT-4o, Gemini 3.1 Pro) resolve approximately <strong>40–55%</strong> of tasks. Root cause analysis of failures consistently identifies one leading pattern: <strong>the agent lacked sufficient codebase context to understand the problem</strong>.</p>
<p>Current tools use embedding-based retrieval: semantic search returns the most relevant files, which are then sent <em>raw</em>. This selects what gets loaded, but what is loaded still consumes the full raw token budget. As the codebase grows, per-window coverage shrinks.</p>
`, 'Mesh — Technical Brief 2026', '2'));

  pages.push(pf(`
${hdr('How Capsule Works')}
<div class="slide-label">Architecture</div>
<h1>Structural compression with selective recovery.</h1>
<p class="lead">Capsule processes source files before they reach any LLM. Not summarization — the original file is always reconstructable in full on demand.</p>
<h2>Pipeline steps</h2>
<table>
  <thead><tr><th>Step</th><th>What happens</th></tr></thead>
  <tbody>
    <tr><td><strong>1 — Parse</strong></td><td>File decomposed into structural components: declarations, function signatures, type annotations, doc comments, control flow markers</td></tr>
    <tr><td><strong>2 — Compress</strong></td><td>Implementation bodies and non-structural content reduced to minimal structural representations</td></tr>
    <tr><td><strong>3 — Encode</strong></td><td>Compact structural descriptor preserving the semantic skeleton of the file</td></tr>
    <tr><td><strong>4 — Selective Recovery</strong></td><td>When the model identifies a specific function as relevant, the full implementation is restored on demand</td></tr>
  </tbody>
</table>
<div class="arch">User query
    │
    ▼
Workspace indexer     ← scans project, builds file registry
    │
    ▼
Capsule compression   ← structural compression per file
    │
    ▼
Context assembler     ← packs compressed files into context window
    │
    ▼
Model API             ← Claude / Gemini / GPT
    │
    ▼
Selective recovery    ← restores full body on model request
    │
    ▼
Response + diff</div>
<p style="font-size:8.5pt;color:#8e97b0;margin-top:6pt;">Capsule activates dynamically. Files below ~200 tokens get a pass-through (format overhead would exceed savings). Production codebases are 95%+ medium-to-large files where compression is highly effective.</p>
`, 'Mesh — Technical Brief 2026', '3'));

  pages.push(pf(`
${hdr('Benchmark Results')}
<div class="slide-label">Performance</div>
<h1>Production pipeline · 5 file types · 6 size tiers</h1>
<p class="lead">TypeScript, YAML, SQL, HTML, Markdown — real production numbers from the live Capsule pipeline.</p>
${bmTable('en')}
<h2>Context window impact (128k)</h2>
${ctxVisual('en')}
<h2>Cost impact (Claude Opus 4.6 — $15.00/MTok input)</h2>
<table>
  <thead><tr><th>Scenario</th><th>Tokens sent</th><th>API cost</th><th>Files covered</th></tr></thead>
  <tbody>
    <tr><td>Raw code</td><td>1,000,000</td><td>$15.00</td><td>~100 medium files</td></tr>
    <tr><td><strong>With Capsule</strong></td><td><strong>260,000</strong></td><td><strong>$3.90</strong></td><td><strong>Same 100 files</strong></td></tr>
  </tbody>
</table>
`, 'Mesh — Technical Brief 2026', '4'));

  pages.push(pf(`
${hdr('Architecture Comparison')}
<div class="slide-label">Retrieval vs Compression</div>
<h1>A fundamental architectural difference.</h1>
<table>
  <thead><tr><th>Property</th><th>Embedding retrieval (industry default)</th><th>Capsule compression (Mesh)</th></tr></thead>
  <tbody>
    <tr><td>What reaches the model</td><td>Raw file content at full token cost</td><td class="check">Compressed structural descriptor</td></tr>
    <tr><td>Token cost</td><td>Scales with file count × file size</td><td class="check">Fixed low cost regardless of file size</td></tr>
    <tr><td>Context window coverage</td><td>Limited to what fits raw</td><td class="check">3.9× more files per window</td></tr>
    <tr><td>Implementation bodies</td><td>Sent in full</td><td class="check">Compressed, restored on demand</td></tr>
    <tr><td>Codebase size sensitivity</td><td>High — coverage degrades as codebase grows</td><td class="check">Low — compression ratio improves with file size</td></tr>
    <tr><td>Approaches mutually exclusive?</td><td colspan="2" style="text-align:center;color:#5a6480;">No — Capsule is additive on top of any retrieval strategy</td></tr>
  </tbody>
</table>
<h2>Model compatibility</h2>
<p>Capsule output is plain text readable by any transformer LLM. Currently supported:</p>
<ul>
  <li><strong>Anthropic</strong> — Claude Opus 4.6, Claude Sonnet (all versions)</li>
  <li><strong>Google</strong> — Gemini 3.1 Pro, Gemini Flash</li>
  <li><strong>OpenAI</strong> — GPT-4o, GPT-4o mini, o1, o3</li>
</ul>
<p>Provider switching is runtime-configurable — no re-indexing or pipeline changes required.</p>
<h2>File type support</h2>
<table>
  <thead><tr><th>Language</th><th>Structural elements preserved</th></tr></thead>
  <tbody>
    <tr><td>TypeScript / JS</td><td>Exports, class declarations, function signatures, type definitions, interfaces</td></tr>
    <tr><td>Python</td><td>Module-level declarations, class/function signatures, docstrings</td></tr>
    <tr><td>YAML / JSON</td><td>Top-level keys, schema structure</td></tr>
    <tr><td>SQL</td><td>Table/view/function definitions, column names and types</td></tr>
    <tr><td>HTML</td><td>Document structure, component boundaries</td></tr>
    <tr><td>Markdown</td><td>Heading hierarchy, code block presence</td></tr>
  </tbody>
</table>
<p style="font-size:8.5pt;color:#8e97b0;">Go, Rust, Java, C# support planned for Capsule v2.</p>
`, 'Mesh — Technical Brief 2026', '5'));

  return pages.join('\n');
}

// ─────────────────────────────────────────────────────────────
// TECHNICAL BRIEF — GERMAN
// ─────────────────────────────────────────────────────────────
function buildTechBriefDE() {
  const pages = [];

  pages.push(cover(
    'Technisches Briefing · 2026',
    'Mesh.',
    'Strukturelle Quellcode-Kompression für LLM-Kontexteffizienz.',
    FOUNDERS_DE, STATS_TECH_DE, CONTACT
  ));

  pages.push(pf(`
${hdr('Das Problem')}
<div class="slide-label">Kontextdegradierung</div>
<h1>Mehr Kontext bedeutet nicht immer bessere Antworten — manchmal das Gegenteil.</h1>
<p class="lead">LLMs arbeiten mit einem fixen Kontextfenster. Mit steigender Auslastung verschlechtert sich die Abrufgenauigkeit — das ist kein theoretisches Problem, sondern in mehreren unabhängigen Benchmarks gemessen.</p>
<h2>NIAH — Needle In A Haystack</h2>
<p>Standard-Retrieval-Benchmark: Eine bestimmte Information wird an verschiedenen Positionen in einem langen Dokument platziert; das Modell muss sie finden. Forschungsergebnisse (Liu et al., 2023, <em>„Lost in the Middle"</em>) zeigen:</p>
<ul>
  <li>Modelle arbeiten zuverlässig bis ~60–70 % Kontextauslastung</li>
  <li>Darüber hinaus fällt die Abrufgenauigkeit um <strong>20–40 %</strong>, je nach Position der gesuchten Information</li>
  <li>Der Effekt verstärkt sich bei Kontexten über 100k Tokens</li>
</ul>
${ctxVisual('de')}
<h2>SWE-bench</h2>
<p>Branchen-Benchmark für KI-Coding-Agenten, die echte GitHub-Issues lösen. Spitzenmodelle (Claude Opus 4.6, GPT-4o, Gemini 3.1 Pro) lösen rund <strong>40–55 %</strong> der Aufgaben. Die Root-Cause-Analyse von Fehlern zeigt immer wieder dasselbe Muster: <strong>Der Agent hatte nicht genug Codebase-Kontext, um das Problem vollständig zu verstehen.</strong></p>
<p>Der Standardansatz — Embedding-basiertes Retrieval — wählt relevante Dateien aus und schickt sie dann roh ans Modell. Das löst das Problem nicht: Die Auswahl bestimmt, was geladen wird, aber was geladen wird, verbraucht weiterhin das volle Token-Budget. Je größer die Codebasis, desto weniger passt pro Fenster.</p>
`, 'Mesh — Technisches Briefing 2026', '2', CONTACT));

  pages.push(pf(`
${hdr('Benchmark-Ergebnisse')}
<div class="slide-label">Performance</div>
<h1>Produktionspipeline · 5 Dateitypen · 6 Größenkategorien</h1>
<p class="lead">TypeScript, YAML, SQL, HTML, Markdown — echte Zahlen aus der laufenden Capsule-Pipeline.</p>
${bmTable('de')}
<h2>Kontextfenster-Wirkung (128k)</h2>
${ctxVisual('de')}
<h2>Kostenanalyse (Claude Opus 4.6 — $15,00/MTok Input)</h2>
<table>
  <thead><tr><th>Szenario</th><th>Gesendete Tokens</th><th>API-Kosten</th><th>Abgedeckte Dateien</th></tr></thead>
  <tbody>
    <tr><td>Roher Code</td><td>1.000.000</td><td>$15,00</td><td>~100 mittlere Dateien</td></tr>
    <tr><td><strong>Mit Capsule</strong></td><td><strong>260.000</strong></td><td><strong>$3,90</strong></td><td><strong>Dieselben 100 Dateien</strong></td></tr>
  </tbody>
</table>
<h2>Architekturvergleich</h2>
<table>
  <thead><tr><th>Eigenschaft</th><th>Embedding-Retrieval (Branchenstandard)</th><th>Capsule-Kompression (Mesh)</th></tr></thead>
  <tbody>
    <tr><td>Was das Modell sieht</td><td>Roher Dateiinhalt zum vollen Token-Preis</td><td class="check">Komprimierter struktureller Deskriptor</td></tr>
    <tr><td>Token-Kosten</td><td>Skalieren mit Dateianzahl × Dateigröße</td><td class="check">Konstant niedrig, unabhängig von Dateigröße</td></tr>
    <tr><td>Kontextfenster-Abdeckung</td><td>Begrenzt auf rohen Fit</td><td class="check">3,9× mehr Dateien pro Fenster</td></tr>
    <tr><td>Codebase-Größen-Sensitivität</td><td>Hoch — Abdeckung sinkt mit Wachstum</td><td class="check">Niedrig — Kompressionsrate steigt mit Dateigröße</td></tr>
    <tr><td>Gegenseitig ausschließend?</td><td colspan="2" style="text-align:center;color:#5a6480;">Nein — Capsule ist additiv zu jeder Retrieval-Strategie</td></tr>
  </tbody>
</table>
<p style="text-align:center;margin-top:16pt;font-size:8.5pt;color:#8e97b0;">${CONTACT} · Technische Demo auf Anfrage</p>
`, 'Mesh — Technisches Briefing 2026', '3', CONTACT));

  return pages.join('\n');
}

// ─────────────────────────────────────────────────────────────
// CAPSULE WHITEPAPER — ENGLISH (no founders, no company framing)
// ─────────────────────────────────────────────────────────────
function buildWhitepaperEN() {
  const pages = [];
  const tag = 'Mesh — Technical Whitepaper 2026';

  // Cover — no founders, pure tech header
  pages.push(`<div class="cover">
<div class="cover-top-bar"></div>
<div class="cover-body">
  <div class="cover-eyebrow">Technical Whitepaper · 2026</div>
  <div class="cover-logo">${ICON_SVG}<span class="cover-title">Mesh.</span></div>
  <div class="cover-subtitle">Structural source code compression for LLM context efficiency — Mesh Compression Engine.</div>
  <div class="cover-rule"></div>
  <div class="cover-stats">
    <div class="cover-stat"><div class="cover-stat-value">74%</div><div class="cover-stat-label">avg token reduction</div></div>
    <div class="cover-stat"><div class="cover-stat-value">3.9×</div><div class="cover-stat-label">context gain per 128k window</div></div>
    <div class="cover-stat"><div class="cover-stat-value">$3.90</div><div class="cover-stat-label">vs $15.00/MTok input · Claude Opus 4.6</div></div>
  </div>
</div>
<div class="cover-footer">
  <span class="cover-footer-contact">Mesh Compression Engine · Production pipeline</span>
  <span class="cover-footer-year">2026</span>
</div>
</div>`);

  pages.push(pf(`
${hdr('Context Degradation')}
<div class="slide-label">The Problem</div>
<h1>As context utilization increases, LLM retrieval accuracy degrades — measurably.</h1>
<p class="lead">Large language models operate with a fixed context window. This is not a soft limit — it creates a hard accuracy ceiling as utilization approaches 100%.</p>
<h2>NIAH — Needle In A Haystack</h2>
<p>Standard retrieval benchmark (Liu et al., 2023, <em>"Lost in the Middle"</em>): a specific fact is placed at varying positions in a long document; the model must retrieve it.</p>
<table>
  <thead><tr><th>Context utilization</th><th>Retrieval accuracy</th></tr></thead>
  <tbody>
    <tr><td>&lt; 60%</td><td>~95–98%</td></tr>
    <tr><td>60–80%</td><td>~75–85%</td></tr>
    <tr><td>80–95%</td><td>~55–70%</td></tr>
    <tr><td>&gt; 95%</td><td>~40–60%</td></tr>
  </tbody>
</table>
<p>The degradation is positional: facts in the middle of the context are retrieved less reliably than those at the beginning or end. At 100k+ token contexts the effect is amplified.</p>
${ctxVisual('en')}
<h2>SWE-bench</h2>
<p>Industry benchmark for AI coding agents solving real GitHub issues. Top models (Claude Opus 4.6, GPT-4o, Gemini 3.1 Pro) resolve approximately <strong>40–55%</strong> of tasks as of early 2026. Root cause analysis of failures identifies one leading pattern: <strong>the agent lacked sufficient codebase context.</strong></p>
<p>Current tools use embedding-based retrieval to select files, then send them raw. This selects what gets loaded — it does not reduce what each file costs. As codebase size grows, coverage per context window shrinks.</p>
`, tag, '1', ''));

  pages.push(pf(`
${hdr('Mechanism')}
<div class="slide-label">How Capsule Works</div>
<h1>Structural compression with selective recovery — not summarization.</h1>
<p class="lead">Capsule processes source files <strong>before</strong> they enter any LLM context window. The original file is always fully reconstructable on demand.</p>
<h2>Pipeline stages</h2>
<table>
  <thead><tr><th>Stage</th><th>Operation</th><th>Output</th></tr></thead>
  <tbody>
    <tr><td><strong>1 — Parse</strong></td><td>Language-aware AST extraction</td><td>Structural components: declarations, signatures, type annotations, doc comments, control flow markers</td></tr>
    <tr><td><strong>2 — Compress</strong></td><td>Implementation body reduction</td><td>Bodies replaced with structural stubs; non-structural tokens minimized</td></tr>
    <tr><td><strong>3 — Encode</strong></td><td>Descriptor assembly</td><td>Compact plain-text structural descriptor preserving semantic skeleton</td></tr>
    <tr><td><strong>4 — Selective Recovery</strong></td><td>On-demand body restoration</td><td>Full implementation body injected inline when model identifies it as needed</td></tr>
  </tbody>
</table>
<h2>What is preserved</h2>
<ul>
  <li>All export and declaration names</li>
  <li>All function and method signatures (parameters, return types)</li>
  <li>Type definitions, interfaces, and type aliases</li>
  <li>Class structure and inheritance hierarchy</li>
  <li>Doc comment content</li>
  <li>Control flow markers (try/catch presence, loop presence, async/await markers)</li>
  <li>Module imports and dependency references</li>
</ul>
<h2>Activation threshold</h2>
<p>Files below ~200 tokens receive pass-through (format overhead exceeds savings). In production codebases, ~95% of files by token count are in the compression range. The threshold has no material effect on total context reduction.</p>
`, tag, '2', ''));

  pages.push(pf(`
${hdr('Benchmark Results')}
<div class="slide-label">Performance</div>
<h1>Production pipeline · 5 file types · 6 size tiers · 50 files per tier</h1>
<p class="lead">TypeScript, YAML, SQL, HTML, Markdown — real numbers from the production Capsule pipeline.</p>
${bmTable('en')}
<h2>Context window coverage at 128k tokens</h2>
${ctxVisual('en')}
<h2>Why compression ratio improves with file size</h2>
<p>Implementation bodies scale with file size; structural skeletons do not. A 100 KB TypeScript file has approximately the same structural skeleton size as a 5 KB file — the extra 95 KB is almost entirely implementation bodies. The compression ratio therefore improves asymptotically as files grow larger.</p>
`, tag, '3', ''));

  pages.push(pf(`
${hdr('Cost Analysis')}
<div class="slide-label">Economics</div>
<h1>74% cost reduction per query — same files, same model, same result quality.</h1>
<h2>Per-query cost (Claude Opus 4.6 — $15.00/MTok input)</h2>
<table>
  <thead><tr><th>Input type</th><th>Tokens sent</th><th>Cost per query</th></tr></thead>
  <tbody>
    <tr><td>Raw source (100 medium files)</td><td>1,000,000</td><td>$15.00</td></tr>
    <tr><td><strong>Capsule compressed (same 100 files)</strong></td><td><strong>~260,000</strong></td><td><strong>$3.90</strong></td></tr>
  </tbody>
</table>
<h2>Scale projection (10,000 users · 50 queries/day · 50k avg context tokens)</h2>
<table>
  <thead><tr><th>Metric</th><th>Raw</th><th>Capsule</th></tr></thead>
  <tbody>
    <tr><td>Total tokens/day</td><td>25,000,000,000</td><td>~6,500,000,000</td></tr>
    <tr><td>API cost/day (Claude Opus 4.6)</td><td>$375,000</td><td class="check">~$97,500</td></tr>
    <tr><td>Monthly API cost</td><td>$11,250,000</td><td class="check">~$2,925,000</td></tr>
    <tr><td>Monthly savings</td><td colspan="2" style="text-align:center;font-weight:700;color:#0a7c4e;">$8,325,000 (−74%)</td></tr>
  </tbody>
</table>
<p>The cost curve is flat with Capsule — adding more files to context costs near-zero marginal tokens once those files are in the compression range.</p>
`, tag, '4', ''));

  pages.push(pf(`
${hdr('Architecture')}
<div class="slide-label">System Design</div>
<h1>Retrieval selects files. Compression reduces what each file costs.</h1>
<div class="arch">User query
    │
    ▼
Workspace indexer        ← scans project directory, builds file registry
    │
    ▼
File selector            ← embedding-based semantic retrieval, returns ranked candidates
    │
    ▼
Capsule compression      ← structural compression per file (parallel workers)
    │
    ▼
Context assembler        ← packs compressed descriptors, targets ~65% utilization
    │
    ▼
Model API call           ← Claude / Gemini / GPT (provider-agnostic)
    │
    ▼
Selective recovery       ← restores full implementation bodies on model request
    │
    ▼
Response + diff output</div>
<h2>Retrieval vs. Compression — not mutually exclusive</h2>
<table>
  <thead><tr><th>Property</th><th>Embedding retrieval</th><th>Capsule compression</th></tr></thead>
  <tbody>
    <tr><td>What reaches the model</td><td>Raw file content (full token cost)</td><td class="check">Compressed structural descriptor</td></tr>
    <tr><td>Token cost scales with</td><td>File count × file size</td><td class="check">Near-constant (structural skeleton size)</td></tr>
    <tr><td>Context coverage (128k)</td><td>~20 medium files</td><td class="check">~78 medium files</td></tr>
    <tr><td>Codebase size sensitivity</td><td>High</td><td class="check">Low — ratio improves with size</td></tr>
    <tr><td>Additive with retrieval</td><td>N/A</td><td class="check">Yes — operates post-retrieval</td></tr>
  </tbody>
</table>
<h2>Gateway / Worker architecture</h2>
<p>Compression runs in stateless worker processes — horizontally scalable, independent of the UI and API gateway. Worker throughput scales linearly with worker count.</p>
<h2>Model compatibility</h2>
<p>Capsule output is plain text in a structured format. No fine-tuning, no special tokenizer. Compatible with any transformer-based LLM: Claude, Gemini, GPT-4o, o1, o3, o4-mini. Provider switching is runtime-configurable — no re-indexing required.</p>
<h2>File type support (v1)</h2>
<table>
  <thead><tr><th>Language</th><th>Preserved structural elements</th></tr></thead>
  <tbody>
    <tr><td>TypeScript / JavaScript</td><td>Exports, class declarations, function signatures, type definitions, interfaces, generics</td></tr>
    <tr><td>Python</td><td>Module-level declarations, class/function signatures, type hints, docstrings</td></tr>
    <tr><td>YAML / JSON</td><td>Top-level keys, schema structure (values compressed to type markers)</td></tr>
    <tr><td>SQL</td><td>Table/view/function definitions, column names and types, index definitions</td></tr>
    <tr><td>HTML / JSX</td><td>Component tree structure, prop signatures, slot structure</td></tr>
    <tr><td>Markdown</td><td>Heading hierarchy, code block presence, link structure</td></tr>
  </tbody>
</table>
<p style="font-size:8.5pt;color:#8e97b0;">Go, Rust, Java, C#, Ruby, PHP planned for Capsule v2.</p>
`, tag, '5', ''));

  return pages.join('\n');
}

// ─────────────────────────────────────────────────────────────
// CAPSULE WHITEPAPER — GERMAN (no founders, no company framing)
// ─────────────────────────────────────────────────────────────
function buildWhitepaperDE() {
  const pages = [];
  const tag = 'Mesh — Technisches Whitepaper 2026';

  pages.push(`<div class="cover">
<div class="cover-top-bar"></div>
<div class="cover-body">
  <div class="cover-eyebrow">Technisches Whitepaper · 2026</div>
  <div class="cover-logo">${ICON_SVG}<span class="cover-title">Mesh.</span></div>
  <div class="cover-subtitle">Strukturelle Quellcode-Kompression für LLM-Kontexteffizienz — Mesh Compression Engine.</div>
  <div class="cover-rule"></div>
  <div class="cover-stats">
    <div class="cover-stat"><div class="cover-stat-value">74%</div><div class="cover-stat-label">Ø Token-Reduktion</div></div>
    <div class="cover-stat"><div class="cover-stat-value">3,9×</div><div class="cover-stat-label">Kontextgewinn im 128k-Fenster</div></div>
    <div class="cover-stat"><div class="cover-stat-value">$3,90</div><div class="cover-stat-label">vs $15,00/MTok · Claude Opus 4.6</div></div>
  </div>
</div>
<div class="cover-footer">
  <span class="cover-footer-contact">Mesh Compression Engine · Produktionspipeline</span>
  <span class="cover-footer-year">2026</span>
</div>
</div>`);

  pages.push(pf(`
${hdr('Kontextfenster-Degradation')}
<div class="slide-label">Das Problem</div>
<h1>Mit steigender Kontextauslastung fällt die LLM-Abrufgenauigkeit — messbar.</h1>
<p class="lead">Large Language Models arbeiten mit einem fixen Kontextfenster in Tokens. Das ist keine weiche Grenze — sie erzeugt eine harte Genauigkeitsdecke, sobald die Auslastung Richtung 100 % tendiert.</p>
<h2>NIAH — Needle In A Haystack</h2>
<p>Standard-Retrieval-Benchmark (Liu et al., 2023, <em>„Lost in the Middle"</em>): Eine Zielinformation wird an verschiedenen Positionen in einem langen Dokument platziert; das Modell muss sie abrufen.</p>
<table>
  <thead><tr><th>Kontextauslastung</th><th>Abrufgenauigkeit</th></tr></thead>
  <tbody>
    <tr><td>&lt; 60 %</td><td>~95–98 %</td></tr>
    <tr><td>60–80 %</td><td>~75–85 %</td></tr>
    <tr><td>80–95 %</td><td>~55–70 %</td></tr>
    <tr><td>&gt; 95 %</td><td>~40–60 %</td></tr>
  </tbody>
</table>
<p>Die Degradation ist positionsabhängig: Informationen in der Mitte des Kontexts werden weniger zuverlässig abgerufen als solche am Anfang oder Ende. Bei Kontexten über 100k Tokens ist der Effekt verstärkt.</p>
${ctxVisual('de')}
<h2>SWE-bench</h2>
<p>Branchen-Benchmark für KI-Coding-Agenten bei echten GitHub-Issues. Spitzenmodelle (Claude Opus 4.6, GPT-4o, Gemini 3.1 Pro) lösen ca. <strong>40–55 %</strong> der Aufgaben (Stand Anfang 2026). Root-Cause-Analyse der Fehler identifiziert konsistent ein führendes Muster: <strong>Der Agent hatte nicht genug Codebase-Kontext, um das Problem vollständig zu verstehen.</strong></p>
<p>Aktuell genutzte Tools wählen per Embedding-Retrieval relevante Dateien aus und senden sie roh ans Modell. Das bestimmt, was geladen wird — nicht, was jede Datei kostet. Je größer die Codebasis, desto geringer die Abdeckung pro Kontextfenster.</p>
`, tag, '1', ''));

  pages.push(pf(`
${hdr('Mechanismus')}
<div class="slide-label">Funktionsweise</div>
<h1>Strukturelle Kompression mit selektiver Wiederherstellung — keine Zusammenfassung.</h1>
<p class="lead">Capsule verarbeitet Quelldateien <strong>bevor</strong> sie ein LLM-Kontextfenster betreten. Die Originaldatei ist jederzeit vollständig wiederherstellbar.</p>
<h2>Pipeline-Stufen</h2>
<table>
  <thead><tr><th>Stufe</th><th>Operation</th><th>Output</th></tr></thead>
  <tbody>
    <tr><td><strong>1 — Parse</strong></td><td>Sprachbewusste AST-Extraktion</td><td>Strukturkomponenten: Deklarationen, Signaturen, Typ-Annotationen, Doc-Comments, Control-Flow-Marker</td></tr>
    <tr><td><strong>2 — Komprimieren</strong></td><td>Implementierungsbody-Reduktion</td><td>Bodies durch strukturelle Stubs ersetzt; nicht-strukturelle Tokens minimiert</td></tr>
    <tr><td><strong>3 — Enkodieren</strong></td><td>Deskriptor-Assembly</td><td>Kompakter Klartext-Deskriptor mit vollständigem semantischen Skelett</td></tr>
    <tr><td><strong>4 — Selektive Wiederherstellung</strong></td><td>On-demand Body-Restaurierung</td><td>Vollständiger Implementierungsbody inline injiziert, wenn das Modell ihn anfordert</td></tr>
  </tbody>
</table>
<h2>Was erhalten bleibt</h2>
<ul>
  <li>Alle Export- und Deklarationsnamen</li>
  <li>Alle Funktions- und Methodensignaturen (Parameter, Rückgabetypen)</li>
  <li>Typ-Definitionen, Interfaces und Typ-Aliase</li>
  <li>Klassenstruktur und Vererbungshierarchie</li>
  <li>Doc-Comment-Inhalt</li>
  <li>Control-Flow-Marker (try/catch-Präsenz, Schleifen, async/await)</li>
  <li>Modul-Imports und Abhängigkeitsreferenzen</li>
</ul>
<h2>Aktivierungsschwelle</h2>
<p>Dateien unter ~200 Tokens erhalten Pass-through (Format-Overhead übersteigt die Einsparung). In Produktions-Codebasen liegen ~95 % der Dateien nach Token-Anzahl im Kompressionsbereich. Die Schwelle hat keinen materiellen Effekt auf die Gesamt-Kontextreduktion.</p>
`, tag, '2', ''));

  pages.push(pf(`
${hdr('Benchmark-Ergebnisse')}
<div class="slide-label">Performance</div>
<h1>Produktionspipeline · 5 Dateitypen · 6 Größenkategorien · 50 Dateien pro Kategorie</h1>
<p class="lead">TypeScript, YAML, SQL, HTML, Markdown — reale Zahlen aus der laufenden Capsule-Pipeline.</p>
${bmTable('de')}
<h2>Kontextfenster-Abdeckung bei 128k Tokens</h2>
${ctxVisual('de')}
<h2>Warum die Kompressionsrate mit Dateigröße steigt</h2>
<p>Implementierungsbodies skalieren mit der Dateigröße; strukturelle Skelette nicht. Eine 100-KB-TypeScript-Datei hat ungefähr dieselbe Skelettgröße wie eine 5-KB-Datei — die zusätzlichen 95 KB sind fast ausschließlich Implementierungsbodies. Die Kompressionsrate steigt daher asymptotisch mit wachsender Dateigröße.</p>
`, tag, '3', ''));

  pages.push(pf(`
${hdr('Kostenanalyse')}
<div class="slide-label">Wirtschaftlichkeit</div>
<h1>74 % Kostenreduktion pro Query — gleiche Dateien, gleiches Modell, gleiche Ergebnisqualität.</h1>
<h2>Kosten pro Query (Claude Opus 4.6 — $15,00/MTok Input)</h2>
<table>
  <thead><tr><th>Input-Typ</th><th>Gesendete Tokens</th><th>Kosten pro Query</th></tr></thead>
  <tbody>
    <tr><td>Roher Code (100 mittlere Dateien)</td><td>1.000.000</td><td>$15,00</td></tr>
    <tr><td><strong>Capsule-komprimiert (dieselben 100 Dateien)</strong></td><td><strong>~260.000</strong></td><td><strong>$3,90</strong></td></tr>
  </tbody>
</table>
<h2>Skalierungsprojektion (10.000 Nutzer · 50 Queries/Tag · 50k Ø Kontext-Tokens)</h2>
<table>
  <thead><tr><th>Metrik</th><th>Roh</th><th>Capsule</th></tr></thead>
  <tbody>
    <tr><td>Tokens gesamt/Tag</td><td>25.000.000.000</td><td>~6.500.000.000</td></tr>
    <tr><td>API-Kosten/Tag (Claude Opus 4.6)</td><td>$375.000</td><td class="check">~$97.500</td></tr>
    <tr><td>Monatliche API-Kosten</td><td>$11.250.000</td><td class="check">~$2.925.000</td></tr>
    <tr><td>Monatliche Einsparung</td><td colspan="2" style="text-align:center;font-weight:700;color:#0a7c4e;">$8.325.000 (−74 %)</td></tr>
  </tbody>
</table>
<p>Die Kostenkurve ist mit Capsule flach — weitere Dateien hinzuzufügen kostet nahezu null Marginal-Tokens, sobald sie im Kompressionsbereich liegen.</p>
`, tag, '4', ''));

  pages.push(pf(`
${hdr('Architektur')}
<div class="slide-label">System-Design</div>
<h1>Retrieval wählt Dateien. Kompression reduziert, was jede Datei kostet.</h1>
<div class="arch">User-Query
    │
    ▼
Workspace-Indexer        ← scannt Projektverzeichnis, baut Datei-Registry
    │
    ▼
File-Selektor            ← Embedding-basiertes Retrieval, gibt gerankte Kandidaten zurück
    │
    ▼
Capsule-Kompression      ← strukturelle Kompression pro Datei (parallele Worker)
    │
    ▼
Context-Assembler        ← packt Deskriptoren, zielt auf ~65 % Auslastung
    │
    ▼
Model-API-Call           ← Claude / Gemini / GPT (provider-agnostisch)
    │
    ▼
Selektive Recovery       ← stellt vollständige Bodies auf Modellanfrage wieder her
    │
    ▼
Response + Diff-Output</div>
<h2>Retrieval und Kompression — nicht gegenseitig ausschließend</h2>
<table>
  <thead><tr><th>Eigenschaft</th><th>Embedding-Retrieval</th><th>Capsule-Kompression</th></tr></thead>
  <tbody>
    <tr><td>Was das Modell erreicht</td><td>Roher Dateiinhalt (volle Token-Kosten)</td><td class="check">Komprimierter Deskriptor</td></tr>
    <tr><td>Token-Kosten skalieren mit</td><td>Dateianzahl × Dateigröße</td><td class="check">Nahezu konstant (Skelettgröße)</td></tr>
    <tr><td>Kontextabdeckung (128k)</td><td>~20 mittlere Dateien</td><td class="check">~78 mittlere Dateien</td></tr>
    <tr><td>Codebase-Größen-Sensitivität</td><td>Hoch</td><td class="check">Niedrig — Rate steigt mit Größe</td></tr>
    <tr><td>Additiv mit Retrieval</td><td>N/A</td><td class="check">Ja — operiert nach dem Retrieval</td></tr>
  </tbody>
</table>
<h2>Modell-Kompatibilität</h2>
<p>Capsule-Output ist Klartext in einem strukturierten Format. Kein Fine-Tuning, kein spezieller Tokenizer. Kompatibel mit jedem transformer-basierten LLM: Claude, Gemini, GPT-4o, o1, o3, o4-mini. Provider-Wechsel ist zur Laufzeit konfigurierbar — kein Re-Indexing erforderlich.</p>
<h2>Dateityp-Unterstützung (v1)</h2>
<table>
  <thead><tr><th>Sprache</th><th>Bewahrte strukturelle Elemente</th></tr></thead>
  <tbody>
    <tr><td>TypeScript / JavaScript</td><td>Exports, Klassen-Deklarationen, Funktionssignaturen, Typ-Definitionen, Interfaces, Generics</td></tr>
    <tr><td>Python</td><td>Module-level-Deklarationen, Klassen-/Funktionssignaturen, Type Hints, Docstrings</td></tr>
    <tr><td>YAML / JSON</td><td>Top-Level-Keys, Schema-Struktur (Werte auf Typ-Marker komprimiert)</td></tr>
    <tr><td>SQL</td><td>Tabellen-/View-/Funktionsdefinitionen, Spaltennamen und -typen, Index-Definitionen</td></tr>
    <tr><td>HTML / JSX</td><td>Komponentenbaumstruktur, Prop-Signaturen, Slot-Struktur</td></tr>
    <tr><td>Markdown</td><td>Überschriftenhierarchie, Code-Block-Präsenz, Link-Struktur</td></tr>
  </tbody>
</table>
<p style="font-size:8.5pt;color:#8e97b0;">Go, Rust, Java, C#, Ruby, PHP geplant für Capsule v2.</p>
`, tag, '5', ''));

  return pages.join('\n');
}

// ─────────────────────────────────────────────────────────────
// PDF GENERATION
// ─────────────────────────────────────────────────────────────
async function generatePDF(htmlContent, filename) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const fullHtml = TEMPLATE.replace('__CONTENT__', htmlContent);
    const tmpFile = path.join(OUT_DIR, `_tmp_${filename}.html`);
    fs.writeFileSync(tmpFile, fullHtml, 'utf8');

    const pg = await browser.newPage();
    await pg.goto(`file://${tmpFile}`, { waitUntil: 'networkidle0' });

    const outPath = path.join(OUT_DIR, filename);
    await pg.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    fs.unlinkSync(tmpFile);
    console.log(`  ✓ ${filename}`);
    return outPath;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('\nGenerating Mesh pitch PDFs...\n');

  const docs = [
    { name: 'pitch-deck-en.pdf',           builder: buildPitchDeckEN },
    { name: 'pitch-deck-de.pdf',           builder: buildPitchDeckDE },
    { name: 'one-pager-en.pdf',            builder: buildOnePagerEN },
    { name: 'one-pager-de.pdf',            builder: buildOnePagerDE },
    { name: 'technical-brief-en.pdf',      builder: buildTechBriefEN },
    { name: 'technical-brief-de.pdf',      builder: buildTechBriefDE },
    { name: 'capsule-whitepaper-en.pdf',   builder: buildWhitepaperEN },
    { name: 'capsule-whitepaper-de.pdf',   builder: buildWhitepaperDE },
  ];

  for (const doc of docs) {
    await generatePDF(doc.builder(), doc.name);
  }

  console.log(`\nAll PDFs written to: ${OUT_DIR}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
