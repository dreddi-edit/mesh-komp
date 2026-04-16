'use strict';

const { z } = require('zod');

const assistantRunSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  model: z.string().optional().default('claude-sonnet-4-6'),
  mode: z.string().optional(),
  autonomyMode: z.string().optional(),
  workspaceFolderName: z.string().optional(),
  activeFilePath: z.string().optional(),
  selectedPaths: z.array(z.string()).optional().default([]),
  terminalSessionId: z.string().optional(),
  opsSelection: z.record(z.unknown()).optional().default({}),
  chatSessionId: z.string().optional(),
});

const terminalSessionSchema = z.object({
  shell: z.string().optional(),
});

const terminalInputSchema = z.object({
  input: z.string({ required_error: 'Input is required and must be a string' }),
});

module.exports = { assistantRunSchema, terminalSessionSchema, terminalInputSchema };
