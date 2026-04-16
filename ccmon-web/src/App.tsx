import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Activity,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Database,
  DollarSign,
  Cpu,
  Clock,
  TrendingUp,
  Cloud,
  CloudOff,
  RefreshCw,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppState, ServerMessage, FeedEvent, HistoryDay } from './types';
import './index.css';

const API_BASE = 'http://localhost:3030';
const ROLLING_WINDOW = 40;

const formatUSD  = (v: number) => `$${v.toFixed(v < 0.01 ? 4 : v < 1 ? 3 : 2)}`;
const formatNum  = (v: number) => new Intl.NumberFormat('en-US').format(Math.round(v));
const formatK    = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v));
const fmtTime    = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDate    = (d: string) => d.slice(5); // MM-DD

function formatUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

interface RollingPoint {
  t: string;
  speed: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  seq: number;
}

export default function App() {
  const [state, setState]         = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const [uptime, setUptime]       = useState(0);
  const [rolling, setRolling]     = useState<RollingPoint[]>([]);
  const [cwRefreshing, setCwRefreshing] = useState(false);
  const [cwError, setCwError]     = useState<string | null>(null);
  const seqRef                    = useRef(0);

  // SSE connection
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/events`);
    es.onopen  = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const msg: ServerMessage = JSON.parse(e.data);
      const data: AppState = msg;
      setState(data);

      // Build rolling sparkline from the feed delta — append latest event
      const feed = data.session.feed;
      if (feed.length > 0) {
        const latest = feed[feed.length - 1];
        setRolling(prev => {
          const next = seqRef.current++;
          const point: RollingPoint = {
            t:        fmtTime(latest.time),
            speed:    latest.speed,
            tokensIn: latest.tokensIn,
            tokensOut: latest.tokensOut,
            cost:     latest.costUSD,
            seq:      next,
          };
          // Deduplicate by seq
          if (prev.length > 0 && prev[prev.length - 1].seq === next - 1) {
            return [...prev.slice(-(ROLLING_WINDOW - 1)), point];
          }
          return [...prev.slice(-(ROLLING_WINDOW - 1)), point];
        });
      }
    };
    return () => es.close();
  }, []);

  // Uptime ticker
  useEffect(() => {
    const id = setInterval(() => {
      if (state) setUptime(Math.floor((Date.now() - new Date(state.session.startedAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [state]);

  // Seed rolling from existing feed on first load
  useEffect(() => {
    if (!state || rolling.length > 0) return;
    const seed = state.session.feed.map((ev, i) => ({
      t:        fmtTime(ev.time),
      speed:    ev.speed,
      tokensIn: ev.tokensIn,
      tokensOut: ev.tokensOut,
      cost:     ev.costUSD,
      seq:      i,
    }));
    seqRef.current = seed.length;
    setRolling(seed.slice(-ROLLING_WINDOW));
  }, [state]);

  const handleCwRefresh = useCallback(async () => {
    if (cwRefreshing) return;
    setCwRefreshing(true);
    setCwError(null);
    try {
      const res = await fetch(`${API_BASE}/api/cloudwatch/refresh`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) setCwError(json.error ?? 'CloudWatch unavailable');
    } catch {
      setCwError('Server unreachable');
    } finally {
      setCwRefreshing(false);
    }
  }, [cwRefreshing]);

  if (!state) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#030407] text-white">
        <div className="flex flex-col items-center gap-4">
          <Activity className="h-10 w-10 animate-pulse text-blue-500" />
          <p className="text-sm font-light tracking-[0.2em] text-slate-400 uppercase">Connecting to ccmon server…</p>
        </div>
      </div>
    );
  }

  const { session, accumulated, burnRate, history, cloudWatch } = state;
  const ctxPct = session.contextLimit > 0 ? (session.contextTokens / session.contextLimit) * 100 : 0;
  const ctxColor = ctxPct > 90 ? '#ef4444' : ctxPct > 75 ? '#f59e0b' : '#3b82f6';
  const avgLatency = session.requests > 0 ? Math.round(session.totalLatencyMs / session.requests) : 0;

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-[#030407] text-white p-3 gap-3">

      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between px-4 py-2 glass flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="text-lg font-bold tracking-tight">
            cc<span className="text-blue-500">mon</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono border border-white/10 rounded px-2 py-0.5 uppercase">{state.projectName}</span>
          <span className="text-[10px] font-medium text-slate-400 font-mono">{session.model}</span>
        </div>

        <div className="flex items-center gap-6">
          <StatPill label="UPTIME" value={formatUptime(uptime)} />
          <StatPill label="REQUESTS" value={formatNum(session.requests)} />
          <StatPill label="PEAK" value={`${session.peakSpeed} t/s`} />
          <StatPill label="AVG LATENCY" value={avgLatency > 0 ? `${avgLatency}ms` : '—'} />

          {/* CW status */}
          <div className="flex flex-col items-end gap-0.5">
            <button
              onClick={handleCwRefresh}
              disabled={cwRefreshing}
              title={cwError ?? (cloudWatch.ok ? `Last fetched: ${cloudWatch.lastFetched ?? '—'}` : 'Click to retry')}
              className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1 rounded-full border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                cwRefreshing
                  ? 'border-blue-500/30 text-blue-400'
                  : cwError
                  ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                  : cloudWatch.ok
                  ? 'border-green-500/30 text-green-400 hover:bg-green-500/10'
                  : 'border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10'
              }`}
            >
              {cwRefreshing
                ? <RefreshCw size={11} className="animate-spin" />
                : cloudWatch.ok
                ? <Cloud size={11} />
                : <CloudOff size={11} />}
              {cwRefreshing ? 'FETCHING…' : cwError ? 'CW ERROR' : cloudWatch.ok ? 'CW LIVE' : 'CW OFF'}
              {!cwRefreshing && <RefreshCw size={9} className="opacity-40" />}
            </button>
            {cwError && (
              <span className="text-[9px] text-red-400/80 max-w-[180px] truncate">{cwError}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`} />
            <span className="text-[10px] font-bold text-slate-400">{connected ? 'LIVE' : 'OFFLINE'}</span>
          </div>
        </div>
      </div>

      {/* ── METRIC CARDS ── */}
      <div className="grid grid-cols-6 gap-3 flex-shrink-0">
        <MetricCard
          label="Today's Cost"
          value={formatUSD(accumulated.today.costUSD)}
          sub={`${formatUSD(burnRate.dailyAvg)}/day avg`}
          icon={<DollarSign size={14} className="text-blue-400" />}
          accent="blue"
          spark={session.sparkCost}
          sparkColor="#3b82f6"
        />
        <MetricCard
          label="This Week"
          value={formatUSD(accumulated.week.costUSD)}
          sub={`Projected ${formatUSD(burnRate.projectedMonthly)}/mo`}
          icon={<TrendingUp size={14} className="text-purple-400" />}
          accent="purple"
          spark={session.sparkCost}
          sparkColor="#8b5cf6"
        />
        <MetricCard
          label="Input Tokens"
          value={formatK(session.tokensIn)}
          sub={session.lastEvent ? `+${formatK(session.lastEvent.tokensIn)} last req` : 'Session total'}
          icon={<ArrowDownRight size={14} className="text-slate-400" />}
          accent="slate"
          spark={session.sparkIn}
          sparkColor="#64748b"
        />
        <MetricCard
          label="Output Tokens"
          value={formatK(session.tokensOut)}
          sub={session.lastEvent ? `+${formatK(session.lastEvent.tokensOut)} last req` : 'Session total'}
          icon={<ArrowUpRight size={14} className="text-emerald-400" />}
          accent="emerald"
          spark={session.sparkOut}
          sparkColor="#10b981"
        />
        <MetricCard
          label="Cache Reads"
          value={formatK(session.cacheRead)}
          sub={session.cacheRead > 0 ? `~${formatUSD(session.cacheRead * 0.3 / 1e6)} saved` : 'No cache hits yet'}
          icon={<Database size={14} className="text-cyan-400" />}
          accent="cyan"
          spark={session.sparkIn.map(v => v * 0.3)}
          sparkColor="#06b6d4"
        />
        <MetricCard
          label="Speed"
          value={`${session.lastSpeed} t/s`}
          sub={`Peak ${session.peakSpeed} t/s`}
          icon={<Zap size={14} className="text-orange-400" />}
          accent="orange"
          spark={session.sparkSpeed}
          sparkColor="#f97316"
        />
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 grid grid-cols-12 gap-3 min-h-0">

        {/* Spending history — 5 cols */}
        <div className="col-span-5 glass p-4 flex flex-col gap-3 min-h-0">
          <ChartHeader title="Spending History" sub="Daily cost — CloudWatch authoritative" />
          <div className="flex-1 min-h-0">
            <SpendingChart history={history} />
          </div>
        </div>

        {/* Realtime rolling chart — 4 cols */}
        <div className="col-span-4 glass p-4 flex flex-col gap-3 min-h-0">
          <ChartHeader title="Realtime Activity" sub={`Last ${ROLLING_WINDOW} requests • live`} live />
          <div className="flex-1 min-h-0">
            <RealtimeChart data={rolling} />
          </div>
        </div>

        {/* Daily bar breakdown — 3 cols */}
        <div className="col-span-3 glass p-4 flex flex-col gap-3 min-h-0">
          <ChartHeader title="Daily Requests" sub="Last 7 active days" />
          <div className="flex-1 min-h-0">
            <DailyBarsChart history={history} />
          </div>
        </div>

      </div>

      {/* ── BOTTOM ROW ── */}
      <div className="flex gap-3 flex-shrink-0" style={{ height: '220px' }}>

        {/* Context bar + session stats */}
        <div className="glass p-4 flex flex-col gap-3" style={{ width: '320px' }}>
          <ChartHeader title="Context Window" sub={`${session.model}`} />
          <ContextBar pct={ctxPct} color={ctxColor} tokens={session.contextTokens} limit={session.contextLimit} />
          <div className="grid grid-cols-2 gap-2 mt-1">
            <MiniStat label="Used" value={formatK(session.contextTokens)} />
            <MiniStat label="Free" value={formatK(session.contextLimit - session.contextTokens)} />
            <MiniStat label="Session cost" value={formatUSD(session.costUSD)} />
            <MiniStat label="Requests" value={formatNum(session.requests)} />
          </div>
        </div>

        {/* Live feed */}
        <div className="glass p-4 flex flex-col gap-2 flex-1 overflow-hidden">
          <div className="flex items-center justify-between flex-shrink-0">
            <ChartHeader title="Live Feed" sub="Most recent interactions" live />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            <AnimatePresence initial={false}>
              {session.feed.length === 0 ? (
                <div className="flex h-full items-center justify-center text-slate-600 text-xs italic">
                  Waiting for Claude Code interactions…
                </div>
              ) : (
                [...session.feed].reverse().slice(0, 20).map((ev, i) => (
                  <FeedRow key={`${ev.time}-${i}`} event={ev} />
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Token breakdown */}
        <div className="glass p-4 flex flex-col gap-3" style={{ width: '260px' }}>
          <ChartHeader title="All-Time" sub="Cumulative stats" />
          <div className="space-y-2 mt-1">
            <TokenBar label="Input" value={accumulated.allTime.tokensIn} max={accumulated.allTime.tokensIn + accumulated.allTime.tokensOut} color="#3b82f6" />
            <TokenBar label="Output" value={accumulated.allTime.tokensOut} max={accumulated.allTime.tokensIn + accumulated.allTime.tokensOut} color="#10b981" />
          </div>
          <div className="pt-2 border-t border-white/5 space-y-1.5">
            <MiniStat label="All-time cost" value={formatUSD(accumulated.allTime.costUSD)} />
            <MiniStat label="All-time reqs" value={formatNum(accumulated.allTime.requests)} />
            <MiniStat label="Monthly spend" value={formatUSD(burnRate.spentThisMonth)} />
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">{label}</span>
      <span className="text-xs font-bold font-mono text-slate-200">{value}</span>
    </div>
  );
}

function ChartHeader({ title, sub, live = false }: { title: string; sub: string; live?: boolean }) {
  return (
    <div className="flex items-start justify-between flex-shrink-0">
      <div>
        <h3 className="text-xs font-bold text-slate-200 tracking-wider uppercase">{title}</h3>
        <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>
      </div>
      {live && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-green-500/10 border border-green-500/20 rounded-full">
          <div className="live-indicator w-1.5 h-1.5" />
          <span className="text-[9px] font-bold text-green-400 uppercase">Live</span>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label, value, sub, icon, accent, spark, sparkColor,
}: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  accent: string; spark: number[]; sparkColor: string;
}) {
  const sparkData = spark.map((v, i) => ({ v, i }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass p-4 flex flex-col gap-2 relative overflow-hidden group hover:border-white/15 transition-all"
    >
      <div className="flex justify-between items-start">
        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">{label}</span>
        <div className="bg-white/5 p-1 rounded-lg">{icon}</div>
      </div>
      <p className="text-xl font-bold tracking-tight">{value}</p>
      <p className="text-[9px] text-slate-600 font-medium uppercase">{sub}</p>
      {sparkData.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-10 opacity-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`sg-${accent}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} fill={`url(#sg-${accent})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}

function SpendingChart({ history }: { history: HistoryDay[] }) {
  const data = useMemo(() => [...history].reverse().map(d => ({ ...d, date: fmtDate(d.date) })), [history]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#475569', fontWeight: 600 }} minTickGap={20} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#475569', fontWeight: 500 }} tickFormatter={v => `$${v}`} />
        <Tooltip
          contentStyle={{ background: '#0d1117', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', fontSize: 11 }}
          formatter={(v: number) => [formatUSD(v), 'Cost']}
        />
        <Area type="monotone" dataKey="costUSD" name="Cost" stroke="#3b82f6" strokeWidth={2} fill="url(#gc)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RealtimeChart({ data }: { data: { t: string; speed: number; tokensIn: number; tokensOut: number; cost: number }[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-slate-700 text-xs italic">
        Waiting for requests…
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis dataKey="t" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#334155' }} minTickGap={40} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: '#334155' }} tickFormatter={v => `${v}`} />
        <Tooltip
          contentStyle={{ background: '#0d1117', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', fontSize: 11 }}
          formatter={(v: number, name: string) => {
            if (name === 'speed') return [`${v} t/s`, 'Speed'];
            if (name === 'tokensIn') return [formatK(v), 'Tokens In'];
            if (name === 'tokensOut') return [formatK(v), 'Tokens Out'];
            return [v, name];
          }}
        />
        <Line type="monotone" dataKey="speed" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} name="speed" />
        <Line type="monotone" dataKey="tokensOut" stroke="#10b981" strokeWidth={1.5} dot={false} isAnimationActive={false} name="tokensOut" />
        <Line type="monotone" dataKey="tokensIn" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} name="tokensIn" />
      </LineChart>
    </ResponsiveContainer>
  );
}

function DailyBarsChart({ history }: { history: HistoryDay[] }) {
  const data = useMemo(() => history.slice(0, 7).map(d => ({ ...d, date: fmtDate(d.date) })), [history]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart layout="vertical" data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis dataKey="date" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#475569', fontWeight: 600 }} width={42} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.02)' }}
          contentStyle={{ background: '#0d1117', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', fontSize: 11 }}
          formatter={(v: number) => [formatNum(v), 'Requests']}
        />
        <Bar dataKey="requests" radius={[0, 4, 4, 0]} barSize={12}>
          {data.map((_, i) => (
            <Cell key={`cell-${i}`} fill={i === 0 ? '#3b82f6' : `rgba(59,130,246,${0.15 + (6 - i) * 0.08})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ContextBar({ pct, color, tokens, limit }: { pct: number; color: string; tokens: number; limit: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] font-mono">
        <span className="text-slate-500">{formatK(tokens)} used</span>
        <span style={{ color }} className="font-bold">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-3 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}99, ${color})` }}
          initial={{ width: '0%' }}
          animate={{ width: `${Math.min(pct, 100)}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <div className="text-[9px] text-slate-600">{formatK(limit)} token limit</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[10px] text-slate-600 uppercase tracking-wide">{label}</span>
      <span className="text-[11px] font-bold font-mono text-slate-300">{value}</span>
    </div>
  );
}

function TokenBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-500">{label}</span>
        <span className="font-mono font-bold" style={{ color }}>{formatK(value)}</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function FeedRow({ event }: { event: FeedEvent }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      layout
      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all"
    >
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">{fmtTime(event.time)}</span>
        <span className="text-[10px] text-slate-400">
          <span className="text-blue-400 font-bold">{formatK(event.tokensIn)}</span> in
          <span className="text-slate-600 mx-1">·</span>
          <span className="text-emerald-400 font-bold">{formatK(event.tokensOut)}</span> out
        </span>
        {event.speed > 0 && (
          <span className="text-[10px] text-orange-400 font-mono font-bold flex-shrink-0">{event.speed} t/s</span>
        )}
        <span className="text-[10px] text-slate-500 font-mono ml-auto flex-shrink-0">{formatUSD(event.costUSD)}</span>
      </div>
    </motion.div>
  );
}
