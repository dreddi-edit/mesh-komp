const ws = new WebSocket(`ws://${window.location.host}`);

function formatNum(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function formatCost(num) {
  return '$' + num.toFixed(3);
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

let chartInstance = null;

function renderChart(byDate) {
  const ctx = document.getElementById('dailyChart').getContext('2d');

  // Last 7 days
  const data = byDate.slice(-7);
  const labels = data.map(d => d[0].slice(5)); // MM-DD
  const values = data.map(d => d[1].costUSD);

  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = values;
    chartInstance.update();
    return;
  }

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Cost (USD)',
        data: values,
        backgroundColor: '#d29922',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#30363d' }, ticks: { color: '#8b949e', callback: (val) => '$' + val.toFixed(2) } },
        x: { grid: { display: false }, ticks: { color: '#8b949e' } }
      }
    }
  });
}

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  const { session, accumulated, burnRate, statusMsg, projectName, byDate } = data;

  // Header
  document.getElementById('projectName').textContent = projectName;
  document.getElementById('footerProject').textContent = projectName;
  document.getElementById('modelName').textContent = session.model !== 'unknown' ? session.model : '—';
  document.getElementById('reqCount').textContent = session.requests;

  const uptimeMs = Date.now() - new Date(session.startedAt).getTime();
  document.getElementById('uptime').textContent = formatDuration(uptimeMs);

  const statusEl = document.getElementById('statusMsg');
  if (statusMsg) {
    statusEl.textContent = '⚠ ' + statusMsg;
    statusEl.style.display = 'block';
  } else {
    statusEl.style.display = 'none';
  }

  // Metrics
  document.getElementById('val-tokensIn').textContent = formatNum(session.tokensIn);
  document.getElementById('sub-tokensIn').textContent = session.lastEvent ? `+${formatNum(session.lastEvent.tokensIn)} last` : '—';

  document.getElementById('val-tokensOut').textContent = formatNum(session.tokensOut);
  document.getElementById('sub-tokensOut').textContent = session.lastEvent ? `+${formatNum(session.lastEvent.tokensOut)} last` : '—';

  document.getElementById('val-cacheRead').textContent = formatNum(session.cacheRead);
  document.getElementById('sub-cacheRead').textContent = `~${formatCost(session.cacheRead * 0.30 / 1e6)} saved`;

  document.getElementById('val-cacheWrite').textContent = formatNum(session.cacheWrite);
  document.getElementById('sub-cacheWrite').textContent = `${session.requests} writes`;

  document.getElementById('val-cost').textContent = formatCost(session.costUSD);
  document.getElementById('sub-cost').textContent = `today ${formatCost(accumulated.today?.costUSD || 0)}`;

  document.getElementById('val-speed').textContent = `${session.lastSpeed} t/s`;
  document.getElementById('sub-speed').textContent = `peak ${session.peakSpeed} t/s`;

  // Context Bar
  const ctxPct = session.contextLimit > 0 ? (session.contextTokens / session.contextLimit) * 100 : 0;
  const fillEl = document.getElementById('ctx-fill');
  fillEl.style.width = `${Math.min(100, ctxPct)}%`;
  fillEl.style.backgroundColor = ctxPct > 90 ? 'var(--color-red)' : ctxPct > 75 ? 'var(--color-yellow)' : 'var(--color-blue)';

  const free = session.contextLimit - session.contextTokens;
  document.getElementById('ctx-stats').innerHTML = `used <b>${formatNum(session.contextTokens)}</b>  free ${formatNum(free)}  limit ${formatNum(session.contextLimit)}  <b>${ctxPct.toFixed(1)}%</b>`;

  // Middle Row
  document.getElementById('tokenBreakdown').innerHTML = `
    <div><strong>In:</strong> ${formatNum(session.tokensIn)}</div>
    <div><strong>Out:</strong> ${formatNum(session.tokensOut)}</div>
    <div><strong>Cache Read:</strong> ${formatNum(session.cacheRead)}</div>
    <div><strong>Cache Write:</strong> ${formatNum(session.cacheWrite)}</div>
  `;

  const avgLatency = session.requests > 0 ? Math.round(session.totalLatencyMs / session.requests) : 0;
  document.getElementById('performance').innerHTML = `
    <div><strong>Avg Latency:</strong> ${formatDuration(avgLatency)}</div>
    <div><strong>Last Latency:</strong> ${session.lastEvent ? formatDuration(session.lastEvent.latencyMs || 0) : '—'}</div>
    <div><strong>Total Req:</strong> ${session.requests}</div>
  `;

  renderChart(byDate);

  // Accumulated
  document.getElementById('accumulated').innerHTML = `
    <div>
      <div style="color:var(--text-muted);font-size:12px">TODAY</div>
      <div style="font-size:18px;font-weight:bold">${formatCost(accumulated.today.costUSD)}</div>
      <div style="font-size:12px">${accumulated.today.requests} req</div>
    </div>
    <div>
      <div style="color:var(--text-muted);font-size:12px">THIS WEEK</div>
      <div style="font-size:18px;font-weight:bold">${formatCost(accumulated.week.costUSD)}</div>
      <div style="font-size:12px">${accumulated.week.requests} req</div>
    </div>
    <div>
      <div style="color:var(--text-muted);font-size:12px">THIS MONTH</div>
      <div style="font-size:18px;font-weight:bold">${formatCost(accumulated.month.costUSD)}</div>
      <div style="font-size:12px">Proj: ${formatCost(burnRate.projectedMonthly)}</div>
    </div>
    <div>
      <div style="color:var(--text-muted);font-size:12px">ALL TIME</div>
      <div style="font-size:18px;font-weight:bold">${formatCost(accumulated.allTime.costUSD)}</div>
      <div style="font-size:12px">${accumulated.allTime.requests} req</div>
    </div>
  `;

  // Feed
  const tbody = document.querySelector('#feedTable tbody');
  tbody.innerHTML = '';
  [...session.feed].reverse().forEach(entry => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--text-muted)">${new Date(entry.time).toLocaleTimeString()}</td>
      <td class="blue">${formatNum(entry.tokensIn)}</td>
      <td class="green">${formatNum(entry.tokensOut)}</td>
      <td class="magenta">${formatNum(entry.cacheRead)}</td>
      <td class="yellow">${formatCost(entry.costUSD)}</td>
      <td class="cyan">${entry.speed} t/s</td>
      <td>${(entry.latencyMs / 1000).toFixed(1)}s</td>
    `;
    tbody.appendChild(tr);
  });
};

// Update uptime clock locally
setInterval(() => {
  const timeStr = document.getElementById('uptime').textContent;
  if(timeStr === '0s' || timeStr === '—') return;

  // Just trigger an update to visually tick the clock (actual logic handles it on messages)
}, 1000);