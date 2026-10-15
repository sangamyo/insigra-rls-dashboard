# Insigra Reports – Multi-tenant Campaign Dashboard

A small app where each company sees **only its own** marketing data.
Isolation is enforced by **PostgreSQL Row-Level Security (RLS)** in Supabase, not by the frontend.

- **Frontend:** plain HTML/CSS/JS (no build step), `supabase-js` for auth and data, Chart.js for the chart
- **Backend:** Supabase (Postgres, Auth, RLS)

## Test logins

| Email            | Password    | Company   |
|------------------|-------------|-----------|
| alpha@test.com   | *(set yours)* | Alpha Ltd |
| beta@test.com    | *(set yours)* | Beta Ltd  |

## How the security works

```sql
create policy "Users read own company campaigns"
  on public.campaign_data for select to authenticated
  using (
    company_name = (select company_name from public.profiles
                    where id = auth.uid())
  );
```

1. When a user logs in, Supabase gives the browser a **signed JWT**. Every request sends it.
2. In Postgres, `auth.uid()` reads the user id from that token. The browser can't change it without breaking the signature.
3. For every row in `campaign_data`, Postgres checks the policy: it looks up the user's company in `profiles` and keeps the row only if the names match.
4. The frontend runs `select *` with **no filter**. If someone opens DevTools and queries the API directly with the public anon key, they still only get their own company's rows.
5. There are no insert/update/delete policies, so writes are denied. Visitors who aren't logged in (`anon`) have no policy, so they see 0 rows.
6. `profiles` also has RLS: a user can read only their own profile row, so they can't change their company or see another user's.

## Setup

1. **Create a Supabase project** at supabase.com.
2. **Create users:** Authentication → Users → *Add user* → `alpha@test.com` and `beta@test.com`, each with a password and *Auto Confirm User* ticked.
3. **SQL Editor:** run [`supabase/01_schema_and_rls.sql`](supabase/01_schema_and_rls.sql), then [`supabase/02_seed.sql`](supabase/02_seed.sql).
4. **Verify RLS in the DB:** run each block of [`supabase/03_test_rls.sql`](supabase/03_test_rls.sql) separately. Alpha should see 5 rows, Beta 5 different rows, anon 0, and the insert should fail.
5. **Configure the frontend:** put your Project URL and anon key from Project Settings → API into [`config.js`](config.js).
6. **Run locally:** `npx serve .` (or any static server), then open the printed URL.
7. **End-to-end test (optional):** `SB_URL=... SB_ANON=... SB_SERVICE=... node tests/rls-e2e.mjs`. It signs in both test users through the real Auth API (admin magic link, no passwords) and checks, over the public REST API, that each sees only its own rows, can't write, and that a tampered token is rejected. The service_role key is only used locally to mint the test sessions; it never goes in the frontend.
8. **Deploy:** push to GitHub, then import the repo in Vercel or Netlify as a static site (no build command, output dir `.`). GitHub Pages also works.

## Files

```
index.html                      login + dashboard markup
app.js                          auth, data fetch (no client-side filter), table, chart
config.js                       Supabase URL + public anon key
style.css                       styling
supabase/01_schema_and_rls.sql  tables, index, RLS + policies
supabase/02_seed.sql            10 campaign rows + profile links
supabase/03_test_rls.sql        SQL proof that isolation works
tests/rls-e2e.mjs               end-to-end API test (20 checks)
```
