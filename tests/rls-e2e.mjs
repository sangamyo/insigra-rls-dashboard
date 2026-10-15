// End-to-end RLS test against the live Supabase project.
// Gets real sessions for the test users via admin magic-link (no passwords),
// then calls the REST API with the public anon key + user JWT, like the app does.
const URL_ = process.env.SB_URL;
const ANON = process.env.SB_ANON;
const SERVICE = process.env.SB_SERVICE;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

async function sessionFor(email) {
  const gl = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  }).then((r) => r.json());
  const hashed = gl.hashed_token ?? gl.properties?.hashed_token;
  if (!hashed) throw new Error('generate_link failed: ' + JSON.stringify(gl).slice(0, 200));
  const v = await fetch(`${URL_}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  }).then((r) => r.json());
  if (!v.access_token) throw new Error('verify failed: ' + JSON.stringify(v).slice(0, 200));
  return v.access_token;
}

const api = (path, token, init = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });

const summary = (rows) => {
  const companies = [...new Set(rows.map((r) => r.company_name))].join(',');
  return `${rows.length} rows, companies=[${companies}], leads=${rows.reduce((s, r) => s + r.leads, 0)}`;
};

async function testUser(email, company, other, expectedLeads) {
  console.log(`\n== ${email} ==`);
  const token = await sessionFor(email);
  check('real session obtained', !!token);

  const profile = await api('profiles?select=company_name', token).then((r) => r.json());
  check('profile shows own company only', profile.length === 1 && profile[0].company_name === company, JSON.stringify(profile));

  const rows = await api('campaign_data?select=company_name,channel,leads', token).then((r) => r.json());
  check(`sees only ${company} (5 rows, ${expectedLeads} leads)`,
    rows.length === 5 && rows.every((r) => r.company_name === company) &&
    rows.reduce((s, r) => s + r.leads, 0) === expectedLeads, summary(rows));

  const sneaky = await api(`campaign_data?company_name=eq.${encodeURIComponent(other)}`, token).then((r) => r.json());
  check(`explicitly asking for ${other} returns nothing`, Array.isArray(sneaky) && sneaky.length === 0, `${sneaky.length} rows`);

  const ins = await api('campaign_data', token, { method: 'POST', body: JSON.stringify({ company_name: other, channel: 'Hack', leads: 999 }) });
  check('insert blocked', ins.status >= 400, `HTTP ${ins.status}`);

  const upd = await api(`campaign_data?company_name=eq.${encodeURIComponent(company)}`, token, { method: 'PATCH', body: JSON.stringify({ leads: 0 }) }).then((r) => r.json());
  check('update changes 0 rows', Array.isArray(upd) && upd.length === 0, JSON.stringify(upd).slice(0, 80));

  const del = await api('campaign_data?leads=gte.0', token, { method: 'DELETE' }).then((r) => r.json());
  check('delete removes 0 rows', Array.isArray(del) && del.length === 0, JSON.stringify(del).slice(0, 80));

  const prof = await api('profiles?company_name=neq.x', token, { method: 'PATCH', body: JSON.stringify({ company_name: other }) }).then((r) => r.json());
  check('cannot switch own company', Array.isArray(prof) && prof.length === 0, JSON.stringify(prof).slice(0, 80));

  // Tamper with the token payload (swap a character) → signature no longer valid
  const [h, p, s] = token.split('.');
  const forged = `${h}.${p.slice(0, -2)}${p.slice(-2) === 'AA' ? 'AB' : 'AA'}.${s}`;
  const f = await api('campaign_data?select=company_name', forged);
  check('tampered token rejected', f.status === 401, `HTTP ${f.status}`);

  await fetch(`${URL_}/auth/v1/logout`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
}

console.log('== anonymous (not logged in) ==');
const anon = await api('campaign_data?select=*').then((r) => r.json());
check('anon sees 0 rows', Array.isArray(anon) && anon.length === 0, `${anon.length} rows`);
const anonProf = await api('profiles?select=*').then((r) => r.json());
check('anon sees 0 profiles', Array.isArray(anonProf) && anonProf.length === 0, `${anonProf.length} rows`);

await testUser('alpha@test.com', 'Alpha Ltd', 'Beta Ltd', 340);
await testUser('beta@test.com', 'Beta Ltd', 'Alpha Ltd', 380);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
