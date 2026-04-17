# Phase 29: Terminal Research

**Phase:** 29 — Terminal Visibility, Copy & Local Connection
**Researched:** 2026-04-17

---

## 1. TERM-01: xterm.js Theme — Text Visibility

### xterm.js 5.5 Theme API

The `Terminal` constructor accepts a `theme` option with `ITheme` interface properties. The exact property names confirmed from xterm.js 5.x source:

```js
new Terminal({
  theme: {
    foreground: '#c8e6f0',      // Main text color
    background: '#1a1a1a',
    cursor: '#00d4ff',
    cursorAccent: '#1a1a1a',
    selectionBackground: '#264f78',
    selectionForeground: '#ffffff',
    // ANSI colors: black, red, green, yellow, blue, magenta, cyan, white
    // + bright variants: brightBlack, brightRed, etc.
  }
})
```

**Current code (assets/app-workspace.js:1439):** Uses `foreground:'#d4d4d4'` which is mid-gray. The fix is to update to `foreground:'#c8e6f0'` and `cursor:'#00d4ff'`.

**`theme` can also be updated at runtime:** `term.options.theme = { ...newTheme }` — no need to recreate the terminal.

**Gotcha:** xterm.js loads asynchronously from CDN ESM (views/app.njk:498-502). The `window.Terminal` check at app-workspace.js:1428 guards against this correctly.

---

## 2. TERM-02: Copy Behavior — xterm.js 5.5 API

### Selection API (confirmed for xterm.js 5.x)

```js
term.hasSelection()     // boolean — true if text is currently selected
term.getSelection()     // string — returns selected text (empty string if none)
term.clearSelection()   // clears selection
```

### Key Event Interception

```js
term.attachCustomKeyEventHandler((e) => {
  // Return false to prevent xterm from processing the key
  if ((e.metaKey || e.ctrlKey) && e.key === 'c' && term.hasSelection()) {
    navigator.clipboard.writeText(term.getSelection());
    return false; // prevent xterm from sending Ctrl+C to shell
  }
  return true; // let xterm handle normally (sends SIGINT if no selection)
});
```

**This is the correct API for xterm 5.x** — `attachCustomKeyEventHandler` replaces the older `onKey` approach for key interception. Returns `false` to consume the event, `true` to pass through.

### Mouse Selection

xterm.js enables mouse selection by default. The issue is that some terminal applications (vim, htop) enable "mouse mode" which causes xterm to forward mouse events to the shell instead of doing selection. For the current use case (basic shell), mouse mode won't be active.

**No additional config needed** — xterm selection works out of the box. The `mouseEvents` option does not exist in xterm 5.x; xterm handles this internally via `term.modes.mouseTrackingMode`.

**`copyOnSelect`** is not a top-level option in xterm 5.x — it's accessed via `term.options.copyOnSelect = false` (default). The user chose NOT to use copyOnSelect, so this is already the default.

### Clipboard API Availability

`navigator.clipboard.writeText()` requires a secure context (HTTPS or localhost). Since Mesh runs on HTTPS in production, this is safe. In development (HTTP), use the fallback:

```js
async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}
```

---

## 3. TERM-03: Local Agent Architecture

### Architecture Overview

```
User's Machine                     Mesh Server (EC2)            Browser
┌────────────────┐   WebSocket    ┌──────────────────┐   WS    ┌──────────┐
│ mesh-local     │◄──────────────►│ /terminal-agent  │◄───────►│ xterm.js │
│ (node-pty)     │  /term-agent   │  (proxy/router)  │/terminal│          │
│ spawns shell   │                │                  │         │          │
└────────────────┘                └──────────────────┘         └──────────┘
```

**Message flow:**
1. Browser connects to `/terminal` (authenticated with session cookie)
2. Server checks if an agent is connected for this user (`/terminal-agent` endpoint)
3. If agent connected: server routes browser messages → agent → pty → agent → server → browser
4. If agent not connected: server shows "connect dialog" state

### Server-Side: `/terminal-agent` WebSocket Endpoint

```js
// New endpoint alongside existing /terminal in terminal.routes.js
// Agent authenticates with long-lived token (not session cookie)

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname === '/terminal-agent') {
    // Agent auth: Bearer token in query param or Authorization header
    const agentToken = url.searchParams.get('token') 
      || req.headers['authorization']?.replace('Bearer ', '');
    const userId = await resolveUserFromAgentToken(agentToken);
    if (!userId) { socket.destroy(); return; }
    
    wssAgent.handleUpgrade(req, socket, head, (ws) => {
      // Store agent connection keyed by userId
      agentConnections.set(userId, ws);
      ws.on('close', () => agentConnections.delete(userId));
    });
  }
});
```

**Agent connection map:** In-memory `Map<userId, WebSocket>` in the server process. Acceptable for single-server deployments; for multi-instance would need Redis pub/sub (out of scope here).

### Agent Token Storage

Use the existing `setUserStoreValue` / `getUserStoreValue` from `secure-db.js`:

```js
// Generate token (in auth.routes.js, new POST /api/v1/terminal/agent-token)
const token = crypto.randomBytes(32).toString('hex');
await setUserStoreValue(userId, 'terminal-agent-token', { token, createdAt: Date.now() });
return { token };

// Verify token (in terminal-agent WebSocket upgrade handler)
async function resolveUserFromAgentToken(rawToken) {
  // Must scan user store — but this is inefficient for DynamoDB
  // Better: store a reverse index: token hash → userId
}
```

**Token lookup problem:** `getUserStoreValue` requires a known `userId`. For token-based auth we need the reverse: token → userId. 

**Solution:** Store both directions:
1. `setUserStoreValue(userId, 'terminal-agent-token', { token, createdAt })` — user's token
2. Separately, store in a dedicated session-like table keyed by token hash (like existing session tokens)

**Simpler solution:** Reuse the existing `createSession` / `findSession` pattern from `secure-db.js:220-267` but with a different type field. The session table already has `hashSessionToken` and lookup by hash. Add an `agentToken` type:

```js
// In secure-db.js — new exported function
async function createAgentToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const hashId = hashSessionToken(token); // reuse existing hash fn
  const doc = {
    id: hashId,
    type: 'agent-token',
    userId,
    createdAt: toIsoNow(),
    // No expiry — long-lived
  };
  // Store in DYNAMO_SESSIONS_TABLE (same table, different type)
  await putDoc(DYNAMO_SESSIONS_TABLE, doc);
  return token;
}

async function findAgentToken(rawToken) {
  const hashId = hashSessionToken(rawToken);
  const doc = await getDoc(DYNAMO_SESSIONS_TABLE, hashId);
  if (!doc || doc.type !== 'agent-token') return null;
  return doc.userId;
}
```

### mesh-local Package Structure

```
packages/mesh-local/
├── package.json          # { "name": "mesh-local", "bin": { "mesh-local": "bin/mesh-local.js" } }
├── bin/
│   └── mesh-local.js     # CLI entry — parses --token, --server, registers mesh:// handler
├── src/
│   ├── agent.js          # WebSocket client + node-pty integration
│   ├── protocol-register.js  # mesh:// URL scheme registration (macOS/Linux)
│   └── config.js         # Reads/writes ~/.mesh-local.json (persisted token)
└── README.md
```

**`mesh-local` dependencies:** `ws` (WebSocket client), `node-pty` (shell spawning). Both already in the main project — mesh-local can be a zero-extra-dep package that requires the user to have Node.js.

### mesh:// Protocol Registration

**macOS (using `defaults write`):**

```bash
# Register mesh:// to launch "mesh-local --launch"
defaults write com.apple.LaunchServices LSHandlers -array-add \
  '{ LSHandlerURLScheme = "mesh"; LSHandlerRoleAll = "com.mesh.local-agent"; }'
# Requires logout/login or: /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local
```

**Better macOS approach:** Register via `Info.plist` in a minimal `.app` bundle, or use `open-app` approach. However, the simplest cross-platform approach is:

```js
// In bin/mesh-local.js — auto-register on first run
const os = require('os');
if (os.platform() === 'darwin') {
  // Write a minimal .app bundle to ~/Applications/MeshLocalAgent.app
  // with Info.plist defining CFBundleURLSchemes = ['mesh']
  registerMacOSProtocol();
} else if (os.platform() === 'linux') {
  // Write ~/.local/share/applications/mesh-local.desktop
  // with MimeType=x-scheme-handler/mesh
  // Then: xdg-mime default mesh-local.desktop x-scheme-handler/mesh
  registerLinuxProtocol();
}
```

**Gotcha:** macOS requires the `Info.plist` `CFBundleURLSchemes` approach (not `defaults write LSHandlers` directly — that is for file types). The correct approach:

```xml
<!-- ~/Applications/MeshLocalAgent.app/Contents/Info.plist -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>mesh</string></array>
    <key>CFBundleURLName</key>
    <string>Mesh Local Agent</string>
  </dict>
</array>
```

The `.app` bundle's executable is just a shell script that calls `npx mesh-local --launch "$@"`.

**URL format:** `mesh://launch-agent?token=<TOKEN>&server=https://mesh.ai`

When opened, `mesh-local` parses the URL, reads token, connects to server.

### ResizeObserver + FitAddon

```js
// Wire after term.open(mountEl):
const resizeObserver = new ResizeObserver(() => {
  S.termFit?.fit();
});
resizeObserver.observe(mountEl);

// Store on S for cleanup:
S.termResizeObserver = resizeObserver;

// In closeTerminal():
S.termResizeObserver?.disconnect();
S.termResizeObserver = null;
```

**Gotcha:** Call `fit()` only after the terminal is opened and has dimensions. The existing `setTimeout(()=>S.termFit?.fit(),100)` at line 1444 handles initial sizing — the ResizeObserver handles subsequent resizes.

**`onResize` event (already wired at line 1462):** `term.onResize(({cols,rows}) => ws.send(...))` already sends resize to server/pty. No change needed there — FitAddon triggers this automatically when `fit()` is called.

---

## 4. Connect Dialog UI

The connect dialog needs to:
1. Generate/fetch the user's agent token via `GET /api/v1/terminal/agent-token`
2. Display two connection options:
   - **Auto-launch:** `<a href="mesh://launch-agent?token=...&server=...">Launch Mesh Local Agent</a>` button
   - **Manual:** Code block with `npx mesh-local --token=<TOKEN> --server=<SERVER>` and a copy button
3. Poll `/api/v1/terminal/agent-status` (or use the existing WS connection) to detect when agent connects
4. Auto-close and open terminal when agent connects

**Status polling:** Simple `setInterval` polling `GET /api/v1/terminal/agent-status` every 1.5s, stops when agent connects or dialog closes.

---

## 5. Validation Architecture

### TERM-01 Checks
- `assets/app-workspace.js` contains `foreground:'#c8e6f0'` in the xterm theme config
- `assets/app-workspace.js` contains `cursor:'#00d4ff'` in the xterm theme config
- Both `#termContainer` and `#terminalSurfacePrimary` mount points use the same `openTerminal()` function (already true — single function)

### TERM-02 Checks
- `assets/app-workspace.js` contains `attachCustomKeyEventHandler` call
- `assets/app-workspace.js` contains `term.hasSelection()` check inside the key handler
- `assets/app-workspace.js` contains `navigator.clipboard.writeText` call

### TERM-03 Checks
- `src/routes/terminal.routes.js` handles `/terminal-agent` WebSocket path
- `secure-db.js` exports `createAgentToken` and `findAgentToken` functions
- `src/routes/auth.routes.js` has `POST /api/v1/terminal/agent-token` endpoint
- `src/routes/auth.routes.js` has `GET /api/v1/terminal/agent-status` endpoint
- `packages/mesh-local/` directory exists with `package.json` and `bin/mesh-local.js`
- `packages/mesh-local/src/agent.js` exists
- `packages/mesh-local/src/protocol-register.js` exists
- Connect dialog UI exists in `views/app.njk` (or rendered via JS)

### Resize Check
- `assets/app-workspace.js` contains `ResizeObserver` wired to terminal container
- `assets/app-workspace.js` `closeTerminal` disconnects the ResizeObserver

---

## 6. Implementation Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `navigator.clipboard` blocked in non-HTTPS dev | TERM-02 broken in dev | Add `execCommand('copy')` fallback |
| agent connection map lost on server restart | TERM-03: user must reconnect agent | Acceptable — agent auto-reconnects with stored token |
| mesh:// not registered or blocked by browser | TERM-03: fallback to manual command | Always show manual command as fallback |
| node-pty unavailable on user's machine | mesh-local fails | Clear error message; node-pty is a native module requiring build tools |
| xterm.js CDN load failure | All terminal features fail | Existing toast/fallback already handles this at app-workspace.js:1429 |
| ResizeObserver loop (fit triggers resize → observer fires again) | Performance | `fit()` is idempotent and xterm debounces resize events |

---

## RESEARCH COMPLETE
