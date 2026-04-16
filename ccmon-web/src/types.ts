export interface AppState {
  projectName: string;
  session: Session;
  accumulated: Accumulated;
  burnRate: BurnRate;
  history: HistoryDay[];
  cloudWatch: CloudWatchStatus;
  timestamp: number;
}

/**
 * Discriminated union for all SSE message types emitted by ccmon-server.js.
 * The server broadcasts { type: 'update'|'cw_update'|'init', ...AppState }.
 * Using this type in onmessage handlers gives compile-time protection
 * against shape drift between the server and client.
 */
export type ServerMessage =
  | ({ type: 'init' } & AppState)
  | ({ type: 'update' } & AppState)
  | ({ type: 'cw_update' } & AppState);

export interface Session {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  costUSD: number;
  requests: number;
  startedAt: string;
  model: string;
  lastSpeed: number;
  peakSpeed: number;
  contextTokens: number;
  contextLimit: number;
  totalLatencyMs: number;
  sparkIn: number[];
  sparkOut: number[];
  sparkCost: number[];
  sparkSpeed: number[];
  feed: FeedEvent[];
  lastEvent: LastEvent | null;
}

export interface LastEvent {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  costUSD: number;
  model: string;
}

export interface FeedEvent {
  time: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  costUSD: number;
  speed: number;
  latencyMs: number;
}

export interface Accumulated {
  today: Stats;
  week: Stats;
  month: Stats;
  allTime: Stats;
}

export interface Stats {
  costUSD: number;
  requests: number;
  tokensIn: number;
  tokensOut: number;
}

export interface BurnRate {
  dailyAvg: number;
  projectedMonthly: number;
  spentThisMonth: number;
  daysLeftInMonth: number;
}

export interface HistoryDay {
  date: string;
  costUSD: number;
  tokensIn: number;
  tokensOut: number;
  requests: number;
}

export interface CloudWatchStatus {
  ok: boolean;
  lastFetched: string | null;
  error: string | null;
}
