import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-IN');
const pct = new Intl.NumberFormat('en-IN', { style: 'percent', maximumFractionDigits: 0 });

let chart;
let rows = [];
let sort = { key: 'leads', dir: 'desc' };
let currentUserId = null;

// ============ Auth ============

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;

  // Simple client-side checks for a nicer UX (security is still server-side)
  $('email').setAttribute('aria-invalid', String(!$('email').checkValidity()));
  $('password').setAttribute('aria-invalid', String(!password));
  if (!$('email').checkValidity() || !password) {
    showLoginError(!email || !$('email').checkValidity() ? 'Enter a valid email address.' : 'Enter your password.');
    return;
  }

  showLoginError('');
  setLoading($('login-btn'), true);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  setLoading($('login-btn'), false);

  if (error) {
    showLoginError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message);
    $('password').select();
  }
});

$('logout-btn').addEventListener('click', () => supabase.auth.signOut());

// Fires on page load (restored session) and on every login/logout.
supabase.auth.onAuthStateChange((event, session) => {
  // Defer so we don't call Supabase from inside the auth callback.
  setTimeout(() => {
    $('boot').hidden = true;
    if (!session) return showLogin();
    // Token refreshes for the same user don't need a full reload.
    if (session.user.id === currentUserId && event !== 'SIGNED_IN') return;
    showDashboard(session);
  }, 0);
});

// ============ Login UI helpers ============

function showLoginError(message) {
  $('login-error').textContent = message;
  $('login-error').hidden = !message;
}

function setLoading(btn, loading) {
  btn.classList.toggle('is-loading', loading);
  btn.disabled = loading;
  btn.querySelector('.btn-label').textContent = loading ? 'Signing in…' : 'Sign in';
}

$('toggle-pw').addEventListener('click', () => {
  const input = $('password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggle-pw').setAttribute('aria-pressed', String(show));
  $('toggle-pw').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

// Demo chips only fill the email; the password is always typed by the user.
document.querySelectorAll('.chip').forEach((chip) =>
  chip.addEventListener('click', () => {
    $('email').value = chip.dataset.email;
    $('email').removeAttribute('aria-invalid');
    $('password').focus();
  })
);

// ============ Theme ============

$('theme-btn').addEventListener('click', () => {
  const root = document.documentElement;
  const isDark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = isDark ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
  if (rows.length) renderChart(); // chart colours come from CSS variables
});

// ============ Views ============

function showLogin() {
  currentUserId = null;
  rows = [];
  $('dashboard-view').hidden = true;
  $('login-view').hidden = false;
  $('password').value = '';
  showLoginError('');
  if (chart) { chart.destroy(); chart = null; }
  resetDashboard();
}

function resetDashboard() {
  $('company-title').innerHTML = '<span class="skeleton skeleton--title"></span>';
  $('subtitle').textContent = 'Loading your data…';
  for (const id of ['kpi-total', 'kpi-top', 'kpi-avg']) $(id).innerHTML = '<span class="skeleton"></span>';
  for (const id of ['kpi-total-sub', 'kpi-top-sub', 'kpi-avg-sub']) $(id).innerHTML = '&nbsp;';
  $('data-body').innerHTML = '<tr class="skeleton-row"><td colspan="4"><span class="skeleton"></span></td></tr>'.repeat(3);
  $('chart-skeleton').hidden = false;
  $('data-error').hidden = true;
  $('chart-meta').textContent = $('table-meta').textContent = '';
}

async function showDashboard(session) {
  currentUserId = session.user.id;
  $('login-view').hidden = true;
  $('dashboard-view').hidden = false;
  $('user-email').textContent = session.user.email;
  $('avatar').textContent = session.user.email[0].toUpperCase();
  resetDashboard();
  await loadData();
}

$('retry-btn').addEventListener('click', () => { resetDashboard(); loadData(); });

async function loadData() {
  // Profile: RLS only returns the logged-in user's own row.
  const { data: profile } = await supabase
    .from('profiles')
    .select('company_name')
    .maybeSingle();
  const company = profile?.company_name ?? 'No company assigned';
  $('company-title').textContent = company;
  $('user-company').textContent = company;

  // NOTE: no .eq('company_name', ...) filter here on purpose.
  // We ask for *everything*; the database's RLS policy decides what we get.
  const { data, error } = await supabase
    .from('campaign_data')
    .select('company_name, channel, leads')
    .order('leads', { ascending: false });

  if (error) {
    $('data-error-text').textContent = `Couldn't load campaign data: ${error.message}`;
    $('data-error').hidden = false;
    $('subtitle').textContent = 'Something went wrong.';
    return;
  }

  rows = data;
  $('subtitle').textContent = `Showing ${rows.length} campaign${rows.length === 1 ? '' : 's'} · updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  renderKpis();
  renderTable();
  renderChart();
}

// ============ Rendering ============

const total = () => rows.reduce((sum, r) => sum + r.leads, 0);

// Sum leads per channel (handles several rows for the same channel).
function leadsByChannel() {
  const byChannel = {};
  for (const r of rows) byChannel[r.channel] = (byChannel[r.channel] ?? 0) + r.leads;
  return Object.entries(byChannel).sort((a, b) => b[1] - a[1]);
}

function renderKpis() {
  const channels = leadsByChannel();
  const sum = total();
  $('kpi-total').textContent = fmt.format(sum);
  $('kpi-total-sub').textContent = `across ${rows.length} campaign${rows.length === 1 ? '' : 's'}`;

  if (channels.length) {
    const [topName, topLeads] = channels[0];
    $('kpi-top').textContent = topName;
    $('kpi-top-sub').textContent = `${fmt.format(topLeads)} leads · ${pct.format(topLeads / sum || 0)} of total`;
    $('kpi-avg').textContent = fmt.format(Math.round(sum / channels.length));
    $('kpi-avg-sub').textContent = `over ${channels.length} channel${channels.length === 1 ? '' : 's'}`;
  } else {
    $('kpi-top').textContent = $('kpi-avg').textContent = '–';
    $('kpi-top-sub').textContent = $('kpi-avg-sub').textContent = 'No data yet';
  }
}

function renderTable() {
  const body = $('data-body');
  body.innerHTML = '';
  const sum = total();

  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="4" class="empty">No campaign data for your company yet.</td></tr>';
  }

  const sorted = [...rows].sort((a, b) => {
    const cmp = sort.key === 'leads' ? a.leads - b.leads : a.channel.localeCompare(b.channel);
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  for (const r of sorted) {
    const share = sum ? r.leads / sum : 0;
    const tr = document.createElement('tr');
    // textContent, not innerHTML → no XSS
    tr.append(
      cell(r.channel, 'channel'),
      cell(r.company_name, 'company hide-sm'),
      cell(fmt.format(r.leads), 'num'),
      shareCell(share)
    );
    body.appendChild(tr);
  }

  $('total-leads').textContent = fmt.format(sum);
  $('table-meta').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`;

  document.querySelectorAll('.sort').forEach((btn) => {
    btn.setAttribute('aria-sort', btn.dataset.key === sort.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function shareCell(share) {
  const td = document.createElement('td');
  td.className = 'num';
  const wrap = document.createElement('span');
  wrap.className = 'share';
  const bar = document.createElement('span');
  bar.className = 'share-bar';
  const fill = document.createElement('span');
  fill.style.width = `${share * 100}%`;
  bar.appendChild(fill);
  const label = document.createElement('span');
  label.className = 'share-pct';
  label.textContent = pct.format(share);
  wrap.append(bar, label);
  td.appendChild(wrap);
  return td;
}

document.querySelectorAll('.sort').forEach((btn) =>
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    // Same column → flip direction. New column → leads high-to-low, channel A–Z.
    const dir = sort.key === key
      ? (sort.dir === 'asc' ? 'desc' : 'asc')
      : (key === 'leads' ? 'desc' : 'asc');
    sort = { key, dir };
    renderTable();
  })
);

// Draws each bar's value just above it.
const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(c) {
    const { ctx } = c;
    const meta = c.getDatasetMeta(0);
    ctx.save();
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = cssVar('--text-2');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    meta.data.forEach((bar, i) => ctx.fillText(fmt.format(c.data.datasets[0].data[i]), bar.x, bar.y - 6));
    ctx.restore();
  },
};

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function renderChart() {
  const channels = leadsByChannel();
  $('chart-skeleton').hidden = true;
  $('chart-meta').textContent = `${channels.length} channel${channels.length === 1 ? '' : 's'}`;

  if (chart) chart.destroy();
  chart = new Chart($('leads-chart'), {
    type: 'bar',
    data: {
      labels: channels.map(([name]) => name),
      datasets: [{
        label: 'Leads',
        data: channels.map(([, leads]) => leads),
        backgroundColor: cssVar('--accent'),
        hoverBackgroundColor: cssVar('--accent-hover'),
        borderRadius: { topLeft: 4, topRight: 4 },
        borderSkipped: 'bottom',
        maxBarThickness: 44,
      }],
    },
    plugins: [valueLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: cssVar('--text'),
          titleColor: cssVar('--surface'),
          bodyColor: cssVar('--surface'),
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => `${fmt.format(ctx.parsed.y)} leads · ${pct.format(ctx.parsed.y / total() || 0)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: cssVar('--border-strong') },
          ticks: { color: cssVar('--muted'), font: { family: 'Inter', size: 12 }, maxRotation: 0, autoSkip: false },
        },
        y: {
          beginAtZero: true,
          grid: { color: cssVar('--track') },
          border: { display: false },
          ticks: { color: cssVar('--muted'), font: { family: 'Inter', size: 12 }, maxTicksLimit: 5, precision: 0 },
        },
      },
    },
  });
}
