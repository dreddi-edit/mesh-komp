'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const hljs = require('highlight.js');
const { marked } = require('marked');
const config = require('../config');
const logger = require('../logger');
const { cacheControl } = require('./route-utils');

const markedRenderer = new marked.Renderer();
markedRenderer.code = function(code, lang) {
  // If arguments is an object (marked >= 8.0.0 uses options object)
  let actualCode = code;
  let actualLang = lang;
  if (code && typeof code === 'object' && code.text !== undefined) {
      actualCode = code.text;
      actualLang = code.lang;
  }

  let highlighted = actualCode;
  if (actualLang && hljs.getLanguage(actualLang)) {
    try {
      highlighted = hljs.highlight(actualCode, { language: actualLang }).value;
    } catch (e) {}
  } else {
    try {
      highlighted = hljs.highlightAuto(actualCode).value;
    } catch (e) {}
  }
  return `<pre><code class="hljs ${escapeHtml(actualLang || '')}">${highlighted}</code></pre>`;
};
marked.use({ renderer: markedRenderer });

const REPO_DOCS_ROOT = path.join(__dirname, '..', '..');
const REPO_DOCS_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  '.playwright-cli',
  'output',
  'old',
  'Animationen',
  'Logos',
]);
const REPO_DOCS_INCLUDED_EXTENSIONS = new Set([
  '.md', '.txt', '.js', '.cjs', '.mjs', '.json', '.html', '.css', '.yml', '.yaml',
]);
const REPO_DOCS_PRIORITY = [
  'CURRENT-SYSTEM-OVERVIEW.md',
  'UI-REVIEW.md',
  'DEPLOY.md',
  'CLAUDE.md',
  'claude-overview.md',
  '.mesh/project.json',
  '.mesh/files.md',
  '.mesh/rules.md',
];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeRepoDocsPath(input = '') {
  return String(input || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.(\/|\\)/g, '').trim();
}

function pathPriorityScore(relPath) {
  const idx = REPO_DOCS_PRIORITY.indexOf(relPath);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function listRepoMarkdownDocs() {
  const docs = [];
  const walk = (absDir, relDir = '', depth = 0) => {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') && !['.mesh', '.planning'].includes(entry.name)) continue;
      if (entry.isDirectory()) {
        if (REPO_DOCS_EXCLUDED_DIRS.has(entry.name)) continue;
        walk(path.join(absDir, entry.name), relDir ? `${relDir}/${entry.name}` : entry.name, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      docs.push({
        path: relPath,
        name: entry.name,
        group: relDir || 'root',
        priority: pathPriorityScore(relPath),
      });
    }
  };
  walk(REPO_DOCS_ROOT);
  return docs.sort((a, b) => a.priority - b.priority || a.group.localeCompare(b.group) || a.path.localeCompare(b.path));
}

function buildRepoTree(absDir, relDir = '', depth = 0) {
  if (depth > 5) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const items = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && !['.mesh', '.planning', '.eslintrc.json'].includes(entry.name)) continue;
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (REPO_DOCS_EXCLUDED_DIRS.has(entry.name)) continue;
      items.push({
        type: 'dir',
        name: entry.name,
        path: relPath,
        children: buildRepoTree(absPath, relPath, depth + 1),
      });
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!REPO_DOCS_INCLUDED_EXTENSIONS.has(ext) && !REPO_DOCS_PRIORITY.includes(relPath)) continue;
    items.push({
      type: 'file',
      name: entry.name,
      path: relPath,
      ext,
    });
  }
  return items;
}


function sanitizeContent(src) {
  return String(src || '').replace(/(sk-[a-zA-Z0-9_\-]{20,})/g, '********');
}

function renderRepoDocument(relPath, rawContent) {
  const content = sanitizeContent(rawContent);
  const ext = path.extname(relPath).toLowerCase();

  if (ext === '.md') {
    return marked.parse(content, { breaks: true, gfm: true });
  }

  // Also try to syntax highlight other raw files
  let lang = ext.slice(1);
  if (lang === 'js' || lang === 'cjs' || lang === 'mjs') lang = 'javascript';
  else if (lang === 'yml') lang = 'yaml';

  let highlighted = content;
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(content, { language: lang }).value;
    } catch (e) {}
  } else {
    highlighted = hljs.highlightAuto(content).value;
  }

  return `<pre><code class="hljs ${escapeHtml(lang)}">${highlighted}</code></pre>`;
}

const DEFAULT_BILLING_STATE = {
  cycle: "annual",
  currentPlan: "pro",
};

const DEFAULT_BILLING_INVOICES = [
  { id: "inv-2026-04", period: "April 2026", amount: 14900, currency: "USD", detail: "Pro plan · Annual · EU Central", status: "paid" },
  { id: "inv-2026-03", period: "March 2026", amount: 14900, currency: "USD", detail: "Pro plan · Annual · EU Central", status: "paid" },
  { id: "inv-2026-02", period: "February 2026", amount: 14900, currency: "USD", detail: "Pro plan · Annual · EU Central", status: "paid" },
  { id: "inv-2026-01", period: "January 2026", amount: 18600, currency: "USD", detail: "Pro plan · Monthly -> Annual upgrade", status: "paid" },
  { id: "inv-2025-12", period: "December 2025", amount: 17900, currency: "USD", detail: "Pro plan · Monthly", status: "paid" },
];

const DEFAULT_BILLING_USAGE = [
  { id: "edge-events", label: "Edge events", used: "7.4M", limit: "10M", percent: 74, tone: "warning" },
  { id: "active-sessions", label: "Active sessions", used: "7,440", limit: "12,000", percent: 62, tone: "neutral" },
  { id: "operator-seats", label: "Operator seats", used: "7", limit: "12", percent: 58, tone: "neutral" },
  { id: "audit-log-storage", label: "Audit log storage", used: "2.8 GB", limit: "9 GB", percent: 31, tone: "neutral" },
];

function formatMoney(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format((Number(cents || 0) || 0) / 100);
}

function buildBillingSummaryPayload(state = {}) {
  const currentPlan = String(state.currentPlan || DEFAULT_BILLING_STATE.currentPlan || "pro").trim().toLowerCase();
  const cycle = String(state.cycle || DEFAULT_BILLING_STATE.cycle || "annual").trim().toLowerCase();
  const planLabel = currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1);
  const monthlySpend = currentPlan === "starter" ? 4900 : currentPlan === "enterprise" ? 0 : 14900;

  return {
    ok: true,
    billing: {
      cycle,
      currentPlan,
      currentPlanLabel: planLabel,
      monthlySpend,
      monthlySpendLabel: currentPlan === "enterprise" ? "Custom" : formatMoney(monthlySpend),
      invoices: DEFAULT_BILLING_INVOICES.map((invoice) => ({
        ...invoice,
        amountLabel: formatMoney(invoice.amount, invoice.currency),
      })),
      usage: DEFAULT_BILLING_USAGE,
    },
  };
}

/**
 * @param {object} core  Subset of exports from src/core/index.js
 * @returns {import('express').Router}
 */
function createAppRouter(core) {
  const {
    requireAuth,
    secureDb,
    DEMO_USER_EMAIL,
    reportAuthStoreError,
    normalizeRequestedStoreKeys,
    normalizeUserStoreKey,
    USER_STORE_MAX_JSON_BYTES,
    toIsoNow,
    snapshotOperationsPayload,
    operationsStore,
    buildWorkspaceFileListingEntry,
    localAssistantWorkspace,
    queueDeployment,
    settleDeploymentAction,
    createPolicy,
    updatePolicy,
    appendOperationLog,
    validateProviderKey,
    runModelChat,
    Anthropic,
    invalidateCredentialCache,
  } = core;

  async function loadBillingStateForUser(userId) {
    const stored = await secureDb.getUserStoreValue(userId, "meshBillingState", {});
    return {
      ...DEFAULT_BILLING_STATE,
      ...(stored && typeof stored === "object" ? stored : {}),
    };
  }

  const router = express.Router();

  router.get("/healthz", async (_req, res) => {
    let authStoreOk = true;
    try {
      await secureDb.getUserByEmail(DEMO_USER_EMAIL);
    } catch (error) {
      authStoreOk = false;
      reportAuthStoreError("healthz", error);
    }

    const payload = {
      ok: authStoreOk,
      service: "mesh-gateway",
      authStoreOk,
      uptimeSec: Math.round(process.uptime()),
      now: new Date().toISOString(),
    };

    res.status(authStoreOk ? 200 : 503).json(payload);
  });

  router.get("/api/docs/index", requireAuth, cacheControl(60), (_req, res) => {
    try {
      const docs = listRepoMarkdownDocs();
      const tree = buildRepoTree(REPO_DOCS_ROOT);
      res.json({
        ok: true,
        title: 'mesh-komp',
        docs,
        tree,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to build repo docs index', { scope: 'app-routes', error: String(error?.message || error || 'unknown') });
      res.status(500).json({ ok: false, error: 'Failed to build repo docs index' });
    }
  });

  router.get("/api/docs/file", requireAuth, cacheControl(60), (req, res) => {
    try {
      const relPath = normalizeRepoDocsPath(req.query.path || '');
      if (!relPath) {
        res.status(400).json({ ok: false, error: 'Missing file path' });
        return;
      }
      const resolvedRoot = path.resolve(REPO_DOCS_ROOT);
      const absPath = path.resolve(REPO_DOCS_ROOT, relPath);
      if (absPath !== resolvedRoot && !absPath.startsWith(resolvedRoot + path.sep)) {
        res.status(400).json({ ok: false, error: 'Invalid file path' });
        return;
      }
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) {
        res.status(404).json({ ok: false, error: 'File not found' });
        return;
      }
      const ext = path.extname(relPath).toLowerCase();
      if (!REPO_DOCS_INCLUDED_EXTENSIONS.has(ext) && !relPath.toLowerCase().endsWith('.md')) {
        res.status(400).json({ ok: false, error: 'Unsupported file type' });
        return;
      }
      const content = fs.readFileSync(absPath, 'utf8');
      res.json({
        ok: true,
        path: relPath,
        kind: ext === '.md' ? 'markdown' : 'code',
        content,
        html: renderRepoDocument(relPath, content),
        updatedAt: stat.mtime.toISOString(),
      });
    } catch (error) {
      logger.error('Failed to read docs file', { scope: 'app-routes', error: String(error?.message || error || 'unknown') });
      res.status(500).json({ ok: false, error: 'Failed to read docs file' });
    }
  });

  router.get("/api/user/store", requireAuth, async (req, res) => {
    const requestedKeys = normalizeRequestedStoreKeys(req.query.keys);
    const data = await secureDb.getUserStoreValues(req.authUser.id, requestedKeys);
    res.json({ ok: true, data });
  });

  router.get("/api/user/store/:key", requireAuth, async (req, res) => {
    const key = normalizeUserStoreKey(req.params.key);
    if (!key) {
      res.status(400).json({ ok: false, error: "Unsupported user store key." });
      return;
    }

    const value = await secureDb.getUserStoreValue(req.authUser.id, key, {});
    res.json({ ok: true, key, value });
  });

  router.put("/api/user/store/:key", requireAuth, async (req, res) => {
    const key = normalizeUserStoreKey(req.params.key);
    if (!key) {
      res.status(400).json({ ok: false, error: "Unsupported user store key." });
      return;
    }

    const incomingValue = req.body?.value === undefined ? {} : req.body.value;
    const shouldMerge = req.body?.merge !== false;
    const existingValue = shouldMerge ? await secureDb.getUserStoreValue(req.authUser.id, key, {}) : {};
    const value = {
      ...(existingValue && typeof existingValue === "object" ? existingValue : {}),
      ...(incomingValue && typeof incomingValue === "object" ? incomingValue : {}),
    };

    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      res.status(400).json({ ok: false, error: "Value must be JSON serializable." });
      return;
    }

    if (Buffer.byteLength(serialized || "", "utf8") > USER_STORE_MAX_JSON_BYTES) {
      res.status(413).json({ ok: false, error: "Stored value exceeds maximum size." });
      return;
    }

    await secureDb.setUserStoreValue(req.authUser.id, key, value);
    invalidateCredentialCache(req.authUser.id);
    res.json({ ok: true, key, updatedAt: toIsoNow() });
  });

  router.get("/api/app/ops", requireAuth, cacheControl(60), (_req, res) => {
    res.json(snapshotOperationsPayload());
  });

  router.get("/api/app/compression", requireAuth, cacheControl(60), (_req, res) => {
    const folderName = localAssistantWorkspace.folderName || null;
    if (!folderName || !localAssistantWorkspace.files.size) {
      return res.json({ ok: true, folderName, files: [] });
    }
    const files = [...localAssistantWorkspace.files.values()]
      .map((meta) => buildWorkspaceFileListingEntry(meta))
      .filter((f) => f.rawBytes > 0 || f.capsuleBytes > 0);
    res.json({ ok: true, folderName, files });
  });

  router.get("/api/app/deployments", requireAuth, (_req, res) => {
    res.json({
      ok: true,
      pending: operationsStore.deployments.pending,
      history: operationsStore.deployments.history,
      updatedAt: operationsStore.updatedAt,
    });
  });

  router.post("/api/app/deployments", requireAuth, (req, res) => {
    const entry = queueDeployment(req.body || {}, req.authUser || {});
    res.status(201).json({ ok: true, deployment: entry });
  });

  router.post("/api/app/deployments/:id/action", requireAuth, (req, res) => {
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (!["approve", "reject"].includes(action)) {
      res.status(400).json({ ok: false, error: "Action must be approve or reject." });
      return;
    }

    const settled = settleDeploymentAction(req.params.id, action, req.authUser || {});
    if (!settled) {
      res.status(404).json({ ok: false, error: "Deployment not found in pending queue." });
      return;
    }

    res.json({ ok: true, deployment: settled });
  });

  router.get("/api/app/policies", requireAuth, (_req, res) => {
    res.json({ ok: true, policies: operationsStore.policies, updatedAt: operationsStore.updatedAt });
  });

  router.post("/api/app/policies", requireAuth, (req, res) => {
    const created = createPolicy(req.body || {}, req.authUser || {});
    res.status(201).json({ ok: true, policy: created });
  });

  router.put("/api/app/policies/:id", requireAuth, (req, res) => {
    const updated = updatePolicy(req.params.id, req.body || {}, req.authUser || {});
    if (!updated) {
      res.status(404).json({ ok: false, error: "Policy not found." });
      return;
    }
    res.json({ ok: true, policy: updated });
  });

  router.get("/api/app/logs", requireAuth, (req, res) => {
    const level  = String(req.query.level  || "all").trim().toLowerCase();
    const region = String(req.query.region || "all").trim().toLowerCase();
    const limit  = Math.min(Math.max(Number(req.query.limit) || 200, 1), 600);

    const filtered = operationsStore.logs.filter((entry) => {
      const levelOk  = level  === "all" || entry.level  === level;
      const regionOk = region === "all" || entry.region === region;
      return levelOk && regionOk;
    });

    res.json({
      ok: true,
      logs: filtered.slice(-limit),
      total: filtered.length,
      updatedAt: operationsStore.updatedAt,
    });
  });

  router.post("/api/app/logs", requireAuth, (req, res) => {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ ok: false, error: "Log message is required." });
      return;
    }

    appendOperationLog(req.body?.level || "info", message, {
      region: req.body?.region,
      source: String(req.authUser?.name || req.authUser?.email || "operator"),
    });

    res.status(201).json({ ok: true });
  });

  router.get("/api/app/billing/summary", requireAuth, async (req, res) => {
    const state = await loadBillingStateForUser(req.authUser.id);
    res.json(buildBillingSummaryPayload(state));
  });

  router.get("/api/app/billing/invoices/:invoiceId/download", requireAuth, async (req, res) => {
    const state   = await loadBillingStateForUser(req.authUser.id);
    const summary = buildBillingSummaryPayload(state);
    const invoice = (summary.billing?.invoices || []).find(
      (entry) => String(entry.id || "") === String(req.params.invoiceId || "")
    );

    if (!invoice) {
      res.status(404).json({ ok: false, error: "Invoice not found." });
      return;
    }

    const contact = await secureDb.getUserStoreValue(req.authUser.id, "meshBillingContact", {});
    const lines = [
      "Mesh Billing Invoice",
      `Invoice ID: ${invoice.id}`,
      `Period: ${invoice.period}`,
      `Status: ${invoice.status}`,
      `Plan: ${invoice.detail}`,
      `Amount: ${invoice.amountLabel}`,
      `Cycle: ${summary.billing?.cycle || DEFAULT_BILLING_STATE.cycle}`,
      `Customer: ${String(contact.company || contact.contactName || req.authUser.name || req.authUser.email || "Workspace operator")}`,
      `Billing Email: ${String(contact.contactEmail || req.authUser.email || "")}`,
      "",
      "This invoice was generated by the Mesh demo billing service.",
    ].join("\n");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.id}.txt"`);
    res.send(lines);
  });

  router.post("/api/byok/validate", requireAuth, async (req, res) => {
    try {
      const result = await validateProviderKey(req.body || {});
      res.json(result);
    } catch (error) {
      res.status(400).json({ ok: false, error: "Validation failed" });
    }
  });

  // Allowlist of model IDs accepted by the simple /api/chat route.
  // Prevents clients from passing arbitrary strings to the Anthropic API.
  const ALLOWED_CHAT_MODELS = new Set([
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ]);

  router.post("/api/chat", requireAuth, async (req, res) => {
    const requestedModel = String(req.body?.model || 'claude-opus-4-6').trim();
    const model = ALLOWED_CHAT_MODELS.has(requestedModel) ? requestedModel : 'claude-opus-4-6';
    const { messages = [] } = req.body;
    const apiKey = config.ANTHROPIC_API_KEY;

    if (!apiKey || !Anthropic) {
      res.status(503).json({ error: "Chat service unavailable: API key not configured." });
      return;
    }

    try {
      const client = new Anthropic({ apiKey });
      const resp = await client.messages.create({
        model,
        max_tokens: 1024,
        system: `You are Mesh AI, an intelligent coding assistant.
Help users with code, architecture, debugging, and workspace navigation.
Be concise, technical, and precise. When showing code changes, use diff format.`,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });
      res.json({ content: resp.content[0]?.text || "" });
    } catch (err) {
      logger.error('Chat request failed', { scope: 'app-routes', error: String(err?.message || err || 'unknown') });
      res.status(500).json({ error: "Chat request failed." });
    }
  });

  router.post("/api/inline-complete", requireAuth, async (req, res) => {
    const { assistantService } = req.app.locals.services;
    const { prefix = "", language = "plaintext" } = req.body || {};

    const messages = [
      { role: "user", content: `You are a code completion engine. Complete the ${language} code at the cursor. Output ONLY the completion text, no explanation, no markdown fences.\n\n${prefix}` },
    ];

    try {
      const result = await assistantService.chat(
        { model: config.MESH_DEFAULT_MODEL, messages, maxTokens: 200 },
        req.authUser,
        req.requestId
      );
      const text = String(result?.content || "");
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      logger.error('Inline completion failed', { scope: 'app-routes', error: String(err?.message || err || 'unknown') });
      res.status(502).json({ ok: false, error: "Inline completion request failed." });
    }
  });

  return router;
}

module.exports = { createAppRouter };
