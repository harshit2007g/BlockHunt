-- BlockHunt schema. Apply schema.sql then event.sql, in a transaction.
-- Re-runnable on fresh and legacy installs. Existing event rows are preserved.
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
      stage4_submitted_at timestamptz,
  stage4_tx_hash text unique,
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

insert into public.stage_config (key, value) values
  ('stage1', '{"open": false, "started_at": null, "duration_ms": 900000}'),
  ('stage2', '{"open": false, "started_at": null, "duration_ms": 2400000, "difficulty_prefix": "0", "nonce_max": 100000000}'),
  ('stage3', '{"open": false, "started_at": null, "duration_ms": 1800000}'),
  ('stage4', '{"open": false, "started_at": null, "duration_ms": 1500000}'),
  ('stage5', '{"open": false, "started_at": null, "duration_ms": 1500000, "finalists": []}')
on conflict (key) do nothing;

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


-- Rename before adding the replacement; also repair partially migrated installs.
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='scores' and column_name='stage2_last_nonce') then
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='scores' and column_name='stage2_last_attempt_at') then
      alter table public.scores rename column stage2_last_nonce to stage2_last_attempt_at;
    else
      update public.scores set stage2_last_attempt_at=coalesce(stage2_last_attempt_at,stage2_last_nonce);
      alter table public.scores drop column stage2_last_nonce;
    end if;
  end if;
end $$;
alter table public.mining_pool add column if not exists data text not null default '';
alter table public.mining_pool add column if not exists parent_block bigint;
alter table public.scores add column if not exists stage1_attempts int not null default 0;
alter table public.scores add column if not exists stage1_locked_until timestamptz;
alter table public.scores add column if not exists stage2_last_attempt_at timestamptz;
alter table public.scores add column if not exists stage3_attempts int not null default 0;
alter table public.scores add column if not exists stage3_locked_until timestamptz;
alter table public.scores add column if not exists stage4_submitted_at timestamptz;
alter table public.scores add column if not exists stage4_tx_hash text;
alter table public.scores add column if not exists stage5_attempts int not null default 0;
alter table public.scores add column if not exists stage5_at timestamptz;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.scores'::regclass and conname='scores_stage4_tx_hash_key') then
    alter table public.scores add constraint scores_stage4_tx_hash_key unique(stage4_tx_hash);
  end if;
end $$;
update public.stage_config set value=value-'tampered_block' where key='stage3';
update public.stage_config set value=value-'contract_address'-'success_code' where key='stage4';
update public.stage_config set value=value || '{"finalists":[]}'::jsonb where key='stage5' and not(value ? 'finalists');

drop policy if exists "team reads own" on public.teams;
drop policy if exists "team updates own (profile only)" on public.teams;
drop policy if exists "team inserts own" on public.teams;
drop policy if exists "scores public read" on public.scores;
drop policy if exists "scores admin write" on public.scores;
drop policy if exists "scores admin insert" on public.scores;
drop policy if exists "own raw reads" on public.raw_submissions;
drop policy if exists "own raw inserts" on public.raw_submissions;
drop policy if exists "pool public read" on public.mining_pool;
drop policy if exists "pool admin update" on public.mining_pool;
drop policy if exists "config read" on public.stage_config;
drop policy if exists "config admin write" on public.stage_config;
drop policy if exists "config admin insert" on public.stage_config;
drop policy if exists "admins see admins" on public.admin_users;
drop policy if exists "pool own write" on public.mining_pool;
drop policy if exists "own raw updates" on public.raw_submissions;
alter table public.teams enable row level security;
alter table public.scores enable row level security;
alter table public.raw_submissions enable row level security;
alter table public.mining_pool enable row level security;
alter table public.stage_config enable row level security;
alter table public.stage_secrets enable row level security;
alter table public.admin_users enable row level security;
create policy "team reads own" on public.teams for select using(auth_uid=auth.uid() or public.is_admin());
create policy "scores public read" on public.scores for select using(team_id=public.my_team_id() or public.is_admin());
create policy "own raw reads" on public.raw_submissions for select using(team_id=public.my_team_id() or public.is_admin());
create policy "config read" on public.stage_config for select using(auth.role()='authenticated');
create policy "admins see admins" on public.admin_users for select using(public.is_admin());

create or replace function public.handle_new_team() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.scores(team_id) values(NEW.id) on conflict(team_id) do nothing;
  return NEW;
end;
$$;
drop trigger if exists on_teams_created on public.teams;
create trigger on_teams_created after insert on public.teams for each row execute function public.handle_new_team();
insert into public.scores(team_id) select id from public.teams on conflict(team_id) do nothing;

grant usage on schema public to anon,authenticated,service_role;
grant select on public.teams,public.scores,public.raw_submissions,public.stage_config,public.admin_users to authenticated;
grant all on public.teams,public.scores,public.raw_submissions,public.mining_pool,public.stage_config,public.stage_secrets,public.admin_users to service_role;
grant usage,select on all sequences in schema public to service_role;
revoke all on public.teams,public.scores,public.raw_submissions,public.stage_config,public.admin_users from anon;
revoke insert,update,delete on public.teams,public.scores,public.raw_submissions,public.stage_config,public.admin_users from authenticated;
revoke all on public.stage_secrets,public.mining_pool from anon,authenticated;
