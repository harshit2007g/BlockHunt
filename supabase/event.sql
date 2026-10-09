-- Apply after schema.sql. Re-runnable, no event data is reset.
alter table public.scores add column if not exists mining_round integer not null default 0;
alter table public.scores add column if not exists stage4_last_attempt_at timestamptz;

-- All player mutations go through event_submit with the server service role.
revoke insert, update, delete on public.teams, public.scores, public.raw_submissions, public.mining_pool from anon, authenticated;
revoke all on public.stage_secrets, public.mining_pool from anon, authenticated;

create or replace function public.event_submit(p_team uuid, p_stage integer, p_correct boolean, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.scores%rowtype;
  cfg jsonb;
  at_time timestamptz;
  bonus integer := 0;
  awarded integer := 0;
  attempts integer;
  locked timestamptz;
  pool_id bigint;
  parent public.mining_pool%rowtype;
begin
  -- Opening/closing and pool freezing take the exclusive counterpart.
  perform pg_advisory_xact_lock_shared(42626);
  select value into cfg from public.stage_config where key = 'stage' || p_stage;
  select * into s from public.scores where team_id = p_team for update;
  if not found then return jsonb_build_object('status',403,'error','No team score row'); end if;
  at_time := clock_timestamp();
  if not coalesce((cfg->>'open')::boolean, false) then return jsonb_build_object('status',423,'error','Stage is closed'); end if;
  if cfg->>'started_at' is null or cfg->>'duration_ms' is null then return jsonb_build_object('status',503,'error','Stage clock is not configured'); end if;
  if at_time >= (cfg->>'started_at')::timestamptz + (cfg->>'duration_ms')::bigint * interval '1 millisecond' then return jsonb_build_object('status',423,'error','Stage window has ended'); end if;
  if p_stage = 1 or p_stage = 3 then
    attempts := case when p_stage = 1 then s.stage1_attempts else s.stage3_attempts end;
    locked := case when p_stage = 1 then s.stage1_locked_until else s.stage3_locked_until end;
    if (p_stage=1 and s.stage1_base>0) or (p_stage=3 and s.stage3_base>0) then return jsonb_build_object('status',409,'error','Already solved'); end if;
    if attempts >= 3 then return jsonb_build_object('status',429,'error','No guesses left'); end if;
    if locked > at_time then return jsonb_build_object('status',429,'error','Locked after a wrong guess','lockedUntil',locked); end if;
    attempts := attempts + 1;
    locked := case when p_correct then null else at_time + interval '60 seconds' end;
    bonus := round(20 * greatest(0,least(1,1 - extract(epoch from (at_time-(cfg->>'started_at')::timestamptz))*1000/(cfg->>'duration_ms')::numeric)));
    awarded := case when p_correct then (case when p_stage=1 then 100 else 130 end) + bonus else 0 end;
    if p_stage=1 then
      update public.scores set stage1_attempts=attempts, stage1_locked_until=locked,
        stage1_base=case when p_correct then 100 else 0 end, stage1_bonus=case when p_correct then bonus else 0 end,
        stage1_at=case when p_correct then at_time else stage1_at end,
        last_submit_at=case when p_correct then at_time else last_submit_at end where team_id=p_team;
    else
      update public.scores set stage3_attempts=attempts, stage3_locked_until=locked,
        stage3_base=case when p_correct then 130 else 0 end, stage3_bonus=case when p_correct then bonus else 0 end,
        stage3_at=case when p_correct then at_time else stage3_at end,
        last_submit_at=case when p_correct then at_time else last_submit_at end where team_id=p_team;
    end if;
  elsif p_stage=2 then
    if (p_payload->>'round')::integer <> s.mining_round then return jsonb_build_object('status',409,'error','Challenge changed'); end if;
    if p_payload->>'prefix' <> coalesce(cfg->>'difficulty_prefix','0') then return jsonb_build_object('status',409,'error','Difficulty changed; reload'); end if;
    if s.stage2_last_attempt_at > at_time - interval '3 seconds' then return jsonb_build_object('status',429,'error','Wait 3 seconds between attempts'); end if;
    if (p_payload->>'nonce')::bigint < 0 or (p_payload->>'nonce')::bigint > 1000000000 or (cfg->>'nonce_max' is not null and (p_payload->>'nonce')::bigint >= (cfg->>'nonce_max')::bigint) then return jsonb_build_object('status',400,'error','Nonce outside allowed range'); end if;
    update public.scores set stage2_last_attempt_at=at_time where team_id=p_team;
    if p_correct then
      if p_payload->>'parent_block' is not null then
        select * into parent from public.mining_pool where id=(p_payload->>'parent_block')::bigint and team_id=p_team;
        if not found or parent.hash <> p_payload->>'prev_hash' then raise exception 'Invalid mining parent'; end if;
      elsif p_payload->>'prev_hash' <> '00000000' then raise exception 'Non-genesis root'; end if;
      insert into public.mining_pool(team_id,block_index,nonce,hash,prev_hash,data,parent_team,parent_block)
      values(p_team,s.mining_round,p_payload->>'nonce',p_payload->>'hash',p_payload->>'prev_hash',p_payload->>'data',parent.team_id,(p_payload->>'parent_block')::bigint) returning id into pool_id;
      bonus := round(30 * greatest(0,least(1,1-extract(epoch from (at_time-(cfg->>'started_at')::timestamptz))*1000/(cfg->>'duration_ms')::numeric)));
      awarded := case when s.stage2_base=0 then 150+bonus else 0 end;
      update public.scores set mining_round=mining_round+1,
        stage2_base=150, stage2_bonus=case when s.stage2_base=0 then bonus else stage2_bonus end,
        stage2_at=case when s.stage2_base=0 then at_time else stage2_at end,
        last_submit_at=case when s.stage2_base=0 then at_time else last_submit_at end where team_id=p_team;
    end if;
  elsif p_stage=4 then
    if s.stage4_bonus>0 then return jsonb_build_object('status',409,'error','Already solved'); end if;
    if s.stage4_last_attempt_at > at_time - interval '3 seconds' then return jsonb_build_object('status',429,'error','Wait 3 seconds between attempts'); end if;
    awarded := case when p_correct then 50 else 0 end;
    update public.scores set stage4_last_attempt_at=at_time,stage4_bonus=awarded,
      stage4_submitted_at=case when p_correct then at_time else null end,
      stage4_at=case when p_correct then at_time else stage4_at end,
      last_submit_at=case when p_correct then at_time else last_submit_at end where team_id=p_team;
  elsif p_stage=5 then
    if not (cfg->'finalists' @> jsonb_build_array(p_team::text)) then return jsonb_build_object('status',403,'error','Finalists only'); end if;
    if s.stage5_attempts>0 then return jsonb_build_object('status',409,'error','One finale submission only'); end if;
    awarded := (p_payload->>'branch_pts')::integer + (p_payload->>'longest_pts')::integer;
    update public.scores set stage5_attempts=1,stage5_branches=(p_payload->>'branch_pts')::integer,
      stage5_longest=(p_payload->>'longest_pts')::integer,stage5_at=at_time,last_submit_at=at_time where team_id=p_team;
  else raise exception 'Unknown stage'; end if;
  insert into public.raw_submissions(team_id,stage,payload,correct,awarded) values(p_team,p_stage,p_payload,p_correct,awarded);
  return jsonb_build_object('correct',p_correct,'correctBlock',p_correct,'accepted',p_correct,'awarded',awarded,
    'pool_id',pool_id,'attemptsLeft',3-attempts,'lockedUntil',locked,
    'valid_branches',p_payload->'valid_branches','branch_pts',p_payload->'branch_pts','longest_pts',p_payload->'longest_pts');
end;
$$;
revoke all on function public.event_submit(uuid,integer,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.event_submit(uuid,integer,boolean,jsonb) to service_role;

create or replace function public.event_control(p_key text, p_open boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg jsonb; pool jsonb;
begin
  perform pg_advisory_xact_lock(42626);
  if p_key not in ('stage1','stage2','stage3','stage4','stage5') then raise exception 'Invalid stage'; end if;
  select value into cfg from public.stage_config where key=p_key for update;
  if p_open and p_key='stage5' then
    if exists(select 1 from public.stage_config where key='stage2' and (value->>'open')::boolean) then return jsonb_build_object('status',409,'error','Close Stage 2 before freezing the finale'); end if;
    if jsonb_array_length(coalesce(cfg->'finalists','[]'))=0 then return jsonb_build_object('status',400,'error','Set finalists first'); end if;
    -- Retain the same snapshot across close/reopen; never change a scored target.
    if not exists(select 1 from public.stage_secrets where key='stage5_pool') then
      select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object('team_name',t.name) order by b.id),'[]') into pool
        from public.mining_pool b join public.teams t on t.id=b.team_id where cfg->'finalists' @> jsonb_build_array(b.team_id::text);
      if jsonb_array_length(pool)=0 then return jsonb_build_object('status',400,'error','Finalists must mine at least one block'); end if;
      insert into public.stage_secrets(key,value) values('stage5_pool',jsonb_build_object('blocks',pool));
    end if;
  end if;
  -- A close/reopen never restarts the scoring clock.
  cfg := cfg || jsonb_build_object('open',p_open,'started_at',coalesce(cfg->>'started_at',case when p_open then clock_timestamp()::text end), 'duration_ms',coalesce((cfg->>'duration_ms')::bigint,1500000));
  update public.stage_config set value=cfg where key=p_key;
  return jsonb_build_object('ok',true,'value',cfg);
end;
$$;
revoke all on function public.event_control(text,boolean) from public, anon, authenticated;
grant execute on function public.event_control(text,boolean) to service_role;

-- Durable team judging; the judge cannot award explanation points to unsolved work.
create or replace function public.event_judge(p_team uuid, p_points integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_points < 0 or p_points > 20 then raise exception 'Rubric range is 0..20'; end if;
  update public.scores set stage3_expl=p_points where team_id=p_team and stage3_base>0;
  if not found then return jsonb_build_object('status',400,'error','Team has not solved Stage 3'); end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.event_judge(uuid,integer) from public, anon, authenticated;
grant execute on function public.event_judge(uuid,integer) to service_role;

create or replace function public.event_settings(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg jsonb;
begin
  perform pg_advisory_xact_lock(42626);
  select value into cfg from public.stage_config where key=p_key for update;
  if p_key='stage5' then
    if exists(select 1 from public.stage_secrets where key='stage5_pool') then return jsonb_build_object('status',409,'error','Finalist pool is already frozen'); end if;
    if jsonb_typeof(p_value->'finalists') <> 'array' then raise exception 'Invalid finalist list'; end if;
    cfg := cfg || jsonb_build_object('finalists',p_value->'finalists');
  elsif p_key='stage2' then
    if p_value ? 'difficulty_prefix' then cfg := cfg || jsonb_build_object('difficulty_prefix',p_value->'difficulty_prefix'); end if;
    if p_value ? 'nonce_max' then
      if p_value->'nonce_max'='null'::jsonb then cfg := cfg-'nonce_max';
      else cfg := cfg || jsonb_build_object('nonce_max',p_value->'nonce_max'); end if;
    end if;
  else raise exception 'Invalid settings key'; end if;
  update public.stage_config set value=cfg where key=p_key;
  return jsonb_build_object('ok',true,'value',cfg);
end;
$$;
revoke all on function public.event_settings(text,jsonb) from public,anon,authenticated;
grant execute on function public.event_settings(text,jsonb) to service_role;
