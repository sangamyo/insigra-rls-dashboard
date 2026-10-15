import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
let chart;

// ---------- Auth ----------

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('login-btn').disabled = true;

  const { error } = await supabase.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value,
  });

  $('login-btn').disabled = false;
  if (error) $('login-error').textContent = error.message;
});

$('logout-btn').addEventListener('click', () => supabase.auth.signOut());

// Fires on page load (restored session) and on every login/logout.
supabase.auth.onAuthStateChange((_event, session) => {
  // Defer so we don't call Supabase from inside the auth callback.
  setTimeout(() => (session ? showDashboard(session) : showLogin()), 0);
});

function showLogin() {
  $('dashboard-view').hidden = true;
  $('login-view').hidden = false;
  $('password').value = '';
  if (chart) { chart.destroy(); chart = null; }
  $('data-body').innerHTML = '';
}

async function showDashboard(session) {
  $('login-view').hidden = true;
  $('dashboard-view').hidden = false;
  $('user-email').textContent = session.user.email;
  $('avatar').textContent = session.user.email[0].toUpperCase();
  $('data-error').textContent = '';

  // Profile: RLS only returns the logged-in user's own row.
  const { data: profile } = await supabase
    .from('profiles')
    .select('company_name')
    .maybeSingle();
  $('company-title').textContent = profile?.company_name ?? 'No company assigned';

  // NOTE: no .eq('company_name', ...) filter here on purpose.
  // We ask for *everything*; the database's RLS policy decides what we get.
  const { data: rows, error } = await supabase
    .from('campaign_data')
    .select('company_name, channel, leads')
    .order('leads', { ascending: false });

  if (error) {
    $('data-error').textContent = error.message;
    return;
  }
  renderKpis(rows);
  renderTable(rows);
  renderChart(rows);
}

// ---------- Rendering ----------

const fmt = new Intl.NumberFormat('en-IN');

// Sum leads per channel (handles several rows for the same channel).
function leadsByChannel(rows) {
  const byChannel = {};
  for (const r of rows) byChannel[r.channel] = (byChannel[r.channel] ?? 0) + r.leads;
  return Object.entries(byChannel).sort((a, b) => b[1] - a[1]);
}

function renderKpis(rows) {
  const channels = leadsByChannel(rows);
  $('kpi-total').textContent = fmt.format(rows.reduce((sum, r) => sum + r.leads, 0));
  $('kpi-top').textContent = channels[0]?.[0] ?? '–';
  $('kpi-count').textContent = channels.length;
}

function renderTable(rows) {
  const body = $('data-body');
  body.innerHTML = '';
  const max = Math.max(1, ...rows.map((r) => r.leads));
  for (const r of rows) {
    const tr = document.createElement('tr');

    // textContent, not innerHTML → no XSS
    const company = document.createElement('td');
    company.className = 'company';
    company.textContent = r.company_name;
    const channel = document.createElement('td');
    channel.textContent = r.channel;

    const leads = document.createElement('td');
    leads.className = 'num';
    const cell = document.createElement('div');
    cell.className = 'bar-cell';
    const bar = document.createElement('div');
    bar.className = 'mini-bar';
    const fill = document.createElement('span');
    fill.style.width = `${(r.leads / max) * 100}%`;
    bar.appendChild(fill);
    const value = document.createElement('span');
    value.textContent = fmt.format(r.leads);
    cell.append(bar, value);
    leads.appendChild(cell);

    tr.append(company, channel, leads);
    body.appendChild(tr);
  }
  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="3" class="muted">No data</td></tr>';
  }
  $('total-leads').textContent = fmt.format(rows.reduce((sum, r) => sum + r.leads, 0));
}

function renderChart(rows) {
  const channels = leadsByChannel(rows);
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();

  if (chart) chart.destroy();
  chart = new Chart($('leads-chart'), {
    type: 'bar',
    data: {
      labels: channels.map(([name]) => name),
      datasets: [{
        label: 'Leads',
        data: channels.map(([, leads]) => leads),
        backgroundColor: color('--accent'),
        hoverBackgroundColor: color('--accent-hover'),
        borderRadius: { topLeft: 4, topRight: 4 },
        borderSkipped: 'bottom',
        maxBarThickness: 40,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: { label: (ctx) => `${fmt.format(ctx.parsed.y)} leads` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: color('--border') },
          ticks: { color: color('--muted'), font: { family: 'Inter' } },
        },
        y: {
          beginAtZero: true,
          grid: { color: color('--track') },
          border: { display: false },
          ticks: { color: color('--muted'), font: { family: 'Inter' }, maxTicksLimit: 5 },
        },
      },
    },
  });
}
