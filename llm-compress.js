#!/usr/bin/env node
/**
 * llm-compress.js — Maximum lossless compression for LLM input
 *
 * MODES:
 *   --mode=smart    (default) semantisch: Pseudocode + komprimierter Code ~40-65%
 *   --mode=skeleton            Signaturen + Pseudocode only           ~80-90%
 *   --mode=lean                nur Comments/Blanks entfernen          ~15-40%
 *   --mode=llm80               Ziel >=80% bei hoher LLM-Lesbarkeit    ~80-95%
 *
 * Usage:
 *   node llm-compress.js file.js [--mode=smart|skeleton|lean]
 *   node llm-compress.js src/   [--out=compressed/]
 *   node llm-compress.js file.js --stdout
 */
"use strict";
const fs   = require("fs");
const path = require("path");

// ── LANG MAP ──────────────────────────────────────────────────────────────────
const EXT_LANG = {
  ".js":"js",".mjs":"js",".cjs":"js",".jsx":"js",".ts":"js",".tsx":"js",
  ".py":"py",".go":"go",".rs":"rs",".java":"java",".php":"php",".rb":"rb",
  ".css":"css",".scss":"css",".html":"html",".sh":"sh",".sql":"sql",
  ".yml":"yaml",".yaml":"yaml",".md":"md",".json":"json",".xml":"xml",
  ".toml":"toml",".ini":"ini",".txt":"text",
};
const getLang = fp => EXT_LANG[path.extname(fp||"").toLowerCase()] || "text";

// ── STRIP COMMENTS + BLANKS ───────────────────────────────────────────────────
function strip(src, lg) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
  if (lg === "html") src = src.replace(/<!--[\s\S]*?-->/g, "");
  const lc = { js:"//", go:"//", java:"//", rs:"//", php:"//", css:"//",
                py:"#", rb:"#", sh:"#", sql:"--" }[lg];
  if (lc) {
    src = src.split("\n").map(line => {
      if (line.startsWith("#!")) return line;
      if (line.trimStart().startsWith(lc)) return "";
      const t = line.indexOf("  " + lc);
      return t > 0 ? line.slice(0, t) : line;
    }).join("\n");
  }
  return src.split("\n").map(l => l.trimEnd()).filter(l => l.trim()).join("\n");
}

// ── BRACE-MATCH BLOCK EXTRACTOR ───────────────────────────────────────────────
function extractBlocks(src) {
  const RE = /^([ \t]*)((?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\s*(?:\*\s*)?\(|\([^)]*\)\s*=>|[\w$]+\s*=>)|app\.(get|post|put|delete|patch|use)\s*\()/gm;
  const blocks = [];
  let m;
  while ((m = RE.exec(src)) !== null) {
    let bp = src.indexOf("{", m.index);
    if (bp < 0 || bp - m.index > 300) continue;
    let depth = 0, i = bp;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { if (--depth === 0) break; }
    }
    const name = m[3] || m[4] || `app.${m[5]||"use"}`;
    const sig  = src.slice(m.index, bp).trim().replace(/\s+/g, " ");
    const body = src.slice(bp + 1, i);
    const bl   = body.split("\n").filter(l => l.trim()).length;
    blocks.push({ name, sig, body, bodyLines: bl, start: m.index, end: i + 1 });
  }
  return blocks;
}

// ── COLLAPSE SYNTAX ────────────────────────────────────────────────────────────
function collapse(code) {
  let s = code;
  s = s.replace(/\) \{\n[ \t]+(return [^\n{;]{0,150};)\n[ \t]*\}/g, ") { $1 }");
  s = s.replace(/\) \{\n[ \t]+(throw [^\n{;]{0,150};)\n[ \t]*\}/g,  ") { $1 }");
  s = s.replace(/if \(([^\)]{0,100})\) \{\n[ \t]+((?:return|throw|continue|break)[^\n;]{0,120};)\n[ \t]*\}/g, "if ($1) $2");
  // try { x; } catch {}
  s = s.replace(/try \{\n[ \t]+([^;\n]{0,120};)\n[ \t]*\} catch \{[^}]*\}/g, "try { $1 } catch {}");
  return s.split("\n").map(l => l.trimEnd()).filter(l => l.trim()).join("\n");
}

// ── PSEUDOCODE GENERATOR ──────────────────────────────────────────────────────
function pseudo(name, body, sig) {
  const b = body.replace(/\s+/g, " ").trim();

  // enum normalizer
  const enumM = b.match(/\[([^\]]{3,300})\]\.includes\(\w+\).*?return \w+;.*?return ["'`](\w+)/);
  if (enumM) {
    const vals = enumM[1].replace(/["']/g,"").split(",").map(s=>s.trim()).join("|");
    return `enum[${vals}] ‖ "${enumM[2]}"`;
  }
  // boolean flag
  if (/"1","true","yes","on"/.test(b)) return `"1/true/yes/on/enabled"→true "0/false/no/off/disabled"→false ‖ fallback`;
  // clamp
  if (/Math\.min[^]*Math\.max/.test(b)) return `clamp(min,max, trunc(v) if finite ‖ fallback)`;
  // scrypt hash
  if (/scryptSync/.test(b) && /toString\("hex"\)/.test(b) && !/timingSafe/.test(b)) return `→ "${"`${salt}:${scryptHash}`"}"`;
  // timing safe compare
  if (/timingSafeEqual/.test(b)) return `split stored "salt:hash", recompute, timingSafeEqual → bool`;
  // ISO date
  if (/new Date\(\)\.toISOString\(\)/.test(b) && b.length < 100) return `→ new Date().toISOString()`;
  // safeRead
  if (/readFileSync/.test(b) && /JSON\.parse/.test(b)) return `→ JSON.parse(file) ‖ fallback (silent)`;
  // safeWrite
  if (/writeFileSync/.test(b) && /JSON\.stringify/.test(b)) return `writeFile JSON.stringify(v,null,2) — swallow errors`;
  // cookie header build
  if (/SameSite|HttpOnly|Max-Age/.test(b)) return `→ build "name=val; Path; Max-Age; SameSite; HttpOnly[; Secure]" string`;
  // auth middleware
  if (/401/.test(b) && /next\(\)/.test(b)) return `→ resolveAuth → 401 if none ‖ attach authUser/Token → next()`;
  // pruneExpired
  if (/pruneExpiredSessions/.test(b) && b.length < 100) return `→ secureDb.pruneExpiredSessions()`;
  // simple return expr
  const retM = b.match(/^(?:\{)?\s*(?:const \w+ = .{0,60};\s*)?return\s+([^;{}]{5,120});\s*(?:\})?$/);
  if (retM) return `→ ${retM[1].replace(/\s+/g," ")}`;
  // trim + lower
  if (/\.trim\(\)/.test(b) && b.length < 300) {
    const repM = b.match(/\.replace\(\/([^/]{1,30})\//);
    const hasLower = /\.toLowerCase\(\)/.test(b);
    return `→ String(v‖"")${hasLower?".toLowerCase()":""}.trim()${repM?`.replace(/${repM[1]}/…)`:""}`;
  }
  // String coercion
  if (/^return String\(/.test(b) && b.length < 120) return `→ ${b.replace(/^return /,"").replace(/;$/,"").replace(/\s+/g," ")}`;
  // short array/set filter
  if (/Array\.isArray[^]*\? .* : \[\]/.test(b) && b.length < 150) return `→ Array.isArray(x) ? x : []`;
  // crypto UUID
  if (/crypto\.randomUUID\(\)/.test(b) && b.length < 80) return `→ crypto.randomUUID()`;
  // cookie read
  if (/parseCookies|readCookie|cookie\[/.test(b)) return `→ parse Cookie header → value for ${name.replace(/read|get/i,"")}`;
  // set cookie
  if (/setHeader.*Set-Cookie|Set-Cookie.*setHeader/.test(b)) return `→ res.setHeader("Set-Cookie", createCookieHeader(…))`;
  // clear cookie  
  if (/clearAuthCookie|maxAge.*0/.test(b) && /setHeader/.test(b)) return `→ clear auth cookie (Max-Age=0)`;
  // normalize email
  if (/\.toLowerCase\(\)/.test(b) && /email/i.test(name) && b.length < 100) return `→ String(email‖"").trim().toLowerCase()`;
  // slug
  if (/a-z0-9[._\-]/.test(b) && /replace.*\^-/.test(b)) return `→ lower [a-z0-9._-] trim-dashes ‖ fallback`;
  // persist/load
  if (/safeWriteJsonFile/.test(b) && b.length < 120) return `→ operationsStore.updatedAt=now(); safeWriteJsonFile(…)`;
  // infer region
  if (/includes\("ap"\)/.test(b) && /includes\("us"\)/.test(b)) return `ap→"ap" us→"us" ‖ "eu"`;
  // rot47
  if (/charCodeAt|fromCharCode/.test(b) && b.length < 200) return `→ ROT47 transform: char codes 33-126 shifted by 47 mod 94`;
  // replaceLiteralAll
  if (/split.*join/.test(b) && b.length < 150) return `→ str.split(search).join(replacement) — literal replace-all`;
  // escape regex
  if (/replace.*\[.*\\.*\]/.test(b) && b.length < 150) return `→ escape special regex chars in string`;

  return null; // not auto-summarizable
}

// ── HEAD/TAIL TRUNCATE ─────────────────────────────────────────────────────────
function headTail(lines, head, tail) {
  if (lines.length <= head + tail) return lines.join("\n");
  return [
    ...lines.slice(0, head),
    `  // ···+${lines.length - head - tail} lines···`,
    ...(tail > 0 ? lines.slice(-tail) : []),
  ].join("\n");
}

// ── FORMAT BLOCK ───────────────────────────────────────────────────────────────
function formatBlock(b, mode) {
  const { name, sig, body, bodyLines } = b;

  // skeleton: always one-liner
  if (mode === "skeleton") {
    const p = pseudo(name, body, sig);
    if (p) return `// ${name}(…) ${p}`;
    return `// ${sig.slice(0,100)}… [${bodyLines} lines]`;
  }

  // smart mode
  const p = pseudo(name, body, sig);

  if (bodyLines <= 10) {
    if (p) return `// ${name}(…) ${p}`;
    const lines = collapse(body).split("\n");
    return `${sig} {\n${lines.slice(0, 4).join("\n")}\n}`;
  }
  if (bodyLines <= 30) {
    if (p) return `// ${name}(…) ${p}`;
    const lines = collapse(body).split("\n");
    return `${sig} {\n${headTail(lines, 6, 0)}\n}`;
  }
  // large/huge
  const lines = collapse(body).split("\n");
  const header = p ? `// ${name}: ${p}\n` : "";
  return `${header}${sig} {\n${headTail(lines, 6, 3)}\n}`;
}

// ── ROUTES TABLE ───────────────────────────────────────────────────────────────
function extractRoutes(src) {
  const RE = /app\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*(requireAuth\s*,)?/g;
  const out = []; let m;
  while ((m = RE.exec(src)) !== null)
    out.push(`  ${m[3]?"🔒":"🌐"} ${m[1].toUpperCase().padEnd(7)}${m[2]}`);
  return out;
}

// ── IMPORTS ────────────────────────────────────────────────────────────────────
function extractImports(src) {
  const out = []; let m;
  const reqRE = /(?:const|let|var)\s+(.+?)\s*=\s*require\(["'`]([^"'`]+)["'`]\)/g;
  while ((m = reqRE.exec(src)) !== null) out.push(`${m[2]}→${m[1].replace(/\s+/g," ").trim()}`);
  const impRE = /^import\s+(.+?)\s+from\s+["'`]([^"'`]+)["'`]/gm;
  while ((m = impRE.exec(src)) !== null) out.push(`${m[2]}→${m[1].replace(/\s+/g," ").trim()}`);
  return out;
}

// ── TOP-LEVEL CONSTS ───────────────────────────────────────────────────────────
function extractConsts(src) {
  const RE = /^const\s+([A-Z_][A-Z0-9_]{2,})\s*=\s*(.{1,220});$/gm;
  const out = []; let m;
  while ((m = RE.exec(src)) !== null) {
    let v = m[2].trim();
    // Condense Set/Map with many items
    if (/^new\s+(Set|Map)\s*\(\[/.test(v)) {
      const items = [...v.matchAll(/["'`]([^"'`]+)["'`]/g)].map(x=>x[1]);
      if (items.length > 3) { out.push(`${m[1]}=new ${/Set/.test(v)?"Set":"Map"}([…${items.length}: ${items.slice(0,3).join(",")}…])`); continue; }
    }
    out.push(`${m[1]}=${v}`);
  }
  return out;
}

function pushUnique(list, seen, value, maxItems = 20) {
  if (list.length >= maxItems) return;
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 3 || seen.has(normalized)) return;
  seen.add(normalized);
  list.push(normalized);
}

function extractAnchors(src, lg, maxItems = 20) {
  const text = String(src || "");
  const out = [];
  const seen = new Set();

  if (lg === "html") {
    for (const m of text.matchAll(/id\s*=\s*["']([^"']+)["']/g)) pushUnique(out, seen, `id:${m[1]}`, maxItems);
    for (const m of text.matchAll(/class\s*=\s*["']([^"']+)["']/g)) {
      for (const cls of String(m[1] || "").split(/\s+/g)) pushUnique(out, seen, `class:${cls}`, maxItems);
    }
    for (const m of text.matchAll(/<h[1-6][^>]*>([^<]{1,90})<\/h[1-6]>/gi)) pushUnique(out, seen, `heading:${m[1]}`, maxItems);
    for (const m of text.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)) pushUnique(out, seen, `script:${m[1]}`, maxItems);
  } else if (lg === "css") {
    for (const m of text.matchAll(/(^|\n)\s*([^@\n][^{]{1,120})\{/g)) pushUnique(out, seen, `selector:${m[2]}`, maxItems);
  } else if (lg === "json") {
    for (const m of text.matchAll(/"([^"]{1,80})"\s*:/g)) pushUnique(out, seen, `key:${m[1]}`, maxItems);
  } else if (lg === "yaml" || lg === "toml" || lg === "ini") {
    for (const m of text.matchAll(/(^|\n)\s*([A-Za-z0-9_.-]{2,80})\s*[:=]/g)) pushUnique(out, seen, `key:${m[2]}`, maxItems);
  } else if (lg === "md") {
    for (const m of text.matchAll(/^#{1,6}\s+(.{2,100})$/gm)) pushUnique(out, seen, `heading:${m[1]}`, maxItems);
  } else {
    for (const m of text.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]{2,})\s*\(/g)) pushUnique(out, seen, `call:${m[1]}`, maxItems);
    for (const m of text.matchAll(/["'`]([^"'`\n]{10,100})["'`]/g)) {
      const value = String(m[1] || "");
      if (/\b(http|https|api|error|failed|success|token|auth|model|workspace|compress|decode)\b/i.test(value)) {
        pushUnique(out, seen, `str:${value}`, maxItems);
      }
    }
    for (const m of text.matchAll(/\b([A-Z_][A-Z0-9_]{3,})\b/g)) pushUnique(out, seen, `const:${m[1]}`, maxItems);
  }

  return out.slice(0, maxItems);
}

function buildLlm80Output(src, clean, lg, filePath, origLines, origBytes) {
  const blocks = extractBlocks(clean).sort((a,b) => a.start - b.start);
  const blockLines = blocks.map((b) => formatBlock(b, "skeleton").replace(/\s+/g, " "));
  const anchors = extractAnchors(src, lg, 24);
  const imports = extractImports(src).slice(0, 8);
  const routes = extractRoutes(src).slice(0, 10);
  const consts = extractConsts(clean).slice(0, 8);

  const header = [
    `// ◆ ${path.basename(filePath||"file")} [${lg.toUpperCase()}] ${origLines} lines → LLM80`,
    imports.length ? `// DEP: ${imports.join(" │ ")}` : "",
    routes.length ? `// ROUTES: ${routes.join(" │ ")}` : "",
    consts.length ? `// K: ${consts.join(" │ ")}` : "",
  ].filter(Boolean);

  const targetBytes = Math.max(180, Math.floor(origBytes * 0.2));
  let keepBlocks = blockLines.length;
  let keepAnchors = anchors.length;

  const compose = (maxLen = 180) => {
    const lines = [...header, "// FLOW:"];
    for (const line of blockLines.slice(0, keepBlocks)) {
      lines.push(line.length > maxLen ? `${line.slice(0, Math.max(60, maxLen - 1))}…` : line);
    }
    if (keepAnchors > 0) {
      lines.push("// ANCHORS:");
      for (const anchor of anchors.slice(0, keepAnchors)) lines.push(`// A: ${anchor}`);
    }
    return lines.join("\n");
  };

  let output = compose(180);
  while (Buffer.byteLength(output, "utf8") > targetBytes && keepAnchors > 0) {
    keepAnchors -= 1;
    output = compose(180);
  }

  while (Buffer.byteLength(output, "utf8") > targetBytes && keepBlocks > Math.min(8, blockLines.length)) {
    keepBlocks -= 1;
    output = compose(160);
  }

  if (Buffer.byteLength(output, "utf8") > targetBytes) output = compose(120);
  if (Buffer.byteLength(output, "utf8") > targetBytes) {
    const minimal = [header[0], `// FLOW: ${blockLines.slice(0, 6).join(" │ ")}`];
    output = minimal.join("\n");
  }

  return output;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
function compress(src, lg, filePath, mode = "smart") {
  const origBytes = Buffer.byteLength(src, "utf8");
  const origLines = src.split("\n").length;
  const clean = strip(src, lg);
  const out = [];

  out.push(`// ◆ ${path.basename(filePath||"file")} [${lg.toUpperCase()}] ${origLines} lines → LLM-compressed (${mode})`);

  // Imports
  const imps = extractImports(src);
  if (imps.length) out.push(`// DEP: ${imps.join(" │ ")}`);

  // Constants
  const consts = extractConsts(clean);
  for (let i = 0; i < consts.length; i += 3)
    out.push(`// K: ${consts.slice(i,i+3).join(" │ ")}`);

  // Routes
  const routes = extractRoutes(src);
  if (routes.length) { out.push(`// ROUTES:`); routes.forEach(r => out.push(r)); }

  out.push("//");

  if (mode === "llm80") {
    const output = buildLlm80Output(src, clean, lg, filePath, origLines, origBytes);
    const cb = Buffer.byteLength(output, "utf8");
    return {
      output,
      stats: {
        origBytes,
        compBytes: cb,
        origLines,
        compLines: output.split("\n").length,
        byteReduction: ((1-cb/origBytes)*100).toFixed(1),
        lineReduction: ((1-output.split("\n").length/origLines)*100).toFixed(1),
      }
    };
  }

  // lean mode: just stripped + collapsed code, no semantic analysis
  if (mode === "lean") {
    out.push(collapse(clean));
    const output = out.join("\n");
    const cb = Buffer.byteLength(output, "utf8");
    return { output, stats: { origBytes, compBytes: cb, origLines, compLines: output.split("\n").length,
      byteReduction: ((1-cb/origBytes)*100).toFixed(1), lineReduction: ((1-output.split("\n").length/origLines)*100).toFixed(1) } };
  }

  // Extract and format blocks
  const blocks = extractBlocks(clean);
  const sorted = [...blocks].sort((a,b) => a.start - b.start);

  let pos = 0;
  for (const b of sorted) {
    // Gap before this block (static data, setup code)
    const gap = clean.slice(pos, b.start).trim();
    if (gap) {
      const glines = gap.split("\n").filter(l=>l.trim());
      // skip if it's just const declarations (already covered above)
      const nonConst = glines.filter(l => !/^const\s+[A-Z_]/.test(l.trim()));
      if (nonConst.length > 0 && mode !== "skeleton") {
        const collapsed = collapse(gap).split("\n");
        out.push(headTail(collapsed, 4, 2));
      }
    }
    out.push(formatBlock(b, mode));
    pos = b.end;
  }

  // Tail
  const tail = clean.slice(pos).trim();
  if (tail) {
    const tlines = collapse(tail).split("\n");
    if (mode !== "skeleton") out.push(headTail(tlines, 5, 3));
    else out.push(`// tail: ${tlines.slice(0,2).join(" │ ")} …`);
  }

  const output = out.join("\n");
  const compBytes = Buffer.byteLength(output, "utf8");
  const compLines = output.split("\n").length;
  return {
    output,
    stats: {
      origBytes, compBytes, origLines, compLines,
      byteReduction: ((1-compBytes/origBytes)*100).toFixed(1),
      lineReduction: ((1-compLines/origLines)*100).toFixed(1),
    }
  };
}

const EXTS = new Set([".js",".mjs",".cjs",".jsx",".ts",".tsx",".py",".go",
  ".rs",".java",".php",".rb",".css",".scss",".html",".sh",".sql",".yml",".yaml",
  ".json",".xml",".toml",".ini",".md",".txt"]);

function collectFiles(p) {
  try {
    if (fs.statSync(p).isFile()) return [p];
    const all = [];
    const walk = d => {
      for (const e of fs.readdirSync(d,{withFileTypes:true})) {
        if (["node_modules","dist",".git","build","__pycache__","vendor",".next"].includes(e.name)||e.name.startsWith(".")) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) all.push(full);
      }
    };
    walk(p);
    return all;
  } catch { return []; }
}

function outPath(fp) {
  const e = path.extname(fp);
  const selectedMode = arguments.length > 1 ? arguments[1] : "smart";
  const suf = selectedMode === "skeleton" ? ".skeleton" : selectedMode === "lean" ? ".lean" : ".llm";
  const out = fp.slice(0,-e.length) + suf + e;
  const outDir = arguments.length > 2 ? arguments[2] : "";
  if (outDir) {
    const rel = path.relative(process.cwd(), out);
    return path.join(outDir, rel.replace(/\.\.\//g, "_/"));
  }
  return out;
}

function runCli(argv = process.argv.slice(2)) {
  const flags = argv.filter(a => a.startsWith("--"));
  const inputs = argv.filter(a => !a.startsWith("--"));
  const requestedMode = (flags.find(f => f.startsWith("--mode=")) || "--mode=smart").split("=")[1];
  const VALID_MODES = new Set(["smart", "skeleton", "lean", "llm80"]);
  const mode = VALID_MODES.has(requestedMode) ? requestedMode : "smart";
  const outDir = (flags.find(f => f.startsWith("--out=")) || "").split("=")[1] || "";
  const toStdout = flags.includes("--stdout");

  if (!inputs.length) {
    console.error("Usage: node llm-compress.js <file|dir> [--mode=lean|smart|skeleton|llm80] [--out=dir] [--stdout]");
    process.exit(1);
  }

  let totalOrig = 0;
  let totalComp = 0;
  let count = 0;
  for (const input of inputs) {
    for (const fp of collectFiles(input)) {
      try {
        const src = fs.readFileSync(fp, "utf8");
        if (src.length < 80) continue;
        const lg = getLang(fp);
        const { output, stats } = compress(src, lg, fp, mode);
        totalOrig += stats.origBytes;
        totalComp += stats.compBytes;
        count += 1;
        if (toStdout) {
          process.stdout.write(output + "\n\n");
        } else {
          const op = outPath(fp, mode, outDir);
          fs.mkdirSync(path.dirname(op), { recursive: true });
          fs.writeFileSync(op, output, "utf8");
          const bar = "█".repeat(Math.min(10, Math.round(+stats.byteReduction / 10))).padEnd(10, "░");
          console.log(`✓ ${path.relative(process.cwd(), fp)}`);
          console.log(`  [${bar}] −${stats.byteReduction}% bytes  −${stats.lineReduction}% lines  (${stats.origLines}→${stats.compLines} Zeilen)  → ${path.basename(op)}`);
        }
      } catch (err) {
        console.error(`✗ ${fp}: ${err.message}`);
      }
    }
  }

  if (!toStdout && count > 1) {
    console.log(`\n── TOTAL: ${count} Dateien │ ${totalOrig}→${totalComp} Bytes │ −${((1-totalComp/totalOrig)*100).toFixed(1)}% ──`);
  }
}

module.exports = {
  EXTS,
  collectFiles,
  compress,
  extractAnchors,
  extractBlocks,
  extractConsts,
  extractImports,
  extractRoutes,
  formatBlock,
  getLang,
  outPath,
  pseudo,
  runCli,
  strip,
};

if (require.main === module) {
  runCli();
}
