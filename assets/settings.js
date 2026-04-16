/* ============================================================
   MESH Settings — shared JS
   Handles: forms, switches, API keys, billing, appearance
   ============================================================ */

/* ── Utils ── */
function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
function qsa(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

const USER_STORE_KEYS = [
  "meshAiAnthropic",
  "meshAiOpenAI",
  "meshAiGoogle",
  "meshAiByok",
  "meshAiBehaviour",
  "meshByokModelRegistry",
  "meshApiKeys",
  "meshAppearance",
  "meshSwitches",
  "meshAccountProfile",
  "meshWorkspaceConfig",
  "meshSecurityBaseline",
  "meshBillingContact",
  "meshBillingState",
  "meshIntegrations",
  "meshAssistantEditFlow",
];

const SENSITIVE_USER_STORE_KEYS = new Set([
  "meshAiAnthropic",
  "meshAiOpenAI",
  "meshAiGoogle",
  "meshAiByok",
  "meshApiKeys",
]);

const SAFE_USER_STORE_KEYS = USER_STORE_KEYS.filter((key) => !SENSITIVE_USER_STORE_KEYS.has(key));

const USER_STORE_CACHE = new Map();
let USER_STORE_READY = false;
const SETTINGS_ROUTES = {
  account: "settings-account",
  security: "settings-security",
  billing: "settings-billing",
  "api-keys": "settings-api-keys",
  appearance: "settings-appearance",
  ai: "settings-ai",
};
const DEFAULT_APPEARANCE = { theme: "light", density: "default", accent: "indigo", motion: "full", font: "berkeley", sidebarWidth: "default" };
const DEFAULT_BILLING_STATE = { cycle: "annual", currentPlan: "pro" };
const DEFAULT_INTEGRATIONS = {
  github: { connected: true, label: "@yourhandle", scopes: "Read access to repositories" },
  slack: { connected: true, label: "#mesh-ops", scopes: "Activity and alert routing" },
  pagerduty: { connected: false, label: "On-call schedules", scopes: "Route incident alerts to escalation chains" },
  datadog: { connected: false, label: "Metrics pipeline", scopes: "Forward edge metrics and session telemetry" },
};

const DEMO_BILLING_SUMMARY = {
  currentPlanLabel: "Pro",
  currentPlan: "pro",
  cycle: "annual",
  monthlySpendLabel: "$149.00",
  invoices: [
    { id: "inv_2026_03", period: "March 2026", detail: "Pro plan · Annual · 12 seats", amountLabel: "$149.00", status: "paid" },
    { id: "inv_2026_02", period: "February 2026", detail: "Pro plan · Annual · 12 seats", amountLabel: "$149.00", status: "paid" },
    { id: "inv_2026_01", period: "January 2026", detail: "Pro plan · Annual · 12 seats", amountLabel: "$149.00", status: "paid" },
  ],
  usage: [
    { id: "edge-events", label: "Edge events", used: "7.4M", limit: "10M", percent: 74, tone: "normal" },
    { id: "operator-seats", label: "Operator seats", used: "4", limit: "12", percent: 33, tone: "normal" },
    { id: "audit-log", label: "Audit log storage", used: "27 days", limit: "90 days", percent: 30, tone: "normal" },
  ],
};

function cloneJson(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (
    fallback && typeof fallback === "object" && !Array.isArray(fallback) &&
    value && typeof value === "object" && !Array.isArray(value)
  ) {
    return { ...fallback, ...value };
  }

  return value;
}

function isEmptyValue(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function readLegacyLocalJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return cloneJson(JSON.parse(raw), fallback);
  } catch {}
  return cloneJson(undefined, fallback);
}

function loadJSON(key, fallback) {
  if (USER_STORE_CACHE.has(key)) {
    return cloneJson(USER_STORE_CACHE.get(key), fallback);
  }
  return readLegacyLocalJSON(key, fallback);
}

async function putUserStoreValue(key, value) {
  const response = await fetch(`/api/user/store/${encodeURIComponent(key)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value, merge: true }),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw || `Storage update failed (${response.status})`);
  }
}

function saveJSON(key, val) {
  USER_STORE_CACHE.set(key, val);
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  void putUserStoreValue(key, val).catch(() => {});
}

async function persistJSON(key, value) {
  USER_STORE_CACHE.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  // Treat API failure as non-fatal so the UI works without a backend.
  await putUserStoreValue(key, value).catch(() => {});
  return value;
}

async function preloadUserStoreCache() {
  if (USER_STORE_READY) return;

  // Seed from localStorage first so the UI renders correctly without a backend.
  for (const key of USER_STORE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      USER_STORE_CACHE.set(key, raw !== null ? JSON.parse(raw) : {});
    } catch {
      USER_STORE_CACHE.set(key, {});
    }
  }

  // Try to hydrate from server; merge on top of local values for non-sensitive keys.
  try {
    const query = encodeURIComponent(SAFE_USER_STORE_KEYS.join(","));
    const response = await fetch(`/api/user/store?keys=${query}`, { credentials: "same-origin" });
    if (response.ok) {
      const body = await response.json().catch(() => ({}));
      const remote = body?.data && typeof body.data === "object" ? body.data : {};
      for (const key of SAFE_USER_STORE_KEYS) {
        if (remote[key] !== undefined) USER_STORE_CACHE.set(key, remote[key]);
      }
    }
  } catch {}

  USER_STORE_READY = true;
}

function showToast(title, msg) {
  let stack = qs("[data-toast-stack]");
  if (!stack) { stack = document.createElement("div"); stack.className = "toast-stack"; stack.dataset.toastStack = ""; document.body.appendChild(stack); }
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = '';
  const div = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = msg;
  div.appendChild(strong);
  div.appendChild(span);
  t.appendChild(div);
  stack.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(8px)"; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

document.addEventListener("mesh-toast", (event) => {
  const detail = event?.detail || {};
  if (!detail.title && !detail.body) return;
  showToast(detail.title || "Notice", detail.body || "");
});

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function withButtonBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    if (busyText) button.textContent = busyText;
    return;
  }
  button.disabled = false;
  if (button.dataset.originalText) button.textContent = button.dataset.originalText;
}

function readReturnTo() {
  const raw = String(new URL(window.location.href).searchParams.get("returnTo") || "").trim();
  if (!raw) return "/app";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {}
  return "/app";
}

function buildSettingsHref(page) {
  // Always target the combined /settings SPA; the hash selects the section.
  const pageId = Object.keys(SETTINGS_ROUTES).includes(page) ? page : "account";
  // If we are already on the settings page, return just the hash to keep the URL clean.
  if (window.location.pathname.endsWith("/settings") || window.location.pathname.endsWith("/settings.html")) {
    return `#${pageId}`;
  }
  const url = new URL(`${window.location.origin}/settings`);
  url.searchParams.set("returnTo", readReturnTo());
  return `${url.pathname}${url.search}#${pageId}`;
}

function applyStandaloneNavigation() {
  const returnTo = readReturnTo();
  qsa(".topbar-back, .topbar-logo").forEach((link) => {
    link.setAttribute("href", returnTo);
  });
  qsa(".settings-nav a").forEach((link) => {
    const href = String(link.getAttribute("href") || "").trim();
    const page = Object.keys(SETTINGS_ROUTES).find((key) => href.includes(SETTINGS_ROUTES[key])) || "account";
    link.setAttribute("href", buildSettingsHref(page));
  });
}

function resolveThemeSetting(theme) {
  const value = String(theme || "light").trim().toLowerCase();
  if (value === "system") {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return value === "dark" ? "dark" : "light";
}

function applySettingsTheme() {
  document.documentElement.dataset.theme = resolveThemeSetting(loadJSON("meshAppearance", DEFAULT_APPEARANCE).theme);
}

function snapshotForm(form) {
  return JSON.stringify(Object.fromEntries(new FormData(form)));
}

function updateFormDirtyState(form, initialRef) {
  const dirty = snapshotForm(form) !== initialRef.value;
  form.dataset.dirty = dirty ? "true" : "false";
  const submit = qs("button[type='submit']", form);
  if (submit && !submit.disabled) {
    submit.textContent = dirty ? (submit.dataset.dirtyLabel || "Save changes") : (submit.dataset.cleanLabel || submit.dataset.originalLabel || submit.textContent);
  }
}

/* ── Forms with server-side user store ── */
function initForms() {
  qsa("form[data-storage-key]").forEach(form => {
    const key = form.dataset.storageKey;
    const msg = form.dataset.successMessage || "Saved.";
    const saved = loadJSON(key, {});
    qsa("input,select,textarea", form).forEach(el => { if (el.name && saved[el.name] !== undefined) el.value = saved[el.name]; });
    const submit = qs("button[type='submit']", form);
    if (submit) {
      submit.dataset.originalLabel = submit.textContent;
      submit.dataset.cleanLabel = submit.textContent;
      submit.dataset.dirtyLabel = form.dataset.dirtyLabel || "Save changes";
    }
    const initialSnapshot = { value: snapshotForm(form) };
    qsa("input,select,textarea", form).forEach((field) => {
      field.addEventListener("input", () => updateFormDirtyState(form, initialSnapshot));
      field.addEventListener("change", () => updateFormDirtyState(form, initialSnapshot));
    });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (SENSITIVE_USER_STORE_KEYS.has(key)) {
        Object.keys(data).forEach((fieldName) => {
          if (/apikey/i.test(fieldName) && !String(data[fieldName] || "").trim()) {
            delete data[fieldName];
          }
        });
      }
      withButtonBusy(submit, true, "Saving…");
      try {
        await persistJSON(key, { ...loadJSON(key, {}), ...data });
        initialSnapshot.value = snapshotForm(form);
        updateFormDirtyState(form, initialSnapshot);
        showToast("Saved", msg);
      } catch (error) {
        showToast("Save failed", error.message || "Could not store settings.");
      } finally {
        withButtonBusy(submit, false);
      }
    });
    updateFormDirtyState(form, initialSnapshot);
  });
}

/* ── AI BYOK + model registry ── */
const AI_MODEL_REGISTRY_KEY = "meshByokModelRegistry";
const AI_STATIC_MODEL_IDS = {
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "o3", "gpt-4o-mini"],
  google: ["gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro"],
};
const AI_MODEL_LABELS = {
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "gpt-4o": "GPT-4o",
  "o3": "o3",
  "gpt-4o-mini": "GPT-4o mini",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-1.5-pro": "Gemini 1.5 Pro",
};

function aiModelLabel(modelId) {
  const id = String(modelId || "").replace(/^models\//, "").trim();
  if (!id) return "Unknown model";
  if (AI_MODEL_LABELS[id]) return AI_MODEL_LABELS[id];
  return id
    .split(/[\/_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function postJSON(url, payload) {
  const headers = { "Content-Type": "application/json" };

  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(payload || {}),
  });

  const raw = await response.text();
  let body = {};
  if (raw) {
    try { body = JSON.parse(raw); }
    catch { throw new Error(raw.slice(0, 180)); }
  }

  if (response.status === 401) {
    throw new Error("Session missing. Sign in on the app page first.");
  }

  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `Request failed (${response.status})`);
  }

  return body;
}

function loadAiRegistry() {
  return loadJSON(AI_MODEL_REGISTRY_KEY, {
    providerReports: {},
    staticVerified: {},
    dynamicModels: [],
    updatedAt: null,
  });
}

function normalizeAdditionalModel(model, fallbackProviderId, fallbackProviderName) {
  if (!model) return null;

  if (typeof model === "string") {
    const id = model.trim();
    if (!id) return null;
    return {
      id,
      label: aiModelLabel(id),
      providerId: fallbackProviderId,
      providerName: fallbackProviderName,
    };
  }

  const id = String(model.id || "").trim();
  if (!id) return null;
  return {
    id,
    label: String(model.label || aiModelLabel(id)).trim() || aiModelLabel(id),
    providerId: String(model.providerId || fallbackProviderId || "byok").trim().toLowerCase() || "byok",
    providerName: String(model.providerName || fallbackProviderName || "BYOK").trim() || "BYOK",
  };
}

function mergeAiValidationResult(result) {
  const registry = loadAiRegistry();
  const provider = String(result?.provider || "").trim().toLowerCase();
  if (!provider) return;

  const providerId = String(result?.providerId || provider).trim().toLowerCase() || provider;
  const providerName = String(result?.providerName || provider.toUpperCase()).trim() || provider.toUpperCase();
  const reportKey = provider === "byok" ? `byok:${providerId}` : provider;

  registry.providerReports[reportKey] = {
    provider,
    providerId,
    providerName,
    requestedModels: Array.isArray(result?.requestedModels)
      ? result.requestedModels.map(modelId => String(modelId || "").trim()).filter(Boolean)
      : [],
    reachableModels: Array.isArray(result?.reachableModels) ? result.reachableModels : [],
    verifiedModels: Array.isArray(result?.verifiedModels) ? result.verifiedModels : [],
    failedModels: Array.isArray(result?.failedModels)
      ? result.failedModels
          .map(item => ({
            id: String(item?.id || item || "").trim(),
            error: String(item?.error || "").trim(),
          }))
          .filter(item => item.id)
      : [],
    additionalModels: Array.isArray(result?.additionalModels)
      ? result.additionalModels
          .map(item => normalizeAdditionalModel(item, providerId, providerName))
          .filter(Boolean)
      : [],
    checkedAt: new Date().toISOString(),
  };

  const nextStatic = {};
  const nextDynamic = [];
  const seenDynamic = new Set();

  Object.values(registry.providerReports).forEach(report => {
    (Array.isArray(report.verifiedModels) ? report.verifiedModels : []).forEach(modelId => {
      nextStatic[String(modelId)] = true;
    });

    (Array.isArray(report.additionalModels) ? report.additionalModels : []).forEach(model => {
      const normalized = normalizeAdditionalModel(model, report.providerId, report.providerName);
      if (!normalized) return;
      if (AI_MODEL_LABELS[normalized.id]) return;
      const dedupeKey = `${normalized.providerId}::${normalized.id}`;
      if (seenDynamic.has(dedupeKey)) return;
      seenDynamic.add(dedupeKey);
      nextDynamic.push(normalized);
    });
  });

  registry.staticVerified = nextStatic;
  registry.dynamicModels = nextDynamic;
  registry.updatedAt = new Date().toISOString();
  saveJSON(AI_MODEL_REGISTRY_KEY, registry);
}

function renderByokValidation(result) {
  const statusEl = qs("[data-byok-result]");
  const existingEl = qs("[data-byok-existing]");
  const newEl = qs("[data-byok-new]");
  if (!statusEl || !existingEl || !newEl) return;

  const requested = Array.isArray(result?.requestedModels) ? result.requestedModels : [];
  const reachable = Array.isArray(result?.reachableModels) ? result.reachableModels : [];
  const verified = Array.isArray(result?.verifiedModels) ? result.verifiedModels : [];
  const additional = Array.isArray(result?.additionalModels) ? result.additionalModels : [];
  const failed = Array.isArray(result?.failedModels) ? result.failedModels : [];
  const testedCount = requested.length || (reachable.length + failed.length);

  const testedPrefix = testedCount
    ? `Tested model IDs (${testedCount})`
    : "No model IDs were tested";

  if (reachable.length) {
    statusEl.textContent = `${testedPrefix} · reachable (${reachable.length}): ${reachable.slice(0, 6).join(", ")}${reachable.length > 6 ? " …" : ""}`;
  } else {
    statusEl.textContent = `${testedPrefix} · no reachable models found.`;
  }

  if (failed.length) {
    const failedIds = failed
      .map(item => String(item?.id || "").trim())
      .filter(Boolean);
    if (failedIds.length) {
      statusEl.textContent += ` Failed: ${failedIds.slice(0, 4).join(", ")}${failedIds.length > 4 ? " …" : ""}`;
    }
  }

  existingEl.textContent = verified.length
    ? `Already in dropdown (now verified): ${verified.map(aiModelLabel).join(", ")}`
    : "No existing dropdown models were verified by this key.";

  const normalizedAdditional = additional
    .map(item => normalizeAdditionalModel(item, result?.providerId, result?.providerName))
    .filter(Boolean);

  newEl.textContent = normalizedAdditional.length
    ? `New BYOK models imported: ${normalizedAdditional.slice(0, 8).map(item => item.label).join(", ")}${normalizedAdditional.length > 8 ? " …" : ""}`
    : "No new BYOK models were imported.";
}

function updateAiStats() {
  if (document.body.dataset.settingsPage !== "ai") return;

  const providerCountEl = qs("#ai-stat-providers");
  const modelEl = qs("#ai-stat-model");
  const contextEl = qs("#ai-stat-context");

  const anthropic = loadJSON("meshAiAnthropic", {});
  const openai = loadJSON("meshAiOpenAI", {});
  const google = loadJSON("meshAiGoogle", {});
  const byok = loadJSON("meshAiByok", {});
  const behaviour = loadJSON("meshAiBehaviour", {});

  let providerCount = 0;
  if (String(anthropic.apiKey || "").trim()) providerCount++;
  if (String(openai.apiKey || "").trim()) providerCount++;
  if (String(google.apiKey || "").trim()) providerCount++;
  if (String(byok.apiKey || "").trim()) providerCount++;
  if (providerCountEl) providerCountEl.textContent = String(providerCount);

  const provider = String(behaviour.defaultProvider || "anthropic").trim().toLowerCase();
  let defaultModel = "claude-sonnet-4-6";
  if (provider === "openai") {
    defaultModel = String(openai.defaultModel || "gpt-5.4");
  } else if (provider === "google") {
    defaultModel = String(google.defaultModel || "gemini-3.1-pro");
  } else if (provider === "byok") {
    const registry = loadAiRegistry();
    const firstByok = Array.isArray(registry.dynamicModels) && registry.dynamicModels.length > 0 ? registry.dynamicModels[0].id : "byok";
    defaultModel = firstByok;
  } else {
    defaultModel = String(anthropic.defaultModel || "claude-sonnet-4-6");
  }
  if (modelEl) modelEl.textContent = aiModelLabel(defaultModel);

  const limit = Number(behaviour.fileCharLimit || 8000);
  if (contextEl) contextEl.textContent = `${Math.round(limit / 1000)}k`;
}

function providerFormByName(provider) {
  const map = {
    anthropic: "#form-anthropic",
    openai: "#form-openai",
    google: "#form-google",
    byok: "#form-byok",
  };
  const selector = map[provider];
  if (!selector) return null;
  return qs(selector);
}

function buildValidationPayload(provider, form) {
  const data = Object.fromEntries(new FormData(form || undefined));
  const parseModelIds = (raw) => String(raw || "")
    .split(/[\n,]/g)
    .map(modelId => modelId.trim())
    .filter(Boolean);

  if (provider === "anthropic") {
    return {
      provider,
      apiKey: String(data.apiKey || "").trim(),
    };
  }
  if (provider === "openai") {
    return {
      provider,
      apiKey: String(data.apiKey || "").trim(),
      orgId: String(data.orgId || "").trim(),
    };
  }
  if (provider === "google") {
    return {
      provider,
      apiKey: String(data.apiKey || "").trim(),
    };
  }
  if (provider === "byok") {
    return {
      provider,
      providerId: String(data.providerId || "openrouter").trim().toLowerCase() || "openrouter",
      providerName: String(data.providerName || "BYOK").trim() || "BYOK",
      apiKey: String(data.apiKey || "").trim(),
      baseUrl: String(data.baseUrl || "").trim(),
      modelIds: parseModelIds(data.modelIds),
    };
  }
  return { provider };
}

function setValidationButtonState(button, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Testing…";
    return;
  }
  button.disabled = false;
  button.textContent = button.dataset.originalText || "Test connection";
}

function renderStoredByokSummary() {
  if (document.body.dataset.settingsPage !== "ai") return;
  const registry = loadAiRegistry();
  const reports = Object.values(registry.providerReports || {});
  const byokReport = reports
    .filter(report => report.provider === "byok")
    .sort((a, b) => String(b.checkedAt || "").localeCompare(String(a.checkedAt || "")))[0];

  if (byokReport) {
    renderByokValidation(byokReport);
  }
}

function initAiSettingsPage() {
  if (document.body.dataset.settingsPage !== "ai") return;

  qsa("[data-test-key]").forEach(button => {
    button.addEventListener("click", async () => {
      const provider = String(button.dataset.testKey || "").trim().toLowerCase();
      const form = providerFormByName(provider);
      if (!form) {
        showToast("Validation failed", "Provider form not found.");
        return;
      }

      const payload = buildValidationPayload(provider, form);
      if (!String(payload.apiKey || "").trim()) {
        showToast("API key missing", "Paste your API key before testing this provider.");
        return;
      }

      setValidationButtonState(button, true);
      try {
        const result = await postJSON("/api/byok/validate", payload);
        mergeAiValidationResult(result);
        if (provider === "byok") {
          renderByokValidation(result);
        }

        const reachableCount = Array.isArray(result?.reachableModels) ? result.reachableModels.length : 0;
        const importedCount = Array.isArray(result?.additionalModels) ? result.additionalModels.length : 0;
        const failedCount = Array.isArray(result?.failedModels) ? result.failedModels.length : 0;
        showToast("Validation successful", `${provider.toUpperCase()} reachable models: ${reachableCount}${provider === "byok" ? ` · imported: ${importedCount}${failedCount ? ` · failed: ${failedCount}` : ""}` : ""}`);
        updateAiStats();
      } catch (error) {
        showToast("Validation failed", error.message || "Provider validation failed.");
      } finally {
        setValidationButtonState(button, false);
      }
    });
  });

  ["#form-anthropic", "#form-openai", "#form-google", "#form-byok", "[data-storage-key='meshAiBehaviour']"]
    .map(selector => qs(selector))
    .filter(Boolean)
    .forEach(form => {
      form.addEventListener("submit", () => {
        setTimeout(updateAiStats, 10);
      });
    });

  renderStoredByokSummary();
  updateAiStats();
}

/* ── Switches ── */
function initSwitches() {
  const state = loadJSON("meshSwitches", {});
  qsa("[data-switch]").forEach(sw => {
    const key = sw.dataset.switch;
    const checkbox = sw.querySelector("input[type=checkbox]");
    if (checkbox) {
      // New label+checkbox structure
      if (state[key] !== undefined) checkbox.checked = state[key];
      checkbox.addEventListener("change", () => {
        state[key] = checkbox.checked;
        saveJSON("meshSwitches", state);
        showToast(checkbox.checked ? "Enabled" : "Disabled", key.replace(/([A-Z])/g, " $1").toLowerCase());
      });
    } else {
      // Legacy aria-pressed structure
      if (state[key]) sw.setAttribute("aria-pressed", "true");
      sw.addEventListener("click", () => {
        const next = sw.getAttribute("aria-pressed") !== "true";
        sw.setAttribute("aria-pressed", String(next));
        state[key] = next;
        saveJSON("meshSwitches", state);
        showToast(next ? "Enabled" : "Disabled", key.replace(/([A-Z])/g, " $1").toLowerCase());
      });
    }
  });
}

/* ── Expire sessions ── */
function initExpireSessions() {
  if (document.body.dataset.settingsPage !== "security") return;

  const list = qs("[data-sessions-list]");
  const baseline = loadJSON("meshSecurityBaseline", {});
  const ttlValue = qs("[data-security-stat='ttl']");
  const ttlDesc = qs("[data-security-stat-desc='ttl']");
  const recoveryValue = qs("[data-security-stat='recovery']");
  const recoveryDesc = qs("[data-security-stat-desc='recovery']");

  if (ttlValue) ttlValue.textContent = String(baseline.sessionTtl || "14d").replace("d", " d");
  if (ttlDesc) ttlDesc.textContent = "Current session TTL before re-authentication is required.";
  const recoveryCount = [baseline.recoveryEmail, baseline.breakglass].filter((entry) => String(entry || "").trim()).length || 2;
  if (recoveryValue) recoveryValue.textContent = String(recoveryCount);
  if (recoveryDesc) recoveryDesc.textContent = "Recovery contacts configured for emergency workspace access.";

  async function revoke(mode, sessionId, button) {
    withButtonBusy(button, true, mode === "all" ? "Expiring…" : "Working…");
    try {
      const response = await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, sessionId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) throw new Error(body?.error || "Session revoke failed.");
      if (body.signedOut) {
        window.location.assign("/app?login=1");
        return;
      }
      showToast("Sessions updated", mode === "others" ? "Other sessions expired." : mode === "all" ? "All sessions expired." : "Session expired.");
      await loadSessions();
    } catch (error) {
      showToast("Session action failed", error.message || "Could not revoke session.");
    } finally {
      withButtonBusy(button, false);
    }
  }

  function bindButtons() {
    qsa("[data-expire-sessions]").forEach((button) => {
      button.onclick = async () => {
        const rawMode = String(button.dataset.expireSessions || "session").trim().toLowerCase();
        const mode = rawMode === "session" ? "single" : rawMode;
        await revoke(mode, String(button.dataset.sessionId || "").trim(), button);
      };
    });
  }

  async function loadSessions() {
    if (!list) return;
    list.innerHTML = `<div class="session-card"><div class="session-meta"><strong>Loading active sessions…</strong><span class="badge badge-neutral">Syncing</span></div><div class="session-detail">Fetching current sessions.</div></div>`;
    try {
      const response = await fetch("/api/auth/sessions", { credentials: "same-origin" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) throw new Error(body?.error || "Could not load sessions.");
      const sessions = Array.isArray(body.sessions) ? body.sessions : [];
      if (!sessions.length) {
        list.innerHTML = `<div class="session-card"><div class="session-meta"><strong>No active sessions</strong><span class="badge badge-neutral">Clear</span></div><div class="session-detail">No live sessions are stored for this operator.</div></div>`;
        return;
      }
      list.innerHTML = sessions.map((session) => {
        const badgeClass = session.current ? "badge-green" : "badge-neutral";
        const badgeText = session.current ? "Current" : "Active";
        const ip = session.ipAddress ? ` · ${escapeHtml(session.ipAddress)}` : "";
        return `<div class="session-card">
          <div class="session-meta">
            <strong>${escapeHtml(session.label)}</strong>
            <span class="badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="session-detail">${escapeHtml(session.platform)} · ${escapeHtml(session.browser)}${ip} · Last active ${escapeHtml(session.lastActiveLabel || "recently")}</div>
          <button class="btn-ghost-sm" type="button" data-expire-sessions="session" data-session-id="${escapeHtml(session.id)}">${session.current ? "Sign out" : "Expire"}</button>
        </div>`;
      }).join("");
      bindButtons();
    } catch {
      list.innerHTML = `
        <div class="session-card">
          <div class="session-meta"><strong>MacBook Pro — Safari 18</strong><span class="badge badge-green">Current</span></div>
          <div class="session-detail">macOS 15 · Safari 18 · EU Central · Active now</div>
          <button class="btn-ghost-sm" type="button" data-expire-sessions="session" data-session-id="demo-1">Sign out</button>
        </div>
        <div class="session-card">
          <div class="session-meta"><strong>iPhone 16 — Safari 18</strong><span class="badge badge-neutral">Active</span></div>
          <div class="session-detail">iOS 18 · Safari 18 · EU Central · Last active 3h ago</div>
          <button class="btn-ghost-sm" type="button" data-expire-sessions="session" data-session-id="demo-2">Expire</button>
        </div>
        <div class="session-card">
          <div class="session-meta"><strong>Windows 11 — Chrome 132</strong><span class="badge badge-neutral">Active</span></div>
          <div class="session-detail">Windows 11 · Chrome 132 · US East · Last active 2 days ago</div>
          <button class="btn-ghost-sm" type="button" data-expire-sessions="session" data-session-id="demo-3">Expire</button>
        </div>`;
      bindButtons();
    }
  }

  bindButtons();
  void loadSessions();
}

/* ── Connect accounts ── */
function initConnectAccounts() {
  if (document.body.dataset.settingsPage !== "account") return;
  const list = qs("[data-integrations-list]");
  const stat = qs("[data-account-stat='integrations']");
  const statDesc = qs("[data-account-stat-desc='integrations']");

  function normalizeState(raw) {
    const state = raw && typeof raw === "object" ? raw : {};
    const next = {};
    Object.entries(DEFAULT_INTEGRATIONS).forEach(([id, defaults]) => {
      next[id] = { ...defaults, ...(state[id] && typeof state[id] === "object" ? state[id] : {}) };
    });
    return next;
  }

  function render() {
    if (!list) return;
    const state = normalizeState(loadJSON("meshIntegrations", DEFAULT_INTEGRATIONS));
    const connectedCount = Object.values(state).filter((entry) => entry.connected).length;
    if (stat) stat.textContent = String(connectedCount);
    if (statDesc) statDesc.textContent = connectedCount === 1 ? "1 connected service on this operator profile." : `${connectedCount} connected services on this operator profile.`;

    list.innerHTML = Object.entries(state).map(([id, item]) => {
      const title = id === "github" ? "GitHub" : id === "slack" ? "Slack" : id === "pagerduty" ? "PagerDuty" : "Datadog";
      const badgeClass = item.connected ? "badge-green" : "badge-neutral";
      const badgeText = item.connected ? "Connected" : "Not connected";
      const buttonClass = item.connected ? "btn-ghost-sm" : "btn-secondary";
      const buttonStyle = item.connected ? "" : "font-size:0.78rem;padding:6px 12px;";
      const buttonLabel = item.connected ? "Disconnect" : "Connect";
      const detail = item.connected ? `${item.label} · ${item.scopes}` : item.scopes;
      return `<div class="session-card">
        <div class="session-meta" style="flex:1;">
          <strong>${escapeHtml(title)}</strong>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="session-detail">${escapeHtml(detail)}</div>
        <button class="${buttonClass}" type="button" style="${buttonStyle}" data-connect-account="${escapeHtml(id)}">${buttonLabel}</button>
      </div>`;
    }).join("");

    qsa("[data-connect-account]").forEach((button) => {
      button.onclick = async () => {
        const serviceId = String(button.dataset.connectAccount || "").trim().toLowerCase();
        const state = normalizeState(loadJSON("meshIntegrations", DEFAULT_INTEGRATIONS));
        if (!state[serviceId]) return;
        state[serviceId].connected = !state[serviceId].connected;
        withButtonBusy(button, true, state[serviceId].connected ? "Connecting…" : "Disconnecting…");
        try {
          await persistJSON("meshIntegrations", state);
          render();
          showToast(state[serviceId].connected ? "Integration connected" : "Integration disconnected", `${titleCase(serviceId)} access updated.`);
        } catch (error) {
          showToast("Integration update failed", error.message || "Could not update integration.");
        } finally {
          withButtonBusy(button, false);
        }
      };
    });
  }

  function titleCase(value) {
    return String(value || "")
      .split(/[-_\s]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  render();
}

/* ── API Keys ── */
const KEYS_STORE = "meshApiKeys";

function issueApiToken() {
  const bytes = new Uint8Array(18);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const body = Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
  return `mesh_${body}`;
}

function maskApiToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return "mesh_••••";
  if (token.length <= 10) return `${token.slice(0, 4)}••••`;
  return `${token.slice(0, 8)}••••${token.slice(-4)}`;
}

function normalizeApiKeyState(rawState) {
  const input = rawState && Array.isArray(rawState.keys) ? rawState.keys : [];
  let changed = false;

  const keys = input.map((entry) => {
    const name = String(entry?.name || "").trim();
    const scope = String(entry?.scope || "read").trim() || "read";
    const region = String(entry?.region || "Global").trim() || "Global";
    const environment = String(entry?.environment || "edge").trim() || "edge";
    const created = String(entry?.created || "").trim() || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const tokenPreview = String(entry?.tokenPreview || "").trim();
    const legacyToken = String(entry?.token || "").trim();

    if (legacyToken) changed = true;
    const preview = tokenPreview || maskApiToken(legacyToken);

    return {
      name,
      scope,
      region,
      environment,
      tokenPreview: preview,
      created,
    };
  }).filter((entry) => entry.name);

  if (keys.length !== input.length) changed = true;
  return { keys, changed };
}

function renderKeys() {
  const list = qs("[data-api-key-list]");
  const empty = qs("[data-api-empty]");
  const snippet = qs("#api-key-snippet");
  if (!list) return;

  const normalized = normalizeApiKeyState(loadJSON(KEYS_STORE, { keys: [] }));
  const keys = normalized.keys;
  if (normalized.changed) {
    saveJSON(KEYS_STORE, { keys });
  }

  // Update metrics
  qs("[data-key-metric='active']") && (qs("[data-key-metric='active']").textContent = keys.length);
  qs("[data-key-metric='automation']") && (qs("[data-key-metric='automation']").textContent = keys.filter(k => k.scope && k.scope.includes("write")).length);
  qs("[data-key-metric='edge']") && (qs("[data-key-metric='edge']").textContent = keys.filter(k => k.environment === "edge").length);

  if (empty) empty.hidden = keys.length > 0;

  list.textContent = "";
  keys.forEach((k, i) => {
    const entry = document.createElement("div"); entry.className = "api-key-entry";
    const info = document.createElement("div"); info.className = "api-key-info";
    const nameDiv = document.createElement("div"); nameDiv.className = "key-name"; nameDiv.textContent = String(k.name || "");
    const metaDiv = document.createElement("div"); metaDiv.className = "key-meta"; metaDiv.textContent = String(k.region || "") + " · " + String(k.environment || "") + " · created " + String(k.created || "");
    const tokenDiv = document.createElement("div"); tokenDiv.className = "api-key-token"; tokenDiv.textContent = String(k.tokenPreview || "");
    info.appendChild(nameDiv); info.appendChild(metaDiv); info.appendChild(tokenDiv);
    const actions = document.createElement("div"); actions.className = "api-key-actions";
    const rotateBtn = document.createElement("button"); rotateBtn.className = "btn-secondary"; rotateBtn.type = "button"; rotateBtn.style.cssText = "font-size:0.74rem;padding:5px 10px;"; rotateBtn.dataset.rotateKey = String(i); rotateBtn.textContent = "Rotate";
    const deleteBtn = document.createElement("button"); deleteBtn.className = "btn-danger"; deleteBtn.type = "button"; deleteBtn.style.cssText = "font-size:0.74rem;padding:5px 10px;"; deleteBtn.dataset.deleteKey = String(i); deleteBtn.textContent = "Delete";
    actions.appendChild(rotateBtn); actions.appendChild(deleteBtn);
    entry.appendChild(info); entry.appendChild(actions);
    list.appendChild(entry);
  });

  if (snippet && keys.length > 0) {
    const last = keys[keys.length - 1];
    snippet.textContent = `curl -X GET https://api.mesh.run/v1/routes \\
  -H "Authorization: Bearer <paste-new-token-here>" \\
  -H "X-Mesh-Region: ${last.region}" \\
  -H "X-Mesh-Workspace: nova-ops"`;
  } else if (snippet) {
    snippet.textContent = "# Create a key above to see an example request.";
  }

  // Rotate
  qsa("[data-rotate-key]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const state = normalizeApiKeyState(loadJSON(KEYS_STORE, { keys: [] }));
      const idx = parseInt(btn.dataset.rotateKey);
      const token = issueApiToken();
      if (!state.keys[idx]) return;
      state.keys[idx].tokenPreview = maskApiToken(token);
      state.keys[idx].created = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      saveJSON(KEYS_STORE, { keys: state.keys });
      renderKeys();
      await navigator.clipboard?.writeText(token).catch(() => {});
      showToast("Key rotated", `${state.keys[idx].name} rotated. New token copied once.`);
    });
  });

  // Delete
  qsa("[data-delete-key]").forEach(btn => {
    btn.addEventListener("click", () => {
      const state = normalizeApiKeyState(loadJSON(KEYS_STORE, { keys: [] }));
      const name = state.keys[parseInt(btn.dataset.deleteKey)].name;
      state.keys.splice(parseInt(btn.dataset.deleteKey), 1);
      saveJSON(KEYS_STORE, { keys: state.keys });
      renderKeys();
      showToast("Key deleted", name);
    });
  });
}

function initApiKeys() {
  const form = qs("[data-api-key-form]");
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.name) { showToast("Name required", "Give the key a name before creating it."); return; }
    const state = normalizeApiKeyState(loadJSON(KEYS_STORE, { keys: [] }));
    const token = issueApiToken();
    state.keys.push({
      name: data.name,
      scope: data.scope || "read",
      region: data.region || "Global",
      environment: data.environment || "edge",
      tokenPreview: maskApiToken(token),
      created: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    });
    saveJSON(KEYS_STORE, { keys: state.keys });
    form.reset();
    renderKeys();
    await navigator.clipboard?.writeText(token).catch(() => {});
    showToast("Key created", `${data.name} created. Token copied once.`);
  });
  renderKeys();
}

/* ── Billing cycle toggle ── */
function initBilling() {
  if (document.body.dataset.settingsPage !== "billing") return;

  const cycleButtons = qsa("[data-billing-cycle]");
  const planButtons = qsa("[data-select-plan]");
  const planCards = qsa("[data-plan]");
  const statPlan = qs("[data-billing-stat='plan']");
  const statPlanDesc = qs("[data-billing-stat-desc='plan']");
  const statSpend = qs("[data-billing-stat='spend']");
  const statSpendDesc = qs("[data-billing-stat-desc='spend']");
  const statUsage = qs("[data-billing-stat='usage']");
  const statUsageDesc = qs("[data-billing-stat-desc='usage']");
  const invoiceList = qs("[data-invoice-list]");
  const usageList = qs("[data-usage-list]");

  async function fetchSummary() {
    const response = await fetch("/api/app/billing/summary", { credentials: "same-origin" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) throw new Error(body?.error || "Could not load billing summary.");
    return body.billing || {};
  }

  function renderUsageRows(rows) {
    if (!usageList) return;
    usageList.innerHTML = rows.map((item) => {
      const percent = Math.max(0, Math.min(100, Number(item.percent || 0)));
      const badgeClass = item.tone === "warning" ? "badge-yellow" : "badge-neutral";
      return `<div class="usage-row">
        <div class="usage-label">${escapeHtml(item.label)}</div>
        <div class="usage-bar-wrap">
          <div class="usage-bar" style="--pct: ${percent}%"></div>
        </div>
        <div class="usage-value">${escapeHtml(item.used)} / ${escapeHtml(item.limit)}</div>
        <span class="badge ${badgeClass}">${percent}%</span>
      </div>`;
    }).join("");
  }

  function renderInvoices(invoices) {
    if (!invoiceList) return;
    invoiceList.innerHTML = invoices.map((invoice) => {
      const paid = String(invoice.status || "").toLowerCase() === "paid";
      return `<div class="invoice-row">
        <div class="invoice-period">${escapeHtml(invoice.period)}</div>
        <div class="invoice-detail">${escapeHtml(invoice.detail)}</div>
        <div class="invoice-amount">${escapeHtml(invoice.amountLabel)}</div>
        <span class="badge ${paid ? "badge-green" : "badge-neutral"}">${escapeHtml(String(invoice.status || "open").replace(/^\w/, c => c.toUpperCase()))}</span>
        <button class="btn-ghost-sm" type="button" data-billing-download="${escapeHtml(invoice.id)}">Download</button>
      </div>`;
    }).join("");
    qsa("[data-billing-download]").forEach((button) => {
      button.onclick = () => {
        window.location.assign(`/api/app/billing/invoices/${encodeURIComponent(button.dataset.billingDownload || "")}/download`);
      };
    });
  }

  function renderPlanState(summary) {
    const cycle = String(summary.cycle || DEFAULT_BILLING_STATE.cycle).trim().toLowerCase();
    const currentPlan = String(summary.currentPlan || DEFAULT_BILLING_STATE.currentPlan).trim().toLowerCase();
    cycleButtons.forEach((button) => button.classList.toggle("active", button.dataset.billingCycle === cycle));
    qsa("[data-monthly]").forEach((el) => {
      el.textContent = cycle === "annual" ? el.dataset.annual : el.dataset.monthly;
    });
    planCards.forEach((card) => {
      const isCurrent = card.dataset.plan === currentPlan;
      card.classList.toggle("is-current", isCurrent);
      const button = card.querySelector("[data-select-plan]");
      if (button) {
        button.disabled = isCurrent;
        button.textContent = isCurrent ? "Current plan" : card.dataset.plan === "enterprise" ? "Contact sales" : `Select ${card.dataset.plan.charAt(0).toUpperCase()}${card.dataset.plan.slice(1)}`;
        button.className = isCurrent ? "btn-primary plan-select-btn" : "btn-secondary plan-select-btn";
      }
    });
  }

  function renderSummary(summary) {
    if (statPlan) statPlan.textContent = summary.currentPlanLabel || "Pro";
    if (statPlanDesc) statPlanDesc.textContent = `Billed ${summary.cycle || "annual"}ly. Invoices update below.`;
    if (statSpend) statSpend.textContent = summary.monthlySpendLabel || "$149.00";
    if (statSpendDesc) statSpendDesc.textContent = "Edge events, sessions and operator seats combined.";
    const edge = Array.isArray(summary.usage) ? summary.usage.find((item) => item.id === "edge-events") : null;
    if (statUsage) statUsage.textContent = edge ? `${edge.percent}%` : "0%";
    if (statUsageDesc) statUsageDesc.textContent = edge ? `Of included ${edge.label.toLowerCase()} quota. Overage billing starts at 80%.` : "Usage syncs in real time.";
    renderPlanState(summary);
    renderInvoices(Array.isArray(summary.invoices) ? summary.invoices : []);
    renderUsageRows(Array.isArray(summary.usage) ? summary.usage : []);
  }

  async function persistState(nextState, triggerButton) {
    withButtonBusy(triggerButton, true, "Saving…");
    try {
      await persistJSON("meshBillingState", nextState);
      let summary;
      try {
        summary = await fetchSummary();
      } catch {
        summary = { ...DEMO_BILLING_SUMMARY, ...nextState };
      }
      renderSummary(summary);
      showToast("Billing updated", "Plan and billing preferences saved.");
    } catch (error) {
      showToast("Billing update failed", error.message || "Could not update billing state.");
    } finally {
      withButtonBusy(triggerButton, false);
    }
  }

  cycleButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await persistState({ ...loadJSON("meshBillingState", DEFAULT_BILLING_STATE), cycle: button.dataset.billingCycle }, button);
    });
  });

  planButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await persistState({ ...loadJSON("meshBillingState", DEFAULT_BILLING_STATE), currentPlan: button.dataset.selectPlan }, button);
      if (String(button.dataset.selectPlan || "") === "enterprise") {
        showToast("Enterprise selected", "Enterprise mode saved. Invoice exports remain available below.");
      }
    });
  });

  const legacyBtns = qsa("[data-cycle]");
  legacyBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      legacyBtns.forEach(b => b.classList.toggle("active", b === btn));
      const cycle = btn.dataset.cycle;
      qsa("[data-plan-price]").forEach(el => { el.textContent = cycle === "annual" ? el.dataset.priceAnnual : el.dataset.priceMonthly; });
    });
  });

  fetchSummary().then(renderSummary).catch(() => {
    renderSummary({ ...DEMO_BILLING_SUMMARY, ...loadJSON("meshBillingState", DEFAULT_BILLING_STATE) });
  });
}

/* ── Appearance ── */
function initAppearance() {
  const defaults = DEFAULT_APPEARANCE;
  const form = qs("[data-storage-key='meshAppearance']") || qs("[data-appearance-form]");
  const state = loadJSON("meshAppearance", defaults);

  // Restore selects
  if (form) {
    qsa("select", form).forEach(sel => { if (state[sel.name] !== undefined) sel.value = state[sel.name]; });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      saveJSON("meshAppearance", data);
      updatePreviews(data);
      applySettingsTheme();
      showToast("Saved", "Appearance preferences saved.");
    });
    form.addEventListener("change", () => {
      const next = Object.fromEntries(new FormData(form));
      updatePreviews(next);
      document.documentElement.dataset.theme = resolveThemeSetting(next.theme);
    });
  }

  // Presets
  const PRESETS = {
    default:       { theme: "light", density: "default", accent: "indigo", motion: "full" },
    focus:         { theme: "light", density: "compact", accent: "indigo", motion: "none" },
    night:         { theme: "dark",  density: "compact", accent: "indigo", motion: "full" },
    highcontrast:  { theme: "light", density: "default", accent: "slate",  motion: "full" },
  };
  qsa("[data-appearance-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = PRESETS[btn.dataset.appearancePreset] || {};
      const data = { ...defaults, ...preset };
      saveJSON("meshAppearance", data);
      if (form) qsa("select", form).forEach(sel => { if (data[sel.name] !== undefined) sel.value = data[sel.name]; });
      updatePreviews(data);
      document.documentElement.dataset.theme = resolveThemeSetting(data.theme);
      const label = btn.querySelector("strong")?.textContent || btn.dataset.appearancePreset;
      showToast("Preset applied", label);
    });
  });

  // Reset
  qsa("[data-appearance-reset]").forEach(btn => {
    btn.addEventListener("click", () => {
      saveJSON("meshAppearance", defaults);
      if (form) qsa("select", form).forEach(sel => { if (defaults[sel.name] !== undefined) sel.value = defaults[sel.name]; });
      updatePreviews(defaults);
      applySettingsTheme();
      showToast("Reset", "Appearance restored to defaults.");
    });
  });

  // Copy button
  qsa("[data-copy-target]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = document.querySelector(btn.dataset.copyTarget);
      if (!target) return;
      navigator.clipboard?.writeText(target.textContent).catch(() => {});
      showToast("Copied", "Snippet copied to clipboard.");
    });
  });

  updatePreviews(state);
}

function updatePreviews(data) {
  const themeMap = { light: "Light", dark: "Dark", system: "System" };
  const densityMap = { comfortable: "Comfortable", default: "Default", compact: "Compact" };
  const accentMap = { indigo: "Indigo", violet: "Violet", slate: "Slate", teal: "Teal", rose: "Rose", petrol: "Petrol" };

  const themeStat = qs("#preview-theme-stat");
  const densityStat = qs("#preview-density-stat");
  const accentStat = qs("#preview-accent-stat");
  if (themeStat) themeStat.textContent = themeMap[data.theme] || data.theme || "Light";
  if (densityStat) densityStat.textContent = densityMap[data.density] || data.density || "Default";
  if (accentStat) accentStat.textContent = accentMap[data.accent] || data.accent || "Indigo";

  // Legacy data-preview-* targets
  qsa("[data-preview-theme]").forEach(el => el.textContent = themeMap[data.theme] || data.theme || "Light");
  qsa("[data-preview-accent]").forEach(el => el.textContent = accentMap[data.accent] || data.accent || "Indigo");
  qsa("[data-preview-density]").forEach(el => el.textContent = densityMap[data.density] || data.density || "Default");
  qsa("[data-preview-motion]").forEach(el => el.textContent = data.motion || "Full");
}

/* ── Init ── */
document.addEventListener("DOMContentLoaded", async () => {
  await preloadUserStoreCache();
  applyStandaloneNavigation();
  applySettingsTheme();
  initForms();
  initSwitches();
  initExpireSessions();
  initConnectAccounts();
  initAiSettingsPage();
  initApiKeys();
  initBilling();
  initAppearance();
});
