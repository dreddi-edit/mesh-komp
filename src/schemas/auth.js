'use strict';

const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Must be a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const sessionRevokeSchema = z.object({
  mode: z.enum(['single', 'all', 'others']).default('single'),
  sessionId: z.string().optional(),
});

module.exports = { loginSchema, sessionRevokeSchema };
