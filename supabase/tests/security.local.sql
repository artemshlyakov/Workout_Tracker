\set ON_ERROR_STOP on
grant usage on schema auth to authenticated;
grant execute on function auth.uid(), auth.jwt() to authenticated;
do $$
declare
  v_table text;
  v_privilege text;
begin
  foreach v_table in array array[
    'public.workouts', 'public.exercises', 'public.workout_exercises',
    'public.exercise_sets', 'public.sync_operations'
  ] loop
    if not (select relrowsecurity from pg_class where oid = v_table::regclass) then
      raise exception 'RLS missing on %', v_table;
    end if;
    foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('authenticated', v_table, v_privilege) then
        raise exception 'authenticated has direct % on %', v_privilege, v_table;
      end if;
    end loop;
    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('anon', v_table, v_privilege) then
        raise exception 'anon has % on %', v_privilege, v_table;
      end if;
      if v_table = 'public.sync_operations' and
         has_table_privilege('authenticated', v_table, v_privilege) then
        raise exception 'authenticated can access sync_operations via %', v_privilege;
      end if;
    end loop;
    if v_table <> 'public.sync_operations' and
       not has_table_privilege('authenticated', v_table, 'SELECT') then
      raise exception 'authenticated cannot read own rows from %', v_table;
    end if;
  end loop;
  if has_function_privilege('anon','public.apply_workout_operation(uuid,text,uuid,text,bigint,jsonb)','EXECUTE') or
     not has_function_privilege('authenticated','public.apply_workout_operation(uuid,text,uuid,text,bigint,jsonb)','EXECUTE') then
    raise exception 'unexpected RPC execute grants';
  end if;
end $$;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","is_anonymous":false}',true);
do $$ declare r jsonb; begin
  begin
    perform 1 from public.sync_operations;
    raise exception 'authenticated read operation ledger directly';
  exception when insufficient_privilege then null; end;
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000001','workout',
    '11111111-1111-4111-8111-111111111111','upsert',null,
    '{"title":"A workout","started_at":"2026-10-20T10:00:00Z","completed_at":null}');
  if r->>'status' <> 'applied' or (r->>'revision')::int <> 1 then raise exception 'A create failed'; end if;
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000001','workout',
    '11111111-1111-4111-8111-111111111111','upsert',null,
    '{"title":"A workout","started_at":"2026-10-20T10:00:00Z","completed_at":null}');
  if (r->>'revision')::int <> 1 then raise exception 'replay changed revision'; end if;
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000011','workout',
    '11111111-1111-4111-8111-111111111111','upsert',null,
    '{"title":"A workout","started_at":"2026-10-20T10:00:00Z","completed_at":null}');
  if r->>'status' <> 'conflict' or (r->>'server_revision')::int <> 1 then
    raise exception 'duplicate entity did not conflict'; end if;
  begin
    perform public.apply_workout_operation('d0000000-0000-4000-8000-000000000001','workout',
      '11111111-1111-4111-8111-111111111111','upsert',null,
      '{"title":"forged replay","started_at":"2026-10-20T10:00:00Z","completed_at":null}');
    raise exception 'different payload accepted';
  exception when sqlstate '22023' then null; end;
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000002','workout',
    '11111111-1111-4111-8111-111111111111','upsert',1,
    '{"title":"A updated","started_at":"2026-10-20T10:00:00Z","completed_at":null}');
  if (r->>'revision')::int <> 2 then raise exception 'CAS update failed'; end if;
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000003','workout',
    '11111111-1111-4111-8111-111111111111','upsert',1,
    '{"title":"stale","started_at":"2026-10-20T10:00:00Z","completed_at":null}');
  if r->>'status' <> 'conflict' or (r->>'server_revision')::int <> 2 then raise exception 'CAS conflict missing'; end if;
  if (select title from public.workouts where id='11111111-1111-4111-8111-111111111111') <> 'A updated' then
    raise exception 'stale update overwrote data'; end if;
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000004','exercise',
    '22222222-2222-4222-8222-222222222222','upsert',null,'{"name":"Bench press"}');
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000005','workout_exercise',
    '33333333-3333-4333-8333-333333333333','upsert',null,
    '{"workout_id":"11111111-1111-4111-8111-111111111111","exercise_id":"22222222-2222-4222-8222-222222222222","position":0}');
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000006','exercise_set',
    '44444444-4444-4444-8444-444444444444','upsert',null,
    '{"workout_exercise_id":"33333333-3333-4333-8333-333333333333","position":0,"weight_kg":80.50,"reps":10}');
  if (r->>'revision')::int <> 1 then raise exception 'set create failed'; end if;
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000007','exercise_set',
    '44444444-4444-4444-8444-444444444444','delete',1,'{}');
  if (r->>'revision')::int <> 2 or r->>'deleted_at' is null then raise exception 'tombstone failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","is_anonymous":false}',true);
do $$ declare r jsonb; begin
  if (select count(*) from public.workouts) <> 0 or (select count(*) from public.exercise_sets) <> 0 then
    raise exception 'B read A data'; end if;
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000008','workout',
    '11111111-1111-4111-8111-111111111111','upsert',2,
    '{"title":"B forged","started_at":"2026-10-20T10:00:00Z","completed_at":null}');
  if r->>'status' <> 'conflict' or r->>'server_revision' is not null then
    raise exception 'B learned or changed A revision'; end if;
  r := public.apply_workout_operation('d0000000-0000-4000-8000-000000000009','exercise',
    '66666666-6666-4666-8666-666666666666','upsert',null,'{"name":"B exercise"}');
  begin
    perform public.apply_workout_operation('d0000000-0000-4000-8000-000000000010','workout_exercise',
      '77777777-7777-4777-8777-777777777777','upsert',null,
      '{"workout_id":"11111111-1111-4111-8111-111111111111","exercise_id":"66666666-6666-4666-8666-666666666666","position":0}');
    raise exception 'foreign parent accepted';
  exception when foreign_key_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","is_anonymous":true}',true);
do $$ begin
  if (select count(*) from public.workouts) <> 0 then raise exception 'anonymous Auth read A data'; end if;
  begin
    perform public.apply_workout_operation('d0000000-0000-4000-8000-000000000012','exercise',
      '99999999-9999-4999-8999-999999999999','upsert',null,'{"name":"anonymous"}');
    raise exception 'anonymous Auth write accepted';
  exception when sqlstate '28000' then null; end;
end $$;
reset role;
set local role anon;
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'public.workouts', 'public.exercises', 'public.workout_exercises',
    'public.exercise_sets', 'public.sync_operations'
  ] loop
    begin
      execute format('select 1 from %s limit 1', v_table);
      raise exception 'anon read % directly', v_table;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
rollback;
