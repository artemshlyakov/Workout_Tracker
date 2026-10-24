-- Saved training plans are distinct from dated workout sessions.
create table public.training_plans (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  exercise_names jsonb not null check (jsonb_typeof(exercise_names) = 'array' and jsonb_array_length(exercise_names) between 1 and 50),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id,id)
);
create index training_plans_user_idx on public.training_plans(user_id,updated_at desc,id);
alter table public.training_plans enable row level security;
create policy training_plans_owner_read on public.training_plans for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.training_plans from public,anon,authenticated;
grant select on public.training_plans to authenticated;

create table public.training_plan_operations (
 user_id uuid not null references auth.users(id) on delete restrict,
 operation_id uuid not null,
 entity_id uuid not null,
 payload_hash bytea not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(user_id,operation_id)
);
alter table public.training_plan_operations enable row level security;
revoke all on public.training_plan_operations from public,anon,authenticated;

create function public.apply_training_plan_operation(p_operation_id uuid,p_entity_id uuid,p_action text,p_base_revision bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_uid uuid := (select auth.uid());
 v_hash bytea;
 v_stored public.training_plan_operations%rowtype;
 v_revision bigint;
 v_result jsonb;
 v_names jsonb;
begin
 if v_uid is null then raise exception 'authentication required' using errcode='28000'; end if;
 if p_operation_id is null or p_entity_id is null or p_action not in ('upsert','delete') or p_payload is null or
   (p_base_revision is not null and p_base_revision < 1) then raise exception 'invalid operation' using errcode='22023'; end if;
 v_hash := extensions.digest(pg_catalog.convert_to(p_entity_id::text||p_action||coalesce(p_base_revision::text,'null')||p_payload::text,'UTF8'),'sha256');
 select * into v_stored from public.training_plan_operations where user_id=v_uid and operation_id=p_operation_id;
 if found then
   if v_stored.payload_hash <> v_hash or v_stored.entity_id <> p_entity_id then raise exception 'operation id reused' using errcode='22023'; end if;
   return v_stored.result;
 end if;
 if p_action='delete' then
   if p_base_revision is null or p_payload <> '{}'::jsonb then raise exception 'invalid delete' using errcode='22023'; end if;
   update public.training_plans set deleted_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp(),revision=revision+1
    where user_id=v_uid and id=p_entity_id and revision=p_base_revision and deleted_at is null returning revision into v_revision;
 else
   if p_payload - 'title' - 'exercise_names' <> '{}'::jsonb or not(p_payload ? 'title' and p_payload ? 'exercise_names') then raise exception 'invalid payload' using errcode='22023'; end if;
   v_names := p_payload->'exercise_names';
   if jsonb_typeof(v_names)<>'array' or jsonb_array_length(v_names) not between 1 and 50 or
     exists(select 1 from jsonb_array_elements(v_names) item where jsonb_typeof(item)<>'string' or char_length(btrim(item#>>'{}')) not between 1 and 120) then raise exception 'invalid exercises' using errcode='22023'; end if;
   if p_base_revision is null then
     insert into public.training_plans(id,user_id,title,exercise_names) values(p_entity_id,v_uid,p_payload->>'title',v_names)
     on conflict(id) do nothing returning revision into v_revision;
   else
     update public.training_plans set title=p_payload->>'title',exercise_names=v_names,updated_at=pg_catalog.clock_timestamp(),revision=revision+1
      where user_id=v_uid and id=p_entity_id and revision=p_base_revision and deleted_at is null returning revision into v_revision;
   end if;
 end if;
 if v_revision is null then
   select revision into v_revision from public.training_plans where user_id=v_uid and id=p_entity_id;
   v_result := pg_catalog.jsonb_build_object('status','conflict','operation_id',p_operation_id,'entity_id',p_entity_id,'server_revision',v_revision);
 else
   v_result := pg_catalog.jsonb_build_object('status','applied','operation_id',p_operation_id,'entity_id',p_entity_id,'revision',v_revision);
 end if;
 insert into public.training_plan_operations(user_id,operation_id,entity_id,payload_hash,result) values(v_uid,p_operation_id,p_entity_id,v_hash,v_result);
 return v_result;
end;
$$;
revoke all on function public.apply_training_plan_operation(uuid,uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.apply_training_plan_operation(uuid,uuid,text,bigint,jsonb) to authenticated;
