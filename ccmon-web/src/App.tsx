import React, { useEffect, useState, useMemo } from 'react';
import { 
  Activity, 
  Database, 
  CreditCard, 
  Zap, 
  History as HistoryIcon, 
  LayoutDashboard,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Globe,
  Calendar,
  BarChart3
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppState, HistoryDay } from './types';
import './index.css';

const API_BASE = 'http://localhost:3030';

const formatUSD = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
const formatNum = (val: number) => new Intl.NumberFormat('en-US').format(val);

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/events`);

    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);
    
    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setState(data);
    };

    return () => eventSource.close();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (state) {
        const start = new Date(state.session.startedAt).getTime();
        setUptime(Math.floor((Date.now() - start) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${sec}s`;
  };

  if (!state) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black text-white">
        <div className="flex flex-col items-center gap-4">
          <Activity className="h-10 w-10 animate-pulse text-blue-500" />
          <p className="text-lg font-light tracking-widest text-slate-400">CONNECTING TO CCMON SERVER...</p>
        </div>
      </div>
    );
  }

  const { session, accumulated, burnRate, history } = state;

  return (
    <div className="flex h-screen w-full p-6 gap-6 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 flex flex-col gap-6 h-full">
        <header className="flex items-center gap-3 px-2">
          <div className="bg-blue-600/20 p-2 rounded-xl border border-blue-500/30">
            <Globe className="h-6 w-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">ccmon <span className="text-blue-500">web</span></h1>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500'}`} />
              {connected ? 'LIVE CONNECTION' : 'DISCONNECTED'}
            </div>
          </div>
        </header>

        <nav className="flex flex-col gap-2">
          <NavItem active icon={<LayoutDashboard size={18} />} label="Dashboard" />
          <NavItem icon={<HistoryIcon size={18} />} label="Usage History" />
        </nav>

        <div className="mt-auto glass p-5 flex flex-col gap-4">
          <h3 className="text-xs font-bold text-slate-400 tracking-wider">PROJECT CONTEXT</h3>
          <div className="space-y-1">
            <p className="text-sm font-semibold truncate">{state.projectName}</p>
            <p className="text-[10px] text-slate-500 font-mono">~/.claude/projects</p>
          </div>
          <div className="pt-4 border-t border-white/5 space-y-3">
             <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Active Model</span>
                <span className="text-xs font-semibold text-blue-400">{session.model}</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Session Uptime</span>
                <span className="text-xs font-mono">{formatUptime(uptime)}</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Active Requests</span>
                <span className="text-xs font-semibold">{formatNum(session.requests)}</span>
             </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2">
        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-4">
          <MetricCard 
            label="Spend Today" 
            value={formatUSD(accumulated.today.costUSD)} 
            sub={`Average ${formatUSD(burnRate.dailyAvg)} / day`}
            icon={<CreditCard className="text-blue-400" size={18} />} 
          />
          <MetricCard 
            label="Weekly Spend" 
            value={formatUSD(accumulated.week.costUSD)} 
            sub="Last 7 days accumulated"
            icon={<Calendar className="text-purple-400" size={18} />} 
          />
          <MetricCard 
            label="Monthly Spend" 
            value={formatUSD(accumulated.month.costUSD)} 
            sub={`Projected ${formatUSD(burnRate.projectedMonthly)}`}
            icon={<BarChart3 className="text-emerald-400" size={18} />} 
          />
          <MetricCard 
            label="Input Tokens" 
            value={formatNum(session.tokensIn)} 
            sub={session.lastEvent ? `+${formatNum(session.lastEvent.tokensIn)} last` : "Session Total"}
            icon={<ArrowDownRight className="text-slate-400" size={18} />} 
          />
           <MetricCard 
            label="Output Tokens" 
            value={formatNum(session.tokensOut)} 
            sub={session.lastEvent ? `+${formatNum(session.lastEvent.tokensOut)} last` : "Session Total"}
            icon={<ArrowUpRight className="text-slate-400" size={18} />} 
          />
          <MetricCard 
            label="Burn Rate" 
            value={`${Math.round(session.lastSpeed)} t/s`} 
            sub={`Peak speed ${session.peakSpeed} t/s`}
            icon={<Zap className="text-orange-400" size={18} />} 
          />
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-3 gap-6 flex-1 min-h-[400px]">
          <div className="col-span-2 glass p-6 flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-slate-200 tracking-wider uppercase">Spending Trends</h3>
                <p className="text-[10px] text-slate-500 font-medium">Daily cost accumulation over the last active period</p>
              </div>
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-white/5 border border-white/5 rounded-full text-[10px] font-bold text-slate-400">LAST 10 ACTIVE DAYS</span>
              </div>
            </div>
            <div className="flex-1 min-h-0">
               <HeroChart history={history} />
            </div>
          </div>

          <div className="glass p-6 flex flex-col gap-6">
            <h3 className="text-sm font-bold text-slate-200 tracking-wider uppercase">Daily Requests</h3>
            <div className="flex-1">
              <DailyBreakdown history={history} />
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="glass p-6 min-h-[300px] flex flex-col gap-4">
          <h3 className="text-sm font-bold text-slate-200 tracking-wider uppercase flex items-center gap-2">
            <Activity size={14} className="text-blue-500" /> Live Session Activity
          </h3>
          <div className="flex-1 flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {session.feed.length > 0 ? (
                [...session.feed].reverse().slice(0, 10).map((ev, i) => (
                  <FeedItem key={ev.id || i} event={ev} />
                ))
              ) : (
                <div className="flex h-full items-center justify-center text-slate-600 text-sm italic">Waiting for Claude Code interactions...</div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: any, label: string, active?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${active ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
      {icon}
      <span className="text-sm font-medium">{label}</span>
      {active && <ChevronRight size={14} className="ml-auto opacity-50" />}
    </div>
  );
}

function MetricCard({ label, value, sub, icon }: { label: string, value: string, sub: string, icon: any }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }}
      className="glass p-5 flex flex-col gap-3 relative overflow-hidden group hover:bg-white/[0.04] transition-all border-white/5"
    >
      <div className="flex justify-between items-center z-10">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
        <div className="bg-white/5 p-1.5 rounded-lg text-slate-400 group-hover:text-white transition-colors">{icon}</div>
      </div>
      <div className="z-10">
        <p className="text-2xl font-bold tracking-tight text-white group-hover:text-blue-400 transition-colors">{value}</p>
        <p className="text-[10px] text-slate-500 font-medium mt-1 uppercase">{sub}</p>
      </div>
      {/* Subtle glow effect */}
      <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-all" />
    </motion.div>
  );
}

function HeroChart({ history }: { history: HistoryDay[] }) {
  const data = useMemo(() => [...history].reverse(), [history]);
  
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
        <XAxis 
          dataKey="date" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fontSize: 9, fill: '#475569', fontWeight: 500 }} 
          minTickGap={30}
        />
        <YAxis 
          axisLine={false} 
          tickLine={false} 
          tick={{ fontSize: 9, fill: '#475569', fontWeight: 500 }} 
          tickFormatter={(val) => `$${val}`}
        />
        <Tooltip 
           contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)' }}
           itemStyle={{ fontSize: '12px', fontWeight: 600 }}
           labelStyle={{ fontSize: '10px', color: '#64748b', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 700 }}
        />
        <Area 
          type="monotone" 
          dataKey="costUSD" 
          name="Daily Cost"
          stroke="#3b82f6" 
          strokeWidth={3}
          fillOpacity={1} 
          fill="url(#colorCost)" 
          animationDuration={2000}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function DailyBreakdown({ history }: { history: HistoryDay[] }) {
  const data = useMemo(() => history.slice(0, 7), [history]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart layout="vertical" data={data} margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis 
          dataKey="date" 
          type="category" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fontSize: 9, fill: '#64748b', fontWeight: 600 }} 
          width={70} 
        />
        <Tooltip 
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}
        />
        <Bar dataKey="requests" name="Requests" radius={[0, 4, 4, 0]} barSize={10}>
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={index === 0 ? '#3b82f6' : 'rgba(255,255,255,0.1)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function FeedItem({ event }: { event: any }) {
  // Sync property name fix: backend now sends 'timestamp'
  const ts = event.timestamp || event.time;
  const dateStr = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';

  return (
    <motion.div 
      initial={{ opacity: 0, x: -10 }} 
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      layout
      className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-all group"
    >
      <div className="bg-blue-600/10 p-2 rounded-lg group-hover:bg-blue-600/20 transition-colors border border-blue-500/10">
        <Zap size={14} className="text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center">
          <p className="text-xs font-bold text-slate-200 uppercase tracking-tight">
            {event.model || 'Claude'} <span className="text-slate-500 font-normal lowercase ml-1">Interaction</span>
          </p>
          <span className="text-[10px] text-slate-500 font-mono font-bold tracking-tighter bg-white/5 px-2 py-0.5 rounded-full">{dateStr}</span>
        </div>
        <div className="flex items-center gap-3 mt-1">
           <span className="text-[10px] text-slate-500"><span className="text-slate-400 font-bold">{formatNum(event.tokensIn)}</span> in</span>
           <span className="text-slate-700">•</span>
           <span className="text-[10px] text-slate-500"><span className="text-slate-400 font-bold">{formatNum(event.tokensOut)}</span> out</span>
           <span className="text-slate-700">•</span>
           <span className="text-[10px] font-bold text-blue-400/80">{formatUSD(event.costUSD)}</span>
        </div>
      </div>
    </motion.div>
  );
}
