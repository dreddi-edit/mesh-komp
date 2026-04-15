'use strict';

/**
 * CloudWatch Bedrock metrics integration for ccmon.
 *
 * Fetches InputTokenCount and OutputTokenCount from AWS/Bedrock namespace.
 * These metrics are the authoritative billing source — more accurate than
 * the estimated costs derived from ~/.claude/projects JSONL files.
 *
 * Requires: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (or instance profile).
 * Region: AWS_REGION_BEDROCK or AWS_REGION, default us-east-1.
 */

const { CloudWatchClient, GetMetricStatisticsCommand, ListMetricsCommand } = require('@aws-sdk/client-cloudwatch');

const CW_NAMESPACE = 'AWS/Bedrock';
const CW_RESOLUTION_SECONDS = 3600; // 1-hour granularity — finest CloudWatch supports for Bedrock
const CW_MAX_DATAPOINTS = 1440;     // 60 days of hourly data

/** Map Bedrock modelId prefixes → ccmon pricing table model keys */
const BEDROCK_MODEL_ALIAS = {
  'anthropic.claude-sonnet-4-6':                    'claude-sonnet-4-6',
  'us.anthropic.claude-sonnet-4-6':                 'claude-sonnet-4-6',
  'anthropic.claude-opus-4-6':                      'claude-opus-4-6',
  'us.anthropic.claude-opus-4-6':                   'claude-opus-4-6',
  'anthropic.claude-haiku-4-5':                     'claude-haiku-4-5',
  'us.anthropic.claude-haiku-4-5':                  'claude-haiku-4-5',
  'anthropic.claude-opus-4-5':                      'claude-opus-4-5',
  'us.anthropic.claude-opus-4-5':                   'claude-opus-4-5',
  'anthropic.claude-sonnet-4-5':                    'claude-sonnet-4-5',
  'us.anthropic.claude-sonnet-4-5':                 'claude-sonnet-4-5',
};

/**
 * Normalise a raw Bedrock ModelId dimension value into the short ccmon model key.
 * Falls back to the raw value if no alias found.
 * @param {string} modelId
 * @returns {string}
 */
function normalizeModelId(modelId) {
  const raw = String(modelId || '').trim();
  // Exact match first.
  if (BEDROCK_MODEL_ALIAS[raw]) return BEDROCK_MODEL_ALIAS[raw];
  // Prefix match for versioned IDs (e.g. us.anthropic.claude-sonnet-4-6-20251001-v1:0).
  for (const [prefix, alias] of Object.entries(BEDROCK_MODEL_ALIAS)) {
    if (raw.startsWith(prefix)) return alias;
  }
  // Strip version suffix and retry (e.g. us.anthropic.claude-sonnet-4-6-20251001 → claude-sonnet-4-6).
  const stripped = raw.replace(/-\d{8}(-v\d+:\d+)?$/, '').replace(/^(us\.|eu\.|ap\.)/, '').replace(/^anthropic\./, '');
  return stripped || raw;
}

/**
 * Build a CloudWatch client using env-var credentials, same as the Bedrock client.
 * @returns {CloudWatchClient}
 */
function buildCloudWatchClient() {
  const region = process.env.AWS_REGION_BEDROCK || process.env.AWS_REGION || 'us-east-1';
  const config = { region };

  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  if (accessKeyId && secretAccessKey) {
    config.credentials = { accessKeyId, secretAccessKey };
  }
  // If no explicit credentials, the AWS SDK will use instance profile / env / ~/.aws/credentials.

  return new CloudWatchClient(config);
}

/**
 * List all unique ModelId dimension values published to the AWS/Bedrock namespace.
 * @param {CloudWatchClient} client
 * @returns {Promise<string[]>}
 */
async function listBedrockModelIds(client) {
  const models = new Set();
  let nextToken;

  do {
    const cmd = new ListMetricsCommand({
      Namespace: CW_NAMESPACE,
      MetricName: 'InputTokenCount',
      ...(nextToken ? { NextToken: nextToken } : {}),
    });
    const response = await client.send(cmd);
    for (const metric of (response.Metrics || [])) {
      for (const dim of (metric.Dimensions || [])) {
        if (dim.Name === 'ModelId') models.add(dim.Value);
      }
    }
    nextToken = response.NextToken;
  } while (nextToken);

  return [...models];
}

/**
 * Fetch hourly token counts for a single metric + modelId over a date range.
 * Returns an array of { timestamp: Date, sum: number } objects.
 * @param {CloudWatchClient} client
 * @param {'InputTokenCount'|'OutputTokenCount'} metricName
 * @param {string} modelId  raw Bedrock ModelId dimension value
 * @param {Date} startTime
 * @param {Date} endTime
 * @returns {Promise<Array<{timestamp: Date, sum: number}>>}
 */
async function fetchTokenMetric(client, metricName, modelId, startTime, endTime) {
  const cmd = new GetMetricStatisticsCommand({
    Namespace: CW_NAMESPACE,
    MetricName: metricName,
    Dimensions: [{ Name: 'ModelId', Value: modelId }],
    StartTime: startTime,
    EndTime: endTime,
    Period: CW_RESOLUTION_SECONDS,
    Statistics: ['Sum'],
  });

  const response = await client.send(cmd);
  return (response.Datapoints || [])
    .map((dp) => ({ timestamp: new Date(dp.Timestamp), sum: Number(dp.Sum || 0) }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fetch Bedrock token usage from CloudWatch and return a day-keyed summary map.
 *
 * Merges InputTokenCount and OutputTokenCount across all active ModelIds.
 * Cost is calculated using local pricing table.
 *
 * @param {object} [options]
 * @param {number} [options.lookbackDays=30]  how many days back to query
 * @returns {Promise<{ok: boolean, byDate: Map<string, object>, error?: string}>}
 */
async function fetchBedrockUsageFromCloudWatch(options = {}) {
  const { calculateCost } = require('./pricing.js');
  const lookbackDays = Math.min(Math.max(Number(options.lookbackDays) || 30, 1), 60);

  let client;
  try {
    client = buildCloudWatchClient();
  } catch (err) {
    return { ok: false, byDate: new Map(), error: `CloudWatch client init failed: ${err.message}` };
  }

  const endTime = new Date();
  const startTime = new Date(endTime - lookbackDays * 86400_000);

  let modelIds;
  try {
    modelIds = await listBedrockModelIds(client);
  } catch (err) {
    return { ok: false, byDate: new Map(), error: `ListMetrics failed: ${err.message}` };
  }

  if (modelIds.length === 0) {
    return { ok: true, byDate: new Map(), error: 'No Bedrock metrics found in CloudWatch (no usage yet, or wrong region)' };
  }

  const byDate = new Map();

  // Fetch InputTokenCount + OutputTokenCount for all models in parallel.
  await Promise.all(
    modelIds.flatMap((modelId) => [
      fetchTokenMetric(client, 'InputTokenCount', modelId, startTime, endTime)
        .then((datapoints) => {
          const normalizedModel = normalizeModelId(modelId);
          for (const { timestamp, sum } of datapoints) {
            const dateKey = timestamp.toISOString().slice(0, 10);
            if (!byDate.has(dateKey)) byDate.set(dateKey, makeDaySummary());
            const day = byDate.get(dateKey);
            day.tokensIn += sum;
            day.cwModels.add(normalizedModel);
            // Approximate cost contribution (output unknown here — added below).
            day._pendingInput[normalizedModel] = (day._pendingInput[normalizedModel] || 0) + sum;
          }
        })
        .catch(() => { /* skip failing modelId */ }),

      fetchTokenMetric(client, 'OutputTokenCount', modelId, startTime, endTime)
        .then((datapoints) => {
          const normalizedModel = normalizeModelId(modelId);
          for (const { timestamp, sum } of datapoints) {
            const dateKey = timestamp.toISOString().slice(0, 10);
            if (!byDate.has(dateKey)) byDate.set(dateKey, makeDaySummary());
            const day = byDate.get(dateKey);
            day.tokensOut += sum;
            day.cwModels.add(normalizedModel);
            day._pendingOutput[normalizedModel] = (day._pendingOutput[normalizedModel] || 0) + sum;
          }
        })
        .catch(() => { /* skip failing modelId */ }),
    ]),
  );

  // Calculate cost from aggregated token counts per model per day.
  for (const day of byDate.values()) {
    const allModels = new Set([...Object.keys(day._pendingInput), ...Object.keys(day._pendingOutput)]);
    for (const model of allModels) {
      const inputTokens = day._pendingInput[model] || 0;
      const outputTokens = day._pendingOutput[model] || 0;
      day.costUSD += calculateCost(
        { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        model,
      );
    }
    // Clean up temporary accumulator fields before returning.
    delete day._pendingInput;
    delete day._pendingOutput;
    day.cwModels = [...day.cwModels];
  }

  return { ok: true, byDate };
}

function makeDaySummary() {
  return {
    costUSD: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    requests: 0,
    cwModels: new Set(),
    _pendingInput: {},
    _pendingOutput: {},
  };
}

/**
 * Merge a CloudWatch byDate map into the JSONL-derived byDate map.
 * CloudWatch data wins for tokensIn/tokensOut/costUSD (authoritative billing source).
 * JSONL data fills cacheRead/cacheWrite/requests which CloudWatch doesn't expose.
 *
 * @param {Map<string, object>} jsonlByDate  — from loadAllHistory / buildHistoryFromEvents
 * @param {Map<string, object>} cwByDate     — from fetchBedrockUsageFromCloudWatch
 * @returns {Map<string, object>}
 */
function mergeCloudWatchIntoHistory(jsonlByDate, cwByDate) {
  const merged = new Map();

  // Start from JSONL data.
  for (const [date, day] of jsonlByDate) {
    merged.set(date, { ...day });
  }

  // Overlay CloudWatch: authoritative token + cost figures.
  for (const [date, cwDay] of cwByDate) {
    if (merged.has(date)) {
      const existing = merged.get(date);
      merged.set(date, {
        ...existing,
        tokensIn: cwDay.tokensIn,    // CloudWatch wins
        tokensOut: cwDay.tokensOut,  // CloudWatch wins
        costUSD: cwDay.costUSD,      // CloudWatch wins
        // cacheRead / cacheWrite / requests stay from JSONL — CW doesn't have these
        cwModels: cwDay.cwModels,
        cwSource: true,
      });
    } else {
      merged.set(date, {
        costUSD: cwDay.costUSD,
        tokensIn: cwDay.tokensIn,
        tokensOut: cwDay.tokensOut,
        cacheRead: 0,
        cacheWrite: 0,
        requests: 0,
        cwModels: cwDay.cwModels,
        cwSource: true,
      });
    }
  }

  return merged;
}

module.exports = {
  fetchBedrockUsageFromCloudWatch,
  mergeCloudWatchIntoHistory,
  normalizeModelId,
};
