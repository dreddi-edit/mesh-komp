'use strict';

const { z } = require('zod');

/** Schema for creating an assistant run */
const assistantRunSchema = z.object({
  model: z.string().optional().default('claude-sonnet-4-6'),
  mode: z.string().optional(),
  autonomyMode: z.string().optional(),
  prompt: z.string().min(1, 'Prompt is required'),
  workspaceFolderName: z.string().optional(),
  activeFilePath: z.string().optional(),
  selectedPaths: z.array(z.string()).optional().default([]),
  terminalSessionId: z.string().optional(),
  opsSelection: z.record(z.unknown()).optional().default({}),
  chatSessionId: z.string().optional(),
});

/** Schema for terminal session creation */
const terminalSessionSchema = z.object({
  shell: z.string().optional(),
});

/** Schema for terminal input */
const terminalInputSchema = z.object({
  input: z.string().min(1, 'Input is required'),
});

module.exports = {
  assistantRunSchema,
  terminalSessionSchema,
  terminalInputSchema,
};
