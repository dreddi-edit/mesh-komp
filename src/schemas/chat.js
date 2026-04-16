'use strict';

const { z } = require('zod');

const chatMessageSchema = z.object({
  model: z.string().optional(),
  messages: z.array(z.unknown()).optional().default([]),
  activeFilePath: z.string().optional().default(''),
  chatSessionId: z.string().optional().default(''),
}).passthrough();

const codecDecodeSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  sessionId: z.string().optional().default(''),
}).passthrough();

const inlineCompleteSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  model: z.string().optional(),
}).passthrough();

module.exports = { chatMessageSchema, codecDecodeSchema, inlineCompleteSchema };
