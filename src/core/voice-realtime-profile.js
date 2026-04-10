'use strict';

const DEFAULT_REALTIME_ROOT = 'https://mesh-openai.openai.azure.com/';
const DEFAULT_REALTIME_DEPLOYMENT = 'gpt-realtime-1.5';
const DEFAULT_PREVIEW_API_VERSION = '2025-04-01-preview';
const UNKNOWN_PARAMETER_RE = /Unknown parameter:\s*'([^']+)'/i;

function trimText(value) {
  return String(value || '').trim();
}

function trimUrl(value) {
  return trimText(value);
}

function normalizeRootEndpoint(raw) {
  const trimmed = trimUrl(raw || DEFAULT_REALTIME_ROOT);
  return trimmed.replace(/\/+$/, '');
}

function buildUrlWithParams(base, params) {
  const wsBase = String(base || '').replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
  const url = new URL(wsBase);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function parseBooleanFlag(value, fallback) {
  const normalized = trimText(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function deploymentLooksPreview(name) {
  return /realtime-preview/i.test(String(name || ''));
}

function inferProtocolFromEndpoint(endpoint) {
  const normalized = normalizeRootEndpoint(endpoint);
  if (/\/openai\/v1\/realtime(?:$|\?)/i.test(normalized)) return 'ga-websocket';
  if (/\/openai\/realtime(?:$|\?)/i.test(normalized)) return 'preview-websocket';
  return '';
}

function normalizeRealtimeProtocol(value, fallback = 'ga-websocket') {
  const normalized = trimText(value).toLowerCase();
  if (['ga', 'ga-websocket', 'websocket-ga'].includes(normalized)) return 'ga-websocket';
  if (['preview', 'preview-websocket', 'websocket-preview'].includes(normalized)) return 'preview-websocket';
  return fallback;
}

function extractUnknownParameterField(message) {
  const match = String(message || '').match(UNKNOWN_PARAMETER_RE);
  return match ? String(match[1] || '').trim() : '';
}

function buildAzureRealtimeProfile(env = process.env) {
  const configuredEndpoint = trimUrl(env.AZURE_OPENAI_REALTIME_ENDPOINT);
  const rootEndpoint = normalizeRootEndpoint(env.AZURE_OPENAI_ENDPOINT || DEFAULT_REALTIME_ROOT);
  const deployment = trimText(env.AZURE_OPENAI_REALTIME_DEPLOYMENT || DEFAULT_REALTIME_DEPLOYMENT);
  const inferredProtocol = inferProtocolFromEndpoint(configuredEndpoint);
  const protocol = normalizeRealtimeProtocol(
    env.AZURE_OPENAI_REALTIME_PROTOCOL,
    inferredProtocol || (deploymentLooksPreview(deployment) ? 'preview-websocket' : 'ga-websocket')
  );
  const apiVersion = trimText(env.AZURE_OPENAI_REALTIME_API_VERSION || DEFAULT_PREVIEW_API_VERSION);
  const voice = trimText(env.AZURE_OPENAI_REALTIME_VOICE || 'alloy');
  const requireSessionType = parseBooleanFlag(
    env.AZURE_OPENAI_REALTIME_REQUIRE_SESSION_TYPE,
    protocol === 'ga-websocket'
  );
  const includeSessionModel = parseBooleanFlag(
    env.AZURE_OPENAI_REALTIME_INCLUDE_SESSION_MODEL,
    false
  );

  let websocketUrl = '';
  let label = '';

  if (configuredEndpoint) {
    const explicitProtocol = inferProtocolFromEndpoint(configuredEndpoint) || protocol;
    if (explicitProtocol === 'preview-websocket') {
      websocketUrl = buildUrlWithParams(configuredEndpoint, {
        'api-version': apiVersion,
        deployment,
      });
      label = 'configured preview realtime endpoint';
    } else {
      websocketUrl = buildUrlWithParams(configuredEndpoint, { model: deployment });
      label = 'configured GA realtime endpoint';
    }
  } else if (protocol === 'preview-websocket') {
    websocketUrl = buildUrlWithParams(`${rootEndpoint}/openai/realtime`, {
      'api-version': apiVersion,
      deployment,
    });
    label = 'derived preview realtime endpoint';
  } else {
    websocketUrl = buildUrlWithParams(`${rootEndpoint}/openai/v1/realtime`, {
      model: deployment,
    });
    label = 'derived GA realtime endpoint';
  }

  return {
    protocol,
    apiVersion,
    deployment,
    voice,
    requireSessionType,
    includeSessionModel,
    rootEndpoint,
    configuredEndpoint,
    websocketUrl,
    label,
  };
}

module.exports = {
  DEFAULT_REALTIME_ROOT,
  DEFAULT_REALTIME_DEPLOYMENT,
  DEFAULT_PREVIEW_API_VERSION,
  normalizeRealtimeProtocol,
  buildAzureRealtimeProfile,
  extractUnknownParameterField,
};
