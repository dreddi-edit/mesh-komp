const pptxgen = require("pptxgenjs");
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require("./pptxgenjs_helpers/layout");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "OpenAI Codex";
pptx.company = "Mesh";
pptx.subject = "Mesh pitch deck";
pptx.title = "Mesh - Context Compression for AI Systems";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "Aptos Display",
  bodyFontFace: "Aptos",
  lang: "en-US",
};

const COLORS = {
  bg: "081018",
  panel: "0E1621",
  panel2: "0C141D",
  text: "F3F7FB",
  muted: "93A4B8",
  accent: "54E0C1",
  accent2: "61A8FF",
  line: "203141",
  white: "FFFFFF",
};

function addBackground(slide) {
  slide.background = { color: COLORS.bg };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.35,
    y: 0.35,
    w: 12.63,
    h: 6.4,
    line: { color: COLORS.line, pt: 1 },
    fill: { color: COLORS.bg, transparency: 100 },
    radius: 0.08,
  });
  slide.addText("MESH", {
    x: 0.62,
    y: 0.34,
    w: 1.2,
    h: 0.18,
    fontFace: "Courier New",
    fontSize: 10,
    bold: true,
    color: COLORS.accent,
    margin: 0,
    charSpace: 1.6,
  });
}

function addFooter(slide, label) {
  slide.addText(label, {
    x: 10.85,
    y: 7.0 - 0.5,
    w: 1.2,
    h: 0.18,
    align: "right",
    fontFace: "Courier New",
    fontSize: 8,
    color: COLORS.muted,
    margin: 0,
  });
}

function addTitle(slide, eyebrow, title, body) {
  slide.addText(eyebrow.toUpperCase(), {
    x: 0.9,
    y: 0.95,
    w: 2.4,
    h: 0.24,
    fontFace: "Courier New",
    fontSize: 10,
    bold: true,
    color: COLORS.accent,
    charSpace: 1.4,
    margin: 0,
  });
  slide.addText(title, {
    x: 0.9,
    y: 1.25,
    w: 8.6,
    h: 1.05,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
  slide.addText(body, {
    x: 0.92,
    y: 2.36,
    w: 6.7,
    h: 0.75,
    fontFace: "Aptos",
    fontSize: 13,
    color: COLORS.muted,
    margin: 0,
    breakLine: false,
  });
}

function addBulletBlock(slide, x, y, w, title, bullets) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h: 2.1,
    rectRadius: 0.06,
    line: { color: COLORS.line, pt: 1 },
    fill: { color: COLORS.panel },
  });
  slide.addText(title, {
    x: x + 0.18,
    y: y + 0.16,
    w: w - 0.36,
    h: 0.24,
    fontFace: "Aptos Display",
    fontSize: 14,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
  const runs = [];
  bullets.forEach((bullet, index) => {
    runs.push({
      text: bullet,
      options: {
        bullet: { indent: 10 },
        hanging: 2,
        breakLine: index !== bullets.length - 1,
      },
    });
  });
  slide.addText(runs, {
    x: x + 0.18,
    y: y + 0.48,
    w: w - 0.34,
    h: 1.35,
    fontFace: "Aptos",
    fontSize: 11.5,
    color: COLORS.muted,
    margin: 0,
    breakLine: false,
    paraSpaceAfterPt: 9,
    valign: "top",
  });
}

function finalizeSlide(slide) {
  warnIfSlideHasOverlaps(slide, pptx, { ignoreDecorativeShapes: true });
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

// Slide 1
{
  const slide = pptx.addSlide();
  addBackground(slide);
  slide.addText("Context compression infrastructure for AI systems", {
    x: 0.9,
    y: 1.12,
    w: 6.3,
    h: 0.28,
    fontFace: "Courier New",
    fontSize: 10,
    color: COLORS.accent2,
    margin: 0,
  });
  slide.addText("Mesh", {
    x: 0.86,
    y: 1.55,
    w: 4.2,
    h: 0.8,
    fontFace: "Aptos Display",
    fontSize: 30,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
  slide.addText("Cuts token load before it reaches the model.", {
    x: 0.9,
    y: 2.42,
    w: 6.1,
    h: 0.34,
    fontFace: "Aptos Display",
    fontSize: 20,
    color: COLORS.text,
    margin: 0,
  });
  slide.addText(
    "Mesh compresses and restructures large-context inputs so AI systems can operate on codebases and multi-file workflows with lower cost, lower latency, and lower compute intensity.",
    {
      x: 0.92,
      y: 2.98,
      w: 6.35,
      h: 1.2,
      fontFace: "Aptos",
      fontSize: 14,
      color: COLORS.muted,
      margin: 0,
      valign: "top",
    }
  );

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.0,
    y: 1.25,
    w: 4.15,
    h: 4.2,
    rectRadius: 0.08,
    line: { color: COLORS.line, pt: 1 },
    fill: { color: COLORS.panel2 },
  });
  slide.addText("Signal density", {
    x: 8.32,
    y: 1.58,
    w: 1.7,
    h: 0.18,
    fontFace: "Courier New",
    fontSize: 9,
    color: COLORS.accent,
    margin: 0,
  });
  slide.addText("More relevant context per token.", {
    x: 8.32,
    y: 1.88,
    w: 2.9,
    h: 0.36,
    fontFace: "Aptos Display",
    fontSize: 16,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
  slide.addText(
    [
      { text: "Input", options: { bold: true, color: COLORS.text } },
      { text: "  large codebase, noisy files, repeated structure", options: { color: COLORS.muted } },
      { text: "\nMesh", options: { bold: true, color: COLORS.text } },
      { text: "  structural compression, focused retrieval, source recovery", options: { color: COLORS.muted } },
      { text: "\nOutput", options: { bold: true, color: COLORS.text } },
      { text: "  cheaper and more usable model context", options: { color: COLORS.muted } },
    ],
    {
      x: 8.32,
      y: 2.48,
      w: 3.25,
      h: 1.4,
      fontFace: "Aptos",
      fontSize: 11.5,
      margin: 0,
      valign: "top",
    }
  );

  slide.addText("Cost", {
    x: 8.33,
    y: 4.25,
    w: 0.55,
    h: 0.2,
    fontFace: "Courier New",
    fontSize: 8,
    color: COLORS.muted,
    margin: 0,
  });
  slide.addText("Latency", {
    x: 9.55,
    y: 4.25,
    w: 0.65,
    h: 0.2,
    fontFace: "Courier New",
    fontSize: 8,
    color: COLORS.muted,
    margin: 0,
  });
  slide.addText("Emissions", {
    x: 10.88,
    y: 4.25,
    w: 0.78,
    h: 0.2,
    fontFace: "Courier New",
    fontSize: 8,
    color: COLORS.muted,
    margin: 0,
  });
  ["Cost", "Latency", "Emissions"].forEach((_, idx) => {
    slide.addShape(pptx.ShapeType.line, {
      x: 8.35 + idx * 1.28,
      y: 4.75,
      w: 0.72,
      h: 0,
      line: { color: COLORS.accent, pt: 2 },
    });
    slide.addText("down", {
      x: 8.35 + idx * 1.28,
      y: 4.52,
      w: 0.7,
      h: 0.2,
      fontFace: "Aptos",
      fontSize: 12,
      bold: true,
      color: COLORS.text,
      align: "center",
      margin: 0,
    });
  });
  addFooter(slide, "01");
  finalizeSlide(slide);
}

// Slide 2
{
  const slide = pptx.addSlide();
  addBackground(slide);
  addTitle(
    slide,
    "Problem",
    "Model capability is improving faster than context efficiency.",
    "Large-context AI still wastes tokens on repeated, low-signal input. The bottleneck is no longer just model quality; it is getting the right information into the model without paying for noise."
  );

  addBulletBlock(slide, 0.92, 3.22, 3.68, "What breaks today", [
    "Large codebases and multi-file workflows flood models with redundant context.",
    "Token spend scales faster than usefulness.",
    "Teams pay for compute that does not translate into better reasoning.",
  ]);
  addBulletBlock(slide, 4.8, 3.22, 3.68, "Why this matters", [
    "Higher context cost means slower products and worse margins.",
    "Noisy context lowers reliability in real workflows.",
    "Extra tokens also mean extra energy and avoidable emissions.",
  ]);
  addBulletBlock(slide, 8.68, 3.22, 3.08, "Why now", [
    "Agents are moving from toy prompts to real codebases.",
    "Inference cost is becoming a product constraint.",
    "Context infrastructure is becoming its own layer in the stack.",
  ]);
  addFooter(slide, "02");
  finalizeSlide(slide);
}

// Slide 3
{
  const slide = pptx.addSlide();
  addBackground(slide);
  addTitle(
    slide,
    "Architecture",
    "Mesh compresses context before inference.",
    "The system is built around structural compression, selective retrieval, and source-grounded recovery."
  );

  const y = 3.15;
  const h = 1.45;
  const boxes = [
    { x: 0.95, w: 2.35, title: "Raw workspace", body: "Files, docs, diffs, history, graph state." },
    { x: 3.62, w: 2.35, title: "Capsula layer", body: "Structural views that preserve meaning while cutting redundant tokens." },
    { x: 6.29, w: 2.35, title: "Focused retrieval", body: "Only relevant regions are promoted into the active prompt." },
    { x: 8.96, w: 2.35, title: "Source recovery", body: "Exact source can be pulled back when precision matters." },
  ];

  boxes.forEach((box, idx) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: box.x,
      y,
      w: box.w,
      h,
      rectRadius: 0.06,
      line: { color: COLORS.line, pt: 1 },
      fill: { color: idx === 1 ? "10202A" : COLORS.panel },
    });
    slide.addText(box.title, {
      x: box.x + 0.16,
      y: y + 0.18,
      w: box.w - 0.32,
      h: 0.24,
      fontFace: "Aptos Display",
      fontSize: 14,
      bold: true,
      color: idx === 1 ? COLORS.accent : COLORS.text,
      margin: 0,
    });
    slide.addText(box.body, {
      x: box.x + 0.16,
      y: y + 0.52,
      w: box.w - 0.3,
      h: 0.6,
      fontFace: "Aptos",
      fontSize: 11.2,
      color: COLORS.muted,
      margin: 0,
      valign: "top",
    });
    if (idx < boxes.length - 1) {
      slide.addShape(pptx.ShapeType.chevron, {
        x: box.x + box.w + 0.17,
        y: y + 0.52,
        w: 0.14,
        h: 0.34,
        line: { color: COLORS.line, pt: 0.5 },
        fill: { color: COLORS.accent2 },
      });
    }
  });

  slide.addText("Model-side outcome", {
    x: 0.96,
    y: 5.2,
    w: 1.6,
    h: 0.2,
    fontFace: "Courier New",
    fontSize: 9,
    color: COLORS.accent,
    margin: 0,
  });
  slide.addText(
    "Higher signal density, lower token load, and better grounding for agentic systems operating on real projects.",
    {
      x: 0.96,
      y: 5.5,
      w: 7.4,
      h: 0.4,
      fontFace: "Aptos Display",
      fontSize: 16,
      color: COLORS.text,
      bold: true,
      margin: 0,
    }
  );
  slide.addText(
    "This is not another wrapper. It is an infrastructure layer for making large-context inference economically and operationally viable.",
    {
      x: 0.98,
      y: 5.98,
      w: 8.4,
      h: 0.5,
      fontFace: "Aptos",
      fontSize: 12.5,
      color: COLORS.muted,
      margin: 0,
    }
  );
  addFooter(slide, "03");
  finalizeSlide(slide);
}

// Slide 4
{
  const slide = pptx.addSlide();
  addBackground(slide);
  addTitle(
    slide,
    "Positioning",
    "Mesh is a wedge into inference optimization for agentic software.",
    "We start where context is both expensive and operationally painful: coding agents, large codebases, and multi-file reasoning."
  );

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.95,
    y: 3.22,
    w: 5.18,
    h: 2.4,
    rectRadius: 0.06,
    line: { color: COLORS.line, pt: 1 },
    fill: { color: COLORS.panel },
  });
  slide.addText("Current status", {
    x: 1.14,
    y: 3.4,
    w: 1.6,
    h: 0.22,
    fontFace: "Aptos Display",
    fontSize: 14,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
  slide.addText(
    [
      { text: "Working prototype", options: { bullet: { indent: 10 }, hanging: 2, breakLine: true } },
      { text: "End-to-end product surface for code workflows", options: { bullet: { indent: 10 }, hanging: 2, breakLine: true } },
      { text: "Compression-first framing around cost, latency, and emissions", options: { bullet: { indent: 10 }, hanging: 2 } },
    ],
    {
      x: 1.12,
      y: 3.8,
      w: 4.45,
      h: 1.3,
      fontFace: "Aptos",
      fontSize: 11.5,
      color: COLORS.muted,
      margin: 0,
      paraSpaceAfterPt: 10,
    }
  );

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 6.45,
    y: 3.22,
    w: 5.18,
    h: 2.4,
    rectRadius: 0.06,
    line: { color: COLORS.line, pt: 1 },
    fill: { color: COLORS.panel },
  });
  slide.addText("Why it compounds", {
    x: 6.64,
    y: 3.4,
    w: 1.8,
    h: 0.22,
    fontFace: "Aptos Display",
    fontSize: 14,
    bold: true,
    color: COLORS.text,
    margin: 0,
  });
  slide.addText(
    [
      { text: "Better context efficiency improves every downstream model call", options: { bullet: { indent: 10 }, hanging: 2, breakLine: true } },
      { text: "Economic wins scale with usage", options: { bullet: { indent: 10 }, hanging: 2, breakLine: true } },
      { text: "Compute wins also translate into lower emissions per workflow", options: { bullet: { indent: 10 }, hanging: 2 } },
    ],
    {
      x: 6.62,
      y: 3.8,
      w: 4.4,
      h: 1.3,
      fontFace: "Aptos",
      fontSize: 11.5,
      color: COLORS.muted,
      margin: 0,
      paraSpaceAfterPt: 10,
    }
  );

  slide.addText("Deep tech thesis", {
    x: 0.97,
    y: 5.95,
    w: 1.75,
    h: 0.18,
    fontFace: "Courier New",
    fontSize: 9,
    color: COLORS.accent,
    margin: 0,
  });
  slide.addText(
    "As models get stronger, the next bottleneck is not raw capability but context efficiency. Mesh is infrastructure for that layer.",
    {
      x: 0.96,
      y: 6.22,
      w: 8.9,
      h: 0.34,
      fontFace: "Aptos Display",
      fontSize: 17,
      bold: true,
      color: COLORS.text,
      margin: 0,
    }
  );
  addFooter(slide, "04");
  finalizeSlide(slide);
}

async function main() {
  await pptx.writeFile({ fileName: "output/pitch-deck-mesh/mesh_pitch_deck.pptx" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
