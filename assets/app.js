function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

const NAV_ITEMS = [
  { id: "home", href: "index.html", label: "Home" },
  { id: "terminal", href: "terminal.html", label: "Terminal" },
  { id: "how-it-works", href: "how-it-works.html", label: "How It Works" },
  { id: "statistics", href: "statistics.html", label: "Statistics" },
  { id: "docs", href: "docs.html", label: "Docs" },
  { id: "settings", href: "settings-account.html", label: "Settings" },
];

const FOOTER_ITEMS = [
  { href: "docs.html#api-overview", label: "Docs" },
  { href: "statistics.html", label: "Status" },
  { href: "how-it-works.html", label: "Architecture" },
  { href: "settings-security.html", label: "Security" },
  { href: "settings-account.html", label: "Contact" },
];

const SETTINGS_ITEMS = [
  { id: "account", href: "settings-account.html", label: "Account", copy: "Photo, name, email and connected tools." },
  { id: "security", href: "settings-security.html", label: "Security", copy: "Password policy, 2FA and active sessions." },
  { id: "billing", href: "settings-billing.html", label: "Billing", copy: "Plan, usage, invoices and payment method." },
  { id: "api-keys", href: "settings-api-keys.html", label: "API Keys", copy: "Create, rotate and revoke workspace tokens." },
  { id: "appearance", href: "settings-appearance.html", label: "Appearance", copy: "Theme, accent, density and motion preferences." },
];

const DEFAULT_APPEARANCE = {
  theme: "light",
  accent: "default",
  density: "cozy",
  font: "display",
  motion: "full",
};

const TRANSITION_TTL = 4500;
const DESKTOP_MOTION_MIN = 960;

let revealObserver = null;
let activeCanvasCleanups = [];

const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
const RUNTIME_STORE = new Map();

function loadJSON(key, fallback) {
  const value = RUNTIME_STORE.has(key) ? RUNTIME_STORE.get(key) : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  return { ...fallback, ...value };
}

function saveJSON(key, value) {
  const safeValue = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  RUNTIME_STORE.set(key, safeValue);
}

async function loadAppearanceFromUserStore() {
  try {
    const response = await fetch("/api/user/store/meshAppearance", {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    const value = body?.value && typeof body.value === "object" ? body.value : null;
    return value;
  } catch {
    return null;
  }
}

function applyAppearance(state) {
  const merged = { ...DEFAULT_APPEARANCE, ...state };
  const root = document.documentElement;
  root.dataset.theme = merged.theme;
  root.dataset.accent = merged.accent;
  root.dataset.density = merged.density;
  root.dataset.font = merged.font;
  root.dataset.motion = merged.motion;
}

function currentPage() {
  return document.body.dataset.page || "";
}

function currentSettingsPage() {
  return document.body.dataset.settingsPage || "";
}

function prefersReducedMotion() {
  return document.documentElement.dataset.motion === "reduced" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function desktopMotionAllowed() {
  return !prefersReducedMotion() && window.innerWidth >= DESKTOP_MOTION_MIN;
}

function currentPath() {
  return new URL(window.location.href).pathname;
}

function classifyPath(pathname) {
  if (pathname.includes("terminal")) return "terminal";
  if (pathname.includes("statistics")) return "statistics";
  if (pathname.includes("docs")) return "docs";
  if (pathname.includes("settings")) return "settings";
  if (pathname.includes("how-it-works")) return "how-it-works";
  return "home";
}

function sanitizeCloneIds(root) {
  root.removeAttribute("id");
  qsa("[id]", root).forEach((node) => node.removeAttribute("id"));
  qsa("canvas", root).forEach((canvas) => canvas.remove());
}

function renderHeader() {
  const mount = document.querySelector("[data-site-header]");
  if (!mount) return;
  const active = currentPage();
  mount.innerHTML = `
    <header class="site-header" data-motion-id="header-shell" data-motion-role="nav">
      <div class="container site-header__row">
        <a class="brand" href="index.html" aria-label="MESH home" data-motion-id="brand-shell" data-motion-role="brand">
          <span class="brand__mark" data-motion-id="brand-mark" data-motion-role="brand-mark">
            <svg viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11 2L20 11L11 20L2 11L11 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M11 6L16 11L11 16L6 11L11 6Z" fill="currentColor" opacity="0.6"/>
            </svg>
          </span>
          <span>MESH</span>
        </a>
        <nav class="site-nav" aria-label="Primary" data-motion-id="nav-shell" data-motion-role="nav-shell">
          ${NAV_ITEMS.map((item) => `<a href="${item.href}" ${item.id === active ? 'aria-current="page"' : ""}>${item.label}</a>`).join("")}
        </nav>
        <div class="header-actions">
          <a class="ghost-button" href="app.html">Login</a>
          <a class="primary-button magnetic" href="app.html">Get Started</a>
          <button class="menu-toggle" type="button" aria-label="Open navigation" data-menu-toggle>☰</button>
        </div>
      </div>
    </header>
  `;
}

function renderFooter() {
  const mount = document.querySelector("[data-site-footer]");
  if (!mount) return;
  mount.innerHTML = `
    <footer class="footer">
      <div class="container footer__row">
        <div>
          <div class="brand">
            <span class="brand__mark">
              <svg viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 2L20 11L11 20L2 11L11 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M11 6L16 11L11 16L6 11L11 6Z" fill="currentColor" opacity="0.6"/>
              </svg>
            </span>
            <span>MESH</span>
          </div>
          <p class="subtle" style="margin:10px 0 0; font-size:0.84rem;">A cinematic frontend workspace for routing, observability and operator flows.</p>
        </div>
        <nav class="footer-nav" aria-label="Footer">
          ${FOOTER_ITEMS.map((item) => `<a href="${item.href}">${item.label}</a>`).join("")}
        </nav>
      </div>
    </footer>
  `;
}

function renderAuthModal() {
  if (document.querySelector("[data-auth-modal]")) return;
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.dataset.authModal = "true";
  modal.innerHTML = `
    <div class="modal-panel glass">
      <div class="modal-header">
        <div>
          <div class="eyebrow">Workspace access</div>
          <h2 style="margin:16px 0 0; font-family:var(--font-display); letter-spacing:-0.04em;">Open the MESH workspace</h2>
        </div>
        <button class="ghost-button" type="button" data-auth-close>✕</button>
      </div>
      <div class="tabs" role="tablist" style="margin-bottom:20px;">
        <button class="is-active" type="button" data-auth-tab="signin">Sign in</button>
        <button type="button" data-auth-tab="signup">Create account</button>
      </div>
      <div class="auth-card">
        <form data-auth-form novalidate style="display:grid;gap:16px;">
          <div class="field-wrap" data-auth-name hidden>
            <label for="auth-name">Full name</label>
            <input class="field" id="auth-name" name="name" autocomplete="name">
          </div>
          <div class="field-wrap">
            <label for="auth-email">Work email</label>
            <input class="field" id="auth-email" name="email" type="email" autocomplete="email" required>
          </div>
          <div class="field-wrap">
            <label for="auth-password">Password</label>
            <input class="field" id="auth-password" name="password" type="password" autocomplete="current-password" required>
          </div>
          <div class="field-wrap" data-auth-company hidden>
            <label for="auth-company">Team</label>
            <input class="field" id="auth-company" name="company" autocomplete="organization">
          </div>
          <p class="subtle" data-auth-copy style="font-size:0.84rem; margin:0;">Use workspace credentials to access the operator surfaces.</p>
          <p data-auth-error hidden style="color:var(--red); font-size:0.84rem; margin:0;"></p>
          <div class="button-row" style="margin-top:0;">
            <button class="primary-button magnetic" type="submit" data-auth-submit>Sign in</button>
            <button class="secondary-button" type="button" data-auth-fill>Use demo credentials</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function renderToasts() {
  if (document.querySelector("[data-toast-stack]")) return;
  const stack = document.createElement("div");
  stack.className = "toast-stack";
  stack.dataset.toastStack = "true";
  document.body.appendChild(stack);
}

function renderMotionStage() {
  if (document.querySelector("[data-page-transition]")) return;
  const overlay = document.createElement("div");
  overlay.className = "page-transition";
  overlay.dataset.pageTransition = "true";
  overlay.innerHTML = `
    <div class="page-transition__wash"></div>
    <div class="page-transition__grid"></div>
  `;
  document.body.appendChild(overlay);
}

function showToast(title, message) {
  const stack = document.querySelector("[data-toast-stack]");
  if (!stack) return;
  const node = document.createElement("div");
  node.className = "toast glass";
  node.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = message;
  node.appendChild(strong);
  node.appendChild(span);
  stack.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateX(18px)";
  }, 2800);
  setTimeout(() => node.remove(), 3300);
}

function setAuthMode(mode) {
  const modal = document.querySelector("[data-auth-modal]");
  if (!modal) return;
  const signUp = mode === "signup";
  modal.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authTab === mode);
  });
  modal.querySelector("[data-auth-name]")?.toggleAttribute("hidden", !signUp);
  modal.querySelector("[data-auth-company]")?.toggleAttribute("hidden", !signUp);
  modal.querySelector("[data-auth-submit]").textContent = signUp ? "Create workspace" : "Sign in";
  modal.querySelector("[data-auth-copy]").textContent = signUp
    ? "Create a local demo workspace. Nothing is submitted."
    : "Use workspace credentials to access the operator surfaces.";
  modal.dataset.mode = mode;
}

function initHeaderInteractions() {
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector("[data-menu-toggle]");
  toggle?.addEventListener("click", () => header?.classList.toggle("is-open"));

  let lastY = 0;
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      header?.classList.toggle("is-scrolled", y > 12);
      header?.classList.toggle("is-scrolling-down", y > lastY && y > 120);
      lastY = y;
      ticking = false;
    });
  }, { passive: true });
}

function initAuthModal() {
  const modal = document.querySelector("[data-auth-modal]");
  if (!modal) return;
  qsa("[data-auth-open]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      setAuthMode(trigger.dataset.authOpen || "signin");
      modal.classList.add("is-open");
    });
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.remove("is-open");
  });
  modal.querySelector("[data-auth-close]")?.addEventListener("click", () => modal.classList.remove("is-open"));
  qsa("[data-auth-tab]", modal).forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authTab || "signin"));
  });
  modal.querySelector("[data-auth-fill]")?.addEventListener("click", () => {
    modal.querySelector("#auth-email").value = "operator@mesh.network";
    modal.querySelector("#auth-password").value = "mesh-demo";
    modal.querySelector("#auth-name").value = "Network Operator";
    modal.querySelector("#auth-company").value = "Mesh Labs";
  });
  modal.querySelector("[data-auth-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mode = modal.dataset.mode || "signin";
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "").trim();
    const error = modal.querySelector("[data-auth-error]");
    if (!email || !password) {
      error.hidden = false;
      error.textContent = "Email and password are required.";
      return;
    }
    if (mode === "signup" && String(form.get("name") || "").trim().length < 3) {
      error.hidden = false;
      error.textContent = "Please add a full name.";
      return;
    }
    error.hidden = true;
    modal.classList.remove("is-open");
    showToast(mode === "signup" ? "Workspace created" : "Signed in", `Demo state updated for ${email}.`);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") modal.classList.remove("is-open");
  });
}

function initSettingsSidebar() {
  const mount = document.querySelector("[data-settings-sidebar]");
  if (!mount) return;
  const active = currentSettingsPage();
  mount.innerHTML = `
    <aside class="settings-sidebar card glass" data-motion-id="settings-sidebar" data-motion-role="sidebar">
      <div style="margin-bottom:18px;">
        <h2 style="font-size:1.3rem; font-family:var(--font-display); letter-spacing:-0.04em; color:var(--text-strong); margin:0;">Settings</h2>
        <p style="margin:8px 0 0; font-size:0.82rem;">Workspace controls.</p>
      </div>
      <nav class="settings-nav" aria-label="Settings pages">
        ${SETTINGS_ITEMS.map((item) => `
          <a href="${item.href}" ${item.id === active ? 'aria-current="page"' : ""}>
            <strong style="display:block; margin-bottom:3px; font-size:0.9rem;">${item.label}</strong>
            <small style="font-size:0.76rem;">${item.copy}</small>
          </a>
        `).join("")}
      </nav>
    </aside>
  `;
}

function initFaq() {
  qsa(".faq-item button").forEach((button) => {
    button.addEventListener("click", () => {
      const answer = button.parentElement.querySelector(".faq-answer");
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      answer.hidden = expanded;
    });
  });
}

function initCopyButtons() {
  qsa("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.querySelector(button.dataset.copy);
      if (!target) return;
      await navigator.clipboard.writeText(target.textContent).catch(() => {});
      const original = button.textContent;
      button.textContent = "Copied!";
      setTimeout(() => {
        button.textContent = original;
      }, 1800);
    });
  });
}

function animateCounter(element) {
  const raw = element.dataset.target || element.textContent;
  const prefix = raw.match(/^[^0-9]*/)?.[0] || "";
  const suffix = raw.match(/[^0-9.]*$/)?.[0] || "";
  const numeric = raw.replace(prefix, "").replace(suffix, "");
  const isFloat = numeric.includes(".");
  const target = parseFloat(numeric);
  if (Number.isNaN(target)) return;

  const duration = 1400;
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = target * eased;
    element.textContent = prefix + (isFloat ? current.toFixed(1) : Math.floor(current).toLocaleString()) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function initCounters() {
  const elements = qsa("[data-count]");
  if (!elements.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.dataset.target = entry.target.textContent;
      animateCounter(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.45 });
  elements.forEach((element) => observer.observe(element));
}

function setMotionHook(selector, id, role, root = document) {
  const node = root.querySelector(selector);
  if (!node) return;
  node.dataset.motionId = id;
  node.dataset.motionRole = role;
}

function assignMotionHooks() {
  const page = currentPage();
  document.body.dataset.motionPage = page;

  if (page === "home") {
    setMotionHook(".hero-copy", "page-heading-block", "hero-block");
    setMotionHook(".hero-copy h1", "page-title", "title");
    setMotionHook(".hero-actions", "cta-cluster", "cta");
    setMotionHook(".hero-card", "terminal-shell", "terminal-shell");
    setMotionHook(".kpi-strip", "stats-shell", "stats-shell");
    setMotionHook(".feature-showcase", "story-stage", "panel");
    document.querySelector(".sticky-section")?.setAttribute("data-scroll-scene", "home-story");
  }

  if (page === "terminal") {
    setMotionHook("section.hero .section-heading", "page-heading-block", "hero-block");
    setMotionHook("section.hero .section-heading h2", "page-title", "title");
    setMotionHook(".terminal-screen", "terminal-shell", "terminal-shell");
    setMotionHook(".terminal-sidebar", "terminal-sidebar", "sidebar");
    setMotionHook(".terminal-grid > aside.stack", "terminal-side-panels", "panel-cluster");
  }

  if (page === "statistics") {
    setMotionHook("section.hero .section-heading", "page-heading-block", "hero-block");
    setMotionHook("section.hero .section-heading h2", "page-title", "title");
    setMotionHook(".chart", "stats-shell", "stats-shell");
    setMotionHook("[data-stat-metrics]", "stats-metrics", "metrics");
  }

  if (page === "docs") {
    setMotionHook(".docs-sidebar", "docs-sidebar", "sidebar");
    setMotionHook(".docs-card", "page-heading-block", "hero-block");
    setMotionHook(".docs-article h1", "page-title", "title");
    setMotionHook(".docs-article", "docs-shell", "content-shell");
  }

  if (page === "how-it-works") {
    setMotionHook("section.hero .section-heading", "page-heading-block", "hero-block");
    setMotionHook("section.hero .section-heading h2", "page-title", "title");
    setMotionHook("[data-step-panel]", "how-shell", "panel");
  }

  if (page === "settings") {
    setMotionHook(".settings-stack > .settings-panel:first-child", "settings-primary", "settings-primary");
    setMotionHook(".settings-stack > .settings-panel:first-child h2", "page-title", "title");
    setMotionHook(".settings-stack > .settings-panel:first-child", "page-heading-block", "hero-block");
  }
}

function assignRevealTargets() {
  const selectors = [
    ".hero-copy > *",
    ".hero-card",
    ".section-heading",
    ".feature-grid > *",
    ".kpi-grid > *",
    ".grid-2 > *",
    ".grid-3 > *",
    ".grid-4 > *",
    ".metrics-grid > *",
    ".map-grid > *",
    ".flow-steps > *",
    ".proto-diagram > *",
    ".terminal-panel",
    ".docs-card",
    ".docs-article section",
    ".toc-card",
    ".settings-panel",
    ".settings-sidebar",
    ".faq-list > *",
    ".footer__row > *",
    ".sticky-feature",
  ];

  let index = 0;
  selectors.forEach((selector) => {
    qsa(selector).forEach((node) => {
      if (node.closest("[data-auth-modal]")) return;
      if (!node.hasAttribute("data-reveal")) {
        const mode = node.matches(".hero-card, .terminal-panel, .settings-panel, .docs-card, .card, .metric-card, .chart")
          ? "scale"
          : "up";
        node.setAttribute("data-reveal", mode);
      }
      if (!node.style.getPropertyValue("--reveal-delay")) {
        node.style.setProperty("--reveal-delay", `${Math.min(index * 36, 320)}ms`);
      }
      index += 1;
    });
  });
}

function initRevealObserver(force = false) {
  if (force && revealObserver) revealObserver.disconnect();
  assignRevealTargets();
  const nodes = qsa("[data-reveal]");
  if (prefersReducedMotion()) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
  nodes.forEach((node) => revealObserver.observe(node));
}

function initScrollScenes() {
  const scenes = qsa("[data-scroll-scene], .sticky-section");
  if (!scenes.length) return;
  let ticking = false;
  const update = () => {
    scenes.forEach((scene) => {
      const rect = scene.getBoundingClientRect();
      const vh = window.innerHeight;
      const progress = Math.max(0, Math.min(1, (vh - rect.top) / (rect.height + vh * 0.3)));
      scene.style.setProperty("--scene-progress", progress.toFixed(4));
    });
    ticking = false;
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };
  update();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
}

function initStickyScroll() {
  const features = qsa(".sticky-feature");
  const panels = qsa(".sticky-panel-inner");
  if (!features.length || !panels.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const index = features.indexOf(entry.target);
      features.forEach((feature, featureIndex) => feature.classList.toggle("is-active", featureIndex === index));
      panels.forEach((panel, panelIndex) => panel.classList.toggle("is-active", panelIndex === index));
    });
  }, { rootMargin: "-40% 0px -40% 0px", threshold: 0 });
  features.forEach((feature) => observer.observe(feature));
}

function initPointerMotion() {
  if (!desktopMotionAllowed()) return;

  const cards = qsa(".glow-card, .hero-card, .chart, .terminal-panel, .card, .metric-card, .docs-card, .settings-panel, .map-node")
    .filter((node, index, list) => list.indexOf(node) === index);
  cards.forEach((card) => card.classList.add("motion-premium"));

  cards.forEach((card) => {
    let frame = 0;
    let nextX = "50%";
    let nextY = "50%";
    const move = (event) => {
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      nextX = `${(px * 100).toFixed(2)}%`;
      nextY = `${(py * 100).toFixed(2)}%`;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        card.style.setProperty("--mx", nextX);
        card.style.setProperty("--my", nextY);
        frame = 0;
      });
    };
    const leave = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      card.style.removeProperty("--mx");
      card.style.removeProperty("--my");
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerleave", leave);
  });
}

function buildCanvasField(canvas, options = {}) {
  if (!canvas || prefersReducedMotion()) return null;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const settings = {
    density: options.density || 0.000035,
    speed: options.speed || 0.26,
    radius: options.radius || 1.7,
    distance: options.distance || 150,
    stroke: options.stroke || "rgba(109,95,255,0.26)",
    fill: options.fill || "rgba(109,95,255,0.55)",
  };

  let width = 0;
  let height = 0;
  let nodes = [];
  let animationId = 0;
  let lastFrame = 0;

  const resize = () => {
    const parent = canvas.parentElement || canvas;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(10, Math.floor(width * height * settings.density));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * settings.speed,
      vy: (Math.random() - 0.5) * settings.speed,
      r: settings.radius + Math.random() * 1.3,
    }));
  };

  const frame = (now = 0) => {
    if (now - lastFrame < (options.frameInterval || 32)) {
      animationId = requestAnimationFrame(frame);
      return;
    }
    lastFrame = now;
    context.clearRect(0, 0, width, height);
    for (const node of nodes) {
      node.x += node.vx;
      node.y += node.vy;
      if (node.x <= 0 || node.x >= width) node.vx *= -1;
      if (node.y <= 0 || node.y >= height) node.vy *= -1;
    }
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < settings.distance) {
          context.beginPath();
          context.strokeStyle = settings.stroke.replace("0.26", (1 - distance / settings.distance).toFixed(3));
          context.lineWidth = 0.8;
          context.moveTo(nodes[i].x, nodes[i].y);
          context.lineTo(nodes[j].x, nodes[j].y);
          context.stroke();
        }
      }
    }
    for (const node of nodes) {
      context.beginPath();
      context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      context.fillStyle = settings.fill;
      context.fill();
    }
    animationId = requestAnimationFrame(frame);
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement || canvas);
  resize();
  frame();

  return () => {
    resizeObserver.disconnect();
    cancelAnimationFrame(animationId);
  };
}

function initAmbientCanvases() {
  activeCanvasCleanups.forEach((cleanup) => cleanup?.());
  activeCanvasCleanups = [];
  if (!desktopMotionAllowed() || currentPage() !== "home") return;

  const heroCanvas = document.getElementById("hero-canvas");
  const cardCanvas = document.getElementById("card-canvas");

  const heroCleanup = buildCanvasField(heroCanvas, {
    density: 0.000022,
    speed: 0.14,
    radius: 1.15,
    distance: 132,
    stroke: "rgba(109,95,255,0.18)",
    fill: "rgba(109,95,255,0.34)",
    frameInterval: 40,
  });
  const cardCleanup = buildCanvasField(cardCanvas, {
    density: 0.00004,
    speed: 0.16,
    radius: 1.2,
    distance: 92,
    stroke: "rgba(155,138,255,0.16)",
    fill: "rgba(155,138,255,0.32)",
    frameInterval: 48,
  });

  if (heroCleanup) activeCanvasCleanups.push(heroCleanup);
  if (cardCleanup) activeCanvasCleanups.push(cardCleanup);
}

function initHeroStream() {
  const container = document.querySelector("[data-hero-stream]");
  if (!container) return;

  const timeString = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  };
  const rand = (a, b) => Math.floor(Math.random() * (b - a)) + a;
  const lines = [
    { cls: "", text: () => `<strong>${timeString()}</strong> Frankfurt selected as primary ingress. RTT 11ms.` },
    { cls: "green", text: () => `<strong>${timeString()}</strong> Compression ratio stabilised at 4.2:1.` },
    { cls: "", text: () => `<strong>${timeString()}</strong> Delta dictionary rotated for ${rand(900, 1400)} sessions.` },
    { cls: "amber", text: () => `<strong>${timeString()}</strong> Singapore queue pressure elevated — fallback ready.` },
    { cls: "green", text: () => `<strong>${timeString()}</strong> Edge health check complete. All primary nodes nominal.` },
    { cls: "", text: () => `<strong>${timeString()}</strong> Adaptive Brotli-X switched to warm API set.` },
    { cls: "green", text: () => `<strong>${timeString()}</strong> Route score improved to ${(98 + Math.random() * 2).toFixed(2)}%.` },
  ];

  let index = 0;
  const addLine = () => {
    if (container.children.length >= 7) container.firstElementChild.remove();
    const line = lines[index % lines.length];
    const node = document.createElement("div");
    node.className = `live-stream-line ${line.cls}`.trim();
    node.innerHTML = line.text();
    container.appendChild(node);
    index += 1;
  };

  container.innerHTML = "";
  for (let i = 0; i < 5; i += 1) addLine();
  setInterval(addLine, 2200);
}

function createTransitionSnapshot(targetHref) {
  const target = new URL(targetHref, window.location.href);
  return {
    timestamp: Date.now(),
    sourcePath: currentPath(),
    sourcePage: currentPage(),
    targetPath: target.pathname,
    targetPage: classifyPath(target.pathname),
    scrollY: window.scrollY,
  };
}

function activateTransitionOverlay(mode) {
  const overlay = document.querySelector("[data-page-transition]");
  if (!overlay) return;
  overlay.dataset.mode = mode;
  overlay.classList.add("is-active");
}

function clearTransitionOverlay() {
  const overlay = document.querySelector("[data-page-transition]");
  if (!overlay) return;
  overlay.classList.remove("is-active");
  overlay.dataset.mode = "";
}

function playIncomingTransition() {
  return;
}

function initPageTransitions() {
  const overlay = document.querySelector("[data-page-transition]");
  if (!overlay) return;

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== "_self") return;
    if (link.hasAttribute("download")) return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("data:") || href.startsWith("#")) return;
    const target = new URL(href, window.location.href);
    if (target.origin !== window.location.origin) return;
    if (target.pathname === currentPath() && target.hash) return;
    event.preventDefault();
    const snapshot = createTransitionSnapshot(href);
    if (Date.now() - snapshot.timestamp > TRANSITION_TTL) return;
    activateTransitionOverlay(snapshot.targetPage);
    document.body.classList.add("is-leaving");
    setTimeout(() => {
      window.location.href = target.href;
    }, desktopMotionAllowed() ? 220 : 120);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  applyAppearance(loadJSON("meshAppearance", DEFAULT_APPEARANCE));
  const remoteAppearance = await loadAppearanceFromUserStore();
  if (remoteAppearance && Object.keys(remoteAppearance).length) {
    saveJSON("meshAppearance", remoteAppearance);
    applyAppearance(remoteAppearance);
  }

  renderHeader();
  renderFooter();
  renderAuthModal();
  renderToasts();
  renderMotionStage();
  initSettingsSidebar();
  assignMotionHooks();

  window.meshApp = {
    loadJSON,
    saveJSON,
    applyAppearance,
    showToast,
    settingsItems: SETTINGS_ITEMS,
    reobserve: () => initRevealObserver(true),
    refreshMotionHooks: assignMotionHooks,
  };

  initHeaderInteractions();
  initAuthModal();
  initFaq();
  initCopyButtons();
  initCounters();
  initStickyScroll();
  initScrollScenes();
  initRevealObserver();
  initPageTransitions();

  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
    initPointerMotion();
    initAmbientCanvases();
    initHeroStream();
    playIncomingTransition();
  });
});
