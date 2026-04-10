'use strict';

/**
 * MESH — Model Providers + Codec layer
 * Extracted from src/core/index.js for maintainability.
 * Handles: AI model constants, provider call functions (Anthropic/OpenAI/Gemini/BYOK),
 *          mesh codec encoding/decoding, and codec session state management.
 */

const path = require('path');

let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic; } catch { Anthropic = null; }

// Inline path utility (avoids circular dep with index.js)
function toSafePath(rawPath) {
  const input = String(rawPath || '').replace(/\\/g, '/').trim();
  if (!input) return '';
  const normalized = path.posix.normalize(`/${input}`).replace(/^\/+/, '');
  return normalized === '.' ? '' : normalized;
}

// ── Section 1: Static models, codec constants, provider utilities (from index.js lines 1880-3015) ──

const STATIC_MODELS = {
  anthropic: [
    "claude-opus-4-6-v1",
    "claude-opus-4-5",
    "claude-sonnet-4-6",
    "claude-haiku-4-5"
  ],
  openai: ["gpt-5.4-mini"],
  google: ["gemini-3-flash"],
};

const MESH_DEFAULT_MODEL = process.env.MESH_DEFAULT_MODEL || "gpt-5.4-mini";

const MESH_SYSTEM_PROMPT = [
  "You are Mesh AI, an expert AI coding assistant integrated into the Mesh AI IDE.",
  "Mesh AI IDE is a browser-based development environment similar to VS Code, with an integrated file explorer, Monaco code editor, terminal, source control, and AI chat panel.",
  "You are running inside this IDE and can help users with coding, debugging, explaining code, writing documentation, refactoring, and any software development tasks.",
  "The user's workspace files are provided as structural capsules in the `<mesh_workspace_capsules>` XML block. These capsules are intelligently summarized to fit the context window.",
  "If a capsule file has `is_skeleton=\"true\"`, it means the function/class bodies are elided for context efficiency. You must use the `read_file_range` tool to fetch the full implementation if you need to perform an exact analysis or edit.",
  "Refer to the files, structural symbols, and lines you can see. Be concise, technically accurate, and use markdown formatting.",
  "You can produce code blocks with language tags. The user can click 'Apply' on those blocks to insert them directly into their editor.",
  "You are powered by state-of-the-art AI models and run on Mesh's cloud infrastructure.",
].join(" ");

/** Inject system prompt at the beginning of messages if not already present */
function injectMeshSystemPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  if (messages[0]?.role === "system") return messages;
  return [{ role: "system", content: MESH_SYSTEM_PROMPT }, ...messages];
}

const ALL_STATIC_MODELS = new Set([
  ...STATIC_MODELS.anthropic,
  ...STATIC_MODELS.openai,
  ...STATIC_MODELS.google,
]);

const DEFAULT_BYOK_BASE_URLS = {
  openrouter: "https://openrouter.ai/api/v1",
};
const DEFAULT_AZURE_API_VERSION = "2024-08-01-preview";

const MESH_MODEL_CODEC_VERSION = "mc2";
const MESH_MODEL_CODEC_CONTEXT_MARKER = `<mesh_codec_context id="${MESH_MODEL_CODEC_VERSION}">`;
const MESH_MODEL_CODEC_RESPONSE_OPEN = `<mesh_compressed_response codec="${MESH_MODEL_CODEC_VERSION}">`;
const MESH_MODEL_CODEC_RESPONSE_CLOSE = "</mesh_compressed_response>";
const MESH_MODEL_CODEC_PAYLOAD_PREFIX = `${MESH_MODEL_CODEC_VERSION.toUpperCase()}|`;
const MESH_MODEL_CODEC_PAYLOAD_SUFFIX = `|/${MESH_MODEL_CODEC_VERSION.toUpperCase()}`;

// Shared token dictionary for model-facing textual compression.
const MESH_MODEL_CODEC_TERMS = [
  "function", "const", "let", "return", "import", "export", "from", "class", "extends",
  "constructor", "async", "await", "Promise", "try", "catch", "if", "else", "for", "while",
  "switch", "case", "break", "continue", "null", "undefined", "true", "false",
  "document", "querySelector", "querySelectorAll", "addEventListener", "classList", "textContent",
  "innerHTML", "dataset", "setAttribute", "removeAttribute", "toggleAttribute", "IntersectionObserver",
  "JSON.stringify", "JSON.parse", "map", "filter", "forEach", "includes", "slice", "push", "split", "join",
  "messages", "model", "content", "workspace", "path", "originalSize", "compressedSize", "encoding",
  "<div", "</div>", "<span", "</span>", "<script", "</script>", "=>", "===", "!==",
];

const MESH_MODEL_CODEC_ESCAPE_PREFIX = "<<M";
const MESH_MODEL_CODEC_ESCAPE_REPLACEMENT = "<<MM";
const MESH_MODEL_CODEC_NEWLINE_TOKEN = "<<MNL>>";
const MESH_MODEL_CODEC_TAB_TOKEN = "<<MTB>>";

const MESH_MODEL_CODEC_TABLE = MESH_MODEL_CODEC_TERMS.map((term, index) => {
  const code = index.toString(36).toUpperCase().padStart(2, "0");
  return [term, `<<M${code}>>`];
});

const MESH_MODEL_CODEC_ENCODE_TABLE = [...MESH_MODEL_CODEC_TABLE].sort((a, b) => b[0].length - a[0].length);
const MESH_MODEL_CODEC_DECODE_TABLE = [...MESH_MODEL_CODEC_TABLE].sort((a, b) => b[1].length - a[1].length);

const meshCodecSessionState = new Map();

function stripModelPrefix(model) {
  return String(model || "").replace(/^models\//, "").trim();
}

function readMessageText(content) {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part && typeof part.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
  }

  if (content == null) return "";
  return String(content);
}

function normalizeMessages(messages) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = String(message?.role || "user").toLowerCase();
      const allowedRole = role === "assistant" || role === "system" ? role : "user";
      return {
        role: allowedRole,
        content: readMessageText(message?.content).trim(),
      };
    })
    .filter((message) => message.content.length > 0);

  if (normalized.length > 0) return normalized;
  return [{ role: "user", content: "ping" }];
}

function toOpenAiMessages(messages) {
  return normalizeMessages(messages).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function toAnthropicMessages(messages) {
  const normalized = normalizeMessages(messages)
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

  if (normalized.length > 0) return normalized;
  return [{ role: "user", content: "ping" }];
}

function toGeminiContents(messages) {
  const normalized = normalizeMessages(messages)
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  if (normalized.length > 0) return normalized;
  return [{ role: "user", parts: [{ text: "ping" }] }];
}

function trimTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function joinPath(baseUrl, tailPath) {
  return `${trimTrailingSlash(baseUrl)}/${String(tailPath || "").replace(/^\/+/, "")}`;
}

function isAzureProvider(providerId, baseUrl) {
  return String(providerId || "").trim().toLowerCase() === "azure" || /\.openai\.azure\.com/i.test(String(baseUrl || ""));
}

function normalizeAzureBaseUrl(baseUrl) {
  let root = trimTrailingSlash(baseUrl);
  root = root.replace(/\/openai\/v1$/i, "");
  root = root.replace(/\/openai$/i, "");
  return root;
}

function modelDisplayLabel(id) {
  const normalized = stripModelPrefix(id);
  if (!normalized) return "Unknown model";

  return normalized
    .split(/[\/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseProviderError(payload, fallbackMessage) {
  if (!payload) return fallbackMessage;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error && typeof payload.error.message === "string") return payload.error.message;
  if (typeof payload.message === "string") return payload.message;
  return fallbackMessage;
}

function normalizeProviderUsage(rawUsage) {
  const usage = rawUsage && typeof rawUsage === "object" ? rawUsage : {};

  const inputTokens = Number(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? 0
  );
  const outputTokens = Number(
    usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? 0
  );

  const normalizedInput = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.trunc(inputTokens) : 0;
  const normalizedOutput = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.trunc(outputTokens) : 0;

  let totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? 0);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    totalTokens = normalizedInput + normalizedOutput;
  }
  const normalizedTotal = Math.max(0, Math.trunc(totalTokens));

  const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);

  return {
    inputTokens: normalizedInput,
    outputTokens: normalizedOutput,
    totalTokens: normalizedTotal,
    cacheCreationInputTokens: Number.isFinite(cacheCreation) && cacheCreation > 0 ? Math.trunc(cacheCreation) : 0,
    cacheReadInputTokens: Number.isFinite(cacheRead) && cacheRead > 0 ? Math.trunc(cacheRead) : 0,
  };
}

async function readJsonResponse(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { error: raw.slice(0, 400) };
  }
}

function buildOpenAIChatCompletionBody({ model, messages, maxTokens, tokenField = "max_tokens", includeModel = true }) {
  const body = {
    messages: toOpenAiMessages(messages),
    temperature: 0.2,
  };
  if (includeModel) {
    body.model = model;
  }
  body[tokenField] = Math.max(16, Number(maxTokens) || 512);
  return body;
}

function providerWantsMaxCompletionTokens(errorMessage) {
  const msg = String(errorMessage || "").toLowerCase();
  return (
    msg.includes("max_tokens") &&
    msg.includes("max_completion_tokens") &&
    (msg.includes("not supported") || msg.includes("unsupported parameter") || msg.includes("use"))
  );
}

function textFromMaybeContent(content) {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part && typeof part.content === "string") return part.content;
        if (part && part.type === "text" && typeof part.value === "string") return part.value;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    if (content.type === "text" && typeof content.value === "string") return content.value;
  }

  return "";
}

function extractAssistantTextFromChatPayload(payload) {
  const direct = [
    payload?.output_text,
    payload?.message,
    payload?.text,
    payload?.result,
    payload?.choices?.[0]?.message?.refusal,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);
  if (direct) return direct;

  const choiceContent = payload?.choices?.[0]?.message?.content;
  const choiceText = textFromMaybeContent(choiceContent).trim();
  if (choiceText) return choiceText;

  const altChoiceText = [
    payload?.choices?.[0]?.text,
    payload?.choices?.[0]?.message?.text,
    payload?.choices?.[0]?.delta?.content,
    payload?.choices?.[0]?.delta?.text,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);
  if (altChoiceText) return altChoiceText;

  const refusalFromMessage = Array.isArray(payload?.choices?.[0]?.message?.refusal)
    ? payload.choices[0].message.refusal
        .map((item) => (typeof item === "string" ? item : (typeof item?.text === "string" ? item.text : "")))
        .filter(Boolean)
        .join("\n")
    : "";
  if (refusalFromMessage.trim()) return refusalFromMessage.trim();

  const outputText = Array.isArray(payload?.output)
    ? payload.output
        .flatMap((block) => (Array.isArray(block?.content) ? block.content : []))
        .map((item) => {
          if (typeof item?.text === "string") return item.text;
          if (typeof item?.refusal === "string") return item.refusal;
          return "";
        })
        .filter(Boolean)
        .join("\n")
    : "";
  if (outputText.trim()) return outputText.trim();

  return "";
}

async function callOpenAIResponsesEndpoint({ apiKey, model, messages, baseUrl, orgId, providerName, maxOutputTokens = 512, withMeta = false }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (orgId) headers["OpenAI-Organization"] = orgId;

  const isOpenRouter = trimTrailingSlash(baseUrl).includes("openrouter.ai");
  if (isOpenRouter) {
    headers["HTTP-Referer"] = "http://localhost:4173";
    headers["X-Title"] = "Mesh";
  }

  const transcript = normalizeMessages(messages)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  const response = await fetch(joinPath(baseUrl, "responses"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: transcript,
      max_output_tokens: Math.max(16, Number(maxOutputTokens) || 512),
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `${providerName} request failed (${response.status})`));
  }

  const outputText = extractAssistantTextFromChatPayload(payload);
  if (outputText) {
    const result = {
      content: outputText,
      usage: normalizeProviderUsage(payload?.usage),
      requestId: String(response.headers.get("x-request-id") || response.headers.get("request-id") || "").trim(),
    };
    return withMeta ? result : result.content;
  }
  throw new Error(`${providerName} returned no content.`);
}

async function callOpenAICompatibleChat({ apiKey, model, messages, baseUrl, orgId, providerName, maxTokens = 512, withMeta = false }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (orgId) headers["OpenAI-Organization"] = orgId;

  const targetBase = trimTrailingSlash(baseUrl);
  const isOpenRouter = targetBase.includes("openrouter.ai");
  if (isOpenRouter) {
    headers["HTTP-Referer"] = "http://localhost:4173";
    headers["X-Title"] = "Mesh";
  }

  const endpoint = joinPath(targetBase, "chat/completions");
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(buildOpenAIChatCompletionBody({
      model,
      messages,
      maxTokens,
      tokenField: "max_tokens",
    })),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const firstError = parseProviderError(payload, `${providerName} request failed (${response.status})`);

    if (providerWantsMaxCompletionTokens(firstError)) {
      const retryResponse = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(buildOpenAIChatCompletionBody({
          model,
          messages,
          maxTokens,
          tokenField: "max_completion_tokens",
        })),
      });

      const retryPayload = await readJsonResponse(retryResponse);
      if (retryResponse.ok) {
        const retryContent = extractAssistantTextFromChatPayload(retryPayload);
        if (retryContent) {
          const result = {
            content: retryContent,
            usage: normalizeProviderUsage(retryPayload?.usage),
            requestId: String(retryResponse.headers.get("x-request-id") || retryResponse.headers.get("request-id") || "").trim(),
          };
          return withMeta ? result : result.content;
        }
        throw new Error(`${providerName} returned no content.`);
      }

      if (!isOpenRouter) {
        return callOpenAIResponsesEndpoint({
          apiKey,
          model,
          messages,
          baseUrl: targetBase,
          orgId,
          providerName,
          maxOutputTokens: maxTokens,
          withMeta,
        });
      }

      throw new Error(parseProviderError(retryPayload, `${providerName} request failed (${retryResponse.status})`));
    }

    if (!isOpenRouter) {
      return callOpenAIResponsesEndpoint({
        apiKey,
        model,
        messages,
        baseUrl: targetBase,
        orgId,
        providerName,
        maxOutputTokens: maxTokens,
        withMeta,
      });
    }
    throw new Error(firstError);
  }

  const content = extractAssistantTextFromChatPayload(payload);
  if (content) {
    const result = {
      content,
      usage: normalizeProviderUsage(payload?.usage),
      requestId: String(response.headers.get("x-request-id") || response.headers.get("request-id") || "").trim(),
    };
    return withMeta ? result : result.content;
  }
  throw new Error(`${providerName} returned no content.`);
}

async function callAzureOpenAIChat({ apiKey, model, messages, baseUrl, providerName, apiVersion = DEFAULT_AZURE_API_VERSION, maxTokens = 512 }) {
  const deploymentId = stripModelPrefix(model);
  if (!deploymentId) {
    throw new Error(`${providerName} requires a deployment/model ID.`);
  }

  const root = normalizeAzureBaseUrl(baseUrl);
  if (!root) {
    throw new Error(`${providerName} requires a valid Azure base URL.`);
  }

  const endpoint = `${root}/openai/deployments/${encodeURIComponent(deploymentId)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildOpenAIChatCompletionBody({
      model: deploymentId,
      messages,
      maxTokens,
      tokenField: "max_tokens",
      includeModel: false,
    })),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const firstError = parseProviderError(payload, `${providerName} request failed (${response.status})`);
    if (providerWantsMaxCompletionTokens(firstError)) {
      const retryResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildOpenAIChatCompletionBody({
          model: deploymentId,
          messages,
          maxTokens,
          tokenField: "max_completion_tokens",
          includeModel: false,
        })),
      });

      const retryPayload = await readJsonResponse(retryResponse);
      if (!retryResponse.ok) {
        throw new Error(parseProviderError(retryPayload, `${providerName} request failed (${retryResponse.status})`));
      }

      const retryContent = extractAssistantTextFromChatPayload(retryPayload);
      if (retryContent) return retryContent;
      throw new Error(`${providerName} returned no content.`);
    }

    throw new Error(firstError);
  }

  const content = extractAssistantTextFromChatPayload(payload);
  if (content) return content;
  throw new Error(`${providerName} returned no content.`);
}

async function callByokProviderChat({ provider, model, messages, maxTokens = 512 }) {
  const providerId = String(provider?.providerId || "").trim().toLowerCase();
  const providerName = String(provider?.providerName || providerId || "BYOK").trim() || "BYOK";
  const baseUrl = trimTrailingSlash(String(provider?.baseUrl || DEFAULT_BYOK_BASE_URLS[providerId] || ""));
  if (!baseUrl) {
    throw new Error(`BYOK provider "${providerName}" has no base URL configured.`);
  }

  if (isAzureProvider(providerId, baseUrl)) {
    return callAzureOpenAIChat({
      apiKey: provider.apiKey,
      model,
      messages,
      baseUrl,
      providerName,
      apiVersion: String(provider?.apiVersion || DEFAULT_AZURE_API_VERSION).trim() || DEFAULT_AZURE_API_VERSION,
      maxTokens,
    });
  }

  return callOpenAICompatibleChat({
    apiKey: provider.apiKey,
    model,
    messages,
    baseUrl,
    providerName,
    orgId: String(provider?.orgId || "").trim(),
    maxTokens,
  });
}

async function callAnthropicChatWithMeta({ apiKey, model, messages, maxTokens = 1024 }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.max(64, Number(maxTokens) || 1024),
      messages: toAnthropicMessages(messages),
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `Anthropic request failed (${response.status})`));
  }

  const text = Array.isArray(payload?.content)
    ? payload.content
        .filter((item) => item?.type === "text" && typeof item?.text === "string")
        .map((item) => item.text)
        .join("\n")
    : "";

  if (text.trim()) {
    return {
      content: text,
      usage: normalizeProviderUsage(payload?.usage),
      requestId: String(response.headers.get("request-id") || response.headers.get("x-request-id") || "").trim(),
    };
  }
  throw new Error("Anthropic returned no content.");
}

async function callAnthropicChat(args) {
  const result = await callAnthropicChatWithMeta(args);
  return result.content;
}

async function callGeminiChat({ apiKey, model, messages }) {
  const normalizedModel = stripModelPrefix(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: toGeminiContents(messages),
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.2,
      },
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `Gemini request failed (${response.status})`));
  }

  const text = Array.isArray(payload?.candidates)
    ? payload.candidates
        .flatMap((candidate) => candidate?.content?.parts || [])
        .map((part) => part?.text)
        .filter(Boolean)
        .join("\n")
    : "";

  if (text.trim()) return text;
  throw new Error("Gemini returned no content.");
}

function normalizeByokProviders(credentials) {
  const providers = Array.isArray(credentials?.byok?.providers) ? credentials.byok.providers : [];
  return providers
    .map((provider) => {
      const providerId = String(provider?.providerId || provider?.id || "byok").trim().toLowerCase() || "byok";
      const providerName = String(provider?.providerName || providerId.toUpperCase()).trim() || providerId.toUpperCase();
      const apiKey = String(provider?.apiKey || "").trim();
      const baseUrl = trimTrailingSlash(String(provider?.baseUrl || DEFAULT_BYOK_BASE_URLS[providerId] || ""));
      const apiVersion = String(provider?.apiVersion || DEFAULT_AZURE_API_VERSION).trim() || DEFAULT_AZURE_API_VERSION;
      const models = (Array.isArray(provider?.models) ? provider.models : [])
        .map((model) => stripModelPrefix(model))
        .filter(Boolean);
      return { providerId, providerName, apiKey, baseUrl, apiVersion, models };
    })
    .filter((provider) => provider.apiKey);
}

function resolveProviderForModel(model, credentials = {}) {
  const normalizedModel = stripModelPrefix(model);

  if (STATIC_MODELS.anthropic.includes(normalizedModel)) {
    return { provider: "anthropic", model: normalizedModel };
  }
  if (STATIC_MODELS.openai.includes(normalizedModel)) {
    return { provider: "openai", model: normalizedModel };
  }
  if (STATIC_MODELS.google.includes(normalizedModel)) {
    return { provider: "google", model: normalizedModel };
  }

  const byokProviders = normalizeByokProviders(credentials);
  const exactByok = byokProviders.find((provider) => provider.models.includes(normalizedModel));
  if (exactByok) {
    return { provider: "byok", model: normalizedModel, byokProvider: exactByok };
  }

  if (normalizedModel.startsWith("claude-")) return { provider: "anthropic", model: normalizedModel };
  if (normalizedModel.startsWith("gemini-")) return { provider: "google", model: normalizedModel };
  if (normalizedModel.startsWith("gpt-") || normalizedModel.includes("codex")) return { provider: "openai", model: normalizedModel };

  if (byokProviders.length > 0) {
    return { provider: "byok", model: normalizedModel, byokProvider: byokProviders[0] };
  }

  return { provider: "unknown", model: normalizedModel };
}

async function runModelChat({ model, messages, credentials = {} }) {
  const resolved = resolveProviderForModel(model, credentials);
  const byokProviders = normalizeByokProviders(credentials);
  const byokExactProvider = byokProviders.find((provider) => provider.models.includes(resolved.model));

  async function runByok(provider) {
    if (!provider || !provider.apiKey) {
      throw new Error("Missing BYOK provider key. Add it in Settings > AI & Models.");
    }

    const content = await callByokProviderChat({
      provider,
      model: resolved.model,
      messages,
      maxTokens: 512,
    });

    return {
      provider: `byok:${provider.providerId}`,
      model: resolved.model,
      content,
    };
  }

  if (resolved.provider === "anthropic") {
    let apiKey = String(credentials?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || "").trim();
    const bedrockToken = String(process.env.AWS_BEARER_TOKEN_BEDROCK || "").trim();

    // Use Bedrock fallback for designated models if no personal key
    const isBedrockTarget = resolved.model.includes("opus-4") || resolved.model.includes("sonnet-4-6") || resolved.model.includes("haiku-4-5");
    if (!apiKey && bedrockToken && isBedrockTarget) {
      const bedrockResult = await callOpenAICompatibleChat({
        apiKey: bedrockToken,
        model: resolved.model,
        messages: injectMeshSystemPrompt(messages),
        baseUrl: "https://api.mesh-ai.com/v1", // Standard Bedrock Proxy for Mesh
        providerName: "Mesh-Bedrock",
        withMeta: true,
      });
      return {
        provider: "mesh-bedrock",
        model: resolved.model,
        content: bedrockResult.content,
        usage: bedrockResult.usage,
        providerRequestId: bedrockResult.requestId,
      };
    }

    if (!apiKey) {
      if (byokExactProvider) return runByok(byokExactProvider);
      throw new Error("Missing Anthropic API key. Configure it in Settings > AI & Models.");
    }

    const anthropicResult = await callAnthropicChatWithMeta({
      apiKey,
      model: resolved.model,
      messages,
      maxTokens: Number(credentials?.anthropic?.maxTokens || 1024),
    });
    return {
      provider: "anthropic",
      model: resolved.model,
      content: anthropicResult.content,
      usage: anthropicResult.usage,
      providerRequestId: anthropicResult.requestId,
    };
  }

  if (resolved.provider === "openai") {
    const userApiKey = String(credentials?.openai?.apiKey || process.env.OPENAI_API_KEY || "").trim();
    const azureEndpoint = String(process.env.AZURE_OPENAI_ENDPOINT || "").trim().replace(/\/+$/, "");
    const azureKey = String(process.env.AZURE_OPENAI_KEY || "").trim();

    // If user has their own key, use direct OpenAI
    if (userApiKey) {
      const openAiResult = await callOpenAICompatibleChat({
        apiKey: userApiKey,
        model: resolved.model,
        messages: injectMeshSystemPrompt(messages),
        baseUrl: "https://api.openai.com/v1",
        orgId: String(credentials?.openai?.orgId || "").trim(),
        providerName: "OpenAI",
        withMeta: true,
      });
      return {
        provider: "openai",
        model: resolved.model,
        content: openAiResult.content,
        usage: openAiResult.usage,
        providerRequestId: openAiResult.requestId,
      };
    }

    // Azure OpenAI fallback — platform-provided key (never exposed to frontend)
    if (azureEndpoint && azureKey) {
      const deploymentName = resolved.model;
      const azureUrl = `${azureEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-12-01-preview`;
      const body = buildOpenAIChatCompletionBody({
        model: resolved.model,
        messages: injectMeshSystemPrompt(messages),
        maxTokens: 4096,
        tokenField: "max_tokens",
        includeModel: false,
      });

      const azureResponse = await fetch(azureUrl, {
        method: "POST",
        headers: {
          "api-key": azureKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const azurePayload = await readJsonResponse(azureResponse);
      if (!azureResponse.ok) {
        // Try with max_completion_tokens if max_tokens fails
        if (providerWantsMaxCompletionTokens(parseProviderError(azurePayload, ""))) {
          const retryBody = buildOpenAIChatCompletionBody({
            model: resolved.model,
            messages: injectMeshSystemPrompt(messages),
            maxTokens: 4096,
            tokenField: "max_completion_tokens",
            includeModel: false,
          });
          const retryResp = await fetch(azureUrl, {
            method: "POST",
            headers: { "api-key": azureKey, "Content-Type": "application/json" },
            body: JSON.stringify(retryBody),
          });
          const retryPayload = await readJsonResponse(retryResp);
          if (retryResp.ok) {
            const content = extractAssistantTextFromChatPayload(retryPayload);
            if (content) return { provider: "azure-openai", model: resolved.model, content, usage: normalizeProviderUsage(retryPayload?.usage) };
          }
        }
        throw new Error(parseProviderError(azurePayload, `Azure OpenAI request failed (${azureResponse.status})`));
      }

      const content = extractAssistantTextFromChatPayload(azurePayload);
      if (!content) throw new Error("Azure OpenAI returned no content.");
      return {
        provider: "azure-openai",
        model: resolved.model,
        content,
        usage: normalizeProviderUsage(azurePayload?.usage),
        providerRequestId: String(azureResponse.headers.get("x-request-id") || "").trim(),
      };
    }

    if (byokExactProvider) return runByok(byokExactProvider);
    throw new Error("Missing OpenAI API key. Configure it in Settings > AI & Models.");
  }

  if (resolved.provider === "google") {
    const apiKey = String(credentials?.google?.apiKey || process.env.GOOGLE_API_KEY || "").trim();
    if (!apiKey) {
      if (byokExactProvider) return runByok(byokExactProvider);
      throw new Error("Missing Google API key. Configure it in Settings > AI & Models.");
    }

    const content = await callGeminiChat({
      apiKey,
      model: resolved.model,
      messages,
    });
    return { provider: "google", model: resolved.model, content };
  }

  if (resolved.provider === "byok") {
    const provider = resolved.byokProvider;
    return runByok(provider);
  }

  throw new Error(`No provider configured for model "${model}".`);
}

async function fetchAnthropicModels(apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `Anthropic model list failed (${response.status})`));
  }

  return Array.isArray(payload?.data)
    ? payload.data.map((model) => stripModelPrefix(model?.id)).filter(Boolean)
    : [];
}

async function fetchOpenAICompatibleModels({ apiKey, baseUrl, providerName, orgId }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (orgId) headers["OpenAI-Organization"] = orgId;

  const targetBase = trimTrailingSlash(baseUrl);
  if (targetBase.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "http://localhost:4173";
    headers["X-Title"] = "Mesh";
  }

  const response = await fetch(joinPath(targetBase, "models"), {
    method: "GET",
    headers,
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `${providerName} model list failed (${response.status})`));
  }

  return Array.isArray(payload?.data)
    ? payload.data.map((model) => stripModelPrefix(model?.id || model?.name)).filter(Boolean)
    : [];
}

async function fetchGeminiModels(apiKey) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(parseProviderError(payload, `Gemini model list failed (${response.status})`));
  }

  return Array.isArray(payload?.models)
    ? payload.models
        .map((model) => stripModelPrefix(model?.name))
        .filter(Boolean)
    : [];
}

function dedupeModelIds(models) {
  const seen = new Set();
  const out = [];
  for (const model of models || []) {
    const normalized = stripModelPrefix(model);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function staticModelMatch(modelId) {
  const normalized = stripModelPrefix(modelId);
  if (!normalized) return null;
  if (ALL_STATIC_MODELS.has(normalized)) return normalized;

  const slashIdx = normalized.indexOf("/");
  if (slashIdx > -1) {
    const tail = normalized.slice(slashIdx + 1);
    if (ALL_STATIC_MODELS.has(tail)) return tail;
  }
  return null;
}

function normalizeImportedModels(models, providerId, providerName, limit = 20) {
  return dedupeModelIds(models)
    .filter((modelId) => !staticModelMatch(modelId))
    .slice(0, 80)
    .map((modelId) => ({
      id: modelId,
      label: modelDisplayLabel(modelId),
      providerId,
      providerName,
    }));
}

function normalizeRequestedModelIds(modelIds) {
  const raw = Array.isArray(modelIds) ? modelIds : String(modelIds || "").split(/[\n,]/g);
  return dedupeModelIds(raw.map((modelId) => stripModelPrefix(modelId)));
}

async function validateProviderKey(payload = {}) {
  const provider = String(payload.provider || "").trim().toLowerCase();
  const apiKey = String(payload.apiKey || "").trim();

  if (!provider) throw new Error("Provider is required.");
  if (!apiKey) throw new Error("API key is required.");

  if (provider === "anthropic") {
    const listed = await fetchAnthropicModels(apiKey).catch(() => []);
    const probeModel = listed.find((id) => STATIC_MODELS.anthropic.includes(id)) || STATIC_MODELS.anthropic[2];
    await callAnthropicChat({
      apiKey,
      model: probeModel,
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 64,
    });

    const reachableModels = listed.length ? dedupeModelIds(listed) : [probeModel];
    const verifiedModels = STATIC_MODELS.anthropic.filter((id) => reachableModels.includes(id));
    if (!verifiedModels.length) verifiedModels.push(probeModel);

    return {
      ok: true,
      provider,
      providerId: "anthropic",
      providerName: "Anthropic",
      reachableModels,
      verifiedModels: dedupeModelIds(verifiedModels),
      additionalModels: [],
    };
  }

  if (provider === "openai") {
    const listed = await fetchOpenAICompatibleModels({
      apiKey,
      baseUrl: "https://api.openai.com/v1",
      providerName: "OpenAI",
      orgId: String(payload.orgId || "").trim(),
    });

    const probeModel = listed.find((id) => STATIC_MODELS.openai.includes(id)) || STATIC_MODELS.openai[0];
    await callOpenAICompatibleChat({
      apiKey,
      model: probeModel,
      messages: [{ role: "user", content: "ping" }],
      baseUrl: "https://api.openai.com/v1",
      orgId: String(payload.orgId || "").trim(),
      providerName: "OpenAI",
    });

    const reachableModels = dedupeModelIds(listed.length ? listed : [probeModel]);
    const verifiedModels = STATIC_MODELS.openai.filter((id) => reachableModels.includes(id));
    return {
      ok: true,
      provider,
      providerId: "openai",
      providerName: "OpenAI",
      reachableModels,
      verifiedModels,
      additionalModels: [],
    };
  }

  if (provider === "google") {
    const listed = await fetchGeminiModels(apiKey);
    const probeModel = listed.find((id) => STATIC_MODELS.google.includes(id)) || STATIC_MODELS.google[0];
    await callGeminiChat({
      apiKey,
      model: probeModel,
      messages: [{ role: "user", content: "ping" }],
    });

    const reachableModels = dedupeModelIds(listed.length ? listed : [probeModel]);
    const verifiedModels = STATIC_MODELS.google.filter((id) => reachableModels.includes(id));
    return {
      ok: true,
      provider,
      providerId: "google",
      providerName: "Google",
      reachableModels,
      verifiedModels,
      additionalModels: [],
    };
  }

  if (provider === "byok") {
    const providerId = String(payload.providerId || "openrouter").trim().toLowerCase() || "openrouter";
    const providerName = String(payload.providerName || "BYOK").trim() || "BYOK";
    const baseUrl = trimTrailingSlash(String(payload.baseUrl || DEFAULT_BYOK_BASE_URLS[providerId] || ""));
    const apiVersion = String(payload.apiVersion || DEFAULT_AZURE_API_VERSION).trim() || DEFAULT_AZURE_API_VERSION;
    if (!baseUrl) throw new Error(`No base URL configured for BYOK provider "${providerName}".`);

    if (providerId === "openrouter") {
      const authResponse = await fetch(joinPath(baseUrl, "auth/key"), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });
      const authPayload = await readJsonResponse(authResponse);
      if (!authResponse.ok) {
        throw new Error(parseProviderError(authPayload, `OpenRouter key validation failed (${authResponse.status})`));
      }
    }

    const requestedModels = normalizeRequestedModelIds(payload.modelIds);
    if (!requestedModels.length) {
      throw new Error("Enter at least one model ID to test (one per line or comma-separated).");
    }

    const providerConfig = {
      providerId,
      providerName,
      apiKey,
      baseUrl,
      apiVersion,
    };

    const reachableModels = [];
    const failedModels = [];

    for (const modelId of requestedModels) {
      try {
        await callByokProviderChat({
          provider: providerConfig,
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          maxTokens: 24,
        });
        reachableModels.push(modelId);
      } catch (error) {
        failedModels.push({
          id: modelId,
          error: String(error?.message || "Validation call failed."),
        });
      }
    }

    if (!reachableModels.length) {
      const firstFailure = failedModels[0];
      if (firstFailure) {
        throw new Error(`None of the tested model IDs are reachable. First error (${firstFailure.id}): ${firstFailure.error}`);
      }
      throw new Error(`${providerName} validation failed. No reachable model IDs.`);
    }

    const verifiedModels = dedupeModelIds(reachableModels.map(staticModelMatch).filter(Boolean));
    const additionalModels = normalizeImportedModels(reachableModels, providerId, providerName);

    return {
      ok: true,
      provider,
      providerId,
      providerName,
      reachableModels,
      requestedModels,
      failedModels,
      verifiedModels,
      additionalModels,
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}


// ── Section 2: Codec + string manipulation functions (from index.js lines 3265-3619) ──

function extractActiveFilePathFromMessages(messages = []) {
  const lastUserMessage = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user")
    .at(-1)?.content;

  const match = /<active_file\s+path="([^"]+)"\s*\/?>/i.exec(String(lastUserMessage || ""));
  return match ? toSafePath(match[1]) : "";
}

function replaceLiteralAll(input, search, replacement) {
  if (!search) return String(input || "");
  return String(input || "").split(search).join(replacement);
}

function escapeRegexLiteral(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rot47Transform(input) {
  let out = "";
  const source = String(input || "");

  for (const ch of source) {
    const code = ch.charCodeAt(0);
    if (code >= 33 && code <= 126) {
      out += String.fromCharCode(33 + ((code - 33 + 47) % 94));
    } else {
      out += ch;
    }
  }

  return out;
}

function textCompositionStats(input) {
  const text = String(input || "");
  const total = text.length || 1;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/[0-9]/g) || []).length;
  const spaces = (text.match(/\s/g) || []).length;
  const punctuation = (text.match(/[^A-Za-z0-9\s]/g) || []).length;
  const words = (text.match(/[A-Za-z]{3,}/g) || []).length;
  const nonSpace = Math.max(1, total - spaces);

  return {
    letters,
    digits,
    spaces,
    punctuation,
    words,
    alphaRatio: letters / total,
    symbolRatio: (digits + punctuation) / nonSpace,
  };
}

function containsCodecSignals(input) {
  return /<<M[A-Z0-9]{2}>>|<<MNL>>|<<MTB>>/.test(String(input || ""));
}

function isLikelyUnframedRot47(rawText, rotatedText) {
  const raw = String(rawText || "");
  const rotated = String(rotatedText || "");
  if (raw.length < 48 || rotated.length < 48) return false;

  const rawStats = textCompositionStats(raw);
  const rotatedStats = textCompositionStats(rotated);
  const commonWordCount = (rotated.match(/\b(the|and|for|with|from|file|files|context|server|model|response|content|contains|return|line|function|const|import|export)\b/gi) || []).length;

  return (
    rawStats.symbolRatio >= 0.42 &&
    rotatedStats.words >= 6 &&
    rotatedStats.alphaRatio >= rawStats.alphaRatio + 0.18 &&
    rotatedStats.symbolRatio <= rawStats.symbolRatio - 0.12 &&
    commonWordCount >= 2
  );
}

function decodedReadabilityScore(input) {
  const text = String(input || "");
  if (!text) return -1000;

  const stats = textCompositionStats(text);
  const commonWordCount = (text.match(/\b(the|and|for|with|from|file|files|context|server|model|response|content|contains|return|line|function|const|import|export)\b/gi) || []).length;

  return (stats.words * 2) + (commonWordCount * 6) + (stats.alphaRatio * 20) - (stats.symbolRatio * 10);
}

function pickMostReadableDecoded(...candidates) {
  const filtered = candidates
    .map((item) => String(item || ""))
    .filter(Boolean);

  if (!filtered.length) return "";

  let best = filtered[0];
  let bestScore = decodedReadabilityScore(best);

  for (const candidate of filtered.slice(1)) {
    const score = decodedReadabilityScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function decodeCodecTokens(tokenStream) {
  let decoded = String(tokenStream || "");

  for (const [plain, token] of MESH_MODEL_CODEC_DECODE_TABLE) {
    decoded = replaceLiteralAll(decoded, token, plain);
  }

  decoded = replaceLiteralAll(decoded, MESH_MODEL_CODEC_NEWLINE_TOKEN, "\n");
  decoded = replaceLiteralAll(decoded, MESH_MODEL_CODEC_TAB_TOKEN, "\t");
  decoded = replaceLiteralAll(decoded, MESH_MODEL_CODEC_ESCAPE_REPLACEMENT, MESH_MODEL_CODEC_ESCAPE_PREFIX);
  return decoded;
}

function codecTokenShouldReplace(plain, token) {
  return String(plain || "").length > String(token || "").length;
}

function encodeMeshModelCodec(rawText, options = {}) {
  const disableDictionary = Boolean(options.disableDictionary);
  const withMeta = Boolean(options.withMeta);
  let tokenized = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  tokenized = replaceLiteralAll(tokenized, MESH_MODEL_CODEC_ESCAPE_PREFIX, MESH_MODEL_CODEC_ESCAPE_REPLACEMENT);
  const usedTokens = new Set();

  if (!disableDictionary) {
    for (const [plain, token] of MESH_MODEL_CODEC_ENCODE_TABLE) {
      if (!codecTokenShouldReplace(plain, token)) continue;
      if (!tokenized.includes(plain)) continue;
      tokenized = replaceLiteralAll(tokenized, plain, token);
      usedTokens.add(token);
    }
  }

  const encoded = `${MESH_MODEL_CODEC_PAYLOAD_PREFIX}${tokenized}${MESH_MODEL_CODEC_PAYLOAD_SUFFIX}`;
  if (!withMeta) return encoded;

  return {
    encoded,
    usedTokens: [...usedTokens],
    dictionaryEnabled: !disableDictionary,
  };
}

function decodeMeshModelCodec(encodedText, options = {}) {
  const allowLegacy = options.allowLegacy !== false;
  const allowUnframedRot47 = Boolean(options.allowUnframedRot47);

  const raw = String(encodedText || "");
  const unrotated = rot47Transform(raw);

  const hasPlainFramedPayload =
    raw.startsWith(MESH_MODEL_CODEC_PAYLOAD_PREFIX) &&
    raw.endsWith(MESH_MODEL_CODEC_PAYLOAD_SUFFIX);

  if (hasPlainFramedPayload) {
    const tokenized = raw.slice(
      MESH_MODEL_CODEC_PAYLOAD_PREFIX.length,
      raw.length - MESH_MODEL_CODEC_PAYLOAD_SUFFIX.length
    );

    const directDecoded = decodeCodecTokens(tokenized);
    const rotatedInnerDecoded = decodeCodecTokens(rot47Transform(tokenized));
    const bestDecoded = pickMostReadableDecoded(directDecoded, rotatedInnerDecoded);

    return {
      ok: true,
      decoded: bestDecoded,
      mode: bestDecoded === rotatedInnerDecoded ? "mc2-framed-plain-rot47-inner" : "mc2-framed-plain",
    };
  }

  const hasFramedPayload =
    unrotated.startsWith(MESH_MODEL_CODEC_PAYLOAD_PREFIX) &&
    unrotated.endsWith(MESH_MODEL_CODEC_PAYLOAD_SUFFIX);

  if (hasFramedPayload) {
    const tokenized = unrotated.slice(
      MESH_MODEL_CODEC_PAYLOAD_PREFIX.length,
      unrotated.length - MESH_MODEL_CODEC_PAYLOAD_SUFFIX.length
    );
    return { ok: true, decoded: decodeCodecTokens(tokenized), mode: "mc2-framed" };
  }

  if (allowLegacy && containsCodecSignals(raw)) {
    return { ok: true, decoded: decodeCodecTokens(raw), mode: "mc1-legacy" };
  }

  if (allowUnframedRot47 && isLikelyUnframedRot47(raw, unrotated)) {
    if (containsCodecSignals(unrotated)) {
      return { ok: true, decoded: decodeCodecTokens(unrotated), mode: "mc2-rot47-unframed-tokens" };
    }
    return { ok: true, decoded: unrotated, mode: "mc2-rot47-unframed-plain" };
  }

  return { ok: false, decoded: "", mode: "invalid" };
}

function buildMeshCodecContextDocument(options = {}) {
  const dictionaryEnabled = options.dictionaryEnabled !== false;
  const dictionaryLines = dictionaryEnabled
    ? MESH_MODEL_CODEC_TABLE
      .filter(([plain, token]) => codecTokenShouldReplace(plain, token))
      .map(([plain, token]) => `${token} => ${plain}`)
    : [];

  return [
    MESH_MODEL_CODEC_CONTEXT_MARKER,
    "MESH codec reference for this chat session.",
    `Codec version: ${MESH_MODEL_CODEC_VERSION}`,
    "Workspace files are framed context excerpts.",
    "Decoding steps for file payloads:",
    `1) Confirm framing: ${MESH_MODEL_CODEC_PAYLOAD_PREFIX}...${MESH_MODEL_CODEC_PAYLOAD_SUFFIX}`,
    dictionaryEnabled ? "2) Expand dictionary tokens." : "2) Read payload directly as plain excerpt text.",
    "You may answer in plain text.",
    "Gateway handles response compression for transport.",
    "If context is insufficient, request a specific file path instead of guessing.",
    ...(dictionaryEnabled ? ["Token dictionary:", ...dictionaryLines] : []),
    "</mesh_codec_context>",
  ].join("\n");
}

function hasCodecContextMarker(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((message) =>
    String(message?.content || "").includes(MESH_MODEL_CODEC_CONTEXT_MARKER)
  );
}

function normalizeChatSessionId(rawSessionId) {
  const normalized = String(rawSessionId || "").trim();
  if (!normalized) return "";
  return normalized.slice(0, 120);
}

function pruneCodecSessionStateIfNeeded() {
  if (meshCodecSessionState.size <= 500) return;
  const sorted = [...meshCodecSessionState.entries()].sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0));
  const deleteCount = Math.max(100, sorted.length - 400);
  for (const [sessionId] of sorted.slice(0, deleteCount)) {
    meshCodecSessionState.delete(sessionId);
  }
}

function markCodecContextInitialized(sessionId, options = {}) {
  if (!sessionId) return;
  const previous = meshCodecSessionState.get(sessionId) || {};
  meshCodecSessionState.set(sessionId, {
    codecContextSent: true,
    dictionaryReady: Boolean(previous.dictionaryReady || options.dictionaryReady),
    updatedAt: Date.now(),
  });
  pruneCodecSessionStateIfNeeded();
}

function isCodecContextInitializedForSession(sessionId, options = {}) {
  if (!sessionId) return false;
  const state = meshCodecSessionState.get(sessionId);
  if (!state?.codecContextSent) return false;
  if (options.requireDictionary && !state.dictionaryReady) return false;
  return true;
}

function injectCodecContextIntoMessages(messages = [], options = {}) {
  const contextDoc = buildMeshCodecContextDocument(options);
  const cloned = (Array.isArray(messages) ? messages : []).map((message) => ({
    role: String(message?.role || "user"),
    content: String(message?.content || ""),
  }));

  const firstUserIndex = cloned.findIndex((message) => message.role === "user");
  if (firstUserIndex === -1) {
    cloned.unshift({ role: "user", content: contextDoc });
    return cloned;
  }

  cloned[firstUserIndex].content = `${contextDoc}\n\n${cloned[firstUserIndex].content}`;
  return cloned;
}

function extractCompressedModelPayload(rawContent) {
  const raw = String(rawContent || "").trim();
  const wrapped = /<mesh_compressed_response\b[^>]*>([\s\S]*?)<\/mesh_compressed_response>/i.exec(raw);
  if (wrapped) {
    return {
      encodedPayload: String(wrapped[1] || "").trim(),
      wrapped: true,
      payloadSource: "wrapper",
    };
  }

  const prefixEscaped = escapeRegexLiteral(MESH_MODEL_CODEC_PAYLOAD_PREFIX);
  const suffixEscaped = escapeRegexLiteral(MESH_MODEL_CODEC_PAYLOAD_SUFFIX);
  const inlineFrame = new RegExp(`${prefixEscaped}([\\s\\S]*?)${suffixEscaped}`, "i").exec(raw);
  if (inlineFrame) {
    return {
      encodedPayload: `${MESH_MODEL_CODEC_PAYLOAD_PREFIX}${String(inlineFrame[1] || "")}${MESH_MODEL_CODEC_PAYLOAD_SUFFIX}`,
      wrapped: false,
      payloadSource: "inline-frame",
    };
  }

  return {
    encodedPayload: raw,
    wrapped: false,
    payloadSource: "raw",
  };
}

function decodeCompressedModelResponse(rawContent, options = {}) {
  const extracted = extractCompressedModelPayload(rawContent);
  const decoded = decodeMeshModelCodec(extracted.encodedPayload, {
    allowLegacy: options.allowLegacy !== false,
    allowUnframedRot47: Boolean(options.allowUnframedRot47),
  });

  return {
    decoded: decoded.decoded,
    encodedPayload: extracted.encodedPayload,
    compressedByModel: decoded.ok,
    codecValid: decoded.ok,
    codecMode: decoded.mode,
    wrapped: extracted.wrapped,
    payloadSource: extracted.payloadSource,
  };
}

function escapeTagAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function dedupePaths(paths = []) {
  const seen = new Set();
  const out = [];
  for (const input of paths) {
    const normalized = toSafePath(input);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

module.exports = {
  Anthropic,
  STATIC_MODELS,
  MESH_DEFAULT_MODEL,
  ALL_STATIC_MODELS,
  DEFAULT_BYOK_BASE_URLS,
  DEFAULT_AZURE_API_VERSION,
  MESH_MODEL_CODEC_VERSION,
  MESH_MODEL_CODEC_CONTEXT_MARKER,
  MESH_MODEL_CODEC_RESPONSE_OPEN,
  MESH_MODEL_CODEC_RESPONSE_CLOSE,
  MESH_MODEL_CODEC_PAYLOAD_PREFIX,
  MESH_MODEL_CODEC_PAYLOAD_SUFFIX,
  MESH_MODEL_CODEC_TERMS,
  MESH_MODEL_CODEC_ESCAPE_PREFIX,
  MESH_MODEL_CODEC_ESCAPE_REPLACEMENT,
  MESH_MODEL_CODEC_NEWLINE_TOKEN,
  MESH_MODEL_CODEC_TAB_TOKEN,
  MESH_MODEL_CODEC_TABLE,
  MESH_MODEL_CODEC_ENCODE_TABLE,
  MESH_MODEL_CODEC_DECODE_TABLE,
  meshCodecSessionState,
  injectMeshSystemPrompt,
  stripModelPrefix,
  readMessageText,
  normalizeMessages,
  toOpenAiMessages,
  toAnthropicMessages,
  toGeminiContents,
  trimTrailingSlash,
  joinPath,
  isAzureProvider,
  normalizeAzureBaseUrl,
  modelDisplayLabel,
  parseProviderError,
  normalizeProviderUsage,
  readJsonResponse,
  buildOpenAIChatCompletionBody,
  providerWantsMaxCompletionTokens,
  textFromMaybeContent,
  extractAssistantTextFromChatPayload,
  callOpenAIResponsesEndpoint,
  callOpenAICompatibleChat,
  callAzureOpenAIChat,
  callByokProviderChat,
  callAnthropicChatWithMeta,
  callAnthropicChat,
  callGeminiChat,
  normalizeByokProviders,
  resolveProviderForModel,
  runModelChat,
  fetchAnthropicModels,
  fetchOpenAICompatibleModels,
  fetchGeminiModels,
  dedupeModelIds,
  staticModelMatch,
  normalizeImportedModels,
  normalizeRequestedModelIds,
  validateProviderKey,
  extractActiveFilePathFromMessages,
  replaceLiteralAll,
  escapeRegexLiteral,
  rot47Transform,
  textCompositionStats,
  containsCodecSignals,
  isLikelyUnframedRot47,
  decodedReadabilityScore,
  pickMostReadableDecoded,
  decodeCodecTokens,
  codecTokenShouldReplace,
  encodeMeshModelCodec,
  decodeMeshModelCodec,
  buildMeshCodecContextDocument,
  hasCodecContextMarker,
  normalizeChatSessionId,
  pruneCodecSessionStateIfNeeded,
  markCodecContextInitialized,
  isCodecContextInitializedForSession,
  injectCodecContextIntoMessages,
  extractCompressedModelPayload,
  decodeCompressedModelResponse,
  escapeTagAttribute,
  dedupePaths,
  MESH_SYSTEM_PROMPT,
};
