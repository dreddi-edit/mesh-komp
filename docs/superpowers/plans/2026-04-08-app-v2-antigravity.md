# Mesh Antigravity (app-v2.html) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `views/app-v2.html` — a self-contained Mesh-branded clone of the Google Antigravity Easter egg where all UI elements float, bounce, rotate, and respond to mouse/touch/keyboard interaction.

**Architecture:** Single self-contained HTML file with inline `<style>` and `<script>`. Two-phase page: static Mesh portal layout renders for 800ms, then all 12 UI elements detach to `position:fixed` and enter a custom 60fps physics loop (gravity, wall bounce, friction, rotation). No external JS dependencies beyond Google Fonts.

**Tech Stack:** Vanilla HTML/CSS/JS. `requestAnimationFrame` physics loop. CSS custom properties matching `app-workspace.css` design system. Inter + JetBrains Mono fonts via CDN.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `views/app-v2.html` | Complete self-contained antigravity page |
| Modify | `CODEBASE-MAP.md` | Add entry for new file |

---

## Task 1: Static Phase 1 Layout (HTML + CSS)

**Files:**
- Create: `views/app-v2.html`

Build the complete static page first. No JavaScript. The page should look like a clean Mesh-branded portal — same structure as Google's homepage (nav, hero, search bar, feature cards, status bar). Visual verification only since this is a pure frontend page.

- [ ] **Step 1: Create `views/app-v2.html` with full HTML + CSS**

Create the file with this complete content:

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mesh. — Antigravity</title>
<link rel="icon" type="image/svg+xml" href="/assets/brand/icon-color.svg"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #1e1e1e; --bg2: #252526; --bg3: #2d2d2d; --bg4: #313131;
  --bd: #3c3c3c; --bdhov: #505050;
  --tx: #ccc; --tx2: #e0e0e0; --tx3: #777; --txw: #fff;
  --ac: #0098ff; --ac2: #007acc; --acs: rgba(0,152,255,.12);
  --grn: #4ec9b0; --red: #f14c4c; --org: #cca700;
  --f: 'Inter', system-ui, sans-serif;
  --m: 'JetBrains Mono', monospace;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }
body {
  font-family: var(--f);
  background: var(--bg);
  color: var(--tx);
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
}

/* ── Stage ── */
#ag-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100dvh;
  overflow: hidden;
  position: relative;
}

/* ── Nav strip ── */
.ag-nav {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 52px;
  background: var(--bg2);
  border-bottom: 1px solid var(--bd);
  flex-shrink: 0;
}
.ag-nav-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--txw);
}
.ag-nav-links { display: flex; gap: 24px; }
.ag-nav-links a {
  font-size: .82rem;
  color: var(--tx3);
  text-decoration: none;
  font-weight: 500;
}
.ag-nav-links a:hover { color: var(--tx); }

/* ── Hero ── */
.ag-hero {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 0 20px 60px;
}

/* ── Hero logo ── */
.ag-hero-logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.ag-hero-logo svg { filter: drop-shadow(0 0 20px rgba(0,152,255,.25)); }
.ag-hero-wordmark {
  font-size: 3rem;
  font-weight: 700;
  color: var(--txw);
  letter-spacing: -.02em;
}

/* ── Tagline ── */
.ag-tagline {
  font-size: .95rem;
  color: var(--tx3);
  text-align: center;
}

/* ── Chat input card ── */
.ag-chat {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 580px;
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: 10px;
  padding: 10px 14px;
}
.ag-chat input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  font-family: var(--f);
  font-size: .9rem;
  color: var(--txw);
}
.ag-chat input::placeholder { color: var(--tx3); }
.ag-chat-send {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: var(--ac);
  border: none;
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #fff;
}
.ag-chat-send:hover { background: var(--ac2); }

/* ── Pills ── */
.ag-pills { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.ag-pill {
  padding: 5px 14px;
  border: 1px solid var(--bd);
  border-radius: 999px;
  font-size: .78rem;
  color: var(--tx3);
  background: var(--bg2);
  cursor: pointer;
  transition: border-color .15s, color .15s;
}
.ag-pill:hover { border-color: var(--ac); color: var(--txw); }

/* ── Card grid ── */
.ag-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
  max-width: 720px;
}
.ag-card {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: 10px;
  padding: 16px;
  min-height: 110px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: grab;
  user-select: none;
}
.ag-card:hover { border-color: var(--bdhov); }
.ag-card-kicker {
  font-size: .62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--tx3);
}
.ag-card-title { font-size: .88rem; font-weight: 600; color: var(--txw); }
.ag-card-desc { font-size: .75rem; color: var(--tx3); line-height: 1.5; }

/* ── Status bar ── */
.ag-status {
  width: 100%;
  height: 22px;
  background: var(--ac2);
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 14px;
  flex-shrink: 0;
}
.ag-status span { font-size: .67rem; color: rgba(255,255,255,.85); font-weight: 500; white-space: nowrap; }
.ag-status-r { margin-left: auto; }

/* ── Voice orb ── */
.ag-orb-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.ag-orb {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, rgba(0,152,255,.6), rgba(0,120,200,.2));
  border: 2px solid rgba(0,152,255,.5);
  animation: orbPulse 2s ease-in-out infinite;
}
@keyframes orbPulse {
  0%, 100% { transform: scale(1);    box-shadow: 0 0 12px rgba(0,152,255,.3); }
  50%       { transform: scale(1.12); box-shadow: 0 0 24px rgba(0,152,255,.6); }
}
.ag-orb-label { font-size: .72rem; color: var(--tx3); text-align: center; }

/* ── Terminal card ── */
.ag-term-lines {
  font-family: var(--m);
  font-size: .72rem;
  color: var(--grn);
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.ag-term-prompt { color: var(--ac); }
.ag-cursor {
  display: inline-block;
  width: 7px;
  height: 12px;
  background: var(--tx);
  vertical-align: middle;
  animation: blink .8s step-end infinite;
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

/* ── Editor card ── */
.ag-code-lines {
  font-family: var(--m);
  font-size: .7rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.c-kw  { color: #569cd6; }
.c-fn  { color: #dcdcaa; }
.c-str { color: #ce9178; }
.c-pn  { color: var(--tx2); }
.c-cm  { color: #6a9955; }

/* ── Agent card badge ── */
.ag-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--acs);
  border: 1px solid rgba(0,152,255,.2);
  font-size: .65rem;
  color: var(--ac);
  font-weight: 600;
}

/* ── Marketplace count ── */
.ag-count { font-size: .72rem; color: var(--tx3); }

/* ── Hint overlay ── */
#ag-hint {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  background: rgba(30,30,30,.85);
  border: 1px solid var(--bd);
  border-radius: 8px;
  backdrop-filter: blur(8px);
  opacity: 0;
  transition: opacity .4s;
  z-index: 1000;
  pointer-events: none;
  white-space: nowrap;
}
#ag-hint.visible { opacity: 1; }
.ag-hint-key { font-size: .72rem; color: var(--tx3); }
.ag-hint-key kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid var(--bd);
  border-radius: 3px;
  background: var(--bg3);
  color: var(--tx2);
  font-family: var(--f);
  font-size: .65rem;
  margin-right: 3px;
}

/* ── Physics active state ── */
.ag-physics-el {
  position: fixed;
  will-change: left, top, transform;
  cursor: grab;
  box-shadow: 0 4px 24px rgba(0,0,0,.4);
  transform-origin: center center;
}
.ag-physics-el.is-grabbed {
  cursor: grabbing;
  box-shadow: 0 12px 40px rgba(0,0,0,.6);
  z-index: 500 !important;
}
@keyframes launchPop {
  0%   { box-shadow: 0 4px 24px rgba(0,0,0,.4), 0 0 0 0 rgba(0,152,255,.6); }
  40%  { box-shadow: 0 4px 24px rgba(0,0,0,.4), 0 0 0 8px rgba(0,152,255,.0); }
  100% { box-shadow: 0 4px 24px rgba(0,0,0,.4); }
}
.ag-physics-el.launching { animation: launchPop .35s ease-out forwards; }
</style>
</head>
<body>

<div id="ag-stage">

  <!-- 1. Nav strip -->
  <nav class="ag-nav" data-physics-id="nav">
    <div class="ag-nav-logo">
      <svg width="80" height="22" viewBox="0 0 260 60" fill="none">
        <g transform="scale(1.2) translate(2,4)">
          <path d="M10 10L5 20L10 30" stroke="var(--ac)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M30 10L35 20L30 30" stroke="var(--ac2)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <text x="56" y="42" font-family="Inter,sans-serif" font-weight="700" font-size="40" fill="currentColor">Mesh.</text>
      </svg>
    </div>
    <div class="ag-nav-links">
      <a href="#">Editor</a>
      <a href="#">Terminal</a>
      <a href="#">Voice-Coding</a>
      <a href="#">Docs</a>
    </div>
  </nav>

  <div class="ag-hero">

    <!-- 2. Hero logo -->
    <div class="ag-hero-logo" data-physics-id="logo">
      <svg width="64" height="64" viewBox="0 0 40 40" fill="none">
        <path d="M10 10L5 20L10 30" stroke="var(--ac)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M30 10L35 20L30 30" stroke="var(--ac2)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="ag-hero-wordmark">Mesh.</div>
    </div>

    <!-- 3. Tagline -->
    <div class="ag-tagline" data-physics-id="tagline">
      The AI-native IDE. Rebuilt.
    </div>

    <!-- 4. Chat input card -->
    <div class="ag-chat" data-physics-id="chat">
      <input type="text" placeholder="Ask Mesh AI… (Enter to send)" readonly>
      <button class="ag-chat-send" tabindex="-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
        </svg>
      </button>
    </div>

    <!-- 5. Feature pills -->
    <div class="ag-pills" data-physics-id="pills">
      <div class="ag-pill">Editor</div>
      <div class="ag-pill">Terminal</div>
      <div class="ag-pill">Voice-Coding</div>
      <div class="ag-pill">Graph</div>
      <div class="ag-pill">AI Agent</div>
      <div class="ag-pill">Marketplace</div>
    </div>

    <div class="ag-grid">

      <!-- 6. Voice orb card -->
      <div class="ag-card" data-physics-id="card-voice">
        <div class="ag-card-kicker">Voice-Coding</div>
        <div class="ag-orb-wrap">
          <div class="ag-orb"></div>
          <div class="ag-orb-label">Live Session Ready</div>
        </div>
      </div>

      <!-- 7. Terminal card -->
      <div class="ag-card" data-physics-id="card-terminal">
        <div class="ag-card-kicker">Terminal</div>
        <div class="ag-term-lines">
          <div><span class="ag-term-prompt">→</span> mesh run</div>
          <div>Starting workspace…</div>
          <div>✓ Ready on :3000</div>
          <div><span class="ag-term-prompt">→</span> <span class="ag-cursor"></span></div>
        </div>
      </div>

      <!-- 8. Editor card -->
      <div class="ag-card" data-physics-id="card-editor">
        <div class="ag-card-kicker">Editor</div>
        <div class="ag-code-lines">
          <div><span class="c-kw">const</span> <span class="c-fn">agent</span> <span class="c-pn"> = </span><span class="c-kw">new</span> <span class="c-fn">MeshAgent</span><span class="c-pn">()</span></div>
          <div><span class="c-kw">await</span> <span class="c-fn">agent</span><span class="c-pn">.</span><span class="c-fn">run</span><span class="c-pn">(</span><span class="c-str">'refactor'</span><span class="c-pn">)</span></div>
          <div><span class="c-cm">// 42 files changed</span></div>
          <div><span class="c-fn">console</span><span class="c-pn">.</span><span class="c-fn">log</span><span class="c-pn">(</span><span class="c-str">'done'</span><span class="c-pn">)</span></div>
        </div>
      </div>

      <!-- 9. AI Agent card -->
      <div class="ag-card" data-physics-id="card-agent">
        <div class="ag-card-kicker">AI Agent</div>
        <div class="ag-card-title">Agentic Edits</div>
        <div class="ag-card-desc">Plan → apply → verify across your entire workspace.</div>
        <div><span class="ag-badge">● Live</span></div>
      </div>

      <!-- 10. Graph card -->
      <div class="ag-card" data-physics-id="card-graph">
        <div class="ag-card-kicker">Graph</div>
        <div class="ag-card-title">Workspace Graph</div>
        <svg viewBox="0 0 120 55" fill="none" style="flex:1">
          <circle cx="60" cy="27" r="6" fill="var(--ac)" opacity=".9"/>
          <circle cx="18" cy="12" r="4" fill="var(--ac2)" opacity=".7"/>
          <circle cx="102" cy="14" r="4" fill="var(--ac2)" opacity=".7"/>
          <circle cx="22" cy="46" r="4" fill="var(--ac2)" opacity=".7"/>
          <circle cx="98" cy="44" r="4" fill="var(--ac2)" opacity=".7"/>
          <circle cx="60" cy="50" r="3" fill="var(--ac2)" opacity=".5"/>
          <line x1="60" y1="27" x2="18"  y2="12" stroke="var(--bd)" stroke-width="1"/>
          <line x1="60" y1="27" x2="102" y2="14" stroke="var(--bd)" stroke-width="1"/>
          <line x1="60" y1="27" x2="22"  y2="46" stroke="var(--bd)" stroke-width="1"/>
          <line x1="60" y1="27" x2="98"  y2="44" stroke="var(--bd)" stroke-width="1"/>
          <line x1="60" y1="27" x2="60"  y2="50" stroke="var(--bd)" stroke-width="1"/>
          <line x1="18" y1="12" x2="102" y2="14" stroke="var(--bd)" stroke-width="1" opacity=".35"/>
        </svg>
      </div>

      <!-- 11. Marketplace card -->
      <div class="ag-card" data-physics-id="card-market">
        <div class="ag-card-kicker">Marketplace</div>
        <div class="ag-card-title">Extensions</div>
        <div class="ag-card-desc">Git · Terminal · Mesh AI</div>
        <div class="ag-count">3 active · <span style="color:var(--ac)">Browse</span></div>
      </div>

    </div>
  </div>

  <!-- 12. Status bar -->
  <div class="ag-status" data-physics-id="status">
    <span>⊛ Mesh Cloud</span>
    <span>⑂ main</span>
    <span>○ 0 ⚠ 0</span>
    <span class="ag-status-r">Mesh AI</span>
  </div>

</div>

<div id="ag-hint">
  <span class="ag-hint-key"><kbd>Space</kbd> Reset</span>
  <span class="ag-hint-key"><kbd>G</kbd> Flip gravity</span>
  <span class="ag-hint-key"><kbd>F</kbd> Freeze</span>
  <span class="ag-hint-key"><kbd>R</kbd> Restart</span>
</div>

<script>
/* Physics engine placeholder — added in Task 2 */
</script>
</body>
</html>
```

- [ ] **Step 2: Verify static layout in browser**

Open `http://localhost:3000/app-v2` (or open the file directly in a browser).

Expected:
- Dark `#1e1e1e` background
- Nav strip at top: Mesh logo left, Editor/Terminal/Voice-Coding/Docs links right
- Centered hero: large Mesh bracket SVG + "Mesh." wordmark (3rem)
- Tagline below: "The AI-native IDE. Rebuilt."
- Chat input bar (full-width, max 580px)
- Row of 6 feature pills
- 3×2 card grid:
  - Voice card with blue pulsing orb
  - Terminal card with green monospace text + blinking cursor
  - Editor card with syntax-colored code
  - Agent card with "● Live" badge
  - Graph card with SVG node diagram
  - Marketplace card
- Blue status bar at bottom
- No JavaScript errors in console

- [ ] **Step 3: Commit static layout**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp
git add views/app-v2.html
git commit -m "feat(app-v2): add static Phase 1 layout for antigravity page"
```

---

## Task 2: Physics Engine (Launch + Tick Loop + Wall Bounce)

**Files:**
- Modify: `views/app-v2.html` — replace the placeholder `<script>` with the full physics engine

- [ ] **Step 1: Replace the `<script>` placeholder with the physics engine**

Replace:
```html
<script>
/* Physics engine placeholder — added in Task 2 */
</script>
```

With:
```html
<script>
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────────── */
  const GRAVITY        = 0.35;   // px/frame² downward pull
  const FRICTION       = 0.995;  // air resistance per frame
  const ROT_FRICTION   = 0.98;   // rotational damping per frame
  const RESTITUTION    = 0.75;   // bounce energy retention (0–1)
  const FLOOR_FRICTION = 0.85;   // extra horizontal damping on floor contact
  const LAUNCH_MIN     = 6;      // minimum launch speed px/frame
  const LAUNCH_MAX     = 18;     // maximum launch speed px/frame
  const MAX_THROW      = 25;     // maximum throw speed cap px/frame
  const LAUNCH_DELAY   = 800;    // ms before physics activates

  /* ── Mutable state ──────────────────────────────────────────────────────── */
  /** @type {Array<{el:HTMLElement,x:number,y:number,w:number,h:number,vx:number,vy:number,rot:number,vrot:number,grabbed:boolean}>} */
  let objects    = [];
  let gravityDir = 1;      // 1 = down, -1 = up
  let frozen     = false;
  let launched   = false;
  let rafId      = null;

  /* ── Drag state ─────────────────────────────────────────────────────────── */
  let dragObj     = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragHistory = [];   // [{x,y,t}] — last N pointer positions
  let mousedownX  = 0;
  let mousedownY  = 0;

  /* ── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    setTimeout(launch, LAUNCH_DELAY);
  }

  /* ── Launch sequence ────────────────────────────────────────────────────── */
  function launch() {
    launched = true;
    const stage = document.getElementById('ag-stage');
    const els   = stage.querySelectorAll('[data-physics-id]');

    els.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const x = rect.left;
      const y = rect.top;
      const w = rect.width;
      const h = rect.height;

      el.style.position = 'fixed';
      el.style.left     = x + 'px';
      el.style.top      = y + 'px';
      el.style.width    = w + 'px';
      el.style.margin   = '0';
      el.style.zIndex   = String(10 + i);
      el.classList.add('ag-physics-el');

      /* Stagger launch pop animation */
      setTimeout(() => {
        el.classList.add('launching');
        setTimeout(() => el.classList.remove('launching'), 350);
      }, i * 40);

      const angle = Math.random() * Math.PI * 2;
      const speed = LAUNCH_MIN + Math.random() * (LAUNCH_MAX - LAUNCH_MIN);
      const vx    = Math.cos(angle) * speed;
      const vy    = Math.sin(angle) * speed;
      const vrot  = vx * (0.3 + Math.random() * 0.3);

      objects.push({ el, x, y, w, h, vx, vy, rot: 0, vrot, grabbed: false });
    });

    stage.style.background = 'transparent';

    const hint = document.getElementById('ag-hint');
    hint.classList.add('visible');
    setTimeout(() => hint.classList.remove('visible'), 4000);

    rafId = requestAnimationFrame(tick);
  }

  /* ── Physics tick (60fps) ───────────────────────────────────────────────── */
  function tick() {
    if (!frozen) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      for (const obj of objects) {
        if (obj.grabbed) continue;

        obj.vy   += GRAVITY * gravityDir;
        obj.vx   *= FRICTION;
        obj.vy   *= FRICTION;
        obj.vrot *= ROT_FRICTION;
        obj.x    += obj.vx;
        obj.y    += obj.vy;
        obj.rot  += obj.vrot;

        /* Wall bounce */
        if (obj.x < 0) {
          obj.x  = 0;
          obj.vx = Math.abs(obj.vx) * RESTITUTION;
        }
        if (obj.x + obj.w > vw) {
          obj.x  = vw - obj.w;
          obj.vx = -Math.abs(obj.vx) * RESTITUTION;
        }
        if (obj.y < 0) {
          obj.y  = 0;
          obj.vy = Math.abs(obj.vy) * RESTITUTION;
        }
        if (obj.y + obj.h > vh) {
          obj.y   = vh - obj.h;
          obj.vy  = -Math.abs(obj.vy) * RESTITUTION;
          obj.vx *= FLOOR_FRICTION;
        }
      }
    }

    /* Apply transforms */
    for (const obj of objects) {
      obj.el.style.left      = obj.x + 'px';
      obj.el.style.top       = obj.y + 'px';
      obj.el.style.transform = 'rotate(' + obj.rot + 'deg)';
    }

    rafId = requestAnimationFrame(tick);
  }

  /* ── Keyboard shortcuts ─────────────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (!launched) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        resetVelocities();
        break;
      case 'KeyG':
        gravityDir *= -1;
        showHint();
        break;
      case 'KeyF':
        frozen = !frozen;
        showHint();
        break;
      case 'KeyR':
        restartPage();
        break;
    }
  });

  function resetVelocities() {
    for (const obj of objects) {
      if (obj.grabbed) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = LAUNCH_MIN + Math.random() * (LAUNCH_MAX - LAUNCH_MIN);
      obj.vx   = Math.cos(angle) * speed;
      obj.vy   = Math.sin(angle) * speed;
      obj.vrot = obj.vx * 0.3;
    }
  }

  let hintTimer = null;
  function showHint() {
    const hint = document.getElementById('ag-hint');
    hint.classList.add('visible');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('visible'), 2500);
  }

  function restartPage() {
    cancelAnimationFrame(rafId);
    rafId = null;
    objects.forEach(obj => {
      obj.el.style.cssText = '';
      obj.el.classList.remove('ag-physics-el', 'is-grabbed', 'launching');
    });
    objects    = [];
    launched   = false;
    frozen     = false;
    gravityDir = 1;
    dragObj    = null;
    dragHistory = [];
    document.getElementById('ag-stage').style.background = '';
    document.getElementById('ag-hint').classList.remove('visible');
    setTimeout(launch, LAUNCH_DELAY);
  }

  /* ── Mouse interaction ──────────────────────────────────────────────────── */
  function getPhysicsObj(target) {
    const el = target.closest('[data-physics-id]');
    if (!el) return null;
    return objects.find(o => o.el === el) || null;
  }

  document.addEventListener('mousedown', e => {
    if (!launched) return;
    const obj = getPhysicsObj(e.target);
    if (!obj) return;
    obj.grabbed = true;
    obj.vx = 0; obj.vy = 0; obj.vrot = 0;
    obj.el.classList.add('is-grabbed');
    dragObj     = obj;
    dragOffsetX = e.clientX - obj.x;
    dragOffsetY = e.clientY - obj.y;
    mousedownX  = e.clientX;
    mousedownY  = e.clientY;
    dragHistory = [{ x: e.clientX, y: e.clientY, t: Date.now() }];
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragObj) return;
    dragObj.x = e.clientX - dragOffsetX;
    dragObj.y = e.clientY - dragOffsetY;
    dragHistory.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    if (dragHistory.length > 8) dragHistory.shift();
  });

  document.addEventListener('mouseup', e => {
    if (!dragObj) return;
    const obj = dragObj;
    dragObj   = null;
    obj.grabbed = false;
    obj.el.classList.remove('is-grabbed');

    const dist = Math.hypot(e.clientX - mousedownX, e.clientY - mousedownY);

    if (dist < 5) {
      /* Click impulse: push element away from click point */
      const cx  = obj.x + obj.w / 2;
      const cy  = obj.y + obj.h / 2;
      const dx  = cx - e.clientX;
      const dy  = cy - e.clientY;
      const len = Math.hypot(dx, dy) || 1;
      obj.vx    = (dx / len) * 12;
      obj.vy    = (dy / len) * 12;
      obj.vrot  = obj.vx * 0.4;
    } else {
      /* Throw: derive velocity from recent pointer history */
      const cutoff = Date.now() - 100;
      const recent = dragHistory.filter(h => h.t >= cutoff);
      if (recent.length >= 2) {
        const first = recent[0];
        const last  = recent[recent.length - 1];
        const dt    = Math.max((last.t - first.t) / 16, 0.5);
        let tvx = (last.x - first.x) / dt;
        let tvy = (last.y - first.y) / dt;
        const spd = Math.hypot(tvx, tvy);
        if (spd > MAX_THROW) { tvx = (tvx / spd) * MAX_THROW; tvy = (tvy / spd) * MAX_THROW; }
        obj.vx   = tvx;
        obj.vy   = tvy;
        obj.vrot = tvx * 0.4;
      }
    }
    dragHistory = [];
  });

  /* ── Touch support ──────────────────────────────────────────────────────── */
  document.addEventListener('touchstart', e => {
    if (!launched) return;
    const t   = e.touches[0];
    const obj = getPhysicsObj(document.elementFromPoint(t.clientX, t.clientY));
    if (!obj) return;
    obj.grabbed = true;
    obj.vx = 0; obj.vy = 0; obj.vrot = 0;
    obj.el.classList.add('is-grabbed');
    dragObj     = obj;
    dragOffsetX = t.clientX - obj.x;
    dragOffsetY = t.clientY - obj.y;
    mousedownX  = t.clientX;
    mousedownY  = t.clientY;
    dragHistory = [{ x: t.clientX, y: t.clientY, t: Date.now() }];
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!dragObj) return;
    const t   = e.touches[0];
    dragObj.x = t.clientX - dragOffsetX;
    dragObj.y = t.clientY - dragOffsetY;
    dragHistory.push({ x: t.clientX, y: t.clientY, t: Date.now() });
    if (dragHistory.length > 8) dragHistory.shift();
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!dragObj) return;
    const obj = dragObj;
    dragObj   = null;
    obj.grabbed = false;
    obj.el.classList.remove('is-grabbed');

    const cutoff = Date.now() - 100;
    const recent = dragHistory.filter(h => h.t >= cutoff);
    if (recent.length >= 2) {
      const first = recent[0];
      const last  = recent[recent.length - 1];
      const dt    = Math.max((last.t - first.t) / 16, 0.5);
      let tvx = (last.x - first.x) / dt;
      let tvy = (last.y - first.y) / dt;
      const spd = Math.hypot(tvx, tvy);
      if (spd > MAX_THROW) { tvx = (tvx / spd) * MAX_THROW; tvy = (tvy / spd) * MAX_THROW; }
      obj.vx   = tvx;
      obj.vy   = tvy;
      obj.vrot = tvx * 0.4;
    } else {
      /* Tap = upward impulse */
      obj.vx   = (Math.random() - 0.5) * 14;
      obj.vy   = -(Math.abs(Math.random() * 10) + 6);
      obj.vrot = obj.vx * 0.4;
    }
    dragHistory = [];
  });

  /* ── Bootstrap ──────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
```

- [ ] **Step 2: Verify physics in browser**

Open `http://localhost:3000/app-v2`.

Expected timeline:
- 0–800ms: static layout visible, all elements in place
- 800ms: all 12 elements simultaneously detach and fly in random directions with a brief blue ring flash
- Ongoing: elements bounce off all four walls with energy loss (RESTITUTION 0.75), slowly spinning
- Friction causes elements to gradually slow but gravity keeps them in constant motion
- No console errors

- [ ] **Step 3: Verify keyboard shortcuts**

- Press `G` → gravity flips, elements fall upward and float on the ceiling; hint overlay fades in
- Press `G` again → gravity restores, elements fall back down
- Press `F` → all elements freeze in place; press `F` again → resume
- Press `Space` → all elements get new random velocities and scatter
- Press `R` → page returns to static Phase 1 layout, then relaunches after 800ms

- [ ] **Step 4: Verify mouse interaction**

- Drag an element across the screen → element follows cursor exactly
- Release quickly → element flies off with throw velocity
- Click (no drag) on an element → element bounces away from click point
- Cursor shows `grab` on hover, `grabbing` while dragging

- [ ] **Step 5: Commit**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp
git add views/app-v2.html
git commit -m "feat(app-v2): add physics engine with launch, gravity, bounce, drag, and keyboard shortcuts"
```

---

## Task 3: Update CODEBASE-MAP.md

**Files:**
- Modify: `CODEBASE-MAP.md`

- [ ] **Step 1: Add entry to CODEBASE-MAP.md**

Open `CODEBASE-MAP.md`. Find the "Main product pages" section under "HTML Surfaces (`views/`)". After the `views/app.html` entry, add:

```markdown
- `views/app-v2.html`
  Purpose: self-contained Mesh Antigravity page — a physics playground where all 12 Mesh UI elements (nav, logo, tagline, chat input, feature pills, voice orb card, terminal card, editor card, agent card, graph card, marketplace card, status bar) float, bounce, rotate, and respond to mouse/touch/keyboard interaction, inspired by the Google Antigravity Easter egg.
  Works with: `/assets/brand/icon-color.svg`, Google Fonts CDN. No backend APIs required. Served at `/app-v2` by static file routing in `src/server.js`.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp
git add CODEBASE-MAP.md
git commit -m "docs: add views/app-v2.html to CODEBASE-MAP"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Two-phase model (static → physics) | Task 1 (static), Task 2 (launch sequence) |
| 12 specific physics objects | Task 1 HTML: nav, logo, tagline, chat, pills, 6 cards, status |
| GRAVITY / FRICTION / ROT_FRICTION / RESTITUTION / FLOOR_FRICTION | Task 2 constants |
| LAUNCH_SPEED_MIN/MAX | Task 2 `LAUNCH_MIN`/`LAUNCH_MAX` constants |
| Wall bounce (all 4 walls) | Task 2 `tick()` wall bounce block |
| Rotation coupling to horizontal velocity | Task 2: `vrot = vx * 0.4` at launch and on throw |
| Click impulse | Task 2 mouseup distance < 5px branch |
| Drag-to-throw with velocity history | Task 2 mouseup throw branch + dragHistory |
| Cursor grab/grabbing | Task 1 CSS `.ag-physics-el` / `.is-grabbed` |
| Touch support | Task 2 touch handlers (start/move/end) |
| Space reset | Task 2 `resetVelocities()` |
| G gravity flip | Task 2 `gravityDir *= -1` |
| F freeze | Task 2 `frozen` toggle |
| R restart | Task 2 `restartPage()` |
| Keyboard hint overlay | Task 1 HTML `#ag-hint`, Task 2 `showHint()` |
| Voice orb CSS pulse animation | Task 1 `@keyframes orbPulse` |
| Terminal blinking cursor | Task 1 `@keyframes blink` |
| Editor syntax colors | Task 1 `.c-kw` / `.c-fn` / `.c-str` / `.c-pn` / `.c-cm` |
| SVG mini graph | Task 1 `card-graph` SVG |
| Staggered launch flash per element | Task 2 `setTimeout(() => el.classList.add('launching'), i * 40)` |
| Mesh design tokens (colors, fonts) | Task 1 `:root` CSS variables match `app-workspace.css` |
| Served at `/app-v2` | `views/app-v2.html` + existing static routing |
| CODEBASE-MAP update | Task 3 |

All spec requirements covered. No gaps found.
