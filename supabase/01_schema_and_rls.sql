-- =====================================================================
-- Insigra Reports – multi-tenant demo
-- Run this in Supabase → SQL Editor (as one script).
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

-- One row per login. id is the same uuid Supabase Auth gives the user.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  company_name text not null
);

create table if not exists public.campaign_data (
  id           bigint generated always as identity primary key,
  company_name text    not null,
  channel      text    not null,
  leads        integer not null check (leads >= 0)
);

create index if not exists campaign_data_company_name_idx
  on public.campaign_data (company_name);

-- ---------- Row-Level Security ---------------------------------------

alter table public.profiles      enable row level security;
alter table public.campaign_data enable row level security;

-- A user may read only their own profile row.
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));  -- (select …) = evaluated once per query, not per row

-- THE IMPORTANT ONE:
-- A logged-in user sees a campaign row only if its company_name equals
-- the company_name in *their* profile. auth.uid() comes from the signed
-- JWT, so the browser cannot fake it.
drop policy if exists "Users read own company campaigns" on public.campaign_data;
create policy "Users read own company campaigns"
  on public.campaign_data
  for select
  to authenticated
  using (
    company_name = (
      select p.company_name
      from public.profiles p
      where p.id = (select auth.uid())
    )
  );

-- No insert/update/delete policies exist, so with RLS on those actions
-- are denied for everyone using the public (anon) key.
-- The "anon" role (not logged in) has no policy at all → sees 0 rows.
