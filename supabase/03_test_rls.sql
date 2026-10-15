-- =====================================================================
-- Prove RLS works inside the database (no frontend involved).
-- Run each block separately in the SQL Editor. Each one pretends to be
-- a user by setting the same JWT claim Supabase sets on a real request.
-- =====================================================================

-- 1) As Alpha → expect only 5 'Alpha Ltd' rows
begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = 'alpha@test.com'),
                      'role', 'authenticated')::text, true);
  set local role authenticated;
  select company_name, channel, leads from public.campaign_data;
rollback;

-- 2) As Beta → expect only 5 'Beta Ltd' rows
begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = 'beta@test.com'),
                      'role', 'authenticated')::text, true);
  set local role authenticated;
  select company_name, channel, leads from public.campaign_data;
rollback;

-- 3) Not logged in (anon) → expect 0 rows
begin;
  set local role anon;
  select count(*) as visible_rows from public.campaign_data;
rollback;

-- 4) Alpha tries to write → expect an RLS error / 0 rows affected
begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = 'alpha@test.com'),
                      'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.campaign_data (company_name, channel, leads)
  values ('Beta Ltd', 'Hack', 999);
rollback;
