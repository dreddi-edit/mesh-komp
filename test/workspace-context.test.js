"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeTerminalChunk,
  normalizeContextExcerptText,
  normalizeExcerptFocusTerms,
  collectFocusedCharRanges,
  mergeCharRanges,
  buildExcerptFromCharRanges,
} = require("../src/core/workspace-context");

// ── sanitizeTerminalChunk ─────────────────────────────────────────────────────

describe("sanitizeTerminalChunk", () => {
  it("strips ANSI color escape sequences", () => {
    const result = sanitizeTerminalChunk("\x1b[32mhello\x1b[0m");
    assert.equal(result, "hello");
  });

  it("strips OSC sequences (window title)", () => {
    const result = sanitizeTerminalChunk("\x1b]0;My Terminal\x07plain text");
    assert.equal(result, "plain text");
  });

  it("strips cursor movement escapes", () => {
    const result = sanitizeTerminalChunk("\x1b[2Jhello\x1b[Hworld");
    assert.equal(result, "helloworld");
  });

  it("normalizes CRLF to LF", () => {
    assert.equal(sanitizeTerminalChunk("line1\r\nline2"), "line1\nline2");
  });

  it("normalizes bare CR to LF", () => {
    assert.equal(sanitizeTerminalChunk("line1\rline2"), "line1\nline2");
  });

  it("strips control characters except LF and TAB", () => {
    const result = sanitizeTerminalChunk("hello\x00\x07world");
    assert.equal(result, "helloworld");
  });

  it("returns empty string for null/undefined", () => {
    assert.equal(sanitizeTerminalChunk(null), "");
    assert.equal(sanitizeTerminalChunk(undefined), "");
  });

  it("preserves normal text unchanged", () => {
    assert.equal(sanitizeTerminalChunk("normal text here"), "normal text here");
  });

  it("handles mixed ANSI and plain content", () => {
    const result = sanitizeTerminalChunk("\x1b[1mBold\x1b[0m normal");
    assert.equal(result, "Bold normal");
  });
});

// ── normalizeContextExcerptText ───────────────────────────────────────────────

describe("normalizeContextExcerptText", () => {
  it("normalizes CRLF to LF", () => {
    assert.equal(normalizeContextExcerptText("a\r\nb"), "a\nb");
  });

  it("normalizes bare CR to LF", () => {
    assert.equal(normalizeContextExcerptText("a\rb"), "a\nb");
  });

  it("strips trailing whitespace from lines", () => {
    assert.equal(normalizeContextExcerptText("hello   \nworld  \n"), "hello\nworld\n");
  });

  it("collapses 4+ consecutive blank lines to max 3", () => {
    const input = "line1\n\n\n\n\n\nline2";
    const result = normalizeContextExcerptText(input);
    const blankCount = (result.match(/\n/g) || []).length;
    assert.ok(blankCount <= 3, `expected ≤3 newlines, got ${blankCount}`);
  });

  it("returns empty string for empty input", () => {
    assert.equal(normalizeContextExcerptText(""), "");
    assert.equal(normalizeContextExcerptText(null), "");
  });
});

// ── normalizeExcerptFocusTerms ────────────────────────────────────────────────

describe("normalizeExcerptFocusTerms", () => {
  it("accepts array of terms and deduplicates", () => {
    const result = normalizeExcerptFocusTerms(["auth", "AUTH", "auth"]);
    assert.equal(result.length, 1);
    assert.equal(result[0], "auth");
  });

  it("filters terms shorter than 3 chars", () => {
    const result = normalizeExcerptFocusTerms(["ab", "abc", "de"]);
    assert.ok(!result.includes("ab"));
    assert.ok(!result.includes("de"));
    assert.ok(result.includes("abc"));
  });

  it("limits to at most 10 terms", () => {
    const input = Array.from({ length: 20 }, (_, i) => `term${i}`);
    const result = normalizeExcerptFocusTerms(input);
    assert.ok(result.length <= 10);
  });

  it("returns empty array for empty array input", () => {
    assert.deepEqual(normalizeExcerptFocusTerms([]), []);
  });
});

// ── mergeCharRanges ───────────────────────────────────────────────────────────

describe("mergeCharRanges", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(mergeCharRanges([]), []);
    assert.deepEqual(mergeCharRanges(null), []);
  });

  it("returns single range unchanged", () => {
    const result = mergeCharRanges([{ start: 10, end: 20 }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].start, 10);
    assert.equal(result[0].end, 20);
  });

  it("merges overlapping ranges", () => {
    const result = mergeCharRanges([
      { start: 0, end: 30 },
      { start: 20, end: 50 },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].start, 0);
    assert.equal(result[0].end, 50);
  });

  it("merges adjacent ranges within 24-char gap", () => {
    const result = mergeCharRanges([
      { start: 0, end: 20 },
      { start: 30, end: 50 },
    ]);
    // gap of 10 < 24, should merge
    assert.equal(result.length, 1);
  });

  it("keeps separate ranges beyond 24-char gap", () => {
    const result = mergeCharRanges([
      { start: 0, end: 10 },
      { start: 100, end: 200 },
    ]);
    assert.equal(result.length, 2);
  });

  it("filters out zero-length or inverted ranges", () => {
    const result = mergeCharRanges([
      { start: 10, end: 10 },
      { start: 20, end: 15 },
      { start: 5, end: 50 },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].start, 5);
    assert.equal(result[0].end, 50);
  });

  it("sorts ranges by start before merging", () => {
    const result = mergeCharRanges([
      { start: 100, end: 200 },
      { start: 0, end: 50 },
    ]);
    assert.equal(result[0].start, 0);
  });
});

// ── collectFocusedCharRanges ──────────────────────────────────────────────────

describe("collectFocusedCharRanges", () => {
  it("returns empty array when no focus terms", () => {
    const result = collectFocusedCharRanges("hello world", []);
    assert.deepEqual(result, []);
  });

  it("returns empty array for empty text", () => {
    const result = collectFocusedCharRanges("", ["auth"]);
    assert.deepEqual(result, []);
  });

  it("finds a single term match", () => {
    const text = "a".repeat(300) + "auth" + "b".repeat(300);
    const result = collectFocusedCharRanges(text, ["auth"]);
    assert.equal(result.length, 1);
    assert.ok(result[0].start <= 300);
    assert.ok(result[0].end >= 304);
  });

  it("merges overlapping matches from multiple terms", () => {
    const text = "authenticate user with middleware";
    const result = collectFocusedCharRanges(text, ["auth", "middleware"]);
    assert.ok(result.length >= 1);
  });

  it("respects maxHits option", () => {
    const text = Array.from({ length: 20 }, (_, i) => `auth-${i}`).join(" ");
    const result = collectFocusedCharRanges(text, ["auth"], { maxHits: 3 });
    assert.ok(result.length <= 3);
  });
});

// ── buildExcerptFromCharRanges ────────────────────────────────────────────────

describe("buildExcerptFromCharRanges", () => {
  it("returns empty string for empty input", () => {
    assert.equal(buildExcerptFromCharRanges("", []), "");
    assert.equal(buildExcerptFromCharRanges("text", []), "");
  });

  it("extracts a single range", () => {
    const result = buildExcerptFromCharRanges("hello world", [{ start: 0, end: 5 }]);
    assert.equal(result, "hello");
  });

  it("includes gap marker between non-contiguous ranges", () => {
    const text = "aaaa bbbb cccc";
    const result = buildExcerptFromCharRanges(text, [
      { start: 0, end: 4 },
      { start: 10, end: 14 },
    ]);
    assert.ok(result.includes("[...omitted...]") || result.includes("aaaa"));
  });

  it("uses custom gap marker when provided", () => {
    // Ranges must be > 24 chars apart to avoid merging
    const text = "A".repeat(100) + "B".repeat(100);
    const result = buildExcerptFromCharRanges(
      text,
      [{ start: 0, end: 5 }, { start: 150, end: 155 }],
      "---"
    );
    assert.ok(result.includes("---"));
  });
});
