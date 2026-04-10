export interface AppState {
  projectName: string;
  session: Session;
  accumulated: Accumulated;
  burnRate: BurnRate;
  history: HistoryDay[];
  timestamp: number;
}

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
  feed: FeedEvent[];
}

export interface FeedEvent {
  timestamp: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUSD: number;
  id: string;
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
