# Design Spec: app-v2.html — Mesh Antigravity

**Date:** 2026-04-08  
**Status:** Approved  
**Output:** `views/app-v2.html` (self-contained — inline CSS + JS, no build step)

---

## 1. Overview

`app-v2.html` is a Mesh-branded clone of the Google Antigravity Easter egg. The page renders a static Mesh portal layout for ~800ms, then all UI elements simultaneously detach from the DOM flow and become independent physics objects that bounce, rotate, and respond to user interaction. Served at `/app-v2` by the existing Express server.

---

## 2. Two-Phase Page Model

### Phase 1 — Static (0–800ms)
The page renders as a centered, dark-themed Mesh portal:
- Top nav strip (Mesh logo left, nav links right)
- Hero: large Mesh wordmark + tagline
- Chat/search input bar (centered)
- Feature pill row (Editor · Terminal · Voice-Coding · Graph · Agent · Marketplace)
- 3×2 grid of feature cards
- Status bar strip at bottom

No interaction possible. This is the "before antigravity" state, exactly as Google shows the normal search page before the Easter egg triggers.

### Phase 2 — Antigravity (800ms+)
Each of the 12 physics objects detaches:
1. Each element's current `getBoundingClientRect()` is captured
2. Element is repositioned as `position:fixed` at identical coordinates
3. Original DOM placeholder collapses (visibility:hidden, no reflow)
4. Element receives randomized launch velocity
5. Physics loop starts at 60fps via `requestAnimationFrame`

---

## 3. Physics Engine

Custom lightweight engine — no external library. Fully self-contained.

### State per object
```
{
  el: HTMLElement,
  x: number,        // left edge position
  y: number,        // top edge position
  w: number,        // width (fixed at launch)
  h: number,        // height (fixed at launch)
  vx: number,       // velocity x (px/frame)
  vy: number,       // velocity y (px/frame)
  rot: number,      // current rotation (degrees)
  vrot: number,     // rotational velocity (deg/frame)
  grabbed: boolean,
  mass: number      // affects impulse response (larger cards = more mass)
}
```

### Per-frame update
```
if (!obj.grabbed) {
  obj.vy += GRAVITY;          // 0.35 px/frame²
  obj.vx *= FRICTION;         // 0.995 damping
  obj.vy *= FRICTION;
  obj.vrot *= ROT_FRICTION;   // 0.98
  obj.x += obj.vx;
  obj.y += obj.vy;
  obj.rot += obj.vrot;
  handleWallBounce(obj);
}
applyTransform(obj);
```

### Wall bounce
- Left/right: if `x < 0` → `x = 0`, `vx = -vx * RESTITUTION (0.75)`
- Floor: if `y + h > viewport.height` → `y = viewport.height - h`, `vy = -vy * RESTITUTION`; add horizontal friction on floor contact (`vx *= 0.85`)
- Ceiling: if `y < 0` → `y = 0`, `vy = -vy * RESTITUTION`

### Rotation coupling
`vrot` is set at launch as a fraction of `vx` (±`vx * 0.4`, clamped to ±6 deg/frame). As velocity decays, rotation decays proportionally.

### Constants
| Constant | Value | Purpose |
|---|---|---|
| GRAVITY | 0.35 | Downward pull per frame |
| FRICTION | 0.995 | Air resistance |
| ROT_FRICTION | 0.98 | Spin damping |
| RESTITUTION | 0.75 | Bounce energy retention |
| LAUNCH_SPEED_MIN | 6 | px/frame minimum launch speed |
| LAUNCH_SPEED_MAX | 18 | px/frame maximum launch speed |

---

## 4. The 12 Physics Objects

| # | Element | Content | Special behavior |
|---|---|---|---|
| 1 | Top nav strip | Mesh logo + nav links (Editor, Terminal, Docs) | Wide, low mass |
| 2 | Hero logo | Large Mesh wordmark SVG (same as app.html) | Heavy, slow spin |
| 3 | Tagline | "The AI-native IDE. Rebuilt." | Light, fast spin |
| 4 | Chat input card | Textarea + send button + model selector | Medium |
| 5 | Feature pill row | Editor · Terminal · Voice-Coding · Graph · Agent | Wide |
| 6 | Voice orb card | Animated CSS pulse orb + "Voice-Coding" label | Animated while floating |
| 7 | Terminal card | Fake prompt: `$ mesh run` + blinking cursor | Blink animation persists |
| 8 | Editor card | 4 lines of syntax-colored fake JS code | Color preserved |
| 9 | AI Agent card | Icon + "Agentic Edits" + description | Standard |
| 10 | Graph card | Mini SVG node graph | Standard |
| 11 | Marketplace card | Icon + "Extensions" + count badge | Standard |
| 12 | Status bar strip | `⊛ Mesh Cloud  ⑂ main  ○ 0 ⚠ 0` | Wide, low mass |

---

## 5. Mouse / Touch Interaction

### Click impulse
- `mousedown` on non-grabbed element → apply impulse away from click point relative to element center
- Impulse magnitude: 12px/frame, direction: from click point outward through element center

### Drag-to-throw
- `mousedown` → grab: set `obj.grabbed = true`, record `grabOffsetX/Y`
- `mousemove` → track last 3 positions + timestamps for throw velocity
- `mouseup` → release: compute velocity from last 3 frames, apply to `obj.vx/vy`, set `grabbed = false`
- Grabbed element: transform follows mouse exactly, no gravity, z-index elevated
- Cursor: `grab` when hoverable, `grabbing` while dragging

### Touch
- `touchstart` / `touchmove` / `touchend` mirror the mouse handlers using `touches[0]`

---

## 6. Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Reset all objects to viewport center with new random velocities |
| `G` | Toggle gravity direction (down ↔ up) |
| `F` | Freeze/unfreeze all objects (pause physics) |
| `R` | Reset page to Phase 1 (static layout, restart countdown) |

---

## 7. Visual Design

Uses the exact Mesh design system from `app-workspace.css`:
- Background: `#1e1e1e`
- Accent: `#0098ff`
- Font: Inter (Google Fonts CDN)
- Mono: JetBrains Mono (for terminal/editor cards)
- Border: `#3c3c3c`
- All CSS custom properties inlined

Cards have:
- `border-radius: 8px`
- `border: 1px solid #3c3c3c`
- `background: #252526`
- `box-shadow: 0 4px 24px rgba(0,0,0,0.4)` — shifts subtly as rotation increases
- `will-change: transform` for GPU acceleration

Launch animation: each element does a quick scale `1 → 1.05 → 1` over 200ms as it detaches, paired with a brief glow on the border (`border-color: #0098ff`).

---

## 8. Voice Orb Card (Mesh-Specific)

The voice orb card is a Mesh-exclusive element not in the original Google Antigravity. It renders:
- Centered pulsing circle (CSS keyframe animation: scale 1→1.15→1, opacity 0.8→1, 2s loop)
- Inner ring glow in `#0098ff`
- Label: "Voice-Coding" below
- Sub-label: "Tap to start session" (non-functional in this page)

The pulse animation continues while the card floats. The orb visual is identical to the one in `voiceSurfaceOrbStageIntro` in `app.html`.

---

## 9. Page Entry & Loading

```html
<html lang="en" data-theme="dark">
```

- Same favicon as app.html (`assets/brand/icon-color.svg`)
- Same font imports
- No external JS dependencies
- File is fully self-contained: one HTML file, inline `<style>` and `<script>`
- Served by existing `src/server.js` at route `/app-v2` (no server changes needed — static file serving picks it up from `views/`)

---

## 10. CODEBASE-MAP.md Update

After creating the file, add this entry under "HTML Surfaces (`views/`)":

```
- `views/app-v2.html`
  Purpose: self-contained Mesh Antigravity page — a physics playground where all Mesh UI elements float, bounce, rotate, and respond to interaction, inspired by the Google Antigravity Easter egg.
  Works with: `assets/brand/icon-color.svg`, Google Fonts CDN. No backend APIs required.
```

---

## 11. Out of Scope

- No actual IDE functionality (Monaco, file tree, etc.) — this is a visual/interactive demo page
- No auth overlay — page is publicly accessible
- No backend API calls
- No collision detection between objects (wall bounce only, not object-object) — keeps physics O(n) not O(n²)
