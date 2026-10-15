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
  renderTable(rows);
  renderChart(rows);
}

// ---------- Rendering ----------

function renderTable(rows) {
  const body = $('data-body');
  body.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const [value, cls] of [[r.company_name], [r.channel], [r.leads, 'num']]) {
      const td = document.createElement('td');
      td.textContent = value; // textContent, not innerHTML → no XSS
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="3" class="muted">No data</td></tr>';
  }
  $('total-leads').textContent = rows.reduce((sum, r) => sum + r.leads, 0);
}

function renderChart(rows) {
  // Sum leads per channel (handles several rows for the same channel).
  const byChannel = {};
  for (const r of rows) byChannel[r.channel] = (byChannel[r.channel] ?? 0) + r.leads;

  if (chart) chart.destroy();
  chart = new Chart($('leads-chart'), {
    type: 'bar',
    data: {
      labels: Object.keys(byChannel),
      datasets: [{ label: 'Leads', data: Object.values(byChannel), backgroundColor: '#3b5bdb' }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}
