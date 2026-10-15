-- =====================================================================
-- Seed data. Run AFTER creating the two users in
-- Authentication → Users → "Add user" (tick "Auto Confirm User"):
--   alpha@test.com   beta@test.com
-- =====================================================================

-- Campaign rows: 5 per company (skipped if the table already has data,
-- so this file is safe to run more than once)
insert into public.campaign_data (company_name, channel, leads)
select * from (values
  ('Alpha Ltd', 'Google',   120),
  ('Alpha Ltd', 'Meta',      85),
  ('Alpha Ltd', 'LinkedIn',  40),
  ('Alpha Ltd', 'Email',     65),
  ('Alpha Ltd', 'TikTok',    30),
  ('Beta Ltd',  'Google',    55),
  ('Beta Ltd',  'Meta',     140),
  ('Beta Ltd',  'LinkedIn',  95),
  ('Beta Ltd',  'Email',     20),
  ('Beta Ltd',  'YouTube',   70)
) as v(company_name, channel, leads)
where not exists (select 1 from public.campaign_data);

-- Link each auth user to a company.
-- (Looking up by email here is only for seeding the admin data once;
--  the security policy itself never uses email.)
insert into public.profiles (id, company_name)
select id, 'Alpha Ltd' from auth.users where email = 'alpha@test.com'
on conflict (id) do update set company_name = excluded.company_name;

insert into public.profiles (id, company_name)
select id, 'Beta Ltd' from auth.users where email = 'beta@test.com'
on conflict (id) do update set company_name = excluded.company_name;

-- Sanity check: should return 2 rows
select p.id, u.email, p.company_name
from public.profiles p join auth.users u on u.id = p.id;
