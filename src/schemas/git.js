'use strict';

const { z } = require('zod');

const gitCheckoutSchema = z.object({
  branch: z.string().min(1, 'Branch name is required'),
});

const gitStageSchema = z.object({
  files: z.array(z.string()).optional().default([]),
});

const gitCommitSchema = z.object({
  message: z.string().min(1, 'Commit message is required'),
  files: z.array(z.string()).optional().default([]),
});

const gitStashSchema = z.object({
  action: z.enum(['push', 'pop', 'list']).optional().default('push'),
  message: z.string().optional().default('Mesh stash'),
});

const gitCloneSchema = z.object({
  url: z.string().min(1, 'Repository URL is required'),
  path: z.string().optional().default(''),
});

const gitCreateBranchSchema = z.object({
  name: z.string().min(1, 'Branch name is required'),
  startPoint: z.string().optional().default(''),
});

const gitDeleteBranchSchema = z.object({
  name: z.string().min(1, 'Branch name is required'),
});

module.exports = {
  gitCheckoutSchema,
  gitStageSchema,
  gitCommitSchema,
  gitStashSchema,
  gitCloneSchema,
  gitCreateBranchSchema,
  gitDeleteBranchSchema,
};
