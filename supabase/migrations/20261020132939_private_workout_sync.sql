-- Plan 003A draft. Do not apply before owner review.
-- Client-generated UUIDs stay stable across local and cloud stores.
-- Direct client writes are denied: all mutations pass through the CAS RPC below.

-- The operation fingerprint uses pgcrypto.digest(bytea, text). A new Supabase
-- project usually has pgcrypto in extensions already; this also supports one
-- where the extension is available but has not yet been enabled.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$
begin
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'pgcrypto must provide extensions.digest(bytea,text) before workout schema is installed';
  end if;
end;
$$;

create table public.workouts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  started_at timestamptz not null,
  completed_at timestamptz check (completed_at is null or completed_at >= started_at),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, id)
);
create index workouts_user_started_idx on public.workouts (user_id, started_at desc, id);

create table public.exercises (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, id)
);
create index exercises_user_name_idx on public.exercises (user_id, name, id);

create table public.workout_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  workout_id uuid not null,
  exercise_id uuid not null,
  position integer not null check (position >= 0),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, id),
  constraint workout_exercises_workout_owner_fk foreign key (user_id, workout_id)
    references public.workouts (user_id, id) on delete restrict,
  constraint workout_exercises_exercise_owner_fk foreign key (user_id, exercise_id)
    references public.exercises (user_id, id) on delete restrict
);
create index workout_exercises_workout_idx on public.workout_exercises (user_id, workout_id, position, id);
create index workout_exercises_exercise_idx on public.workout_exercises (user_id, exercise_id);

create table public.exercise_sets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  workout_exercise_id uuid not null,
  position integer not null check (position >= 0),
  weight_kg numeric(7,2) not null check (weight_kg between 0 and 2000),
  reps integer not null check (reps between 1 and 1000),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, id),
  constraint exercise_sets_parent_owner_fk foreign key (user_id, workout_exercise_id)
    references public.workout_exercises (user_id, id) on delete restrict
);
create index exercise_sets_parent_idx on public.exercise_sets (user_id, workout_exercise_id, position, id);

-- The operation ledger is private even to the owner; the RPC returns its stored ack.
create table public.sync_operations (
  user_id uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  entity_type text not null check (entity_type in ('workout', 'exercise', 'workout_exercise', 'exercise_set')),
  entity_id uuid not null,
  action text not null check (action in ('upsert', 'delete')),
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  base_revision bigint check (base_revision > 0),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
create index sync_operations_user_created_idx on public.sync_operations (user_id, created_at, operation_id);

alter table public.workouts enable row level security;
alter table public.exercises enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.exercise_sets enable row level security;
alter table public.sync_operations enable row level security;

-- Authenticated users can read only their own rows, including tombstones.
-- Anonymous Auth users are excluded even though they have the authenticated DB role.
create policy workouts_read_own on public.workouts for select to authenticated
  using (user_id = (select auth.uid()) and coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
create policy exercises_read_own on public.exercises for select to authenticated
  using (user_id = (select auth.uid()) and coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
create policy workout_exercises_read_own on public.workout_exercises for select to authenticated
  using (user_id = (select auth.uid()) and coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
create policy exercise_sets_read_own on public.exercise_sets for select to authenticated
  using (user_id = (select auth.uid()) and coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
-- sync_operations intentionally has no client-facing policy.

revoke all on public.workouts, public.exercises, public.workout_exercises,
  public.exercise_sets, public.sync_operations from public, anon, authenticated;
grant select on public.workouts, public.exercises, public.workout_exercises,
  public.exercise_sets to authenticated;

-- Security definer is necessary because browser roles have no table-write grants.
-- Every table access below is schema-qualified and scoped to auth.uid().
create function public.apply_workout_operation(
  p_operation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_base_revision bigint,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash bytea;
  v_previous_hash bytea;
  v_previous_result jsonb;
  v_revision bigint;
  v_current_revision bigint;
  v_deleted_at timestamptz;
  v_result jsonb;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_operation_id is null or p_entity_id is null or
     p_entity_type is null or p_entity_type not in ('workout', 'exercise', 'workout_exercise', 'exercise_set') or
     p_action is null or p_action not in ('upsert', 'delete') or
     p_payload is null or jsonb_typeof(p_payload) <> 'object' or
     octet_length(p_payload::text) > 16384 or
     (p_base_revision is not null and p_base_revision < 1) or
     (p_action = 'delete' and (p_base_revision is null or p_payload <> '{}'::jsonb)) then
    raise exception 'invalid operation' using errcode = '22023';
  end if;

  v_hash := extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id,
      'action', p_action, 'base_revision', p_base_revision, 'payload', p_payload)::text, 'UTF8'), 'sha256');
  -- Lock the operation key before reading its ledger entry. A hash collision only
  -- serializes unrelated requests; it cannot make them share an acknowledgment.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text || ':' || p_operation_id::text, 0));
  select payload_hash, result into v_previous_hash, v_previous_result
    from public.sync_operations
    where user_id = v_uid and operation_id = p_operation_id;
  if found then
    if v_previous_hash <> v_hash then
      raise exception 'operation id reused with different payload' using errcode = '22023';
    end if;
    return v_previous_result;
  end if;

  if p_action = 'delete' then
    if p_entity_type = 'workout' then
      update public.workouts set deleted_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp(), revision = revision + 1
        where user_id = v_uid and id = p_entity_id and revision = p_base_revision and deleted_at is null
        returning revision, deleted_at into v_revision, v_deleted_at;
    elsif p_entity_type = 'exercise' then
      update public.exercises set deleted_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp(), revision = revision + 1
        where user_id = v_uid and id = p_entity_id and revision = p_base_revision and deleted_at is null
        returning revision, deleted_at into v_revision, v_deleted_at;
    elsif p_entity_type = 'workout_exercise' then
      update public.workout_exercises set deleted_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp(), revision = revision + 1
        where user_id = v_uid and id = p_entity_id and revision = p_base_revision and deleted_at is null
        returning revision, deleted_at into v_revision, v_deleted_at;
    else
      update public.exercise_sets set deleted_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp(), revision = revision + 1
        where user_id = v_uid and id = p_entity_id and revision = p_base_revision and deleted_at is null
        returning revision, deleted_at into v_revision, v_deleted_at;
    end if;
  elsif p_entity_type = 'workout' then
    if p_payload - 'title' - 'started_at' - 'completed_at' <> '{}'::jsonb or
       not (p_payload ? 'title' and p_payload ? 'started_at' and p_payload ? 'completed_at') then
      raise exception 'invalid workout payload' using errcode = '22023';
    end if;
    if p_base_revision is null then
      insert into public.workouts (id, user_id, title, started_at, completed_at)
      values (p_entity_id, v_uid, p_payload ->> 'title',
        (p_payload ->> 'started_at')::timestamptz,
        (p_payload ->> 'completed_at')::timestamptz)
      on conflict (id) do nothing
      returning revision into v_revision;
    else
      update public.workouts set title = p_payload ->> 'title',
        started_at = (p_payload ->> 'started_at')::timestamptz,
        completed_at = (p_payload ->> 'completed_at')::timestamptz,
        updated_at = pg_catalog.clock_timestamp(), revision = revision + 1
      where user_id = v_uid and id = p_entity_id and revision = p_base_revision and deleted_at is null
      returning revision into v_revision;
    end if;
  elsif p_entity_type = 'exercise' then
    if p_payload - 'name' <> '{}'::jsonb or not (p_payload ? 'name') then
      raise exception 'invalid exercise payload' using errcode = '22023';
    end if;
    if p_base_revision is null then
      insert into public.exercises (id, user_id, name)
      values (p_entity_id, v_uid, p_payload ->> 'name')
      on conflict (id) do nothing
      returning revision into v_revision;
    else
      update public.exercises set name = p_payload ->> 'name',
        updated_at = pg_catalog.clock_timestamp(), revision = revision + 1
      where user_id = v_uid and id = p_entity_id and revision = p_base_revision and deleted_at is null
      returning revision into v_revision;
    end if;
  elsif p_entity_type = 'workout_exercise' then
    if p_payload - 'workout_id' - 'exercise_id' - 'position' <> '{}'::jsonb or
       not (p_payload ? 'workout_id' and p_payload ? 'exercise_id' and p_payload ? 'position') then
      raise exception 'invalid workout exercise payload' using errcode = '22023';
    end if;
    perform 1 from public.workouts
      where user_id = v_uid and id = (p_payload ->> 'workout_id')::uuid and deleted_at is null
      for share;
    if not found then
      raise exception 'parent not found' using errcode = '23503';
    end if;
    perform 1 from public.exercises
      where user_id = v_uid and id = (p_payload ->> 'exercise_id')::uuid and deleted_at is null
      for share;
    if not found then
      raise exception 'parent not found' using errcode = '23503';
    end if;
    if p_base_revision is null then
      insert into public.workout_exercises (id, user_id, workout_id, exercise_id, position)
      values (p_entity_id, v_uid, (p_payload ->> 'workout_id')::uuid,
        (p_payload ->> 'exercise_id')::uuid, (p_payload ->> 'position')::integer)
      on conflict (id) do nothing
      returning revision into v_revision;
    else
      update public.workout_exercises set workout_id = (p_payload ->> 'workout_id')::uuid,
        exercise_id = (p_payload ->> 'exercise_id')::uuid,
        position = (p_payload ->> 'position')::integer,
        updated_at = pg_catalog.clock_timestamp(), revision = revision + 1
      where user_id = v_uid and id = p_entity_id and revision = p_base_revision and deleted_at is null
      returning revision into v_revision;
    end if;
  else
    if p_payload - 'workout_exercise_id' - 'position' - 'weight_kg' - 'reps' <> '{}'::jsonb or
       not (p_payload ? 'workout_exercise_id' and p_payload ? 'position' and
         p_payload ? 'weight_kg' and p_payload ? 'reps') then
      raise exception 'invalid exercise set payload' using errcode = '22023';
    end if;
    perform 1 from public.workout_exercises we
      join public.workouts w on w.user_id = we.user_id and w.id = we.workout_id
      join public.exercises e on e.user_id = we.user_id and e.id = we.exercise_id
      where we.user_id = v_uid and we.id = (p_payload ->> 'workout_exercise_id')::uuid
        and we.deleted_at is null and w.deleted_at is null and e.deleted_at is null
      for share of we, w, e;
    if not found then
      raise exception 'parent not found' using errcode = '23503';
    end if;
    if p_base_revision is null then
      insert into public.exercise_sets (id, user_id, workout_exercise_id, position, weight_kg, reps)
      values (p_entity_id, v_uid, (p_payload ->> 'workout_exercise_id')::uuid,
        (p_payload ->> 'position')::integer, (p_payload ->> 'weight_kg')::numeric,
        (p_payload ->> 'reps')::integer)
      on conflict (id) do nothing
      returning revision into v_revision;
    else
      update public.exercise_sets set workout_exercise_id = (p_payload ->> 'workout_exercise_id')::uuid,
        position = (p_payload ->> 'position')::integer,
        weight_kg = (p_payload ->> 'weight_kg')::numeric,
        reps = (p_payload ->> 'reps')::integer,
        updated_at = pg_catalog.clock_timestamp(), revision = revision + 1
      where user_id = v_uid and id = p_entity_id and revision = p_base_revision and deleted_at is null
      returning revision into v_revision;
    end if;
  end if;

  if v_revision is null then
    -- No mutation occurred. Ledger the conflict too: repeating this operation
    -- returns the same result; rebase requires a new operation UUID.
    if p_entity_type = 'workout' then
      select revision into v_current_revision from public.workouts where user_id = v_uid and id = p_entity_id;
    elsif p_entity_type = 'exercise' then
      select revision into v_current_revision from public.exercises where user_id = v_uid and id = p_entity_id;
    elsif p_entity_type = 'workout_exercise' then
      select revision into v_current_revision from public.workout_exercises where user_id = v_uid and id = p_entity_id;
    else
      select revision into v_current_revision from public.exercise_sets where user_id = v_uid and id = p_entity_id;
    end if;
    v_result := pg_catalog.jsonb_build_object('status', 'conflict', 'operation_id', p_operation_id,
      'entity_id', p_entity_id, 'server_revision', v_current_revision);
    insert into public.sync_operations
      (user_id, operation_id, entity_type, entity_id, action, payload_hash, base_revision, result)
    values (v_uid, p_operation_id, p_entity_type, p_entity_id, p_action, v_hash, p_base_revision, v_result);
    return v_result;
  end if;

  v_result := pg_catalog.jsonb_build_object('status', 'applied', 'operation_id', p_operation_id,
    'entity_type', p_entity_type, 'entity_id', p_entity_id, 'revision', v_revision,
    'deleted_at', v_deleted_at);
  insert into public.sync_operations
    (user_id, operation_id, entity_type, entity_id, action, payload_hash, base_revision, result)
  values (v_uid, p_operation_id, p_entity_type, p_entity_id, p_action, v_hash, p_base_revision, v_result);
  return v_result;
end;
$$;

revoke all on function public.apply_workout_operation(uuid, text, uuid, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_workout_operation(uuid, text, uuid, text, bigint, jsonb)
  to authenticated;
