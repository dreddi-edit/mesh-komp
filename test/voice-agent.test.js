"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_VOICE_AUTONOMY_MODE,
  voiceToolDefinitions,
  voiceChatToolDefinitions,
  buildVoiceInstructions,
} = require("../src/core/voice-agent");

// ── DEFAULT_VOICE_AUTONOMY_MODE ───────────────────────────────────────────────

describe("DEFAULT_VOICE_AUTONOMY_MODE", () => {
  it("is a non-empty string", () => {
    assert.equal(typeof DEFAULT_VOICE_AUTONOMY_MODE, "string");
    assert.ok(DEFAULT_VOICE_AUTONOMY_MODE.length > 0);
  });
});

// ── voiceToolDefinitions ───────────────────────────────────────────────────────

describe("voiceToolDefinitions", () => {
  it("returns an array", () => {
    const tools = voiceToolDefinitions();
    assert.ok(Array.isArray(tools));
  });

  it("returns at least one tool definition", () => {
    const tools = voiceToolDefinitions();
    assert.ok(tools.length > 0);
  });

  it("each tool has required OpenAI-style fields", () => {
    const tools = voiceToolDefinitions();
    for (const tool of tools) {
      assert.equal(tool.type, "function", `tool ${tool.name} should have type=function`);
      assert.ok(typeof tool.name === "string" && tool.name.length > 0, "tool must have a name");
      assert.ok(typeof tool.description === "string" && tool.description.length > 0, "tool must have a description");
      assert.ok(tool.parameters && typeof tool.parameters === "object", "tool must have parameters");
      assert.equal(tool.parameters.type, "object");
    }
  });

  it("includes a delegate_task tool", () => {
    const tools = voiceToolDefinitions();
    const delegateTool = tools.find((t) => t.name === "delegate_task");
    assert.ok(delegateTool, "delegate_task tool should exist");
    assert.ok(delegateTool.parameters.properties.prompt, "delegate_task should have prompt parameter");
  });

  it("delegate_task requires prompt", () => {
    const tools = voiceToolDefinitions();
    const delegateTool = tools.find((t) => t.name === "delegate_task");
    assert.ok(delegateTool.parameters.required.includes("prompt"));
  });
});

// ── voiceChatToolDefinitions ──────────────────────────────────────────────────

describe("voiceChatToolDefinitions", () => {
  it("returns an array with the same count as voiceToolDefinitions", () => {
    const chat = voiceChatToolDefinitions();
    const voice = voiceToolDefinitions();
    assert.equal(chat.length, voice.length);
  });

  it("wraps tools in OpenAI chat format with function key", () => {
    const chat = voiceChatToolDefinitions();
    for (const tool of chat) {
      assert.equal(tool.type, "function");
      assert.ok(tool.function && typeof tool.function === "object", "should have function key");
      assert.ok(typeof tool.function.name === "string");
      assert.ok(typeof tool.function.description === "string");
    }
  });

  it("delegate_task is present in chat format", () => {
    const chat = voiceChatToolDefinitions();
    const delegateTool = chat.find((t) => t.function.name === "delegate_task");
    assert.ok(delegateTool, "delegate_task should be present in chat format");
  });
});

// ── buildVoiceInstructions ────────────────────────────────────────────────────

describe("buildVoiceInstructions", () => {
  it("returns a non-empty string", () => {
    const result = buildVoiceInstructions({});
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0);
  });

  it("includes delegate_task guidance", () => {
    const result = buildVoiceInstructions({});
    assert.ok(result.includes("delegate_task"));
  });

  it("includes selected model when provided", () => {
    const result = buildVoiceInstructions({ selectedCodingModel: "claude-opus-4-7" });
    assert.ok(result.includes("claude-opus-4-7"));
  });

  it("does not include model line when model is absent", () => {
    const result = buildVoiceInstructions({});
    assert.ok(!result.includes("Delegate coding work using model"));
  });

  it("appends capsule context when provided", () => {
    const capsule = "### src/app.js\nconsole.log('hello')";
    const result = buildVoiceInstructions({}, capsule);
    assert.ok(result.includes("Workspace context"));
    assert.ok(result.includes(capsule));
  });

  it("does not include workspace context section when empty", () => {
    const result = buildVoiceInstructions({}, "");
    assert.ok(!result.includes("Workspace context"));
  });

  it("handles null state gracefully", () => {
    assert.doesNotThrow(() => buildVoiceInstructions(null));
    assert.doesNotThrow(() => buildVoiceInstructions(undefined));
  });
});
