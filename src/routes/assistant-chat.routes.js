'use strict';

/**
 * MESH — Chat, Streaming, Codec, and Inline Completion routes
 *
 * Covers: POST /api/assistant/chat, POST /api/assistant/chat/stream,
 *         POST /api/assistant/codec/decode, POST /api/inline-complete.
 *
 * The streaming helpers (streamBedrockDirect, streamOpenAICompatible,
 * finalizeStreamedResponse) live in this module because they are only
 * used by the stream route and carry significant codec state.
 *
 * @param {object} core  All exports from src/core/index.js
 * @returns {import('express').Router}
 */

const express = require('express');
const config = require('../config');
const logger = require('../logger');
const { safeRouteError } = require('./route-utils');

function createChatRouter(core) {
  const {
    requireAuth,
    meshTunnelRequest,
    localAssistantReply,
    buildCapsuleContextBlock,
    loadCapsuleContextEntries,
    loadRecoveredSpanEntries,
    buildServerCodecRecovery,
    resolveAdaptiveCompressedContextBudget,
    inferReferencedFilesFromWorkspace,
    localResolveReferencedFiles,
    dedupePaths,
    extractActiveFilePathFromMessages,
    normalizeChatSessionId,
    normalizeMessages,
    mergeChatCredentials,
    getStoredCredentialsForUser,
    injectMeshSystemPrompt,
    runModelChat,
    resolveProviderForModel,
    resolveBedrockModelId,
    createBedrockClient,
    buildModelResponseTransport,
    encodeMeshModelCodec,
    decodeCompressedModelResponse,
    hasCodecContextMarker,
    buildMeshCodecContextDocument,
    injectCodecContextIntoMessages,
    injectCompressedContextIntoMessages,
    isCodecContextInitializedForSession,
    markCodecContextInitialized,
    looksLikeCodecProtocolRefusal,
    polishDecompressedAssistantText,
    toSafePath,
    toAnthropicMessages,
    MESH_DEFAULT_MODEL,
    MESH_MODEL_CODEC_VERSION,
  } = core;

  const router = express.Router();

  // ── POST /api/assistant/chat ───────────────────────────────────────────────

  router.post('/api/assistant/chat', requireAuth, async (req, res) => {
    const {
      model = MESH_DEFAULT_MODEL || 'claude-sonnet-4-6',
      messages = [],
      activeFilePath = '',
      chatSessionId = '',
    } = req.body || {};

    const storedCredentials = await getStoredCredentialsForUser(req.authUser?.id);
    const resolvedCredentials = mergeChatCredentials(storedCredentials);
    const normalizedMessages = normalizeMessages(messages);
    const normalizedSessionId = normalizeChatSessionId(chatSessionId);

    let referencedFiles = [];
    const lastUserMessage = normalizedMessages.filter((m) => m?.role === 'user').at(-1)?.content || '';
    try {
      const context = await meshTunnelRequest('chat', { model, messages: normalizedMessages });
      referencedFiles = Array.isArray(context?.referencedFiles) ? context.referencedFiles : [];
    } catch {
      referencedFiles = await localResolveReferencedFiles(lastUserMessage);
    }

    if (referencedFiles.length === 0) {
      const inferred = await inferReferencedFilesFromWorkspace(lastUserMessage);
      if (inferred.length > 0) referencedFiles = inferred;
    }

    const requestedActiveFile = toSafePath(activeFilePath);
    const taggedActiveFile = extractActiveFilePathFromMessages(normalizedMessages);
    const contextPaths = dedupePaths([requestedActiveFile, taggedActiveFile, ...referencedFiles]);
    const hasActiveFileFocus = Boolean(requestedActiveFile || taggedActiveFile);
    const adaptiveContextBudget = resolveAdaptiveCompressedContextBudget({ lastUserMessage, hasActiveFileFocus });

    // Capsule loading and span recovery are independent — run them in parallel.
    const spanRecoveryPaths = contextPaths.slice(0, hasActiveFileFocus ? 2 : 1);
    const [capsuleContextResult, recoveredSpanEntries] = await Promise.all([
      loadCapsuleContextEntries(contextPaths, {
        maxFiles: adaptiveContextBudget.maxFiles,
        maxModelChars: adaptiveContextBudget.maxModelCompressedChars,
        firstFileMaxModelChars: adaptiveContextBudget.firstFileMaxModelCompressedChars,
        query: lastUserMessage,
        disableCodecDictionary: adaptiveContextBudget.disableCodecDictionary,
      }),
      loadRecoveredSpanEntries(spanRecoveryPaths, lastUserMessage, {
        maxFiles: hasActiveFileFocus ? 2 : 1,
        maxSpansPerFile: hasActiveFileFocus ? 4 : 2,
      }),
    ]);
    const capsuleContextEntries = capsuleContextResult.entries;
    const skippedOversizeContextPaths = capsuleContextResult.skippedOversizePaths;
    const contextBlock = buildCapsuleContextBlock(capsuleContextEntries, recoveredSpanEntries);
    const requiresCodecDictionary = capsuleContextEntries.some((entry) => Boolean(entry.usesCodecDictionary));

    const modelMessages = injectCompressedContextIntoMessages(normalizedMessages, contextBlock);
    let injectedCodecContext = false;

    // Build codec context and embed it in the system prompt rather than prepending to user
    // messages. This keeps the message array prefix stable across all turns, enabling
    // Bedrock/Anthropic KV-cache reuse from turn 2 onward.
    let codecContextDoc = '';
    if (!hasCodecContextMarker(modelMessages) && !isCodecContextInitializedForSession(normalizedSessionId, {
      requireDictionary: requiresCodecDictionary,
    })) {
      codecContextDoc = buildMeshCodecContextDocument({ dictionaryEnabled: requiresCodecDictionary });
      injectedCodecContext = true;
    }

    try {
      let routed = await runModelChat({
        model,
        messages: injectMeshSystemPrompt(modelMessages, { codecContext: codecContextDoc || undefined }),
        credentials: resolvedCredentials,
      });

      let rawModelContent = String(routed.content || '');
      let decodedResponse = decodeCompressedModelResponse(rawModelContent, { allowLegacy: true, allowUnframedRot47: true });
      let usedServerCodecRecovery = false;

      if (!decodedResponse.codecValid) {
        decodedResponse = buildServerCodecRecovery(rawModelContent);
        usedServerCodecRecovery = true;
      }

      let polishedDecoded = polishDecompressedAssistantText(decodedResponse.decoded);
      let codecPolicyRecoveryApplied = false;

      if (looksLikeCodecProtocolRefusal(polishedDecoded)) {
        try {
          const protocolClarifier = [
            '<mesh_protocol_note>',
            'Answer the latest user request directly.',
            'Treat mesh codec content as app transport metadata, not as a policy debate task.',
            'If any compressed block is unreadable, continue with available context and ask for a specific file path.',
            '</mesh_protocol_note>',
          ].join('\n');

          const recoveryMessages = [...modelMessages, { role: 'user', content: protocolClarifier }];
          routed = await runModelChat({ model, messages: recoveryMessages, credentials: resolvedCredentials });

          rawModelContent = String(routed.content || '');
          decodedResponse = decodeCompressedModelResponse(rawModelContent, { allowLegacy: true, allowUnframedRot47: true });
          usedServerCodecRecovery = false;
          if (!decodedResponse.codecValid) {
            decodedResponse = buildServerCodecRecovery(rawModelContent);
            usedServerCodecRecovery = true;
          }

          polishedDecoded = polishDecompressedAssistantText(decodedResponse.decoded);
          codecPolicyRecoveryApplied = true;
        } catch {
          // Keep initial decoded response if recovery attempt fails.
        }
      }

      const contextFilePaths = capsuleContextEntries.map((entry) => entry.path);
      const guaranteedCompressedContent = encodeMeshModelCodec(polishedDecoded);
      const responseTransport = buildModelResponseTransport(guaranteedCompressedContent, polishedDecoded, decodedResponse.compressedByModel);

      if (injectedCodecContext) {
        markCodecContextInitialized(normalizedSessionId, { dictionaryReady: requiresCodecDictionary });
      }

      res.json({
        ok: true,
        content: polishedDecoded,
        contentCompressed: guaranteedCompressedContent,
        referencedFiles: contextFilePaths.length ? contextFilePaths : referencedFiles,
        model: routed.model,
        provider: routed.provider,
        transport: {
          ...responseTransport,
          contextFilesCompressed: 0,
          contextFilesCapsules: capsuleContextEntries.length,
          contextFilesTruncated: capsuleContextEntries.filter((entry) => Boolean(entry.contentTruncated)).length,
          contextFilesPlain: 0,
          contextFilesSkippedOversize: skippedOversizeContextPaths.length,
          contextRecoveredSpans: recoveredSpanEntries.length,
          contextBudgetMode: adaptiveContextBudget.mode,
          contextCodec: MESH_MODEL_CODEC_VERSION,
          codecMode: decodedResponse.codecMode,
          codecRetryAttempted: false,
          serverCodecRecovery: usedServerCodecRecovery,
          responseCompressedByGateway: true,
          codecPolicyRecoveryApplied,
          providerInputTokens: Number(routed?.usage?.inputTokens || 0),
          providerOutputTokens: Number(routed?.usage?.outputTokens || 0),
          providerTotalTokens: Number(routed?.usage?.totalTokens || 0),
          providerCacheCreationInputTokens: Number(routed?.usage?.cacheCreationInputTokens || 0),
          providerCacheReadInputTokens: Number(routed?.usage?.cacheReadInputTokens || 0),
          providerRequestId: String(routed?.providerRequestId || ''),
        },
      });
    } catch (error) {
      const message = String(error?.message || '');
      if (/returned no content/i.test(message)) {
        try {
          const fallback = await localAssistantReply(model, normalizedMessages);
          const fallbackDecoded = polishDecompressedAssistantText(String(fallback?.content || ''));
          const fallbackCompressed = encodeMeshModelCodec(fallbackDecoded);
          res.json({
            ok: true,
            content: fallbackDecoded,
            contentCompressed: fallbackCompressed,
            referencedFiles,
            model,
            provider: 'local-fallback',
            transport: {
              responseEncoding: `mesh-${MESH_MODEL_CODEC_VERSION}`,
              responseEncodedBytes: Buffer.byteLength(fallbackCompressed, 'utf8'),
              responseDecodedBytes: Buffer.byteLength(fallbackDecoded, 'utf8'),
              compressedByModel: false,
              contextFilesCompressed: 0,
              contextFilesCapsules: 0,
              contextFilesPlain: 0,
              contextFilesSkippedOversize: 0,
              contextRecoveredSpans: 0,
              contextCodec: MESH_MODEL_CODEC_VERSION,
              codecMode: 'fallback-reencoded',
              serverCodecRecovery: false,
              responseCompressedByGateway: true,
              providerInputTokens: 0,
              providerOutputTokens: 0,
              providerTotalTokens: 0,
              providerCacheCreationInputTokens: 0,
              providerCacheReadInputTokens: 0,
              providerRequestId: '',
            },
            warning: `${message}. Falling back to local assistant context.`,
          });
          return;
        } catch {
          // Continue to regular error response below.
        }
      }
      res.status(400).json({ ok: false, error: message || 'Chat request failed', model, referencedFiles });
    }
  });

  // ── POST /api/assistant/codec/decode ──────────────────────────────────────

  router.post('/api/assistant/codec/decode', requireAuth, async (req, res) => {
    try {
      const payload = String(req.body?.payload || req.body?.contentCompressed || '').trim();
      if (!payload) {
        res.status(400).json({ ok: false, error: 'Missing compressed payload' });
        return;
      }
      const decoded = decodeCompressedModelResponse(payload, { allowLegacy: true, allowUnframedRot47: true });
      if (!decoded.codecValid) {
        res.status(400).json({ ok: false, error: 'Invalid compressed payload', codecMode: decoded.codecMode || 'invalid' });
        return;
      }
      res.json({
        ok: true,
        content: polishDecompressedAssistantText(decoded.decoded),
        codecMode: decoded.codecMode || 'decoded',
        responseEncoding: `mesh-${MESH_MODEL_CODEC_VERSION}`,
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error?.message || 'Codec decode failed') });
    }
  });

  // ── POST /api/assistant/chat/stream ───────────────────────────────────────

  router.post('/api/assistant/chat/stream', requireAuth, async (req, res) => {
    const {
      model = MESH_DEFAULT_MODEL || 'claude-sonnet-4-6',
      messages = [],
      activeFilePath = '',
      chatSessionId = '',
    } = req.body || {};

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    function sendSSE(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    try {
      const storedCredentials = await getStoredCredentialsForUser(req.authUser?.id);
      const resolvedCredentials = mergeChatCredentials(storedCredentials);
      const normalizedMessages = normalizeMessages(messages);
      const normalizedSessionId = normalizeChatSessionId(chatSessionId);

      let referencedFiles = [];
      const lastUserMessage = normalizedMessages.filter((m) => m?.role === 'user').at(-1)?.content || '';
      try {
        const context = await meshTunnelRequest('chat', { model, messages: normalizedMessages });
        referencedFiles = Array.isArray(context?.referencedFiles) ? context.referencedFiles : [];
      } catch {
        referencedFiles = await localResolveReferencedFiles(lastUserMessage);
      }

      if (referencedFiles.length === 0) {
        const inferred = await inferReferencedFilesFromWorkspace(lastUserMessage);
        if (inferred.length > 0) referencedFiles = inferred;
      }

      const requestedActiveFile = toSafePath(activeFilePath);
      const taggedActiveFile = extractActiveFilePathFromMessages(normalizedMessages);
      const contextPaths = dedupePaths([requestedActiveFile, taggedActiveFile, ...referencedFiles]);
      const hasActiveFileFocus = Boolean(requestedActiveFile || taggedActiveFile);
      const adaptiveContextBudget = resolveAdaptiveCompressedContextBudget({ lastUserMessage, hasActiveFileFocus });

      // Capsule loading and span recovery are independent — run them in parallel.
      const spanRecoveryPaths = contextPaths.slice(0, hasActiveFileFocus ? 2 : 1);
      const [capsuleContextResult, recoveredSpanEntries] = await Promise.all([
        loadCapsuleContextEntries(contextPaths, {
          maxFiles: adaptiveContextBudget.maxFiles,
          maxModelChars: adaptiveContextBudget.maxModelCompressedChars,
          firstFileMaxModelChars: adaptiveContextBudget.firstFileMaxModelCompressedChars,
          query: lastUserMessage,
          disableCodecDictionary: adaptiveContextBudget.disableCodecDictionary,
        }),
        loadRecoveredSpanEntries(spanRecoveryPaths, lastUserMessage, {
          maxFiles: hasActiveFileFocus ? 2 : 1,
          maxSpansPerFile: hasActiveFileFocus ? 4 : 2,
        }),
      ]);
      const capsuleContextEntries = capsuleContextResult.entries;
      const contextBlock = buildCapsuleContextBlock(capsuleContextEntries, recoveredSpanEntries);
      const requiresCodecDictionary = capsuleContextEntries.some((entry) => Boolean(entry.usesCodecDictionary));

      let modelMessages = injectCompressedContextIntoMessages(normalizedMessages, contextBlock);
      let injectedCodecContext = false;

      // Build codec context and embed it in the system prompt rather than prepending to user
      // messages. This keeps the message array prefix stable across all turns, enabling
      // Bedrock/Anthropic KV-cache reuse from turn 2 onward.
      let codecContextDoc = '';
      if (!hasCodecContextMarker(modelMessages) && !isCodecContextInitializedForSession(normalizedSessionId, {
        requireDictionary: requiresCodecDictionary,
      })) {
        codecContextDoc = buildMeshCodecContextDocument({ dictionaryEnabled: requiresCodecDictionary });
        injectedCodecContext = true;
      }

      const messagesWithSystem = injectMeshSystemPrompt(modelMessages, { codecContext: codecContextDoc || undefined });

      sendSSE('context', {
        referencedFiles: capsuleContextEntries.map((e) => e.path),
        capsuleCount: capsuleContextEntries.length,
        recoveredSpans: recoveredSpanEntries.length,
      });

      const resolved = resolveProviderForModel(model, resolvedCredentials);

      if (resolved.provider === 'anthropic') {
        const apiKey = String(resolvedCredentials?.anthropic?.apiKey || config.ANTHROPIC_API_KEY || '').trim();
        const bedrockAccessKey = String(config.AWS_ACCESS_KEY_ID || '').trim();
        // Prefer direct Bedrock SDK when IAM credentials are configured — covers all claude-* models.
        const isBedrockTarget = resolved.model.startsWith('claude-');

        if (bedrockAccessKey && isBedrockTarget) {
          await streamBedrockDirect({
            model: resolved.model, messages: messagesWithSystem, res, sendSSE,
            injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
            capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget,
            referencedFiles: capsuleContextEntries.map((e) => e.path),
            // codec helpers threaded in to avoid re-importing
            decodeCompressedModelResponse, buildServerCodecRecovery,
            polishDecompressedAssistantText, encodeMeshModelCodec, markCodecContextInitialized,
            resolveBedrockModelId, createBedrockClient,
          });
          return;
        } else if (apiKey) {
          await streamAnthropicNative({
            apiKey, model: resolved.model, messages: messagesWithSystem, res, sendSSE,
            injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
            capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget, referencedFiles,
            decodeCompressedModelResponse, buildServerCodecRecovery,
            polishDecompressedAssistantText, encodeMeshModelCodec, markCodecContextInitialized,
            toAnthropicMessages,
          });
        } else {
          sendSSE('error', { error: 'Missing Anthropic API key' });
        }
      } else if (resolved.provider === 'openai') {
        const userApiKey = String(resolvedCredentials?.openai?.apiKey || config.OPENAI_API_KEY || '').trim();
        if (userApiKey) {
          await streamOpenAICompatible({
            apiKey: userApiKey, model: resolved.model, messages: messagesWithSystem,
            baseUrl: 'https://api.openai.com/v1', orgId: String(resolvedCredentials?.openai?.orgId || '').trim(),
            res, sendSSE, injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
            capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget, referencedFiles,
            decodeCompressedModelResponse, buildServerCodecRecovery,
            polishDecompressedAssistantText, encodeMeshModelCodec, markCodecContextInitialized,
          });
        } else {
          sendSSE('error', { error: 'Missing OpenAI API key' });
        }
      } else {
        // Fallback: non-streaming for unsupported providers
        const routed = await runModelChat({ model, messages: messagesWithSystem, credentials: resolvedCredentials });
        const decoded = decodeCompressedModelResponse(String(routed.content || ''), { allowLegacy: true, allowUnframedRot47: true });
        const polished = polishDecompressedAssistantText(decoded.decoded);
        sendSSE('token', { text: polished });
        sendSSE('done', { content: polished, model: routed.model, provider: routed.provider });
      }

      res.end();
    } catch (error) {
      try {
        logger.error('Stream failed', { scope: 'assistant-routes', error: String(error?.message || error || 'unknown') });
        sendSSE('error', { error: 'Stream failed' });
        res.end();
      } catch { /* response already ended */ }
    }
  });

  // ── POST /api/inline-complete ──────────────────────────────────────────────

  router.post('/api/inline-complete', requireAuth, async (req, res) => {
    const {
      model = MESH_DEFAULT_MODEL || 'claude-sonnet-4-6',
      prefix = '',
      suffix = '',
      filePath = '',
      language = '',
    } = req.body || {};

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    function sendSSE(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    try {
      const storedCredentials = await getStoredCredentialsForUser(req.authUser?.id);
      const resolvedCredentials = mergeChatCredentials(storedCredentials);
      const lang = language || filePath.split('.').pop() || 'code';

      const messages = [
        { role: 'system', content: `You are a code completion engine. Complete the code where the cursor is. Output ONLY the completion text — no explanation, no markdown fences, no surrounding code. Language: ${lang}` },
        { role: 'user', content: `Complete the code at the cursor position:\n\n${prefix}<CURSOR>${suffix}\n\nProvide only the text that goes at <CURSOR>.` },
      ];

      const routed = await runModelChat({ model, messages, credentials: resolvedCredentials });
      const completion = String(routed.content || '').trim();

      sendSSE('completion', { text: completion });
      sendSSE('done', {});
      res.end();
    } catch (error) {
      logger.error('Completion failed', { scope: 'assistant-routes', error: String(error?.message || error || 'unknown') });
      sendSSE('error', { error: 'Completion failed' });
      res.end();
    }
  });

  return router;
}

// ── Streaming helpers ──────────────────────────────────────────────────────

/**
 * Stream an Anthropic model response via the AWS Bedrock SDK directly.
 * Uses InvokeModelWithResponseStreamCommand — no HTTP proxy, native streaming.
 */
async function streamBedrockDirect({
  model, messages, res, sendSSE,
  injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
  capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget, referencedFiles,
  decodeCompressedModelResponse, buildServerCodecRecovery, polishDecompressedAssistantText,
  encodeMeshModelCodec, markCodecContextInitialized, resolveBedrockModelId, createBedrockClient,
}) {
  const { InvokeModelWithResponseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
  const client = createBedrockClient();
  const bedrockModelId = resolveBedrockModelId(model);

  const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const conversation = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: String(m.content || '') }));

  const payload = { anthropic_version: 'bedrock-2023-05-31', max_tokens: 4096, messages: conversation };
  if (systemText) payload.system = systemText;

  const cmd = new InvokeModelWithResponseStreamCommand({
    modelId: bedrockModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await client.send(cmd);
  let fullContent = '';

  for await (const chunk of response.body) {
    if (!chunk.chunk?.bytes) continue;
    let evt;
    try { evt = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes)); } catch { continue; }
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
      fullContent += evt.delta.text;
      sendSSE('token', { text: evt.delta.text });
    }
  }

  await finalizeStreamedResponse({
    fullContent, injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
    capsuleContextEntries: capsuleContextEntries || [], recoveredSpanEntries: recoveredSpanEntries || [],
    adaptiveContextBudget: adaptiveContextBudget || {}, model, resolved: { model },
    referencedFiles: referencedFiles || [], sendSSE,
    decodeCompressedModelResponse, buildServerCodecRecovery, polishDecompressedAssistantText,
    encodeMeshModelCodec, markCodecContextInitialized,
  });
}

/**
 * Stream a response via the native Anthropic Messages API (non-Bedrock).
 */
async function streamAnthropicNative({
  apiKey, model, messages, res, sendSSE,
  injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
  capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget, referencedFiles,
  decodeCompressedModelResponse, buildServerCodecRecovery, polishDecompressedAssistantText,
  encodeMeshModelCodec, markCodecContextInitialized, toAnthropicMessages,
}) {
  const anthropicSystem = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const anthropicMsgs = toAnthropicMessages(messages);
  // NOTE: maxTokens comes from stored credentials; fall back to 1024 if not set.
  const maxTokens = 1024;

  const streamBody = { model, max_tokens: maxTokens, messages: anthropicMsgs, stream: true };
  if (anthropicSystem) streamBody.system = anthropicSystem;

  const streamResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(streamBody),
    signal: AbortSignal.timeout(120_000),
  });

  if (!streamResponse.ok) {
    const errBody = await streamResponse.text();
    logger.error(`Anthropic API error (${streamResponse.status})`, { scope: 'assistant-routes', body: errBody.slice(0, 500) });
    sendSSE('error', { error: `Anthropic API error (${streamResponse.status})` });
    res.end();
    return;
  }

  let fullContent = '';
  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          fullContent += event.delta.text;
          sendSSE('token', { text: event.delta.text });
        } else if (event.type === 'message_delta' && event.usage) {
          sendSSE('usage', { inputTokens: event.usage.input_tokens || 0, outputTokens: event.usage.output_tokens || 0 });
        }
      } catch { /* skip malformed JSON */ }
    }
  }

  await finalizeStreamedResponse({
    fullContent, injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
    capsuleContextEntries: capsuleContextEntries || [], recoveredSpanEntries: recoveredSpanEntries || [],
    adaptiveContextBudget: adaptiveContextBudget || {}, model, resolved: { model },
    referencedFiles: referencedFiles || [], sendSSE,
    decodeCompressedModelResponse, buildServerCodecRecovery, polishDecompressedAssistantText,
    encodeMeshModelCodec, markCodecContextInitialized,
  });
}

/**
 * Stream an OpenAI-compatible response (OpenAI, Azure, etc.).
 */
async function streamOpenAICompatible({
  apiKey, model, messages, baseUrl, orgId, isAzure, res, sendSSE,
  injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
  capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget, referencedFiles,
  decodeCompressedModelResponse, buildServerCodecRecovery, polishDecompressedAssistantText,
  encodeMeshModelCodec, markCodecContextInitialized,
}) {
  const headers = { 'Content-Type': 'application/json' };
  if (isAzure) {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (orgId) headers['OpenAI-Organization'] = orgId;

  const url = isAzure ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model,
    messages: messages.map((m) => ({
      role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    stream: true,
    max_tokens: 4096,
  };

  const streamResponse = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!streamResponse.ok) {
    const errBody = await streamResponse.text();
    logger.error(`Provider API error (${streamResponse.status})`, { scope: 'assistant-routes', body: errBody.slice(0, 500) });
    sendSSE('error', { error: `Provider API error (${streamResponse.status})` });
    return;
  }

  let fullContent = '';
  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          sendSSE('token', { text: delta });
        }
      } catch { /* skip malformed JSON */ }
    }
  }

  await finalizeStreamedResponse({
    fullContent, injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
    capsuleContextEntries: capsuleContextEntries || [], recoveredSpanEntries: recoveredSpanEntries || [],
    adaptiveContextBudget: adaptiveContextBudget || {}, model, resolved: { model },
    referencedFiles: referencedFiles || [], sendSSE,
    decodeCompressedModelResponse, buildServerCodecRecovery, polishDecompressedAssistantText,
    encodeMeshModelCodec, markCodecContextInitialized,
  });
}

/**
 * Shared post-stream finalization: decode, polish, compress, and send the
 * 'done' SSE event with full transport metadata.
 */
async function finalizeStreamedResponse({
  fullContent, injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
  capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget, model, resolved,
  referencedFiles, sendSSE,
  decodeCompressedModelResponse, buildServerCodecRecovery, polishDecompressedAssistantText,
  encodeMeshModelCodec, markCodecContextInitialized,
}) {
  let decodedResponse = decodeCompressedModelResponse(fullContent, { allowLegacy: true, allowUnframedRot47: true });
  let usedServerCodecRecovery = false;

  if (!decodedResponse.codecValid) {
    decodedResponse = buildServerCodecRecovery(fullContent);
    usedServerCodecRecovery = true;
  }

  const polished = polishDecompressedAssistantText(decodedResponse.decoded);
  const compressed = encodeMeshModelCodec(polished);

  if (injectedCodecContext) {
    markCodecContextInitialized(normalizedSessionId, { dictionaryReady: requiresCodecDictionary });
  }

  const contextPaths = capsuleContextEntries.map((e) => e.path);
  sendSSE('done', {
    content: polished,
    contentCompressed: compressed,
    referencedFiles: contextPaths.length ? contextPaths : referencedFiles,
    model: resolved.model || model,
    transport: {
      contextFilesCapsules: capsuleContextEntries.length,
      contextRecoveredSpans: recoveredSpanEntries.length,
      contextBudgetMode: adaptiveContextBudget.mode,
      serverCodecRecovery: usedServerCodecRecovery,
    },
  });
}

module.exports = { createChatRouter };
