'use strict';

const { z } = require('zod');

const workspaceSelectSchema = z.object({}).passthrough();

const workspaceOpenLocalSchema = z.object({
  rootPath: z.string().optional().default(''),
  folderName: z.string().optional().default(''),
});

const workspaceFileCreateSchema = z.object({
  path: z.string().min(1, 'File path is required'),
  content: z.string().default(''),
  overwrite: z.boolean().optional().default(false),
  workspaceId: z.string().optional().default(''),
  sessionId: z.string().optional().default(''),
});

const workspaceFileSaveSchema = z.object({
  path: z.string().min(1, 'File path is required'),
  content: z.string(),
  workspaceId: z.string().optional().default(''),
  sessionId: z.string().optional().default(''),
});

const workspaceSyncSchema = z.object({
  workspaceId: z.string().optional(),
  folderName: z.string().optional(),
  files: z.array(z.unknown()).optional(),
  deletedPaths: z.array(z.string()).optional(),
  append: z.boolean().optional(),
  mode: z.string().optional(),
  scanEpoch: z.number().optional(),
  complete: z.boolean().optional(),
});

const workspaceRecoverySchema = z.object({
  spanIds: z.array(z.string()).optional().default([]),
  ranges: z.array(z.unknown()).optional().default([]),
});

const workspaceRenameSchema = z.object({
  fromPath: z.string().min(1, 'Source path is required'),
  toPath: z.string().min(1, 'Destination path is required'),
  overwrite: z.boolean().optional().default(false),
  workspaceId: z.string().optional().default(''),
  sessionId: z.string().optional().default(''),
});

const workspaceBatchSchema = z.object({
  operations: z.array(z.unknown()).optional().default([]),
  stopOnError: z.boolean().optional().default(true),
});

const workspaceReindexSchema = z.object({
  files: z.array(z.string()).optional(),
});

const workspaceGrepSchema = z.object({
  limit: z.number().int().min(1).max(500).optional().default(40),
  caseSensitive: z.boolean().optional().default(false),
}).passthrough();

const workspacePurgeSchema = z.object({
  workspaceId: z.string().optional().default(''),
  sessionId: z.string().optional().default(''),
});

module.exports = {
  workspaceSelectSchema,
  workspaceOpenLocalSchema,
  workspaceFileCreateSchema,
  workspaceFileSaveSchema,
  workspaceSyncSchema,
  workspaceRecoverySchema,
  workspaceRenameSchema,
  workspaceBatchSchema,
  workspaceReindexSchema,
  workspaceGrepSchema,
  workspacePurgeSchema,
};
