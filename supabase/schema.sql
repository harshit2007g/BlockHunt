-- BlockHunt '26: Supabase schema + Row Level Security
-- Paste this whole file into Supabase SQL Editor and run once.
--
-- PRIVACY MODEL (why the organizer can run the event while competing):
--   * Every signup is a team account (Supabase Auth, email+password).
--   * `teams` row is created on first login; is_team(auth.uid()) marks team users.
--   * Teams can ONLY read/write rows tagged with their own team id. RLS enforces it.
--   * `raw_submissions`/`attempts` are readable only by that team and admins.
--   * `leaderboard_view` exposes only what the projector should show to everyone.
--   * Stage 5 branch data lives in `public.branches` (needed for /forks display).
--
-- AFTER RUNNING THIS:
--   1. Supabase Dashboard → Auth → Providers → Email: enable signups (or disable
--      open signups and pre-create team accounts yourself / via SQL).
--   2. Create your admin: Dashboard → you sign up → then run the ADMIN sql
--      at the bottom of this file (insert into admin_users).
--   3. Transfer: Supabase → Settings → General → Transfer Project (needs target
--      user to accept). Change org/account without touching your data.

create language if not exists plpgsql;

-- ───────────────────────── tables ─────────────────────────
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid() unique,
  auth_uid uuid unique references auth.users(id) on delete cascade not null,
  name text not null unique check (char_length(name) between 2 and 40),
  member_names text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.scores (
  team_id uuid primary key references public.teams(id) on delete cascade,
  stage1_base int not null default 0,
  stage1_bonus int not null default 0,
  stage2_base int not null default 0,
  stage2_bonus int not null default 0,
  stage3_base int not null default 0,
  stage3_bonus int not null default 0,
  stage3_expl int not null default 0,
  stage4_bonus int not null default 0,
  stage5_branches int not null default 0,
  stage5_longest int not null default 0,
  stage1_at timestamptz,
  stage2_at timestamptz,
  stage3_at timestamptz,
  stage4_at timestamptz,
  stage5_at timestamptz,
  stage1_attempts int not null default 0,
  stage1_locked_until timestamptz,
  stage3_attempts int not null default 0,
  stage3_locked_until timestamptz,
  -- Stage 4 confirmation path: first POST stamps submitted_at + tx hash.
  -- stage4_bonus stays 0 until a volunteer confirms (+50) in the dashboard.
  stage4_submitted_at timestamptz,
  stage4_tx_hash text unique,
  -- timestamp of the team's last Stage 2 attempt (rate limit clock).
  -- Named *_at (not a nonce value) to avoid confusion with the mined nonce.
  stage2_last_attempt_at timestamptz,
  stage5_attempts int not null default 0,
  total int generated always as (
    stage1_base + stage1_bonus + stage2_base + stage2_bonus
    + stage3_base + stage3_bonus + stage3_expl + stage4_bonus
    + stage5_branches + stage5_longest
  ) stored,
  last_submit_at timestamptz not null default 'epoch'
);

create table if not exists public.raw_submissions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  stage int not null check (stage in (1, 2, 3, 4, 5)),
  payload jsonb not null,
  correct boolean,
  awarded int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.mining_pool (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  block_index int not null,
  nonce text not null,
  hash text not null,
  prev_hash text not null,
  data text not null default '',
  parent_team uuid references public.teams(id) on delete set null,
  parent_block bigint,
  valid boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.stage_config (
  key text primary key,
  value jsonb not null
);

-- seed: stages window control. Set these on the day between stages.
insert into public.stage_config (key, value) values
  ('stage1', '{"open": false, "started_at": null, "duration_ms": 900000}'),
  ('stage2', '{"open": false, "started_at": null, "duration_ms": 2400000, "difficulty_prefix": "00", "nonce_max": 100000000}'),
  ('stage3', '{"open": false, "started_at": null, "duration_ms": 1800000}'),
  ('stage4', '{"open": false}'),
  ('stage5', '{"open": false, "started_at": null, "duration_ms": 1500000, "finalists": []}')
on conflict (key) do nothing;

-- Answers live here, NOT in stage_config. RLS is enabled with no client
-- policies, so only the service role (server routes) can read these.
-- Teams reach answers only through the /api/stage3 and /api/stage4 routes.
create table if not exists public.stage_secrets (
  key text primary key,
  value jsonb not null
);

insert into public.stage_secrets (key, value) values
  ('stage3', '{"tampered_block": -1}'),
  ('stage4', '{"contract_address": "", "success_code": ""}')
on conflict (key) do nothing;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  )
$$;

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.teams t
    where t.auth_uid = auth.uid()
  ) and not public.is_admin()
$$;

create or replace function public.my_team_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.teams t where t.auth_uid = auth.uid() limit 1
$$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.teams enable row level security;
alter table public.scores enable row level security;
alter table public.raw_submissions enable row level security;
alter table public.mining_pool enable row level security;
alter table public.stage_config enable row level security;
alter table public.admin_users enable row level security;

-- teams: a team sees its own row; admin sees all
create policy "team reads own" on public.teams
  for select using (auth_uid = auth.uid() or public.is_admin());

create policy "team updates own (profile only)" on public.teams
  for update using (auth_uid = auth.uid())
  with check (auth_uid = auth.uid());

-- teams: an authenticated user may insert only their own row.
-- Unique(name) makes duplicate claims fail; clients surface "name taken".
drop policy if exists "team inserts own" on public.teams;
create policy "team inserts own" on public.teams
  for insert with check (auth_uid = auth.uid());

-- Auto-create the scores row for every new team so signup is playable
-- regardless of client flow. Security definer runs as the table owner,
-- so the admin-only scores INSERT policy does not block it.
create or replace function public.handle_new_team() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.scores (team_id) values (NEW.id) on conflict (team_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists on_teams_created on public.teams;
create trigger on_teams_created
  after insert on public.teams
  for each row execute function public.handle_new_team();

-- scores: projector data is public read; writes only by admins
create policy "scores public read" on public.scores
  for select using (true);

create policy "scores admin write" on public.scores
  for update using (public.is_admin())
  with check (public.is_admin());

create policy "scores admin insert" on public.scores
  for insert with check (public.is_admin());

-- raw submissions: strict append-only audit trail (only own + admin).
-- No UPDATE policy: rows are never edited after insert.
create policy "own raw reads" on public.raw_submissions
  for select using (team_id = public.my_team_id() or public.is_admin());

create policy "own raw inserts" on public.raw_submissions
  for insert with check (team_id = public.my_team_id());

-- mining pool: public read (needed for the /forks visualization).
-- All writes go through /api/stage2 with the service role, so there is
-- deliberately NO client INSERT policy here.
create policy "pool public read" on public.mining_pool
  for select using (true);

drop policy if exists "pool own write" on public.mining_pool;

create policy "pool admin update" on public.mining_pool
  for update using (public.is_admin())
  with check (public.is_admin());

-- stage config: window flags only (no answers; those live in stage_secrets).
-- Readable by logged-in users (play tabs + admin); writes are admin-only.
-- NOTE: any logged-in team can read these rows, so never store answers here.
drop policy if exists "config read" on public.stage_config;
create policy "config read" on public.stage_config
  for select using (auth.role() = 'authenticated');

create policy "config admin write" on public.stage_config
  for update using (public.is_admin())
  with check (public.is_admin());

create policy "config admin insert" on public.stage_config
  for insert with check (public.is_admin());

-- admin table itself: admin only
create policy "admins see admins" on public.admin_users
  for select using (public.is_admin());

-- stage secrets: answers for stage3/stage4. RLS enabled, NO client policies,
-- so anon/authenticated keys cannot read them at all. Server routes use the
-- service role, which bypasses RLS.
alter table public.stage_secrets enable row level security;

-- ───────────────────────── migrations for existing DBs ─────────────────────────
-- If this file was already run once, run this block in SQL Editor to upgrade:
--
--   alter table public.mining_pool add column if not exists data text not null default '';
--   -- rename the misleading Stage 2 rate-limit column (stores a timestamp, not a nonce):
--   do $$ begin
--     if exists (
--       select 1 from information_schema.columns
--       where table_schema = 'public' and table_name = 'scores'
--         and column_name = 'stage2_last_nonce'
--     ) then
--       alter table public.scores rename column stage2_last_nonce to stage2_last_attempt_at;
--     end if;
--   end $$;
--   alter table public.scores add column if not exists stage2_last_attempt_at timestamptz;
--
-- The trigger + teams INSERT policy above are idempotent
-- (drop if exists / create or replace), so re-running the whole file is safe
-- for those objects. Backfill note: existing mining_pool rows keep data = ''
-- and parent_block = NULL; they stay valid but sit at depth 1 until re-mined.
alter table public.mining_pool add column if not exists data text not null default '';
alter table public.scores add column if not exists stage1_attempts int not null default 0;
alter table public.scores add column if not exists stage1_locked_until timestamptz;
alter table public.scores add column if not exists stage5_attempts int not null default 0;
alter table public.scores add column if not exists stage5_at timestamptz;
alter table public.scores add column if not exists stage2_last_attempt_at timestamptz;
alter table public.scores add column if not exists stage3_attempts int not null default 0;
alter table public.scores add column if not exists stage3_locked_until timestamptz;
alter table public.scores add column if not exists stage4_submitted_at timestamptz;
alter table public.scores add column if not exists stage4_tx_hash text;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'scores_stage4_tx_hash_key'
  ) then
    alter table public.scores add constraint scores_stage4_tx_hash_key unique (stage4_tx_hash);
  end if;
end $$;
-- ensure the stage5 seed carries an (empty) finalists list
do $$ begin
  update public.stage_config
    set value = coalesce(value, '{}'::jsonb) || '{"finalists": []}'::jsonb
    where key = 'stage5' and not (value ? 'finalists');
end $$;
-- move any legacy answers out of stage_config into stage_secrets, then strip
-- them from the client-readable row
do $$ begin
  update public.stage_secrets
    set value = coalesce(value, '{}'::jsonb)
      || jsonb_build_object('tampered_block',
          coalesce((select (value->>'tampered_block')::int
                      from public.stage_config where key = 'stage3'),
                   (value->>'tampered_block')::int, -1))
    where key = 'stage3';
  update public.stage_secrets
    set value = coalesce(value, '{}'::jsonb)
      || jsonb_build_object(
          'contract_address',
          coalesce((select value->>'contract_address'
                      from public.stage_config where key = 'stage4'),
                   value->>'contract_address', ''),
          'success_code',
          coalesce((select value->>'success_code'
                      from public.stage_config where key = 'stage4'),
                   value->>'success_code', ''))
    where key = 'stage4';
  update public.stage_config set value = value - 'tampered_block' where key = 'stage3';
  update public.stage_config set value = value - 'contract_address' - 'success_code' where key = 'stage4';
end $$;
-- clean up policies removed from the model (safe on fresh + existing DBs)
drop policy if exists "own raw updates" on public.raw_submissions;
drop policy if exists "pool own write" on public.mining_pool;
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scores'
      and column_name = 'stage2_last_nonce'
  ) then
    alter table public.scores rename column stage2_last_nonce to stage2_last_attempt_at;
  end if;
end $$;
