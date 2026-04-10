"use strict";

const path = require("path");

const RUN_MODES = new Set(["ask", "edit", "agent"]);
const AUTONOMY_MODES = new Set(["review", "auto_edit_confirm_run", "autonomous"]);
const ACTION_TYPES = new Set([
  "read_file",
  "read_capsule",
  "search_workspace",
  "open_file",
  "propose_write",
  "apply_write_batch",
  "recover_spans",
  "run_terminal_command",
  "summarize_ops_context",
]);

const FILE_QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "bei", "bitte", "das", "datei", "dem", "den", "der", "die", "dir",
  "doch", "ein", "eine", "einer", "es", "file", "files", "for", "gib", "give", "hat", "help",
  "ich", "im", "in", "inhalt", "is", "ist", "it", "kannst", "mir", "mit", "oder", "show",
  "the", "und", "uns", "was", "what", "wie", "wo", "worum", "you", "zu",
]);

const QUERY_EXTENSION_HINTS = {
  html: ["html", "htm"],
  htm: ["html", "htm"],
  css: ["css", "scss", "less"],
  scss: ["css", "scss", "less"],
  less: ["css", "scss", "less"],
  js: ["js", "mjs", "cjs"],
  javascript: ["js", "mjs", "cjs"],
  ts: ["ts", "tsx"],
  typescript: ["ts", "tsx"],
  json: ["json"],
  md: ["md", "markdown"],
  markdown: ["md", "markdown"],
  py: ["py"],
  python: ["py"],
  xml: ["xml"],
  yml: ["yml", "yaml"],
  yaml: ["yml", "yaml"],
  txt: ["txt"],
  pdf: ["pdf"],
};

const SINGLE_FILE_LOOKUP_RE = /\b(was\s+ist\s+in|what(?:'s|\s+is)?\s+in|inhalt|contents?|summar(?:y|ize)|ueberblick|überblick|overview|erklär|erklaer|explain|describe|zeige\s+mir)\b/i;
const MULTI_FILE_LOOKUP_RE = /\b(vergleich|compare|all|alle|mehrere|multiple|both|beide|zusammen)\b/i;
const STRUCTURAL_EDIT_RE = /\b(structure|restructure|cleanup|clean\s+up|tidy|organi[sz]e|format|reformat|prettify|polish|readability|lesbar|sauber|struktur(?:ier(?:e|en|t|ung)?)?|glieder(?:e|n|ung)?|ordn(?:e|en|ung)?|aufr[a\u00e4]um(?:en|ung)?|besser\s+struktur)\b/i;
const VOID_HTML_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);
const RAW_HTML_BLOCK_RE = /<(script|style|pre|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi;

function escapeRegexLiteral(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toSafePath(rawPath) {
  const input = String(rawPath || "").replace(/\\/g, "/").trim();
  if (!input) return "";
  const normalized = path.posix.normalize(`/${input}`).replace(/^\/+/g, "");
  return normalized === "." ? "" : normalized;
}

function basename(filePath) {
  const normalized = toSafePath(filePath);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function normalizeRunMode(value, fallback = "ask") {
  const normalized = String(value || "").trim().toLowerCase();
  return RUN_MODES.has(normalized) ? normalized : fallback;
}

function normalizeAutonomyMode(value, fallback = "review") {
  const normalized = String(value || "").trim().toLowerCase();
  return AUTONOMY_MODES.has(normalized) ? normalized : fallback;
}

function normalizeAssistantEditPrefs(value) {
  const incoming = value && typeof value === "object" ? value : {};
  const autonomyMode = normalizeAutonomyMode(incoming.autonomyMode, incoming.autoAccept === true ? "auto_edit_confirm_run" : "review");
  return {
    autonomyMode,
    defaultMode: normalizeRunMode(incoming.defaultMode, "ask"),
    linkTerminal: incoming.linkTerminal !== false,
    autoAccept: autonomyMode !== "review",
  };
}

function extractSearchTokens(input) {
  const text = String(input || "").toLowerCase();
  const rawTokens = text.split(/[^a-z0-9]+/g).filter(Boolean);
  return rawTokens
    .filter((token) => token.length >= 3)
    .filter((token) => !FILE_QUERY_STOP_WORDS.has(token));
}

function compactAlphaNumeric(input) {
  return String(input || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scorePathForQuery(pathInput, queryContext) {
  const pathValue = toSafePath(pathInput).toLowerCase();
  if (!pathValue) return 0;

  const base = basename(pathValue).toLowerCase();
  const pathCompact = compactAlphaNumeric(pathValue);
  const baseCompact = compactAlphaNumeric(base);
  const pathTokens = pathValue.split(/[^a-z0-9]+/g).filter(Boolean);
  const pathTokenSet = new Set(pathTokens);

  const { rawText, compactText, tokens } = queryContext;
  if (!rawText || (!tokens.length && compactText.length < 4)) return 0;

  let score = 0;
  let matchedTokens = 0;

  if (rawText.includes(base)) score += 120;
  if (rawText.includes(pathValue)) score += 140;
  if (compactText && baseCompact && compactText.includes(baseCompact)) score += 90;
  if (compactText && pathCompact && compactText.includes(pathCompact)) score += 110;
  if (compactText && pathCompact && pathCompact.includes(compactText) && compactText.length >= 4) score += 85;

  for (const token of tokens) {
    if (pathTokenSet.has(token)) {
      score += 28;
      matchedTokens += 1;
      continue;
    }

    if (pathCompact.includes(token)) {
      score += 14;
      matchedTokens += 1;
    }
  }

  if (tokens.length > 0 && matchedTokens === tokens.length) score += 60;
  if (matchedTokens >= 2) score += 30;
  if (matchedTokens === 0 && score < 80) return 0;
  return score;
}

function rankWorkspacePathsForQuery(rawQuery, candidatePaths = [], maxMatches = 3) {
  const rawText = String(rawQuery || "").toLowerCase();
  if (!rawText) return [];

  const queryContext = {
    rawText,
    compactText: compactAlphaNumeric(rawText),
    tokens: extractSearchTokens(rawText),
  };

  const ranked = [];
  for (const pathValue of Array.isArray(candidatePaths) ? candidatePaths : []) {
    const safePath = toSafePath(pathValue);
    if (!safePath) continue;

    const score = scorePathForQuery(safePath, queryContext);
    if (score <= 0) continue;
    ranked.push({ path: safePath, score });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, Math.max(1, Number(maxMatches) || 3))
    .map((item) => item.path);
}

function extractQueryExtensionHints(input) {
  const text = String(input || "").toLowerCase();
  const hints = new Set();

  const explicitExtMatches = text.match(/\.[a-z0-9]{2,6}\b/g) || [];
  for (const match of explicitExtMatches) {
    const ext = match.slice(1);
    (QUERY_EXTENSION_HINTS[ext] || [ext]).forEach((value) => hints.add(value));
  }

  for (const [token, mapped] of Object.entries(QUERY_EXTENSION_HINTS)) {
    if (!new RegExp(`\\b${escapeRegexLiteral(token)}\\b`, "i").test(text)) continue;
    mapped.forEach((value) => hints.add(value));
  }

  return hints;
}

function pathHasExtensionHint(pathInput, extensionHints = new Set()) {
  if (!(extensionHints instanceof Set) || extensionHints.size === 0) return true;
  const normalized = toSafePath(pathInput).toLowerCase();
  const dotIdx = normalized.lastIndexOf(".");
  if (dotIdx < 0 || dotIdx === normalized.length - 1) return false;
  const ext = normalized.slice(dotIdx + 1);
  return extensionHints.has(ext);
}

function selectReferenceMatchLimit(rawQuery, extensionHints = new Set()) {
  const text = String(rawQuery || "");
  if (!text) return 1;
  if (MULTI_FILE_LOOKUP_RE.test(text)) return 3;
  if (extensionHints.size > 0) return 1;
  if (SINGLE_FILE_LOOKUP_RE.test(text)) return 1;
  return 3;
}

function extractFirstJsonObject(rawText) {
  const text = String(rawText || "");
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fencedMatch ? fencedMatch[1] : text;

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;

  for (let i = 0; i < candidate.length; i += 1) {
    const char = candidate[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return candidate.slice(start, i + 1);
      }
    }
  }

  return "";
}

function normalizeDocumentText(rawText) {
  return String(rawText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function trimTrailingWhitespace(line) {
  return String(line || "").replace(/[ \t]+$/g, "");
}

function finalizeFormattedText(lines = []) {
  const normalized = [];
  let blankRun = 0;

  for (const line of lines.map((entry) => trimTrailingWhitespace(entry))) {
    if (!String(line).trim()) {
      blankRun += 1;
      if (blankRun > 1) continue;
      normalized.push("");
      continue;
    }
    blankRun = 0;
    normalized.push(line);
  }

  while (normalized.length && !String(normalized[normalized.length - 1] || "").trim()) {
    normalized.pop();
  }

  return normalized.length ? `${normalized.join("\n")}\n` : "";
}

function looksMinifiedContent(rawText) {
  const text = normalizeDocumentText(rawText).trim();
  if (!text) return false;
  const lines = text.split("\n");
  const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const averageLineLength = lines.reduce((sum, line) => sum + line.length, 0) / Math.max(lines.length, 1);
  return lines.length <= 4 && (longestLine >= 180 || averageLineLength >= 140);
}

function isStructuralEditPrompt(rawPrompt) {
  return STRUCTURAL_EDIT_RE.test(String(rawPrompt || ""));
}

function buildDefaultNewFileTemplate(pathValue, prompt) {
  const normalizedPath = String(pathValue || "").toLowerCase();
  const trimmedPrompt = String(prompt || "").trim() || "New page";

  if (normalizedPath.endsWith(".html") || normalizedPath.endsWith(".htm")) {
    return [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "  <meta charset=\"utf-8\">",
      "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
      `  <title>${basename(pathValue)}</title>`,
      "</head>",
      "<body>",
      `  <main>${trimmedPrompt}</main>`,
      "</body>",
      "</html>",
      "",
    ].join("\n");
  }
  if (normalizedPath.endsWith(".json")) return "{\n  \"status\": \"todo\"\n}\n";
  if (normalizedPath.endsWith(".md")) return `# ${basename(pathValue)}\n\n${trimmedPrompt}\n`;
  return `// TODO: ${trimmedPrompt}\n`;
}

function formatPlainTextContent(rawText) {
  const lines = normalizeDocumentText(rawText)
    .split("\n")
    .map((line) => trimTrailingWhitespace(line));
  return finalizeFormattedText(lines);
}

function formatMarkdownContent(rawText) {
  const inputLines = normalizeDocumentText(rawText)
    .split("\n")
    .map((line) => trimTrailingWhitespace(line));
  const lines = [];

  for (let index = 0; index < inputLines.length; index += 1) {
    const line = inputLines[index];
    const trimmed = line.trim();
    const isHeading = /^#{1,6}\s+\S/.test(trimmed);
    const isList = /^([-*+]|\d+\.)\s+\S/.test(trimmed);

    if (!trimmed) {
      lines.push("");
      continue;
    }

    if (isHeading && lines.length && String(lines[lines.length - 1] || "").trim()) {
      lines.push("");
    }

    lines.push(isHeading || isList ? trimmed : line);

    if (isHeading) {
      const nextTrimmed = String(inputLines[index + 1] || "").trim();
      if (nextTrimmed) lines.push("");
    }
  }

  return finalizeFormattedText(lines);
}

function formatJsonContent(rawText) {
  const text = normalizeDocumentText(rawText).trim();
  if (!text) return "";
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch {
    return formatPlainTextContent(text);
  }
}

function tokenizeCodeLikeContent(rawText) {
  const source = normalizeDocumentText(rawText);
  const segments = [];
  let current = "";
  let quote = "";
  let escaping = false;
  let lineComment = false;
  let blockComment = false;

  function pushCurrent() {
    const normalized = current.trim();
    if (normalized) segments.push(normalized);
    current = "";
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") {
        pushCurrent();
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += "/";
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (quote) {
      current += char;
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "/" && next === "/") {
      current += "//";
      index += 1;
      lineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      current += "/*";
      index += 1;
      blockComment = true;
      continue;
    }

    if (char === "{") {
      current = trimTrailingWhitespace(current);
      current = current ? `${current} {` : "{";
      pushCurrent();
      continue;
    }

    if (char === "}") {
      pushCurrent();
      segments.push("}");
      continue;
    }

    if (char === ";") {
      current += ";";
      pushCurrent();
      continue;
    }

    if (char === "\n") {
      pushCurrent();
      continue;
    }

    current += char;
  }

  pushCurrent();
  return segments;
}

function formatCodeLikeContent(rawText) {
  const segments = tokenizeCodeLikeContent(rawText);
  const lines = [];
  let indentLevel = 0;

  for (const segment of segments) {
    const trimmed = String(segment || "").trim();
    if (!trimmed) continue;

    if ((trimmed === ";" || trimmed === ",") && lines.length) {
      lines[lines.length - 1] += trimmed;
      continue;
    }

    if (trimmed === "}") indentLevel = Math.max(indentLevel - 1, 0);
    lines.push(`${"  ".repeat(indentLevel)}${trimmed}`);
    if (trimmed.endsWith("{")) indentLevel += 1;
  }

  return finalizeFormattedText(lines);
}

function extractHtmlTagName(token) {
  const match = /^<\/?\s*([a-z0-9:-]+)/i.exec(String(token || ""));
  return match ? String(match[1] || "").toLowerCase() : "";
}

function formatRawHtmlBlock(rawBlock, indentLevel) {
  const match = /^<([a-z0-9:-]+)\b([^>]*)>([\s\S]*?)<\/\1>$/i.exec(String(rawBlock || "").trim());
  if (!match) return `${"  ".repeat(indentLevel)}${String(rawBlock || "").trim()}`;

  const tagName = String(match[1] || "").toLowerCase();
  const openTag = `<${match[1]}${match[2] || ""}>`;
  const inner = normalizeDocumentText(match[3] || "").replace(/^\n+|\n+$/g, "");
  const closeTag = `</${match[1]}>`;
  const lines = [`${"  ".repeat(indentLevel)}${openTag}`];

  if (inner) {
    const formattedInner = tagName === "script" || tagName === "style"
      ? formatCodeLikeContent(inner)
      : finalizeFormattedText(
        normalizeDocumentText(inner).split("\n").map((line) => trimTrailingWhitespace(line))
      );
    for (const line of formattedInner.trimEnd().split("\n")) {
      lines.push(`${"  ".repeat(indentLevel + 1)}${line}`);
    }
  }

  lines.push(`${"  ".repeat(indentLevel)}${closeTag}`);
  return lines.join("\n");
}

function formatHtmlContent(rawText) {
  const source = normalizeDocumentText(rawText).trim();
  if (!source) return "";

  const rawBlocks = [];
  const extracted = source.replace(RAW_HTML_BLOCK_RE, (match) => {
    const placeholder = `__MESH_RAW_BLOCK_${rawBlocks.length}__`;
    rawBlocks.push({ placeholder, content: match });
    return placeholder;
  });
  const rawBlockMap = new Map(rawBlocks.map((entry) => [entry.placeholder, entry.content]));

  const tokens = extracted
    .replace(/>\s+</g, ">\n<")
    .replace(/(<!--[\s\S]*?-->|<![^>]*>|<[^>]+>)/g, "\n$1\n")
    .split("\n")
    .map((token) => token.trim())
    .filter(Boolean);

  const lines = [];
  let indentLevel = 0;

  for (const token of tokens) {
    const rawBlock = rawBlockMap.get(token);
    if (rawBlock) {
      lines.push(formatRawHtmlBlock(rawBlock, indentLevel));
      continue;
    }

    if (token.startsWith("</")) indentLevel = Math.max(indentLevel - 1, 0);

    if (!token.startsWith("<")) {
      const textValue = token.replace(/\s+/g, " ").trim();
      if (textValue) lines.push(`${"  ".repeat(indentLevel)}${textValue}`);
      continue;
    }

    lines.push(`${"  ".repeat(indentLevel)}${token}`);

    if (
      token.startsWith("<") &&
      !token.startsWith("</") &&
      !token.startsWith("<!") &&
      !token.endsWith("/>") &&
      !token.includes("</")
    ) {
      const tagName = extractHtmlTagName(token);
      if (tagName && !VOID_HTML_TAGS.has(tagName)) indentLevel += 1;
    }
  }

  return finalizeFormattedText(lines);
}

function buildStructuralEditFallback(pathValue, prompt, beforeContent = "") {
  const normalizedPath = String(pathValue || "").toLowerCase();
  const existingContent = normalizeDocumentText(beforeContent);
  const structuralPrompt = isStructuralEditPrompt(prompt);
  const shouldRestructure = structuralPrompt || looksMinifiedContent(existingContent);

  if (!existingContent) {
    return buildDefaultNewFileTemplate(pathValue, prompt);
  }

  if (!shouldRestructure) return existingContent;

  const formatted = (
    normalizedPath.endsWith(".html") || normalizedPath.endsWith(".htm") || normalizedPath.endsWith(".xml")
      ? formatHtmlContent(existingContent)
      : normalizedPath.endsWith(".json")
        ? formatJsonContent(existingContent)
        : normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown")
          ? formatMarkdownContent(existingContent)
          : normalizedPath.endsWith(".css") || normalizedPath.endsWith(".scss") || normalizedPath.endsWith(".less")
            ? formatCodeLikeContent(existingContent)
            : normalizedPath.endsWith(".js") || normalizedPath.endsWith(".mjs") || normalizedPath.endsWith(".cjs")
              || normalizedPath.endsWith(".ts") || normalizedPath.endsWith(".tsx") || normalizedPath.endsWith(".jsx")
              ? formatCodeLikeContent(existingContent)
              : formatPlainTextContent(existingContent)
  );

  return formatted || existingContent;
}

function sanitizeAssistantRunAction(rawAction = {}, index = 0) {
  const type = String(rawAction?.type || "").trim().toLowerCase();
  if (!ACTION_TYPES.has(type)) return null;

  const payload = rawAction?.payload && typeof rawAction.payload === "object" ? rawAction.payload : {};
  const normalized = {
    id: String(rawAction?.id || `action-${index + 1}`),
    type,
    title: String(rawAction?.title || type.replace(/_/g, " ")).trim() || type,
    status: "pending",
    payload: {},
  };

  if (type === "read_file" || type === "read_capsule" || type === "open_file") {
    const path = toSafePath(payload.path);
    if (!path) return null;
    normalized.payload = type === "read_capsule"
      ? {
        path,
        query: String(payload.query || payload.focus || "").trim(),
      }
      : { path };
    return normalized;
  }

  if (type === "search_workspace") {
    const q = String(payload.q || payload.query || "").trim();
    if (!q) return null;
    normalized.payload = {
      q,
      scope: String(payload.scope || "all").trim().toLowerCase() || "all",
      limit: Math.min(Math.max(Number(payload.limit) || 8, 1), 50),
    };
    return normalized;
  }

  if (type === "propose_write") {
    const directPath = toSafePath(payload.path);
    const normalizedPaths = [
      ...new Set(
        (Array.isArray(payload.paths) ? payload.paths : [])
          .map((entry) => toSafePath(entry))
          .filter(Boolean)
      ),
    ].slice(0, 4);
    if (directPath && !normalizedPaths.includes(directPath)) normalizedPaths.unshift(directPath);
    const instruction = String(payload.instruction || payload.prompt || "").trim();
    if (!normalizedPaths.length || !instruction) return null;
    normalized.payload = {
      path: normalizedPaths[0],
      paths: normalizedPaths,
      instruction,
      language: String(payload.language || "").trim().toLowerCase(),
    };
    return normalized;
  }

  if (type === "apply_write_batch") {
    const batchId = String(payload.batchId || "").trim();
    if (!batchId) return null;
    const proposalId = String(payload.proposalId || "").trim();
    normalized.payload = proposalId ? { batchId, proposalId } : { batchId };
    return normalized;
  }

  if (type === "recover_spans") {
    const path = toSafePath(payload.path);
    const spanIds = Array.isArray(payload.spanIds)
      ? payload.spanIds.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 8)
      : [];
    const query = String(payload.query || payload.q || "").trim();
    const ranges = Array.isArray(payload.ranges)
      ? payload.ranges.slice(0, 8).map((range) => ({
        lineStart: Number(range?.lineStart || 0) || undefined,
        lineEnd: Number(range?.lineEnd || 0) || undefined,
        startByte: Number(range?.startByte || 0) || undefined,
        endByte: Number(range?.endByte || 0) || undefined,
      }))
      : [];
    if (!path || (!spanIds.length && !ranges.length && !query)) return null;
    normalized.payload = { path, spanIds, ranges, query };
    return normalized;
  }

  if (type === "run_terminal_command") {
    const command = String(payload.command || payload.input || "").trim();
    if (!command) return null;
    normalized.payload = {
      command,
      terminalSessionId: String(payload.terminalSessionId || "").trim(),
    };
    return normalized;
  }

  if (type === "summarize_ops_context") {
    normalized.payload = {
      scope: String(payload.scope || "selected").trim().toLowerCase() || "selected",
    };
    return normalized;
  }

  return null;
}

function sanitizeAssistantRunPlan(rawPlan) {
  const incoming = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  const rawActions = Array.isArray(incoming.actions) ? incoming.actions : [];
  const actions = rawActions
    .map((action, index) => sanitizeAssistantRunAction(action, index))
    .filter(Boolean);

  return {
    mode: normalizeRunMode(incoming.mode, "ask"),
    summary: String(incoming.summary || "").trim(),
    actions,
  };
}

function classifyTerminalCommandGuard(rawCommand) {
  const command = String(rawCommand || "").trim();
  const lowered = command.toLowerCase();
  if (!command) {
    return { risk: "invalid", needsApproval: true, reason: "Command is empty." };
  }

  const dangerous = [
    /\bsudo\b/,
    /\brm\b/,
    /\bchmod\b/,
    /\bchown\b/,
    /\bgit\s+reset\b/,
    /\bgit\s+clean\b/,
    /\bcurl\b[\s\S]*\|\s*(sh|bash|zsh)\b/,
    /\bwget\b[\s\S]*\|\s*(sh|bash|zsh)\b/,
  ];

  if (dangerous.some((pattern) => pattern.test(lowered))) {
    return { risk: "destructive", needsApproval: true, reason: "Command matches the destructive-command guardrail list." };
  }

  const writes = [
    />/,
    /\btee\b/,
    /\bmkdir\b/,
    /\btouch\b/,
    /\bnpm\s+install\b/,
    /\bpnpm\s+add\b/,
    /\byarn\s+add\b/,
    /\bapt\b/,
    /\bbrew\b/,
    /\bpip(?:3)?\s+install\b/,
  ];
  if (writes.some((pattern) => pattern.test(lowered))) {
    return { risk: "write", needsApproval: true, reason: "Command may mutate the environment or filesystem." };
  }

  return { risk: "read", needsApproval: false, reason: "Command appears read-only." };
}

function shouldAutoApplyAction(actionType, autonomyMode, payload = {}) {
  const normalizedAutonomy = normalizeAutonomyMode(autonomyMode, "review");
  if (normalizedAutonomy === "review") return false;

  if (actionType === "run_terminal_command") {
    const guard = classifyTerminalCommandGuard(payload.command || "");
    if (guard.needsApproval) return normalizedAutonomy === "autonomous" && guard.risk === "read";
    return true;
  }

  if (actionType === "apply_write_batch") {
    return normalizedAutonomy !== "review";
  }

  return true;
}

module.exports = {
  ACTION_TYPES,
  AUTONOMY_MODES,
  QUERY_EXTENSION_HINTS,
  RUN_MODES,
  basename,
  buildStructuralEditFallback,
  classifyTerminalCommandGuard,
  extractFirstJsonObject,
  extractQueryExtensionHints,
  extractSearchTokens,
  isStructuralEditPrompt,
  normalizeAssistantEditPrefs,
  normalizeAutonomyMode,
  normalizeRunMode,
  pathHasExtensionHint,
  rankWorkspacePathsForQuery,
  sanitizeAssistantRunAction,
  sanitizeAssistantRunPlan,
  scorePathForQuery,
  selectReferenceMatchLimit,
  shouldAutoApplyAction,
  toSafePath,
};
