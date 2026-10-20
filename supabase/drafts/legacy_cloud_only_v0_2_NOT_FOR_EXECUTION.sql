-- WARNING v0.3: LEGACY CLOUD-ONLY DRAFT, NOT EXECUTABLE FOR OFFLINE-FIRST RELEASE.
-- Must be reviewed/replaced to add revision, operation ledger, tombstones and atomic sync RPC before Plan 003.
-- DRAFT: review with owner before execution in a new Supabase project.
-- Purpose: workout sessions, exercise catalog, instances and sets.
-- Authorization uses Supabase Auth + RLS and ownership-aware composite FKs.

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  check (completed_at is null or completed_at >= started_at)
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_id uuid not null,
  exercise_id uuid not null,
  position int not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, workout_id) references public.workouts(user_id, id) on delete cascade,
  foreign key (user_id, exercise_id) references public.exercises(user_id, id) on delete restrict
);

create table public.exercise_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_exercise_id uuid not null,
  position int not null check (position >= 0),
  weight_kg numeric(7,2) not null check (weight_kg >= 0 and weight_kg <= 2000),
  reps int not null check (reps between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, workout_exercise_id) references public.workout_exercises(user_id, id) on delete cascade
);

create index workouts_by_user_date on public.workouts(user_id, started_at desc);
create index exercises_by_user on public.exercises(user_id);
create index workout_exercises_by_parent on public.workout_exercises(user_id, workout_id, position);
create index exercise_sets_by_parent on public.exercise_sets(user_id, workout_exercise_id, position);

alter table public.workouts enable row level security;
alter table public.exercises enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.exercise_sets enable row level security;

revoke all on table public.workouts, public.exercises, public.workout_exercises, public.exercise_sets from anon, authenticated;
grant select, insert, update, delete on table public.workouts, public.exercises, public.workout_exercises, public.exercise_sets to authenticated;

create policy workouts_select on public.workouts for select to authenticated using ((select auth.uid()) = user_id);
create policy workouts_insert on public.workouts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy workouts_update on public.workouts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy workouts_delete on public.workouts for delete to authenticated using ((select auth.uid()) = user_id);

create policy exercises_select on public.exercises for select to authenticated using ((select auth.uid()) = user_id);
create policy exercises_insert on public.exercises for insert to authenticated with check ((select auth.uid()) = user_id);
create policy exercises_update on public.exercises for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy exercises_delete on public.exercises for delete to authenticated using ((select auth.uid()) = user_id);

create policy workout_exercises_select on public.workout_exercises for select to authenticated using ((select auth.uid()) = user_id);
create policy workout_exercises_insert on public.workout_exercises for insert to authenticated with check ((select auth.uid()) = user_id);
create policy workout_exercises_update on public.workout_exercises for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy workout_exercises_delete on public.workout_exercises for delete to authenticated using ((select auth.uid()) = user_id);

create policy exercise_sets_select on public.exercise_sets for select to authenticated using ((select auth.uid()) = user_id);
create policy exercise_sets_insert on public.exercise_sets for insert to authenticated with check ((select auth.uid()) = user_id);
create policy exercise_sets_update on public.exercise_sets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy exercise_sets_delete on public.exercise_sets for delete to authenticated using ((select auth.uid()) = user_id);
