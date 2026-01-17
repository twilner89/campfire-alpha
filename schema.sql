create extension if not exists "pgcrypto";

-- Enum for game phases
do $$
begin
  if not exists (select 1 from pg_type where typname = 'game_phase') then
    create type public.game_phase as enum ('LISTEN', 'SUBMIT', 'VOTE', 'PROCESS');
  end if;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  is_admin boolean not null default false
);

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  narrative_text text,
  audio_url text,
  season_num integer not null,
  episode_num integer not null,
  unique (season_num, episode_num)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  episode_id uuid not null references public.episodes (id) on delete cascade,
  content_text text not null,
  is_synthetic boolean not null default false
);

create table if not exists public.path_options (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes (id) on delete cascade,
  title text not null,
  description text not null
);

alter table public.path_options
  add column if not exists source_submission_ids uuid[];

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  option_id uuid not null references public.path_options (id) on delete cascade,
  unique (user_id, option_id)
);

create table if not exists public.game_state (
  id uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  current_phase public.game_phase not null,
  current_episode_id uuid references public.episodes (id) on delete set null,
  phase_expiry timestamptz,
  constraint game_state_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid)
);

create table if not exists public.series_bible (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  genre text not null,
  tone text not null,
  premise text not null,
  bible_json jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.series_bible
  add column if not exists intro_audio_url text;

alter table public.episodes
  add column if not exists credited_authors jsonb;

alter table public.game_state
  add column if not exists current_series_bible_id uuid references public.series_bible (id) on delete set null;

alter table public.game_state
  add column if not exists phase_expiry timestamptz;

alter table public.game_state
  add column if not exists is_transitioning boolean not null default false;

alter table public.game_state
  add column if not exists transitioning_since timestamptz;

create or replace function public.publish_next_episode(
  p_title text,
  p_narrative_text text,
  p_audio_url text,
  p_season_num integer,
  p_episode_num integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_episode_id uuid;
begin
  insert into public.episodes (title, narrative_text, audio_url, season_num, episode_num)
  values (p_title, p_narrative_text, p_audio_url, p_season_num, p_episode_num)
  returning id into new_episode_id;

  update public.game_state
  set current_phase = 'LISTEN',
      current_episode_id = new_episode_id,
      phase_expiry = null
  where id = '00000000-0000-0000-0000-000000000001'::uuid;

  return new_episode_id;
end;
$$;
