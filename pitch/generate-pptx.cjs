'use strict';

const PptxGenJS = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'export');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Brand colours ─────────────────────────────────────────────
const C = {
  white:    'FFFFFF',
  bg:       'FFFFFF',
  bg2:      'F8F9FC',
  bg3:      'F0F2F8',
  border:   'E0E4EF',
  border2:  'CDD3E3',
  text:     '1A1F36',
  muted:    '5A6480',
  faint:    '8E97B0',
  blue:     '005FB8',
  blueMid:  '1A73E8',
  blueLt:   'E8F0FE',
  teal:     '00D4B0',
  violet:   '8A7CFF',
  green:    '0A7C4E',
  greenBg:  'E6F7F1',
  red:      'C0392B',
};

// ── Slide dimensions (10 × 5.625 in = 16:9 widescreen) ────────
const W = 10;
const H = 5.625;

// ── Icon SVG as data URI ───────────────────────────────────────
const ICON_B64 = 'PHN2ZyB2aWV3Qm94PSIwIDAgNDAgNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPHBhdGggZD0iTTEwIDEwTDUgMjBMMTAgMzAiIHN0cm9rZT0iIzAwZmZkNSIgc3Ryb2tlLXdpZHRoPSI0IiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KICA8cGF0aCBkPSJNMzAgMTBMMzUgMjBMMzAgMzAiIHN0cm9rZT0iIzhhN2NmZiIgc3Ryb2tlLXdpZHRoPSI0IiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPC9zdmc+Cg==';

// ── Helpers ────────────────────────────────────────────────────

/** Add a thin gradient top-bar to every content slide */
function topBar(slide) {
  // teal → violet gradient as a SVG rect embedded as image
  const gradSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="8"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#00ffd5"/><stop offset="100%" stop-color="#8a7cff"/></linearGradient></defs><rect width="960" height="8" fill="url(#g)"/></svg>`;
  const gradB64 = Buffer.from(gradSvg).toString('base64');
  slide.addImage({ data: `data:image/svg+xml;base64,${gradB64}`, x: 0, y: 0, w: W, h: 0.09 });
}

/** Slide header: icon + "Mesh." + tag pill */
function slideHeader(slide, tag) {
  topBar(slide);
  slide.addImage({ data: `data:image/svg+xml;base64,${ICON_B64}`, x: 0.35, y: 0.18, w: 0.28, h: 0.28 });
  slide.addText('Mesh.', {
    x: 0.67, y: 0.15, w: 1.1, h: 0.34,
    fontSize: 14, bold: true, color: C.blue,
    fontFace: 'Arial',
  });
  slide.addText(tag.toUpperCase(), {
    x: W - 1.8, y: 0.17, w: 1.5, h: 0.28,
    fontSize: 6.5, bold: true, color: C.faint,
    align: 'right', fontFace: 'Arial',
  });
  // divider
  slide.addShape('line', { x: 0.35, y: 0.55, w: W - 0.7, h: 0, line: { color: C.border, width: 0.75 } });
}

/** Slide label (eyebrow above h1) */
function label(slide, text, y) {
  slide.addText(text.toUpperCase(), {
    x: 0.35, y, w: W - 0.7, h: 0.22,
    fontSize: 6.5, bold: true, color: C.blue,
    fontFace: 'Arial',
  });
}

/** h1 */
function h1(slide, text, y, opts = {}) {
  slide.addText(text, {
    x: 0.35, y, w: W - 0.7, h: opts.h || 0.48,
    fontSize: opts.size || 20, bold: true, color: C.text,
    fontFace: 'Arial', wrap: true,
    ...opts,
  });
}

/** body text */
function body(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x, y, w, h,
    fontSize: opts.size || 9.5, color: opts.color || C.muted,
    fontFace: 'Arial', wrap: true, valign: 'top',
    ...opts,
  });
}

/** bullet list — rows is array of {text, bold?} */
function bullets(slide, rows, x, y, w, h) {
  const items = rows.map(r => ({
    text: typeof r === 'string' ? r : r.text,
    options: { bold: typeof r !== 'string' && r.bold, color: typeof r !== 'string' && r.bold ? C.text : C.muted },
  }));
  slide.addText(items, {
    x, y, w, h,
    fontSize: 9.5, fontFace: 'Arial', wrap: true, valign: 'top',
    bullet: { type: 'bullet', indent: 10 },
  });
}

/** Filled rect box */
function box(slide, x, y, w, h, fill, borderColor) {
  slide.addShape('rect', {
    x, y, w, h,
    fill: { color: fill },
    line: borderColor ? { color: borderColor, width: 0.75 } : { color: fill, width: 0 },
  });
}

/** Stat box */
function statBox(slide, x, y, w, h, value, title, sub) {
  box(slide, x, y, w, h, C.bg2, C.border);
  slide.addText(value, { x: x + 0.12, y: y + 0.1, w: w - 0.24, h: 0.38, fontSize: 18, bold: true, color: C.blue, fontFace: 'Arial' });
  if (title) slide.addText(title, { x: x + 0.12, y: y + 0.46, w: w - 0.24, h: 0.22, fontSize: 8.5, bold: true, color: C.text, fontFace: 'Arial', wrap: true });
  if (sub)   slide.addText(sub,   { x: x + 0.12, y: y + 0.66, w: w - 0.24, h: 0.44, fontSize: 7.5, color: C.muted, fontFace: 'Arial', wrap: true });
}

/** Section divider line + h2 */
function h2(slide, text, y) {
  slide.addShape('line', { x: 0.35, y, w: W - 0.7, h: 0, line: { color: C.border, width: 0.75 } });
  slide.addText(text, { x: 0.35, y: y + 0.05, w: W - 0.7, h: 0.28, fontSize: 10, bold: true, color: C.text, fontFace: 'Arial' });
}

/** Callout box */
function callout(slide, text, y, h = 0.55) {
  box(slide, 0.35, y, W - 0.7, h, C.blueLt, C.blueLt);
  slide.addShape('rect', { x: 0.35, y, w: 0.045, h, fill: { color: C.blue }, line: { color: C.blue, width: 0 } });
  slide.addText(text, { x: 0.46, y: y + 0.05, w: W - 0.85, h: h - 0.1, fontSize: 9, color: C.blue, italic: true, fontFace: 'Arial', wrap: true });
}

/** Progress / benchmark bar */
function bmBar(slide, x, y, w, h, pct, isSkip = false) {
  box(slide, x, y, w, h, C.bg3, C.border);
  if (pct > 0) {
    const fillW = w * Math.min(pct / 100, 1);
    if (isSkip) {
      box(slide, x, y, fillW, h, C.border2, C.border2);
    } else {
      // gradient via SVG
      const gSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="10"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#00D4B0"/><stop offset="100%" stop-color="#8A7CFF"/></linearGradient></defs><rect width="200" height="10" fill="url(#g)"/></svg>`;
      const gB64 = Buffer.from(gSvg).toString('base64');
      slide.addImage({ data: `data:image/svg+xml;base64,${gB64}`, x, y, w: fillW, h });
    }
  }
}

/** Table */
function table(slide, headers, rows, x, y, w, colWidths, opts = {}) {
  const tRows = [];
  // header row
  tRows.push(headers.map(h => ({
    text: h,
    options: { bold: true, fontSize: 7, color: C.faint, fill: C.bg3, fontFace: 'Arial' },
  })));
  // data rows
  rows.forEach((row, ri) => {
    tRows.push(row.map((cell, ci) => {
      const isCheck = cell === '✓';
      const isCross = cell === '✗';
      return {
        text: cell,
        options: {
          fontSize: 8.5,
          color: isCheck ? C.green : isCross ? C.red : (opts.boldCol === ci ? C.text : C.muted),
          bold: isCheck || isCross || opts.boldCol === ci,
          fill: ri % 2 === 1 ? C.bg2 : C.white,
          fontFace: 'Arial',
        },
      };
    }));
  });

  slide.addTable(tRows, {
    x, y, w,
    colW: colWidths,
    border: { type: 'solid', color: C.border, pt: 0.5 },
    rowH: opts.rowH || 0.28,
  });
}

/** Context window visual (2 rows) */
function ctxVisual(slide, y, lang = 'en') {
  const l1 = lang === 'en' ? 'Without Mesh' : 'Ohne Mesh';
  const l2 = lang === 'en' ? 'With Capsule' : 'Mit Capsule';
  const t1 = lang === 'en' ? '~20 medium files  — 100% utilized' : '~20 Dateien — 100 % ausgelastet';
  const t2 = lang === 'en' ? '~78 medium files  — 26% utilized'  : '~78 Dateien — 26 % ausgelastet';

  const bx = 1.6; const bw = W - 2.3; const bh = 0.18;

  slide.addText(l1, { x: 0.35, y: y + 0.02, w: 1.2, h: bh, fontSize: 8, color: C.muted, fontFace: 'Arial' });
  box(slide, bx, y, bw, bh, 'FCE4E4', 'FCE4E4');
  slide.addShape('rect', { x: bx, y, w: bw, h: bh, fill: { color: 'FCE4E4' }, line: { color: C.red, width: 0.75 } });
  slide.addText(t1, { x: bx + 0.05, y: y + 0.01, w: bw - 0.1, h: bh - 0.02, fontSize: 7, color: C.muted, fontFace: 'Arial', valign: 'middle' });

  const y2 = y + 0.28;
  slide.addText(l2, { x: 0.35, y: y2 + 0.02, w: 1.2, h: bh, fontSize: 8, color: C.muted, fontFace: 'Arial' });
  box(slide, bx, y2, bw, bh, C.bg3, C.border);
  const fillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="20"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#00D4B0" stop-opacity="0.3"/><stop offset="100%" stop-color="#8A7CFF" stop-opacity="0.3"/></linearGradient></defs><rect width="400" height="20" fill="url(#g)"/></svg>`;
  slide.addImage({ data: `data:image/svg+xml;base64,${Buffer.from(fillSvg).toString('base64')}`, x: bx, y: y2, w: bw * 0.26, h: bh });
  slide.addText(t2, { x: bx + 0.05, y: y2 + 0.01, w: bw - 0.1, h: bh - 0.02, fontSize: 7, color: C.muted, fontFace: 'Arial', valign: 'middle' });
}

/** Benchmark rows (compact) */
function bmRows(slide, startY, lang = 'en') {
  const rows = lang === 'en'
    ? [
        { label: '~1 KB (small)',  pct: 83,   val: '−83%',   skip: false },
        { label: '~5 KB (medium)', pct: 95,   val: '−95%',   skip: false },
        { label: '~18 KB (large)', pct: 98.5, val: '−98.5%', skip: false },
        { label: '~50 KB (XL)',    pct: 99.4, val: '−99.4%', skip: false },
        { label: '~100 KB (XXL)',  pct: 99.9, val: '−99.9%', skip: false },
        { label: 'Average',        pct: 74,   val: '−74% → 3.9×', skip: false, avg: true },
      ]
    : [
        { label: '~1 KB (klein)',  pct: 83,   val: '−83%',    skip: false },
        { label: '~5 KB (mittel)', pct: 95,   val: '−95%',    skip: false },
        { label: '~18 KB (groß)',  pct: 98.5, val: '−98,5%',  skip: false },
        { label: '~50 KB (XL)',    pct: 99.4, val: '−99,4%',  skip: false },
        { label: '~100 KB (XXL)',  pct: 99.9, val: '−99,9%',  skip: false },
        { label: 'Durchschnitt',   pct: 74,   val: '−74% → 3,9×', skip: false, avg: true },
      ];

  const labelW = 1.2; const barX = 1.6; const barW = W - 3.0; const valW = 0.9;
  const rowH = 0.29;

  rows.forEach((r, i) => {
    const y = startY + i * (rowH + 0.04);
    if (r.avg) slide.addShape('line', { x: 0.35, y: y - 0.04, w: W - 0.7, h: 0, line: { color: C.border2, width: 0.75 } });
    slide.addText(r.label, { x: 0.35, y, w: labelW, h: rowH, fontSize: r.avg ? 9 : 8.5, bold: r.avg, color: r.avg ? C.text : C.muted, fontFace: 'Arial', valign: 'middle' });
    bmBar(slide, barX, y + 0.06, barW, rowH - 0.12, r.pct, r.skip);
    slide.addText(r.val, { x: barX + barW + 0.08, y, w: valW, h: rowH, fontSize: r.avg ? 10 : 8.5, bold: r.avg, color: r.avg ? C.blue : C.green, fontFace: 'Arial', align: 'right', valign: 'middle' });
  });
}

/** Cover slide */
function addCover(pres, eyebrow, title, subtitle, founders, stats, contact) {
  const slide = pres.addSlide();

  // gradient top bar
  const gradSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="10"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#00ffd5"/><stop offset="100%" stop-color="#8a7cff"/></linearGradient></defs><rect width="960" height="10" fill="url(#g)"/></svg>`;
  slide.addImage({ data: `data:image/svg+xml;base64,${Buffer.from(gradSvg).toString('base64')}`, x: 0, y: 0, w: W, h: 0.1 });

  slide.addText(eyebrow.toUpperCase(), { x: 0.55, y: 0.35, w: 5, h: 0.25, fontSize: 8, bold: true, color: C.blue, fontFace: 'Arial', charSpacing: 3 });

  // icon + title
  slide.addImage({ data: `data:image/svg+xml;base64,${ICON_B64}`, x: 0.55, y: 0.62, w: 0.55, h: 0.55 });
  slide.addText(title, { x: 1.18, y: 0.55, w: 5.5, h: 0.75, fontSize: 52, bold: true, color: C.blue, fontFace: 'Arial' });

  slide.addText(subtitle, { x: 0.55, y: 1.35, w: 6.2, h: 0.6, fontSize: 12, color: C.muted, fontFace: 'Arial', wrap: true });

  // rule
  const ruleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="6"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#00ffd5"/><stop offset="100%" stop-color="#8a7cff"/></linearGradient></defs><rect width="160" height="6" rx="3" fill="url(#g)"/></svg>`;
  slide.addImage({ data: `data:image/svg+xml;base64,${Buffer.from(ruleSvg).toString('base64')}`, x: 0.55, y: 2.05, w: 1.65, h: 0.07 });

  // founders
  founders.forEach((f, i) => {
    const x = 0.55 + i * 2.2;
    slide.addText(f.name, { x, y: 2.22, w: 2.1, h: 0.26, fontSize: 10.5, bold: true, color: C.text, fontFace: 'Arial' });
    slide.addText(f.role, { x, y: 2.46, w: 2.1, h: 0.22, fontSize: 8.5, color: C.muted, fontFace: 'Arial' });
  });

  // stats row
  const boxW = (W - 0.55 - 0.35) / stats.length;
  stats.forEach((s, i) => {
    const bx = 0.55 + i * boxW;
    const by = 2.92;
    const bh = 1.0;
    box(slide, bx, by, boxW - 0.05, bh, C.bg2, C.border);
    slide.addText(s.value, { x: bx + 0.12, y: by + 0.1, w: boxW - 0.3, h: 0.4, fontSize: 20, bold: true, color: C.blue, fontFace: 'Arial' });
    slide.addText(s.label, { x: bx + 0.12, y: by + 0.5, w: boxW - 0.3, h: 0.4, fontSize: 8, color: C.muted, fontFace: 'Arial', wrap: true });
  });

  // footer
  slide.addShape('line', { x: 0, y: H - 0.33, w: W, h: 0, line: { color: C.border, width: 0.75 } });
  slide.addText(contact, { x: 0.35, y: H - 0.28, w: 6, h: 0.22, fontSize: 7.5, color: C.faint, fontFace: 'Arial' });
  slide.addText('Confidential · 2026', { x: W - 1.8, y: H - 0.28, w: 1.5, h: 0.22, fontSize: 7.5, color: C.faint, fontFace: 'Arial', align: 'right' });
}

/** Page footer */
function footer(slide, label, pg, contact) {
  slide.addShape('line', { x: 0.35, y: H - 0.28, w: W - 0.7, h: 0, line: { color: C.border, width: 0.75 } });
  slide.addText(label, { x: 0.35, y: H - 0.22, w: 3.5, h: 0.18, fontSize: 7, color: C.faint, fontFace: 'Arial' });
  slide.addText(contact, { x: 3.5, y: H - 0.22, w: 4, h: 0.18, fontSize: 7, color: C.faint, fontFace: 'Arial', align: 'center' });
  slide.addText(String(pg), { x: W - 1.5, y: H - 0.22, w: 1.2, h: 0.18, fontSize: 7, color: C.faint, fontFace: 'Arial', align: 'right' });
}

const CONTACT = 'edgar.baumann@try-mesh.com · philipp.horn@try-mesh.com';
const FOUNDERS_EN = [{ name: 'Edgar Baumann', role: 'Co-Founder · WU Wien' }, { name: 'Philipp Horn', role: 'Co-Founder · WHU' }];
const FOUNDERS_DE = [{ name: 'Edgar Baumann', role: 'Co-Founder · WU Wien' }, { name: 'Philipp Horn', role: 'Co-Founder · WHU' }];
const STATS_MAIN    = [{ value: '74%', label: 'avg token reduction (Capsule)' }, { value: '3.9×', label: 'more codebase per context window' }, { value: '€500k', label: 'seed ask · 18mo runway' }];
const STATS_MAIN_DE = [{ value: '74%', label: 'Ø Token-Reduktion (Capsule)' }, { value: '3,9×', label: 'mehr Codebasis pro Kontextfenster' }, { value: '€500k', label: 'Seed · 18 Monate Runway' }];
const STATS_TECH    = [{ value: '74%', label: 'avg token reduction' }, { value: '3.9×', label: 'context gain per 128k window' }, { value: '$3.90', label: 'vs $15.00/MTok · Claude Opus 4.6' }];
const STATS_TECH_DE = [{ value: '74%', label: 'Ø Token-Reduktion' }, { value: '3,9×', label: 'Kontextgewinn im 128k-Fenster' }, { value: '$3,90', label: 'vs $15,00/MTok · Claude Opus 4.6' }];

// ─────────────────────────────────────────────────────────────
// PITCH DECK — ENGLISH
// ─────────────────────────────────────────────────────────────
function buildPitchDeckEN() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  addCover(pres, 'Seed Round · 2026', 'Mesh.', 'The AI-native coding environment — web app & desktop.\nVoice-driven. Compression-first.', FOUNDERS_EN, STATS_MAIN, CONTACT);

  // ── Problem ──────────────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Problem');
    label(s, 'The Problem', 0.68);
    h1(s, 'AI coding tools are hitting a wall — and it\'s called context.', 0.88, { size: 18 });
    bullets(s, [
      { text: 'AI assistants hallucinate', bold: true }, ' because they only see a fraction of the codebase at once',
      { text: 'API costs explode', bold: true }, ' as teams load more code — paying for tokens, not for answers',
      { text: 'Large files are the worst offenders', bold: true }, ' — a single 50 KB module fills most of a 128k window',
      { text: 'Voice is completely untapped', bold: true }, ' — developers still type every command',
    ].reduce((acc, item, i, arr) => {
      if (typeof item === 'object' && item.bold) {
        acc.push({ text: item.text + (typeof arr[i + 1] === 'string' ? arr[i + 1] : ''), bold: true });
      } else if (typeof item === 'string' && i > 0 && typeof arr[i - 1] === 'object') {
        // already merged above
      } else if (typeof item === 'string') {
        acc.push({ text: item });
      }
      return acc;
    }, []),
    0.35, 1.62, W - 0.7, 1.4);
    // simpler approach for bullets:
    s.addText([
      { text: 'AI assistants hallucinate', options: { bold: true, color: C.text } },
      { text: ' because they only see a fraction of the codebase at once\n', options: { color: C.muted } },
      { text: 'API costs explode', options: { bold: true, color: C.text } },
      { text: ' as teams load more code — paying for tokens, not for answers\n', options: { color: C.muted } },
      { text: 'Large files are the worst offenders', options: { bold: true, color: C.text } },
      { text: ' — a 50 KB module fills most of a 128k window\n', options: { color: C.muted } },
      { text: 'Voice is completely untapped', options: { bold: true, color: C.text } },
      { text: ' — developers still type every command, even when speaking is faster', options: { color: C.muted } },
    ], { x: 0.35, y: 1.62, w: W - 0.7, h: 1.4, fontSize: 9.5, fontFace: 'Arial', bullet: { indent: 10 }, wrap: true });
    callout(s, 'Sending raw code to an LLM is like faxing a dictionary to answer one question. 99% noise. 1% signal. You pay for both.', 3.2);
    footer(s, 'Mesh — Pitch Deck 2026', 2, CONTACT);
  }

  // ── Solution ─────────────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Solution');
    label(s, 'The Solution', 0.68);
    h1(s, 'One environment. Full context. Voice + AI.', 0.88, { size: 18 });
    body(s, 'Mesh combines three capabilities no other tool has together — as a web app and desktop app.', 0.35, 1.38, W - 0.7, 0.35, { size: 9.5 });
    statBox(s, 0.35, 1.82, 2.95, 1.3, '74%', 'Capsule Compression', '3.9× more codebase per context window · 75% lower API costs · better accuracy');
    statBox(s, 3.4,  1.82, 2.95, 1.3, '⌨',   'Unified Workbench', 'Editor + Terminal + AI chat + Dependency Graph — one surface, zero context switching');
    statBox(s, 6.45, 1.82, 3.2,  1.3, '🎙',   'Voice-Driven Agent', 'Speak your intent. Mesh reads compressed codebase context, generates changes, explains them');
    callout(s, 'The only tool that solves context, cost, and workflow at the same time.', 3.28, 0.48);
    footer(s, 'Mesh — Pitch Deck 2026', 3, CONTACT);
  }

  // ── Compression Engine ────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Compression Engine');
    label(s, 'The Technology', 0.68);
    h1(s, 'The engine that makes everything else possible.', 0.88, { size: 17 });

    h2(s, 'Why context quality matters — independent benchmarks', 1.42);

    // NIAH
    s.addText('A — NIAH', { x: 0.35, y: 1.82, w: 2.5, h: 0.22, fontSize: 9, bold: true, color: C.text, fontFace: 'Arial' });
    body(s, 'Models degrade at >60–70% context utilization ("Lost in the Middle" — Liu et al. 2023). Retrieval accuracy drops 20–40% at 100k+ tokens. Capsule keeps utilization low regardless of codebase size.', 0.35, 2.03, W - 0.7, 0.45, { size: 8.5 });
    ctxVisual(s, 2.55);

    // SWE-bench
    s.addText('B — SWE-bench', { x: 0.35, y: 3.14, w: 2.5, h: 0.22, fontSize: 9, bold: true, color: C.text, fontFace: 'Arial' });
    body(s, 'Top agents solve ~40–55% of real GitHub issues. The leading failure mode: insufficient codebase context. More files in context = fewer failures from missing information.', 0.35, 3.35, W - 0.7, 0.44, { size: 8.5 });

    footer(s, 'Mesh — Pitch Deck 2026', 4, CONTACT);
  }

  // ── Benchmarks ────────────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Capsule Benchmarks');
    label(s, 'C — Internal Benchmarks', 0.68);
    h1(s, 'Real production numbers. 5 file types · 6 size tiers.', 0.88, { size: 17 });

    // column headers
    s.addText('File size', { x: 0.35, y: 1.42, w: 1.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial' });
    s.addText('Token reduction', { x: 1.6, y: 1.42, w: W - 3.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial' });
    s.addText('Saving', { x: W - 1.1, y: 1.42, w: 0.8, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial', align: 'right' });
    s.addShape('line', { x: 0.35, y: 1.62, w: W - 0.7, h: 0, line: { color: C.border2, width: 0.75 } });

    bmRows(s, 1.66, 'en');

    footer(s, 'Mesh — Pitch Deck 2026', 5, CONTACT);
  }

  // ── Product ───────────────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Product');
    label(s, 'Product', 0.68);
    h1(s, 'Built for the way developers actually think.', 0.88, { size: 18 });
    body(s, 'Three surfaces, one flow. Web app + desktop — no install required for the web version.', 0.35, 1.38, W - 0.7, 0.3);
    table(s,
      ['Surface', 'What it does'],
      [
        ['Editor', 'Monaco-based editor with AI chat, file explorer, live dependency graph, and workspace intelligence sidebar. The AI knows your entire codebase before you ask — compressed, indexed, always current.'],
        ['Terminal', 'Dedicated workspace — not a bottom panel but a full surface. Runs alongside the editor without losing context.'],
        ['Voice-Coding', 'Speech-driven agent. Say "refactor the auth middleware to use JWT" — Mesh reads the files via Capsule, generates the change, explains it.'],
      ],
      0.35, 1.72, W - 0.7, [1.3, W - 1.65], { boldCol: 0, rowH: 0.4 }
    );
    h2(s, 'Key differentiators', 3.22);
    s.addText([
      { text: 'Capsule compression', options: { bold: true, color: C.text } }, { text: ' — 74% fewer tokens, same intelligence, 75% lower API cost\n', options: { color: C.muted } },
      { text: 'Live dependency graph', options: { bold: true, color: C.text } }, { text: ' — updates in real time as code changes\n', options: { color: C.muted } },
      { text: 'Multi-model', options: { bold: true, color: C.text } }, { text: ' — Claude, Gemini, GPT — no provider lock-in', options: { color: C.muted } },
    ], { x: 0.35, y: 3.48, w: W - 0.7, h: 0.65, fontSize: 8.5, fontFace: 'Arial', bullet: { indent: 8 }, wrap: true });
    footer(s, 'Mesh — Pitch Deck 2026', 6, CONTACT);
  }

  // ── Market ────────────────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Market');
    label(s, 'Market Opportunity', 0.68);
    h1(s, 'Every developer is a potential user.', 0.88, { size: 18 });
    statBox(s, 0.35, 1.32, 3.0, 1.1, '$28B', 'TAM', 'Global developer tools market (2024, 12% CAGR)');
    statBox(s, 3.45, 1.32, 3.0, 1.1, '$4.2B', 'SAM', 'AI-enhanced IDE / coding assistant segment (2025)');
    statBox(s, 6.55, 1.32, 3.1, 1.1, '$120M', 'SOM (3yr)', 'Indie devs + small teams, Europe + North America');
    h2(s, 'Why now', 2.56);
    s.addText([
      { text: 'LLMs crossed the threshold where voice-to-code is genuinely usable\n', options: { color: C.muted } },
      { text: 'Cursor proved developers pay for AI-native editors', options: { bold: true, color: C.text } }, { text: ' — ~$400M ARR in 2 years at $20/month\n', options: { color: C.muted } },
      { text: 'API costs are a real budget line item', options: { bold: true, color: C.text } }, { text: ' — compression has measurable ROI\n', options: { color: C.muted } },
      { text: 'Green tech pressure', options: { bold: true, color: C.text } }, { text: ': enterprises track and report AI energy spend', options: { color: C.muted } },
    ], { x: 0.35, y: 2.82, w: W - 0.7, h: 1.2, fontSize: 9, fontFace: 'Arial', bullet: { indent: 8 }, wrap: true });
    footer(s, 'Mesh — Pitch Deck 2026', 7, CONTACT);
  }

  // ── Competition ───────────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Competition');
    label(s, 'Competitive Landscape', 0.68);
    h1(s, 'We\'re not an extension. We\'re the environment.', 0.88, { size: 18 });
    table(s,
      ['', 'Mesh', 'VS Code + Copilot', 'Cursor', 'Google Antigravity'],
      [
        ['Voice-driven coding agent',    '✓', '✗', 'STT only ²', '✗'],
        ['Structural token compression', '✓', '✗', '✗',          '✗'],
        ['Whole-codebase AI context',    '✓', 'Partial ¹', 'Partial ¹', 'Partial ¹'],
        ['Web app (no install)',          '✓', 'Partial ³', '✗',        '✗'],
        ['AI-native architecture',       '✓', '✗ (retro)', '✓',        '✓'],
        ['Multi-model',                  '✓', '✓',         '✓',        '✓'],
      ],
      0.35, 1.38, W - 0.7, [2.5, 1.0, 1.7, 1.3, 2.0], { rowH: 0.3 }
    );
    s.addText('¹ Embedding retrieval — finds relevant files, sends them raw  ² Cursor has STT dictation into chat box — not a voice coding agent  ³ VS Code for the Web has no terminal or debugger',
      { x: 0.35, y: 3.68, w: W - 0.7, h: 0.28, fontSize: 7, color: C.faint, fontFace: 'Arial' });
    callout(s, 'All three retrieve code with embeddings and send it raw — cost scales with codebase size. Capsule compresses before the model sees it — cost stays flat.', 4.02, 0.48);
    footer(s, 'Mesh — Pitch Deck 2026', 8, CONTACT);
  }

  // ── Business Model ────────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Business Model');
    label(s, 'Business Model', 0.68);
    h1(s, 'Freemium → Pro → Teams', 0.88, { size: 18 });

    const cards = [
      { tier: 'FREE', price: '€0', period: 'forever', features: ['Full editor + terminal', 'AI chat (limited req/mo)', 'Basic workspace indexing'], featured: false },
      { tier: 'PRO — most popular', price: '€19', period: 'per month', features: ['Unlimited AI requests', 'Full Capsule compression', 'Voice-coding agent', 'Priority model access'], featured: true },
      { tier: 'TEAMS', price: '€49', period: 'per seat / month', features: ['Everything in Pro', 'Shared workspace intelligence', 'Team codebase context', 'Admin controls + analytics'], featured: false },
    ];
    cards.forEach((c, i) => {
      const cx = 0.35 + i * 3.15;
      const cw = 3.0; const ch = 2.65;
      box(s, cx, 1.38, cw, ch, c.featured ? C.blueLt : C.white, c.featured ? C.blue : C.border);
      s.addText(c.tier, { x: cx + 0.12, y: 1.5, w: cw - 0.24, h: 0.22, fontSize: 7, bold: true, color: C.blue, fontFace: 'Arial' });
      s.addText(c.price, { x: cx + 0.12, y: 1.7, w: cw - 0.24, h: 0.45, fontSize: 22, bold: true, color: C.text, fontFace: 'Arial' });
      s.addText(c.period, { x: cx + 0.12, y: 2.14, w: cw - 0.24, h: 0.22, fontSize: 8, color: C.muted, fontFace: 'Arial' });
      c.features.forEach((f, fi) => {
        s.addText('– ' + f, { x: cx + 0.12, y: 2.4 + fi * 0.26, w: cw - 0.24, h: 0.24, fontSize: 8.5, color: C.muted, fontFace: 'Arial' });
      });
    });

    callout(s, 'Cursor charges $20/month and crossed $400M ARR. Mesh saves time and API costs — a double value proposition.', 4.1, 0.48);
    footer(s, 'Mesh — Pitch Deck 2026', 9, CONTACT);
  }

  // ── Traction + Team ───────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Traction & Team');
    label(s, 'Traction', 0.68);
    h1(s, 'Early stage — real foundation.', 0.88, { size: 17 });
    s.addText([
      { text: 'MVP complete', options: { bold: true, color: C.text } }, { text: ' — Editor, Terminal, and Voice-Coding surfaces are fully functional\n', options: { color: C.muted } },
      { text: 'Capsule pipeline live and benchmarked', options: { bold: true, color: C.text } }, { text: ' — 74% average token reduction across all file types\n', options: { color: C.muted } },
      { text: 'Architecture built for scale', options: { bold: true, color: C.text } }, { text: ' — gateway/worker split, multi-provider AI, horizontal scaling', options: { color: C.muted } },
    ], { x: 0.35, y: 1.38, w: W - 0.7, h: 0.8, fontSize: 9, fontFace: 'Arial', bullet: { indent: 8 }, wrap: true });

    box(s, 0.35, 2.28, W - 0.7, 0.75, C.bg2, C.border2);
    s.addText('NEXT MILESTONE', { x: 0.5, y: 2.36, w: 3, h: 0.2, fontSize: 7, bold: true, color: C.blue, fontFace: 'Arial' });
    s.addText('First 100 beta users', { x: 0.5, y: 2.55, w: W - 1, h: 0.28, fontSize: 12, bold: true, color: C.text, fontFace: 'Arial' });
    s.addText('Measure retention, voice engagement, and real-world token savings to validate the core thesis', { x: 0.5, y: 2.82, w: W - 1, h: 0.18, fontSize: 8, color: C.muted, fontFace: 'Arial' });

    h2(s, 'Team', 3.16);
    // team cards
    [[0.35, 'Edgar Baumann', 'Co-Founder · WU Wien', 'Built Mesh end-to-end — architecture, compression pipeline, voice agent, and frontend.'],
     [5.1,  'Philipp Horn',  'Co-Founder · WHU',      'Strong entrepreneurial instinct — business strategy, GTM, and growth.']
    ].forEach(([x, name, title, detail]) => {
      box(s, x, 3.42, 4.6, 0.88, C.bg2, C.border);
      s.addText(name,   { x: x + 0.12, y: 3.5,  w: 4.3, h: 0.26, fontSize: 10.5, bold: true, color: C.text, fontFace: 'Arial' });
      s.addText(title,  { x: x + 0.12, y: 3.74, w: 4.3, h: 0.2,  fontSize: 8.5, color: C.blue, bold: true, fontFace: 'Arial' });
      s.addText(detail, { x: x + 0.12, y: 3.93, w: 4.3, h: 0.3,  fontSize: 8.5, color: C.muted, fontFace: 'Arial', wrap: true });
    });
    footer(s, 'Mesh — Pitch Deck 2026', 10, CONTACT);
  }

  // ── Vision + Ask ──────────────────────────────────────────────
  {
    const s = pres.addSlide();
    slideHeader(s, 'Vision & The Ask');
    label(s, 'Vision', 0.68);
    h1(s, 'In 5 years, sending raw code to an AI will seem as wasteful as printing emails.', 0.88, { size: 15 });

    table(s,
      ['Horizon', 'Goal'],
      [
        ['12 months', '1,000 paying Pro users · Capsule as the industry reference benchmark · first team accounts'],
        ['24 months', '10,000 users · Series A · open Capsule SDK for third-party integrations'],
        ['5 years',   'The default environment for developers who think faster than they type — plus a compression infrastructure layer powering other AI tools'],
      ],
      0.35, 1.58, W - 0.7, [1.3, W - 1.65], { rowH: 0.35 }
    );

    label(s, 'Seed Round', 2.78);
    h1(s, '€500,000 · 18-month runway to PMF', 2.94, { size: 16 });

    // funds bar
    const barY = 3.46; const barH = 0.3; const barX = 0.35; const barTotalW = W - 0.7;
    [
      { w: 0.55, color: '005FB8', label: '55%' },
      { w: 0.25, color: '1A73E8', label: '25%' },
      { w: 0.15, color: '4A90D9', label: '15%' },
      { w: 0.05, color: '7DB3E8', label: '5%' },
    ].reduce((x, seg) => {
      box(s, x, barY, barTotalW * seg.w, barH, seg.color, seg.color);
      s.addText(seg.label, { x, y: barY, w: barTotalW * seg.w, h: barH, fontSize: 7.5, bold: true, color: C.white, fontFace: 'Arial', align: 'center', valign: 'middle' });
      return x + barTotalW * seg.w;
    }, barX);

    s.addText([
      { text: '● Engineering', options: { bold: true, color: '005FB8' } }, { text: ' 2 senior engineers, voice pipeline + Capsule v2   ', options: { color: C.muted } },
      { text: '● Growth', options: { bold: true, color: '1A73E8' } }, { text: ' developer marketing, OSS   ', options: { color: C.muted } },
      { text: '● Infrastructure', options: { bold: true, color: '4A90D9' } }, { text: ' AI inference at scale   ', options: { color: C.muted } },
      { text: '● Operations', options: { bold: true, color: '7DB3E8' } }, { text: ' legal, tools', options: { color: C.muted } },
    ], { x: 0.35, y: 3.85, w: W - 0.7, h: 0.4, fontSize: 8, fontFace: 'Arial', wrap: true });

    s.addText(CONTACT + ' · Demo available on request', { x: 0.35, y: 4.35, w: W - 0.7, h: 0.22, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'center' });
    footer(s, 'Mesh — Pitch Deck 2026', 11, CONTACT);
  }

  return pres;
}

// ─────────────────────────────────────────────────────────────
// PITCH DECK — GERMAN
// ─────────────────────────────────────────────────────────────
function buildPitchDeckDE() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  addCover(pres, 'Seed-Runde · 2026', 'Mesh.', 'Die KI-native Entwicklungsumgebung — Web-App & Desktop.\nSprachgesteuert. Kompression als Kern.', FOUNDERS_DE, STATS_MAIN_DE, CONTACT);

  { const s = pres.addSlide(); slideHeader(s, 'Problem');
    label(s, 'Das Problem', 0.68);
    h1(s, 'KI-Coding-Tools stoßen an eine Wand — und die heißt Kontext.', 0.88, { size: 17 });
    s.addText([
      { text: 'KI-Assistenten halluzinieren', options: { bold: true, color: C.text } }, { text: ', weil sie immer nur einen Bruchteil der Codebasis sehen können\n', options: { color: C.muted } },
      { text: 'API-Kosten explodieren', options: { bold: true, color: C.text } }, { text: ', wenn Teams mehr Code laden — bezahlt wird für Tokens, nicht für Antworten\n', options: { color: C.muted } },
      { text: 'Große Dateien sind das Hauptproblem', options: { bold: true, color: C.text } }, { text: ' — ein 50-KB-Modul füllt fast ein 128k-Kontextfenster\n', options: { color: C.muted } },
      { text: 'Voice bleibt ungenutzt', options: { bold: true, color: C.text } }, { text: ' — Entwickler tippen jeden Befehl, obwohl Sprechen dreimal so schnell wäre', options: { color: C.muted } },
    ], { x: 0.35, y: 1.62, w: W - 0.7, h: 1.4, fontSize: 9.5, fontFace: 'Arial', bullet: { indent: 10 }, wrap: true });
    callout(s, 'Rohen Code an ein LLM schicken ist wie ein Wörterbuch per Fax zu verschicken — du bezahlst für 99 % Rauschen und bekommst 1 % Signal.', 3.2);
    footer(s, 'Mesh — Pitch Deck 2026', 2, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Lösung');
    label(s, 'Die Lösung', 0.68);
    h1(s, 'Eine Umgebung. Voller Kontext. Voice + KI.', 0.88, { size: 18 });
    body(s, 'Mesh verbindet drei Dinge, die kein anderes Tool in dieser Kombination bietet — als Web-App und Desktop-App.', 0.35, 1.38, W - 0.7, 0.35, { size: 9.5 });
    statBox(s, 0.35, 1.82, 2.95, 1.3, '74%', 'Capsule-Kompression', '3,9× mehr Codebasis pro Kontextfenster · 75 % niedrigere API-Kosten · bessere Genauigkeit');
    statBox(s, 3.4,  1.82, 2.95, 1.3, '⌨',   'Unified Workbench', 'Editor + Terminal + KI-Chat + Dependency Graph — eine Oberfläche, kein Kontextwechsel');
    statBox(s, 6.45, 1.82, 3.2,  1.3, '🎙',   'Voice-Driven Agent', 'Absicht aussprechen. Mesh liest den komprimierten Codebase-Kontext, generiert Änderungen und erklärt sie');
    callout(s, 'Das einzige Tool, das Kontext, Kosten und Workflow gleichzeitig löst.', 3.28, 0.48);
    footer(s, 'Mesh — Pitch Deck 2026', 3, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Kompressionsmaschine');
    label(s, 'Die Technologie', 0.68);
    h1(s, 'Die Maschine, die alles andere erst möglich macht.', 0.88, { size: 17 });
    h2(s, 'Warum Kontextqualität entscheidend ist', 1.42);
    s.addText('A — NIAH (Needle In A Haystack)', { x: 0.35, y: 1.82, w: W - 0.7, h: 0.22, fontSize: 9, bold: true, color: C.text, fontFace: 'Arial' });
    body(s, 'Modelle verschlechtern sich stark ab ~60–70 % Auslastung (Liu et al. 2023). Abrufgenauigkeit sinkt um 20–40 % bei 100k+ Tokens. Capsule hält die Auslastung unabhängig von der Codebase-Größe niedrig.', 0.35, 2.03, W - 0.7, 0.45, { size: 8.5 });
    ctxVisual(s, 2.55, 'de');
    s.addText('B — SWE-bench', { x: 0.35, y: 3.14, w: W - 0.7, h: 0.22, fontSize: 9, bold: true, color: C.text, fontFace: 'Arial' });
    body(s, 'Spitzenmodelle lösen ~40–55 % echter GitHub-Issues. Der häufigste Ausfallgrund: zu wenig Codebase-Kontext. Mehr Dateien im Kontext = weniger Fehler durch fehlende Informationen.', 0.35, 3.35, W - 0.7, 0.44, { size: 8.5 });
    footer(s, 'Mesh — Pitch Deck 2026', 4, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Capsule Benchmarks');
    label(s, 'C — Interne Benchmarks', 0.68);
    h1(s, 'Echte Produktionszahlen. 5 Dateitypen · 6 Größenkategorien.', 0.88, { size: 16 });
    s.addText('Dateigröße', { x: 0.35, y: 1.42, w: 1.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial' });
    s.addText('Token-Reduktion', { x: 1.6, y: 1.42, w: W - 3.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial' });
    s.addText('Einsparung', { x: W - 1.1, y: 1.42, w: 0.8, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial', align: 'right' });
    s.addShape('line', { x: 0.35, y: 1.62, w: W - 0.7, h: 0, line: { color: C.border2, width: 0.75 } });
    bmRows(s, 1.66, 'de');
    footer(s, 'Mesh — Pitch Deck 2026', 5, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Produkt');
    label(s, 'Produkt', 0.68);
    h1(s, 'Gebaut für die Art, wie Entwickler wirklich denken.', 0.88, { size: 18 });
    body(s, 'Drei Oberflächen, ein durchgängiger Flow. Web-App + Desktop — die Web-Version braucht keine Installation.', 0.35, 1.38, W - 0.7, 0.3);
    table(s,
      ['Oberfläche', 'Was sie leistet'],
      [
        ['Editor', 'Monaco-Editor mit KI-Chat-Panel, Datei-Explorer, Live-Dependency-Graph und Workspace-Intelligence-Sidebar. Die KI kennt die gesamte Codebasis, bevor die erste Frage gestellt wird.'],
        ['Terminal', 'Eigenständiger Workspace — kein Randpanel, sondern eine vollwertige Oberfläche. Läuft neben dem Editor, ohne Kontext zu verlieren.'],
        ['Voice-Coding', 'Sprachgesteuerter Agent. Sag "Auth-Middleware auf JWT umbauen" — Mesh liest die relevanten Dateien, generiert die Änderung und erklärt sie.'],
      ],
      0.35, 1.72, W - 0.7, [1.3, W - 1.65], { boldCol: 0, rowH: 0.4 }
    );
    h2(s, 'Was Mesh einzigartig macht', 3.22);
    s.addText([
      { text: 'Capsule-Kompression', options: { bold: true, color: C.text } }, { text: ' — 74 % weniger Tokens, gleiche Intelligenz, 75 % niedrigere API-Kosten\n', options: { color: C.muted } },
      { text: 'Live-Dependency-Graph', options: { bold: true, color: C.text } }, { text: ' — aktualisiert sich in Echtzeit bei jeder Codeänderung\n', options: { color: C.muted } },
      { text: 'Multi-Modell', options: { bold: true, color: C.text } }, { text: ' — Claude, Gemini, GPT — kein Provider-Lock-in', options: { color: C.muted } },
    ], { x: 0.35, y: 3.48, w: W - 0.7, h: 0.65, fontSize: 8.5, fontFace: 'Arial', bullet: { indent: 8 }, wrap: true });
    footer(s, 'Mesh — Pitch Deck 2026', 6, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Markt');
    label(s, 'Marktchance', 0.68);
    h1(s, 'Jeder Entwickler ist ein potenzieller Nutzer.', 0.88, { size: 18 });
    statBox(s, 0.35, 1.32, 3.0, 1.1, '$28 Mrd.', 'TAM', 'Globaler Entwicklertools-Markt (2024, 12 % CAGR)');
    statBox(s, 3.45, 1.32, 3.0, 1.1, '$4,2 Mrd.', 'SAM', 'KI-gestützte IDEs & Coding-Assistants (2025)');
    statBox(s, 6.55, 1.32, 3.1, 1.1, '$120 Mio.', 'SOM (3 Jahre)', 'Indie-Devs + kleine Teams, Europa + Nordamerika');
    h2(s, 'Warum jetzt', 2.56);
    s.addText([
      { text: 'LLMs sind erstmals gut genug für echtes Voice-to-Code\n', options: { color: C.muted } },
      { text: 'Cursor hat bewiesen, dass Entwickler zahlen', options: { bold: true, color: C.text } }, { text: ' — ~$400 Mio. ARR in zwei Jahren bei $20/Monat\n', options: { color: C.muted } },
      { text: 'API-Kosten stehen in Dev-Budgets', options: { bold: true, color: C.text } }, { text: ' — Kompression hat messbaren ROI\n', options: { color: C.muted } },
      { text: 'Green-Tech-Anforderungen wachsen', options: { bold: true, color: C.text } }, { text: ': Unternehmen berichten KI-Energieverbrauch zunehmend', options: { color: C.muted } },
    ], { x: 0.35, y: 2.82, w: W - 0.7, h: 1.2, fontSize: 9, fontFace: 'Arial', bullet: { indent: 8 }, wrap: true });
    footer(s, 'Mesh — Pitch Deck 2026', 7, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Wettbewerb');
    label(s, 'Wettbewerbslandschaft', 0.68);
    h1(s, 'Kein Plugin. Die Umgebung.', 0.88, { size: 18 });
    table(s,
      ['', 'Mesh', 'VS Code + Copilot', 'Cursor', 'Google Antigravity'],
      [
        ['Voice-Coding-Agent',            '✓', '✗', 'Nur STT ²', '✗'],
        ['Strukturelle Kompression',      '✓', '✗', '✗',         '✗'],
        ['Vollständiger Codebase-Kontext','✓', 'Teilweise ¹', 'Teilweise ¹', 'Teilweise ¹'],
        ['Web-App (keine Installation)',   '✓', 'Teilweise ³', '✗',          '✗'],
        ['KI-nativ von Grund auf',         '✓', '✗ (nachger.)', '✓',         '✓'],
        ['Multi-Modell',                   '✓', '✓',           '✓',          '✓'],
      ],
      0.35, 1.38, W - 0.7, [2.5, 1.0, 1.7, 1.3, 2.0], { rowH: 0.3 }
    );
    s.addText('¹ Embedding-Retrieval — sendet Dateien roh  ² Cursor hat STT-Diktat in Chat-Box — kein Voice-Coding-Agent  ³ VS Code for the Web hat kein Terminal und keinen Debugger',
      { x: 0.35, y: 3.68, w: W - 0.7, h: 0.28, fontSize: 7, color: C.faint, fontFace: 'Arial' });
    callout(s, 'Alle drei rufen Code per Embeddings ab und senden ihn roh — Kosten skalieren mit der Codebase-Größe. Capsule komprimiert, bevor das Modell etwas sieht — Kosten bleiben konstant.', 4.02, 0.48);
    footer(s, 'Mesh — Pitch Deck 2026', 8, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Business-Modell');
    label(s, 'Business-Modell', 0.68);
    h1(s, 'Freemium → Pro → Teams', 0.88, { size: 18 });
    const cards = [
      { tier: 'FREE', price: '€0', period: 'dauerhaft', features: ['Vollständiger Editor + Terminal', 'KI-Chat (begrenzte Anfragen/Mo)', 'Basis-Workspace-Indexierung'], featured: false },
      { tier: 'PRO — meistgewählt', price: '€19', period: 'pro Monat', features: ['Unbegrenzte KI-Anfragen', 'Volle Capsule-Kompression', 'Voice-Coding-Agent', 'Bevorzugter Modellzugang'], featured: true },
      { tier: 'TEAMS', price: '€49', period: 'pro Seat / Monat', features: ['Alles aus Pro', 'Geteilte Workspace-Intelligenz', 'Team-weiter Codebase-Kontext', 'Admin-Controls + Analytics'], featured: false },
    ];
    cards.forEach((c, i) => {
      const cx = 0.35 + i * 3.15; const cw = 3.0; const ch = 2.65;
      box(s, cx, 1.38, cw, ch, c.featured ? C.blueLt : C.white, c.featured ? C.blue : C.border);
      s.addText(c.tier, { x: cx + 0.12, y: 1.5, w: cw - 0.24, h: 0.22, fontSize: 7, bold: true, color: C.blue, fontFace: 'Arial' });
      s.addText(c.price, { x: cx + 0.12, y: 1.7, w: cw - 0.24, h: 0.45, fontSize: 22, bold: true, color: C.text, fontFace: 'Arial' });
      s.addText(c.period, { x: cx + 0.12, y: 2.14, w: cw - 0.24, h: 0.22, fontSize: 8, color: C.muted, fontFace: 'Arial' });
      c.features.forEach((f, fi) => {
        s.addText('– ' + f, { x: cx + 0.12, y: 2.4 + fi * 0.26, w: cw - 0.24, h: 0.24, fontSize: 8.5, color: C.muted, fontFace: 'Arial' });
      });
    });
    callout(s, 'Cursor: $20/Monat, $400 Mio. ARR. Mesh spart Zeit und API-Kosten — ein doppeltes Wertversprechen, das im Team-Tier noch stärker wirkt.', 4.1, 0.48);
    footer(s, 'Mesh — Pitch Deck 2026', 9, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Traction · Team · Forderung');
    label(s, 'Traction', 0.68);
    h1(s, 'Frühphase — stabiles Fundament.', 0.88, { size: 16 });
    s.addText([
      { text: 'MVP vollständig funktionsfähig', options: { bold: true, color: C.text } }, { text: ' — Editor, Terminal und Voice-Coding laufen produktionsreif\n', options: { color: C.muted } },
      { text: 'Capsule live und gemessen', options: { bold: true, color: C.text } }, { text: ' — 74 % Ø Token-Reduktion über alle Dateitypen und -größen\n', options: { color: C.muted } },
      { text: 'Skalierbare Architektur', options: { bold: true, color: C.text } }, { text: ' — Gateway/Worker-Split, Multi-Provider-KI, horizontale Skalierung', options: { color: C.muted } },
    ], { x: 0.35, y: 1.38, w: W - 0.7, h: 0.7, fontSize: 9, fontFace: 'Arial', bullet: { indent: 8 }, wrap: true });
    box(s, 0.35, 2.18, W - 0.7, 0.68, C.bg2, C.border2);
    s.addText('NÄCHSTER MEILENSTEIN', { x: 0.5, y: 2.26, w: 4, h: 0.2, fontSize: 7, bold: true, color: C.blue, fontFace: 'Arial' });
    s.addText('Erste 100 Beta-Nutzer', { x: 0.5, y: 2.44, w: W - 1, h: 0.28, fontSize: 12, bold: true, color: C.text, fontFace: 'Arial' });
    s.addText('Retention, Voice-Engagement und reale Token-Einsparungen messen', { x: 0.5, y: 2.7, w: W - 1, h: 0.16, fontSize: 8, color: C.muted, fontFace: 'Arial' });
    h2(s, 'Team', 2.98);
    [[0.35, 'Edgar Baumann', 'Co-Founder · WU Wien', 'Hat Mesh von Grund auf gebaut — Architektur, Kompressionspipeline, Voice-Agent und Frontend.'],
     [5.1,  'Philipp Horn',  'Co-Founder · WHU',      'Ausgeprägtes unternehmerisches Denken — Strategie, Go-to-Market und Wachstum.']
    ].forEach(([x, name, title, detail]) => {
      box(s, x, 3.24, 4.6, 0.85, C.bg2, C.border);
      s.addText(name,   { x: x + 0.12, y: 3.3,  w: 4.3, h: 0.26, fontSize: 10.5, bold: true, color: C.text, fontFace: 'Arial' });
      s.addText(title,  { x: x + 0.12, y: 3.54, w: 4.3, h: 0.2,  fontSize: 8.5, color: C.blue, bold: true, fontFace: 'Arial' });
      s.addText(detail, { x: x + 0.12, y: 3.73, w: 4.3, h: 0.32, fontSize: 8.5, color: C.muted, fontFace: 'Arial', wrap: true });
    });
    h2(s, 'Seed-Runde', 4.18);
    s.addText('€500.000 · 18 Monate Runway', { x: 0.35, y: 4.44, w: W - 0.7, h: 0.3, fontSize: 13, bold: true, color: C.text, fontFace: 'Arial' });
    footer(s, 'Mesh — Pitch Deck 2026', 10, CONTACT); }

  return pres;
}

// ─────────────────────────────────────────────────────────────
// ONE-PAGER — ENGLISH
// ─────────────────────────────────────────────────────────────
function buildOnePagerEN() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  const s = pres.addSlide();
  slideHeader(s, 'Executive Summary');
  label(s, 'Executive Summary', 0.68);
  h1(s, 'The AI-native coding environment built around voice and workspace intelligence.', 0.88, { size: 15 });

  statBox(s, 0.35, 1.38, 3.0, 0.95, '74%', null, 'avg token reduction via Capsule compression');
  statBox(s, 3.45, 1.38, 3.0, 0.95, '3.9×', null, 'more codebase per context window');
  statBox(s, 6.55, 1.38, 3.1, 0.95, '€500k', null, 'seed ask · 18-month runway to PMF');

  h2(s, 'Problem & Solution', 2.44);
  body(s, 'AI coding tools are hitting a wall: context windows are finite, real codebases are not. Teams pay for tokens, not value. Mesh is built on Capsule — a structural compression pipeline that cuts token usage by 74% on average. The only tool that solves context, cost, and workflow simultaneously.', 0.35, 2.7, W - 0.7, 0.5);

  h2(s, 'Product', 3.3);
  table(s,
    ['Surface', 'What it does'],
    [
      ['Editor', 'Monaco + AI chat + live dependency graph + workspace intelligence'],
      ['Terminal', 'Dedicated workspace, not a bottom panel'],
      ['Voice-Coding', 'Speech-driven agent — say what you want built, watch it happen'],
    ],
    0.35, 3.56, W - 0.7, [1.3, W - 1.65], { rowH: 0.28 }
  );

  // right column - competition + team
  h2(s, 'Competition & Moat', 4.46);
  body(s, 'VS Code + Copilot, Cursor, Antigravity: all use embedding retrieval and send raw tokens. Capsule compresses before the model sees anything — cost stays flat. Moat: voice coding agent + structural compression + full web app. No competitor has all three.', 0.35, 4.7, W - 0.7, 0.38, { size: 8.5 });

  footer(s, 'Mesh — One-Pager 2026', 'Confidential', CONTACT);
  return pres;
}

// ─────────────────────────────────────────────────────────────
// ONE-PAGER — GERMAN
// ─────────────────────────────────────────────────────────────
function buildOnePagerDE() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  const s = pres.addSlide();
  slideHeader(s, 'Executive Summary');
  label(s, 'Executive Summary', 0.68);
  h1(s, 'Die KI-native Entwicklungsumgebung für sprachgesteuertes Coding und Workspace-Intelligenz.', 0.88, { size: 14 });

  statBox(s, 0.35, 1.42, 3.0, 0.95, '74%', null, 'Ø Token-Reduktion durch Capsule-Kompression');
  statBox(s, 3.45, 1.42, 3.0, 0.95, '3,9×', null, 'mehr Codebasis pro Kontextfenster');
  statBox(s, 6.55, 1.42, 3.1, 0.95, '€500k', null, 'Seed · 18 Monate Runway bis PMF');

  h2(s, 'Problem & Lösung', 2.48);
  body(s, 'KI-Coding-Tools stoßen an eine Wand: Kontextfenster sind begrenzt, echte Codebasen nicht. Teams zahlen für Tokens, nicht für Ergebnisse. Mesh basiert auf Capsule — einer strukturellen Kompressionspipeline, die Token-Verbrauch um durchschnittlich 74 % senkt. Das einzige Tool, das Kontext, Kosten und Workflow gleichzeitig löst.', 0.35, 2.74, W - 0.7, 0.5);

  h2(s, 'Produkt', 3.34);
  table(s,
    ['Oberfläche', 'Was sie leistet'],
    [
      ['Editor', 'Monaco + KI-Chat + Live-Dependency-Graph + Workspace-Intelligenz'],
      ['Terminal', 'Eigenständiger Workspace, kein Randpanel'],
      ['Voice-Coding', 'Sprachgesteuerter Agent — sag, was gebaut werden soll, sieh es entstehen'],
    ],
    0.35, 3.6, W - 0.7, [1.3, W - 1.65], { rowH: 0.28 }
  );

  h2(s, 'Wettbewerb & Alleinstellungsmerkmal', 4.5);
  body(s, 'VS Code + Copilot, Cursor, Antigravity setzen alle auf Embedding-Retrieval und senden rohe Tokens. Capsule komprimiert, bevor das Modell etwas sieht — Kosten bleiben konstant. Alleinstellungsmerkmal: Voice-Coding-Agent + strukturelle Kompression + vollständige Web-App. Diese Kombination hat kein Konkurrent.', 0.35, 4.74, W - 0.7, 0.38, { size: 8.5 });

  footer(s, 'Mesh — One-Pager 2026', 'Vertraulich', CONTACT);
  return pres;
}

// ─────────────────────────────────────────────────────────────
// TECHNICAL BRIEF — ENGLISH
// ─────────────────────────────────────────────────────────────
function buildTechBriefEN() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  addCover(pres, 'Technical Brief · 2026', 'Mesh.', 'Structural source code compression for LLM context efficiency.', FOUNDERS_EN, STATS_TECH, CONTACT);

  { const s = pres.addSlide(); slideHeader(s, 'Context Degradation');
    label(s, 'The Problem', 0.68);
    h1(s, 'More context doesn\'t mean better answers — it can mean worse ones.', 0.88, { size: 16 });
    h2(s, 'NIAH — Needle In A Haystack', 1.46);
    body(s, 'Models perform reliably below ~60–70% context utilization. Above that, retrieval accuracy drops 20–40% depending on where the target appears (Liu et al. 2023, "Lost in the Middle"). The effect compounds at 100k+ token contexts.', 0.35, 1.72, W - 0.7, 0.5);
    ctxVisual(s, 2.3, 'en');
    h2(s, 'SWE-bench', 2.85);
    body(s, 'Top agents (Claude Opus 4.6, GPT-4o, Gemini) solve ~40–55% of real GitHub issues. Root cause of failures: the agent lacked sufficient codebase context. Current tools use embedding retrieval — finds relevant files, sends them raw. Token cost scales with codebase size. As the codebase grows, per-window coverage shrinks.', 0.35, 3.11, W - 0.7, 0.55);
    h2(s, 'How Capsule fixes this', 3.76);
    body(s, 'Capsule structurally compresses source files before they reach the LLM. The full file is always recoverable on demand. Activation is automatic — files under ~200 tokens pass through unchanged (format overhead would exceed savings).', 0.35, 4.02, W - 0.7, 0.42);
    footer(s, 'Mesh — Technical Brief 2026', 2, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Benchmark Results');
    label(s, 'Performance', 0.68);
    h1(s, 'Production pipeline · 5 file types · 6 size tiers.', 0.88, { size: 16 });
    s.addText('File size', { x: 0.35, y: 1.42, w: 1.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial' });
    s.addText('Token reduction', { x: 1.6, y: 1.42, w: W - 3.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial' });
    s.addText('Saving', { x: W - 1.1, y: 1.42, w: 0.8, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial', align: 'right' });
    s.addShape('line', { x: 0.35, y: 1.62, w: W - 0.7, h: 0, line: { color: C.border2, width: 0.75 } });
    bmRows(s, 1.66, 'en');
    h2(s, 'Context window impact (128k)', 3.58);
    ctxVisual(s, 3.84, 'en');
    h2(s, 'Cost impact (Claude Opus 4.6 — $15.00/MTok)', 4.38);
    table(s,
      ['Scenario', 'Tokens sent', 'API cost', 'Files covered'],
      [['Raw code', '1,000,000', '$15.00', '~100 medium files'], ['With Capsule', '260,000', '$3.90', 'Same 100 files']],
      0.35, 4.62, W - 0.7, [2.8, 1.8, 1.4, W - 6.35], { rowH: 0.28 }
    );
    footer(s, 'Mesh — Technical Brief 2026', 3, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Architecture Comparison');
    label(s, 'Retrieval vs Compression', 0.68);
    h1(s, 'A fundamental architectural difference.', 0.88, { size: 16 });
    table(s,
      ['Property', 'Embedding retrieval (industry default)', 'Capsule compression (Mesh)'],
      [
        ['What reaches the model', 'Raw file content at full token cost', 'Compressed structural descriptor'],
        ['Token cost', 'Scales with file count × file size', 'Fixed low cost regardless of file size'],
        ['Context coverage', 'Limited to what fits raw', '3.9× more files per window'],
        ['Codebase size sensitivity', 'High — coverage degrades as codebase grows', 'Low — ratio improves with larger files'],
        ['Mutually exclusive?', 'No — Capsule is additive on top of any retrieval strategy', ''],
      ],
      0.35, 1.38, W - 0.7, [2.3, 3.5, 3.55], { rowH: 0.36 }
    );
    h2(s, 'Model compatibility', 3.38);
    body(s, 'Capsule output is plain text readable by any transformer LLM. Supported: Claude Opus 4.6 / Sonnet · Gemini 3.1 Pro / Flash · GPT-4o / o1 / o3. Provider switching is runtime-configurable — no re-indexing required.', 0.35, 3.64, W - 0.7, 0.4);
    h2(s, 'File type support', 4.14);
    table(s,
      ['Language', 'Structural elements preserved'],
      [
        ['TypeScript / JS', 'Exports, class declarations, function signatures, type definitions, interfaces'],
        ['Python', 'Module-level declarations, class/function signatures, docstrings'],
        ['YAML / JSON', 'Top-level keys, schema structure'],
        ['SQL', 'Table/view/function definitions, column names and types'],
      ],
      0.35, 4.4, W - 0.7, [1.6, W - 1.95], { rowH: 0.26 }
    );
    footer(s, 'Mesh — Technical Brief 2026', 4, CONTACT); }

  return pres;
}

// ─────────────────────────────────────────────────────────────
// TECHNICAL BRIEF — GERMAN
// ─────────────────────────────────────────────────────────────
function buildTechBriefDE() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  addCover(pres, 'Technisches Briefing · 2026', 'Mesh.', 'Strukturelle Quellcode-Kompression für LLM-Kontexteffizienz.', FOUNDERS_DE, STATS_TECH_DE, CONTACT);

  { const s = pres.addSlide(); slideHeader(s, 'Kontextdegradierung');
    label(s, 'Das Problem', 0.68);
    h1(s, 'Mehr Kontext bedeutet nicht immer bessere Antworten.', 0.88, { size: 16 });
    h2(s, 'NIAH — Needle In A Haystack', 1.46);
    body(s, 'Modelle arbeiten zuverlässig bis ~60–70 % Kontextauslastung. Darüber sinkt die Abrufgenauigkeit um 20–40 %, abhängig von der Position der gesuchten Information (Liu et al. 2023, „Lost in the Middle"). Der Effekt verstärkt sich bei Kontexten über 100k Tokens.', 0.35, 1.72, W - 0.7, 0.5);
    ctxVisual(s, 2.3, 'de');
    h2(s, 'SWE-bench', 2.85);
    body(s, 'Spitzenmodelle lösen ~40–55 % echter GitHub-Issues. Häufigster Ausfallgrund: zu wenig Codebase-Kontext. Der Standardansatz — Embedding-Retrieval — wählt relevante Dateien aus und schickt sie roh. Token-Kosten skalieren mit der Codebase-Größe. Je größer die Codebase, desto weniger passt pro Fenster.', 0.35, 3.11, W - 0.7, 0.55);
    h2(s, 'Wie Capsule das löst', 3.76);
    body(s, 'Capsule komprimiert Quelldateien strukturell, bevor sie ein LLM erreichen. Die Originaldatei ist jederzeit wiederherstellbar. Aktivierung ist automatisch — Dateien unter ~200 Tokens werden unverändert durchgeleitet.', 0.35, 4.02, W - 0.7, 0.42);
    footer(s, 'Mesh — Technisches Briefing 2026', 2, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Benchmark-Ergebnisse');
    label(s, 'Performance', 0.68);
    h1(s, 'Produktionspipeline · 5 Dateitypen · 6 Größenkategorien.', 0.88, { size: 16 });
    s.addText('Dateigröße', { x: 0.35, y: 1.42, w: 1.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial' });
    s.addText('Token-Reduktion', { x: 1.6, y: 1.42, w: W - 3.2, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial' });
    s.addText('Einsparung', { x: W - 1.1, y: 1.42, w: 0.8, h: 0.2, fontSize: 7, bold: true, color: C.faint, fontFace: 'Arial', align: 'right' });
    s.addShape('line', { x: 0.35, y: 1.62, w: W - 0.7, h: 0, line: { color: C.border2, width: 0.75 } });
    bmRows(s, 1.66, 'de');
    h2(s, 'Kontextfenster-Wirkung (128k)', 3.58);
    ctxVisual(s, 3.84, 'de');
    h2(s, 'Kostenanalyse (Claude Opus 4.6 — $15,00/MTok)', 4.38);
    table(s,
      ['Szenario', 'Gesendete Tokens', 'API-Kosten', 'Abgedeckte Dateien'],
      [['Roher Code', '1.000.000', '$15,00', '~100 mittlere Dateien'], ['Mit Capsule', '260.000', '$3,90', 'Dieselben 100 Dateien']],
      0.35, 4.62, W - 0.7, [2.8, 1.8, 1.4, W - 6.35], { rowH: 0.28 }
    );
    footer(s, 'Mesh — Technisches Briefing 2026', 3, CONTACT); }

  { const s = pres.addSlide(); slideHeader(s, 'Architekturvergleich');
    label(s, 'Retrieval vs. Kompression', 0.68);
    h1(s, 'Ein grundlegender Architekturunterschied.', 0.88, { size: 16 });
    table(s,
      ['Eigenschaft', 'Embedding-Retrieval (Branchenstandard)', 'Capsule-Kompression (Mesh)'],
      [
        ['Was das Modell sieht', 'Roher Dateiinhalt zum vollen Token-Preis', 'Komprimierter struktureller Deskriptor'],
        ['Token-Kosten', 'Skalieren mit Dateianzahl × Dateigröße', 'Konstant niedrig, unabhängig von Dateigröße'],
        ['Kontextfenster-Abdeckung', 'Begrenzt auf rohen Fit', '3,9× mehr Dateien pro Fenster'],
        ['Codebase-Größen-Sensitivität', 'Hoch — Abdeckung sinkt mit Wachstum', 'Niedrig — Ratio verbessert sich bei größeren Dateien'],
        ['Gegenseitig ausschließend?', 'Nein — Capsule ist additiv zu jeder Retrieval-Strategie', ''],
      ],
      0.35, 1.38, W - 0.7, [2.3, 3.5, 3.55], { rowH: 0.36 }
    );
    h2(s, 'Modell-Kompatibilität', 3.38);
    body(s, 'Capsule-Output ist Klartext, lesbar von jedem Transformer-LLM. Unterstützt: Claude Opus 4.6 / Sonnet · Gemini 3.1 Pro / Flash · GPT-4o / o1 / o3. Provider-Wechsel ist zur Laufzeit konfigurierbar — kein Re-Indexing nötig.', 0.35, 3.64, W - 0.7, 0.4);
    h2(s, 'Dateityp-Unterstützung', 4.14);
    table(s,
      ['Sprache', 'Bewahrte strukturelle Elemente'],
      [
        ['TypeScript / JS', 'Exports, Klassen-Deklarationen, Funktionssignaturen, Typ-Definitionen, Interfaces'],
        ['Python', 'Module-Level-Deklarationen, Klassen-/Funktionssignaturen, Docstrings'],
        ['YAML / JSON', 'Top-Level-Keys, Schema-Struktur'],
        ['SQL', 'Tabellen-/View-/Funktionsdefinitionen, Spaltennamen und -typen'],
      ],
      0.35, 4.4, W - 0.7, [1.6, W - 1.95], { rowH: 0.26 }
    );
    footer(s, 'Mesh — Technisches Briefing 2026', 4, CONTACT); }

  return pres;
}

// ─────────────────────────────────────────────────────────────
// CAPSULE WHITEPAPER — ENGLISH (pure technical, no founders)
// ─────────────────────────────────────────────────────────────
function buildWhitepaperEN() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  const TAG = 'Mesh Whitepaper';

  // ── Cover
  { const slide = pres.addSlide();
    const gradSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="10"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#00ffd5"/><stop offset="100%" stop-color="#8a7cff"/></linearGradient></defs><rect width="960" height="10" fill="url(#g)"/></svg>`;
    slide.addImage({ data: `data:image/svg+xml;base64,${Buffer.from(gradSvg).toString('base64')}`, x: 0, y: 0, w: W, h: 0.1 });
    slide.addText('TECHNICAL WHITEPAPER · 2026', { x: 0.55, y: 0.35, w: 6, h: 0.25, fontSize: 8, bold: true, color: C.blue, fontFace: 'Arial', charSpacing: 3 });
    slide.addImage({ data: `data:image/svg+xml;base64,${ICON_B64}`, x: 0.55, y: 0.62, w: 0.55, h: 0.55 });
    slide.addText('Mesh.', { x: 1.18, y: 0.55, w: 6, h: 0.75, fontSize: 52, bold: true, color: C.blue, fontFace: 'Arial' });
    slide.addText('Structural source code compression for LLM context efficiency — Mesh Compression Engine.', { x: 0.55, y: 1.35, w: 6.5, h: 0.55, fontSize: 12, color: C.muted, fontFace: 'Arial', wrap: true });
    const ruleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="6"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#00ffd5"/><stop offset="100%" stop-color="#8a7cff"/></linearGradient></defs><rect width="160" height="6" rx="3" fill="url(#g)"/></svg>`;
    slide.addImage({ data: `data:image/svg+xml;base64,${Buffer.from(ruleSvg).toString('base64')}`, x: 0.55, y: 2.0, w: 1.65, h: 0.07 });
    const stats = [
      { value: '74%',   label: 'avg token reduction' },
      { value: '3.9×',  label: 'context gain per 128k window' },
      { value: '$3.90', label: 'vs $15.00/MTok · Claude Opus 4.6' },
    ];
    const boxW = (W - 0.55 - 0.35) / stats.length;
    stats.forEach((s, i) => {
      const bx = 0.55 + i * boxW; const by = 2.2; const bh = 0.88;
      box(slide, bx, by, boxW - 0.05, bh, C.bg2, C.border);
      slide.addText(s.value, { x: bx + 0.12, y: by + 0.08, w: boxW - 0.3, h: 0.38, fontSize: 20, bold: true, color: C.blue, fontFace: 'Arial' });
      slide.addText(s.label, { x: bx + 0.12, y: by + 0.46, w: boxW - 0.3, h: 0.36, fontSize: 8, color: C.muted, fontFace: 'Arial', wrap: true });
    });
    slide.addText('Mesh Compression Engine · Production pipeline · 2026', { x: 0, y: H - 0.3, w: W, h: 0.25, fontSize: 7.5, color: C.faint, align: 'center', fontFace: 'Arial' });
  }

  // ── 1 — Context Degradation
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'The Problem', 0.62);
    h1(s, 'As context utilization increases, LLM retrieval accuracy degrades — measurably.', 0.83, { size: 17, h: 0.55 });
    h2(s, 'NIAH — Needle In A Haystack', 1.47);
    body(s, 'Liu et al., 2023, "Lost in the Middle". A specific fact is placed at varying positions; the model must retrieve it. Results across GPT-4, Claude, Gemini:', 0.35, 1.78, W - 0.7, 0.4);
    table(s,
      ['Context utilization', 'Retrieval accuracy'],
      [['< 60%', '~95–98%'], ['60–80%', '~75–85%'], ['80–95%', '~55–70%'], ['> 95%', '~40–60%']],
      0.35, 2.22, 3.2, [1.6, 1.6], { rowH: 0.24 }
    );
    body(s, 'Degradation is positional — facts in the middle of the context are retrieved less reliably than those at the beginning or end. The effect amplifies at 100k+ token contexts.', 3.7, 2.22, W - 4.05, 0.6);
    ctxVisual(s, 3.05);
    h2(s, 'SWE-bench', 3.7);
    body(s, 'Top models (Claude Opus 4.6, GPT-4o, Gemini 3.1 Pro) resolve ~40–55% of real GitHub issues. Leading failure cause: insufficient codebase context. Embedding retrieval selects which files to include — it does not reduce what each file costs.', 0.35, 3.95, W - 0.7, 0.55);
    footer(s, 'Mesh — Technical Whitepaper 2026', 1, ''); }

  // ── 2 — Mechanism
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'Mechanism', 0.62);
    h1(s, 'Structural compression with selective recovery — not summarization.', 0.83, { size: 17, h: 0.44 });
    h2(s, 'Pipeline stages', 1.35);
    table(s,
      ['Stage', 'Operation', 'Output'],
      [
        ['1 — Parse',      'Language-aware AST extraction', 'Declarations, signatures, type annotations, doc comments, control flow markers'],
        ['2 — Compress',   'Implementation body reduction', 'Bodies replaced with structural stubs; non-structural tokens minimized'],
        ['3 — Encode',     'Descriptor assembly',           'Compact plain-text structural descriptor preserving semantic skeleton'],
        ['4 — Recovery',   'On-demand body restoration',    'Full implementation body injected inline when model identifies it as needed'],
      ],
      0.35, 1.65, W - 0.7, [1.35, 2.2, W - 0.7 - 1.35 - 2.2], { rowH: 0.3 }
    );
    h2(s, 'What is preserved', 3.0);
    bullets(s, [
      'All export and declaration names',
      'All function and method signatures (parameters, return types)',
      'Type definitions, interfaces, type aliases, class hierarchy',
      'Doc comment content — the semantic contract of the function',
      'Control flow markers (try/catch, loop, async/await)',
      'Module imports and dependency references',
    ], 0.35, 3.28, 4.5, 1.3);
    h2(s, 'Activation threshold', 3.0);
    body(s, 'Files below ~200 tokens receive pass-through (format overhead > savings). In production codebases, ~95% of files are in the compression range. The threshold has no material effect on total context reduction.', 4.95, 3.28, W - 5.3, 0.7, { size: 8.5 });
    body(s, 'Deterministic · Lossless at structural level · Non-destructive · Reversible on demand', 4.95, 4.08, W - 5.3, 0.28, { size: 8, color: C.blue });
    footer(s, 'Mesh — Technical Whitepaper 2026', 2, ''); }

  // ── 3 — Benchmarks
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'Benchmark Results', 0.62);
    h1(s, 'Production pipeline · 5 file types · 6 size tiers · 50 files per tier', 0.83, { size: 15, h: 0.4 });
    body(s, 'TypeScript, YAML, SQL, HTML, Markdown — real numbers from the production Capsule pipeline.', 0.35, 1.25, W - 0.7, 0.28, { size: 9 });
    bmRows(s, 1.6, 'en');
    h2(s, 'Why compression ratio improves with file size', 4.08);
    body(s, 'Implementation bodies scale with file size; structural skeletons do not. A 100 KB TypeScript file has approximately the same skeleton size as a 5 KB file — the extra 95 KB is almost entirely implementation bodies.', 0.35, 4.35, W - 0.7, 0.4, { size: 8.5 });
    footer(s, 'Mesh — Technical Whitepaper 2026', 3, ''); }

  // ── 4 — Cost Analysis
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'Cost Analysis', 0.62);
    h1(s, '74% cost reduction per query — same files, same model, same result quality.', 0.83, { size: 17, h: 0.44 });
    h2(s, 'Per-query cost (Claude Opus 4.6 — $15.00/MTok input)', 1.35);
    table(s,
      ['Input type', 'Tokens sent', 'Cost per query'],
      [
        ['Raw source (100 medium files)',       '1,000,000',  '$15.00'],
        ['Capsule compressed (same 100 files)', '~260,000',   '$3.90'],
      ],
      0.35, 1.65, W - 0.7, [4.5, 2.0, W - 0.7 - 4.5 - 2.0], { rowH: 0.28, boldCol: 2 }
    );
    h2(s, 'Scale projection (10,000 users · 50 queries/day · 50k avg context tokens)', 2.32);
    table(s,
      ['Metric', 'Raw', 'Capsule'],
      [
        ['Total tokens/day',     '25,000,000,000', '~6,500,000,000'],
        ['API cost/day',         '$375,000',        '~$97,500'],
        ['Monthly API cost',     '$11,250,000',     '~$2,925,000'],
        ['Monthly savings',      '—',               '$8,325,000 (−74%)'],
      ],
      0.35, 2.6, W - 0.7, [3.5, 2.5, W - 0.7 - 3.5 - 2.5], { rowH: 0.27 }
    );
    callout(s, 'The cost curve is flat with Capsule — adding more files to context costs near-zero marginal tokens once those files are in the compression range.', 4.2, 0.45);
    footer(s, 'Mesh — Technical Whitepaper 2026', 4, ''); }

  // ── 5 — Architecture & Compatibility
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'Architecture', 0.62);
    h1(s, 'Retrieval selects files. Compression reduces what each file costs. Both apply.', 0.83, { size: 16, h: 0.44 });
    h2(s, 'Retrieval vs. Compression', 1.35);
    table(s,
      ['Property', 'Embedding retrieval', 'Capsule compression'],
      [
        ['What reaches the model',     'Raw file content (full token cost)', 'Compressed structural descriptor'],
        ['Token cost scales with',     'File count × file size',             'Near-constant (structural skeleton)'],
        ['Context coverage (128k)',    '~20 medium files',                   '~78 medium files'],
        ['Codebase size sensitivity',  'High',                               'Low — ratio improves with size'],
        ['Additive with retrieval',    'N/A',                                '✓ Operates post-retrieval'],
      ],
      0.35, 1.62, W - 0.7, [2.4, 2.9, W - 0.7 - 2.4 - 2.9], { rowH: 0.26 }
    );
    h2(s, 'File type support (v1)', 3.12);
    table(s,
      ['Language', 'Preserved structural elements'],
      [
        ['TypeScript / JavaScript', 'Exports, class declarations, function signatures, type definitions, interfaces, generics'],
        ['Python',                  'Module-level declarations, class/function signatures, type hints, docstrings'],
        ['YAML / JSON',             'Top-level keys, schema structure (values compressed to type markers)'],
        ['SQL',                     'Table/view/function definitions, column names and types, index definitions'],
        ['HTML / JSX',              'Component tree structure, prop signatures, slot structure'],
        ['Markdown',                'Heading hierarchy, code block presence, link structure'],
      ],
      0.35, 3.38, W - 0.7, [2.0, W - 0.7 - 2.0], { rowH: 0.22 }
    );
    body(s, 'Go, Rust, Java, C#, Ruby, PHP planned for Capsule v2.  ·  Model-agnostic: works with Claude, Gemini, GPT-4o, o1, o3, o4-mini without fine-tuning or reindexing.', 0.35, 5.12, W - 0.7, 0.3, { size: 7.5, color: C.faint });
    footer(s, 'Mesh — Technical Whitepaper 2026', 5, ''); }

  return pres;
}

// ─────────────────────────────────────────────────────────────
// CAPSULE WHITEPAPER — GERMAN (pure technical, no founders)
// ─────────────────────────────────────────────────────────────
function buildWhitepaperDE() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  const TAG = 'Mesh Whitepaper';

  // ── Cover
  { const slide = pres.addSlide();
    const gradSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="10"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#00ffd5"/><stop offset="100%" stop-color="#8a7cff"/></linearGradient></defs><rect width="960" height="10" fill="url(#g)"/></svg>`;
    slide.addImage({ data: `data:image/svg+xml;base64,${Buffer.from(gradSvg).toString('base64')}`, x: 0, y: 0, w: W, h: 0.1 });
    slide.addText('TECHNISCHES WHITEPAPER · 2026', { x: 0.55, y: 0.35, w: 6, h: 0.25, fontSize: 8, bold: true, color: C.blue, fontFace: 'Arial', charSpacing: 3 });
    slide.addImage({ data: `data:image/svg+xml;base64,${ICON_B64}`, x: 0.55, y: 0.62, w: 0.55, h: 0.55 });
    slide.addText('Mesh.', { x: 1.18, y: 0.55, w: 6, h: 0.75, fontSize: 52, bold: true, color: C.blue, fontFace: 'Arial' });
    slide.addText('Strukturelle Quellcode-Kompression für LLM-Kontexteffizienz — Mesh Compression Engine.', { x: 0.55, y: 1.35, w: 6.5, h: 0.55, fontSize: 12, color: C.muted, fontFace: 'Arial', wrap: true });
    const ruleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="6"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#00ffd5"/><stop offset="100%" stop-color="#8a7cff"/></linearGradient></defs><rect width="160" height="6" rx="3" fill="url(#g)"/></svg>`;
    slide.addImage({ data: `data:image/svg+xml;base64,${Buffer.from(ruleSvg).toString('base64')}`, x: 0.55, y: 2.0, w: 1.65, h: 0.07 });
    const stats = [
      { value: '74%',    label: 'Ø Token-Reduktion' },
      { value: '3,9×',   label: 'Kontextgewinn im 128k-Fenster' },
      { value: '$3,90',  label: 'vs $15,00/MTok · Claude Opus 4.6' },
    ];
    const boxW = (W - 0.55 - 0.35) / stats.length;
    stats.forEach((s, i) => {
      const bx = 0.55 + i * boxW; const by = 2.2; const bh = 0.88;
      box(slide, bx, by, boxW - 0.05, bh, C.bg2, C.border);
      slide.addText(s.value, { x: bx + 0.12, y: by + 0.08, w: boxW - 0.3, h: 0.38, fontSize: 20, bold: true, color: C.blue, fontFace: 'Arial' });
      slide.addText(s.label, { x: bx + 0.12, y: by + 0.46, w: boxW - 0.3, h: 0.36, fontSize: 8, color: C.muted, fontFace: 'Arial', wrap: true });
    });
    slide.addText('Mesh Compression Engine · Produktionspipeline · 2026', { x: 0, y: H - 0.3, w: W, h: 0.25, fontSize: 7.5, color: C.faint, align: 'center', fontFace: 'Arial' });
  }

  // ── 1 — Kontextdegradation
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'Das Problem', 0.62);
    h1(s, 'Mit steigender Kontextauslastung fällt die LLM-Abrufgenauigkeit — messbar.', 0.83, { size: 17, h: 0.55 });
    h2(s, 'NIAH — Needle In A Haystack', 1.47);
    body(s, 'Liu et al., 2023, „Lost in the Middle". Eine Zielinformation wird an verschiedenen Positionen platziert; das Modell muss sie abrufen. Ergebnisse über GPT-4, Claude, Gemini:', 0.35, 1.78, W - 0.7, 0.4);
    table(s,
      ['Kontextauslastung', 'Abrufgenauigkeit'],
      [['< 60 %', '~95–98 %'], ['60–80 %', '~75–85 %'], ['80–95 %', '~55–70 %'], ['> 95 %', '~40–60 %']],
      0.35, 2.22, 3.2, [1.6, 1.6], { rowH: 0.24 }
    );
    body(s, 'Informationen in der Mitte des Kontexts werden weniger zuverlässig abgerufen als solche am Anfang oder Ende. Der Effekt verstärkt sich bei 100k+-Token-Kontexten.', 3.7, 2.22, W - 4.05, 0.6);
    ctxVisual(s, 3.05, 'de');
    h2(s, 'SWE-bench', 3.7);
    body(s, 'Spitzenmodelle (Claude Opus 4.6, GPT-4o, Gemini 3.1 Pro) lösen ~40–55 % echter GitHub-Issues. Führende Fehlerursache: unzureichender Codebase-Kontext. Embedding-Retrieval wählt Dateien aus — es reduziert nicht, was jede Datei kostet.', 0.35, 3.95, W - 0.7, 0.55);
    footer(s, 'Mesh — Technisches Whitepaper 2026', 1, ''); }

  // ── 2 — Mechanismus
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'Mechanismus', 0.62);
    h1(s, 'Strukturelle Kompression mit selektiver Wiederherstellung — keine Zusammenfassung.', 0.83, { size: 17, h: 0.44 });
    h2(s, 'Pipeline-Stufen', 1.35);
    table(s,
      ['Stufe', 'Operation', 'Output'],
      [
        ['1 — Parse',         'Sprachbewusste AST-Extraktion',    'Deklarationen, Signaturen, Typ-Annotationen, Doc-Comments, Control-Flow-Marker'],
        ['2 — Komprimieren',  'Implementierungsbody-Reduktion',   'Bodies durch strukturelle Stubs ersetzt; nicht-strukturelle Tokens minimiert'],
        ['3 — Enkodieren',    'Deskriptor-Assembly',              'Kompakter Klartext-Deskriptor mit vollständigem semantischen Skelett'],
        ['4 — Recovery',      'On-demand Body-Restaurierung',     'Vollständiger Implementierungsbody inline injiziert, wenn Modell ihn anfordert'],
      ],
      0.35, 1.65, W - 0.7, [1.55, 2.2, W - 0.7 - 1.55 - 2.2], { rowH: 0.3 }
    );
    h2(s, 'Was erhalten bleibt', 3.0);
    bullets(s, [
      'Alle Export- und Deklarationsnamen',
      'Alle Funktions- und Methodensignaturen (Parameter, Rückgabetypen)',
      'Typ-Definitionen, Interfaces, Typ-Aliase, Klassenhierarchie',
      'Doc-Comment-Inhalt — der semantische Vertrag der Funktion',
      'Control-Flow-Marker (try/catch, Schleifen, async/await)',
      'Modul-Imports und Abhängigkeitsreferenzen',
    ], 0.35, 3.28, 4.5, 1.3);
    h2(s, 'Aktivierungsschwelle', 3.0);
    body(s, 'Dateien unter ~200 Tokens: Pass-through (Format-Overhead > Einsparung). In Produktions-Codebasen liegen ~95 % der Dateien im Kompressionsbereich. Kein materieller Effekt auf Gesamt-Reduktion.', 4.95, 3.28, W - 5.3, 0.7, { size: 8.5 });
    body(s, 'Deterministisch · Verlustfrei auf struktureller Ebene · Nicht-destruktiv · On-demand reversibel', 4.95, 4.08, W - 5.3, 0.28, { size: 8, color: C.blue });
    footer(s, 'Mesh — Technisches Whitepaper 2026', 2, ''); }

  // ── 3 — Benchmarks
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'Benchmark-Ergebnisse', 0.62);
    h1(s, 'Produktionspipeline · 5 Dateitypen · 6 Größenkategorien · 50 Dateien pro Kategorie', 0.83, { size: 15, h: 0.4 });
    body(s, 'TypeScript, YAML, SQL, HTML, Markdown — reale Zahlen aus der laufenden Capsule-Pipeline.', 0.35, 1.25, W - 0.7, 0.28, { size: 9 });
    bmRows(s, 1.6, 'de');
    h2(s, 'Warum die Kompressionsrate mit Dateigröße steigt', 4.08);
    body(s, 'Implementierungsbodies skalieren mit der Dateigröße; strukturelle Skelette nicht. Eine 100-KB-Datei hat ungefähr dieselbe Skelettgröße wie eine 5-KB-Datei — die Extra-95 KB sind fast ausschließlich Implementierungsbodies.', 0.35, 4.35, W - 0.7, 0.4, { size: 8.5 });
    footer(s, 'Mesh — Technisches Whitepaper 2026', 3, ''); }

  // ── 4 — Kostenanalyse
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'Kostenanalyse', 0.62);
    h1(s, '74 % Kostenreduktion pro Query — gleiche Dateien, gleiches Modell, gleiche Qualität.', 0.83, { size: 17, h: 0.44 });
    h2(s, 'Kosten pro Query (Claude Opus 4.6 — $15,00/MTok Input)', 1.35);
    table(s,
      ['Input-Typ', 'Gesendete Tokens', 'Kosten pro Query'],
      [
        ['Roher Code (100 mittlere Dateien)',             '1.000.000',  '$15,00'],
        ['Capsule-komprimiert (dieselben 100 Dateien)',   '~260.000',   '$3,90'],
      ],
      0.35, 1.65, W - 0.7, [4.5, 2.0, W - 0.7 - 4.5 - 2.0], { rowH: 0.28, boldCol: 2 }
    );
    h2(s, 'Skalierungsprojektion (10.000 Nutzer · 50 Queries/Tag · 50k Ø Kontext-Tokens)', 2.32);
    table(s,
      ['Metrik', 'Roh', 'Capsule'],
      [
        ['Tokens gesamt/Tag',     '25.000.000.000', '~6.500.000.000'],
        ['API-Kosten/Tag',        '$375.000',        '~$97.500'],
        ['Monatliche API-Kosten', '$11.250.000',     '~$2.925.000'],
        ['Monatliche Einsparung', '—',               '$8.325.000 (−74 %)'],
      ],
      0.35, 2.6, W - 0.7, [3.5, 2.5, W - 0.7 - 3.5 - 2.5], { rowH: 0.27 }
    );
    callout(s, 'Die Kostenkurve ist mit Capsule flach — weitere Dateien zum Kontext hinzuzufügen kostet nahezu null Marginal-Tokens, sobald sie im Kompressionsbereich liegen.', 4.2, 0.45);
    footer(s, 'Mesh — Technisches Whitepaper 2026', 4, ''); }

  // ── 5 — Architektur & Kompatibilität
  { const s = pres.addSlide();
    slideHeader(s, TAG);
    label(s, 'Architektur', 0.62);
    h1(s, 'Retrieval wählt Dateien. Kompression reduziert, was jede Datei kostet. Beides wirkt.', 0.83, { size: 16, h: 0.44 });
    h2(s, 'Retrieval und Kompression — nicht gegenseitig ausschließend', 1.35);
    table(s,
      ['Eigenschaft', 'Embedding-Retrieval', 'Capsule-Kompression'],
      [
        ['Was das Modell erreicht',       'Roher Dateiinhalt (volle Token-Kosten)', 'Komprimierter Deskriptor'],
        ['Token-Kosten skalieren mit',    'Dateianzahl × Dateigröße',              'Nahezu konstant (Skelettgröße)'],
        ['Kontextabdeckung (128k)',        '~20 mittlere Dateien',                  '~78 mittlere Dateien'],
        ['Codebase-Größen-Sensitivität',  'Hoch',                                  'Niedrig — Rate steigt mit Größe'],
        ['Additiv mit Retrieval',         'N/A',                                   '✓ Operiert nach dem Retrieval'],
      ],
      0.35, 1.62, W - 0.7, [2.6, 2.9, W - 0.7 - 2.6 - 2.9], { rowH: 0.26 }
    );
    h2(s, 'Dateityp-Unterstützung (v1)', 3.12);
    table(s,
      ['Sprache', 'Bewahrte strukturelle Elemente'],
      [
        ['TypeScript / JavaScript', 'Exports, Klassen-Deklarationen, Funktionssignaturen, Typ-Definitionen, Interfaces, Generics'],
        ['Python',                  'Module-level-Deklarationen, Klassen-/Funktionssignaturen, Type Hints, Docstrings'],
        ['YAML / JSON',             'Top-Level-Keys, Schema-Struktur (Werte auf Typ-Marker komprimiert)'],
        ['SQL',                     'Tabellen-/View-/Funktionsdefinitionen, Spaltennamen und -typen, Index-Definitionen'],
        ['HTML / JSX',              'Komponentenbaumstruktur, Prop-Signaturen, Slot-Struktur'],
        ['Markdown',                'Überschriftenhierarchie, Code-Block-Präsenz, Link-Struktur'],
      ],
      0.35, 3.38, W - 0.7, [2.0, W - 0.7 - 2.0], { rowH: 0.22 }
    );
    body(s, 'Go, Rust, Java, C#, Ruby, PHP geplant für Capsule v2.  ·  Modell-agnostisch: Claude, Gemini, GPT-4o, o1, o3, o4-mini — kein Fine-Tuning, kein Re-Indexing.', 0.35, 5.12, W - 0.7, 0.3, { size: 7.5, color: C.faint });
    footer(s, 'Mesh — Technisches Whitepaper 2026', 5, ''); }

  return pres;
}

// ─────────────────────────────────────────────────────────────
// GENERATE
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\nGenerating Mesh pitch PPTX files...\n');

  const docs = [
    { name: 'pitch-deck-en.pptx',            builder: buildPitchDeckEN },
    { name: 'pitch-deck-de.pptx',            builder: buildPitchDeckDE },
    { name: 'one-pager-en.pptx',             builder: buildOnePagerEN },
    { name: 'one-pager-de.pptx',             builder: buildOnePagerDE },
    { name: 'technical-brief-en.pptx',       builder: buildTechBriefEN },
    { name: 'technical-brief-de.pptx',       builder: buildTechBriefDE },
    { name: 'capsule-whitepaper-en.pptx',    builder: buildWhitepaperEN },
    { name: 'capsule-whitepaper-de.pptx',    builder: buildWhitepaperDE },
  ];

  for (const doc of docs) {
    const pres = doc.builder();
    const outPath = path.join(OUT_DIR, doc.name);
    await pres.writeFile({ fileName: outPath });
    console.log(`  ✓ ${doc.name}`);
  }

  console.log(`\nAll PPTX written to: ${OUT_DIR}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
