"use strict";

const {
  buildWorkspaceFileRecord,
  buildWorkspaceFileView,
  estimateTextTokens,
  recoverWorkspaceFileRecord,
  suggestRecoverySpanIds,
} = require("../mesh-core/src/compression-core.cjs");
const {
  compress: legacyCompress,
  getLang,
} = require("../llm-compress.js");

const SIZE_MULTIPLIERS = [
  { label: "small", repeat: 1 },
  { label: "medium", repeat: 4 },
  { label: "large", repeat: 12 },
];

function bytes(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function ratio(part, whole) {
  if (!whole) return 0;
  return Number((part / whole).toFixed(4));
}

function repeatJoin(count, render) {
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    parts.push(render(index));
  }
  return parts.join("\n\n");
}

function buildCodeFixture(repeat) {
  return [
    "import crypto from 'node:crypto';",
    "",
    repeatJoin(repeat, (index) => [
      `export const routeKey${index} = "mesh-route-${index}";`,
      `export function buildRoute${index}(workspace, token = "mesh-token-${index}") {`,
      "  const trimmed = String(workspace || '').trim().toLowerCase();",
      `  const hash = crypto.createHash('sha256').update(trimmed + ':' + token).digest('hex');`,
      "  return {",
      `    id: routeKey${index},`,
      `    summary: trimmed + '-${index}',`,
      "    secure: token.startsWith('mesh-token'),",
      "    hash,",
      "  };",
      "}",
    ].join("\n")),
  ].join("\n");
}

function buildConfigFixture(repeat) {
  return repeatJoin(repeat, (index) => [
    `workspace_${index}:`,
    `  region: ${index % 2 === 0 ? "eu-central" : "us-east"}`,
    `  retries: ${3 + (index % 3)}`,
    `  timeout_ms: ${1200 + (index * 75)}`,
    "  compression:",
    `    capsule_budget_ratio: ${0.2 + ((index % 3) * 0.01)}`,
    `    transport_chunk_size: ${32768 + (index * 512)}`,
    "  alerts:",
    "    - deployments",
    "    - policies",
  ].join("\n"));
}

function buildSqlFixture(repeat) {
  return repeatJoin(repeat, (index) => [
    `CREATE VIEW deployment_rollup_${index} AS`,
    "SELECT",
    "  r.region_name,",
    "  d.workspace_id,",
    "  COUNT(*) AS deployment_count,",
    "  SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END) AS failed_count",
    "FROM deployments d",
    "JOIN regions r ON r.id = d.region_id",
    "WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
    "GROUP BY r.region_name, d.workspace_id;",
  ].join("\n"));
}

function buildMarkupFixture(repeat) {
  return [
    "<main class=\"mesh-workspace\">",
    repeatJoin(repeat, (index) => [
      `  <section class="deployment-card" id="deployment-${index}">`,
      `    <h2>Deployment ${index}</h2>`,
      `    <p data-region="${index % 2 === 0 ? "eu" : "us"}">Workspace capsule status and recovery details.</p>`,
      "    <button class=\"action-open\">Open</button>",
      "    <button class=\"action-recover\">Recover span</button>",
      "  </section>",
    ].join("\n")),
    "</main>",
  ].join("\n");
}

function buildDocsFixture(repeat) {
  return repeatJoin(repeat, (index) => [
    `## Compression Stage ${index}`,
    "",
    "The coarse capsule keeps structure, high priority facts, and evidence handles.",
    "",
    `- Recovery policy ${index}: fetch raw spans for exact strings, literals, and line-level explanations.`,
    `- Guardrail ${index}: never invent missing values when the capsule is incomplete.`,
    `- Transport ${index}: chunked digest envelope with deterministic validation.`,
  ].join("\n"));
}

const FIXTURE_FAMILIES = [
  {
    id: "code",
    ext: "ts",
    query: "hash token workspace secure route",
    build: buildCodeFixture,
  },
  {
    id: "config",
    ext: "yaml",
    query: "timeout retries capsule transport",
    build: buildConfigFixture,
  },
  {
    id: "sql",
    ext: "sql",
    query: "failed_count region workspace deployment",
    build: buildSqlFixture,
  },
  {
    id: "markup",
    ext: "html",
    query: "recover span deployment card button",
    build: buildMarkupFixture,
  },
  {
    id: "docs",
    ext: "md",
    query: "recovery guardrail exact strings digest",
    build: buildDocsFixture,
  },
];

async function benchmarkFixture(family, size) {
  const path = `fixtures/${family.id}.${size.label}.${family.ext}`;
  const source = family.build(size.repeat);
  const rawBytes = bytes(source);
  const rawTokens = estimateTextTokens(source);
  const record = await buildWorkspaceFileRecord(path, source, { legacyBrotliQuality: 4 });
  const capsuleView = await buildWorkspaceFileView(record, "capsule");
  const focusedView = await buildWorkspaceFileView(record, "focused", { query: family.query });
  const spanIds = suggestRecoverySpanIds(record, family.query, 4);
  const recovery = await recoverWorkspaceFileRecord(record, { spanIds });

  const capsuleBytes = bytes(capsuleView.content);
  const focusedBytes = bytes(focusedView.content);
  const recoveredText = recovery.spans.map((entry) => entry.text).join("\n");
  const recoveredBytes = bytes(recoveredText);

  const legacySmart = legacyCompress(source, getLang(path), path, "smart");
  const legacyLlm80 = legacyCompress(source, getLang(path), path, "llm80");

  return {
    id: `${family.id}:${size.label}`,
    family: family.id,
    size: size.label,
    path,
    query: family.query,
    parserFamily: String(record.parserFamily || ""),
    parseOk: Boolean(record.parseOk),
    capsuleMode: String(record.capsuleMode || ""),
    raw: {
      bytes: rawBytes,
      tokens: rawTokens,
    },
    capsule: {
      bytes: capsuleBytes,
      tokens: estimateTextTokens(capsuleView.content),
      ratio: ratio(capsuleBytes, rawBytes),
    },
    focused: {
      bytes: focusedBytes,
      tokens: estimateTextTokens(focusedView.content),
      ratio: ratio(focusedBytes, rawBytes),
    },
    recovery: {
      spans: recovery.spans.length,
      bytes: recoveredBytes,
      tokens: estimateTextTokens(recoveredText),
      ratio: ratio(recoveredBytes, rawBytes),
    },
    transport: {
      bytes: Number(record.compressionStats?.transportBytes || 0),
      ratio: ratio(Number(record.compressionStats?.transportBytes || 0), rawBytes),
    },
    legacy: {
      smart: {
        bytes: Number(legacySmart.stats?.compBytes || 0),
        ratio: ratio(Number(legacySmart.stats?.compBytes || 0), rawBytes),
      },
      llm80: {
        bytes: Number(legacyLlm80.stats?.compBytes || 0),
        ratio: ratio(Number(legacyLlm80.stats?.compBytes || 0), rawBytes),
      },
    },
  };
}

function summarizeResults(cases) {
  const byFamily = [];
  for (const family of FIXTURE_FAMILIES) {
    const subset = cases.filter((entry) => entry.family === family.id);
    if (!subset.length) continue;
    const aggregate = (selector) => Number((subset.reduce((sum, entry) => sum + selector(entry), 0) / subset.length).toFixed(4));
    byFamily.push({
      family: family.id,
      avgCapsuleRatio: aggregate((entry) => entry.capsule.ratio),
      avgFocusedRatio: aggregate((entry) => entry.focused.ratio),
      avgTransportRatio: aggregate((entry) => entry.transport.ratio),
      avgLegacyLlm80Ratio: aggregate((entry) => entry.legacy.llm80.ratio),
      avgRecoverySpans: aggregate((entry) => entry.recovery.spans),
    });
  }
  return {
    caseCount: cases.length,
    byFamily,
  };
}

async function runBenchmarks() {
  const cases = [];
  for (const family of FIXTURE_FAMILIES) {
    for (const size of SIZE_MULTIPLIERS) {
      cases.push(await benchmarkFixture(family, size));
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    cases,
    summary: summarizeResults(cases),
  };
}

function percentString(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function renderBenchmarkTable(report) {
  const lines = [
    "Compression benchmark: raw vs capsule vs focused vs recovery vs transport vs llm-compress",
    "",
    "family   size    rawB    cap%    foc%    rec%    trn%    llm80%",
  ];

  for (const entry of report.cases) {
    lines.push([
      entry.family.padEnd(8, " "),
      entry.size.padEnd(7, " "),
      String(entry.raw.bytes).padStart(6, " "),
      percentString(entry.capsule.ratio).padStart(7, " "),
      percentString(entry.focused.ratio).padStart(7, " "),
      percentString(entry.recovery.ratio).padStart(7, " "),
      percentString(entry.transport.ratio).padStart(7, " "),
      percentString(entry.legacy.llm80.ratio).padStart(8, " "),
    ].join(" "));
  }

  lines.push("");
  lines.push("Average by family");
  for (const family of report.summary.byFamily) {
    lines.push(
      `${family.family}: capsule=${percentString(family.avgCapsuleRatio)}, focused=${percentString(family.avgFocusedRatio)}, transport=${percentString(family.avgTransportRatio)}, llm80=${percentString(family.avgLegacyLlm80Ratio)}, recoverySpans=${family.avgRecoverySpans}`,
    );
  }

  return lines.join("\n");
}

async function runCli(argv = process.argv.slice(2)) {
  const report = await runBenchmarks();
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderBenchmarkTable(report)}\n`);
}

module.exports = {
  FIXTURE_FAMILIES,
  SIZE_MULTIPLIERS,
  renderBenchmarkTable,
  runBenchmarks,
  summarizeResults,
};

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
