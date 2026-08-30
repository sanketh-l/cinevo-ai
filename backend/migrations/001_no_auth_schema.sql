-- Cinevo no-auth schema migration.
-- This removes auth.users UUID dependency while login is intentionally disabled.

alter table if exists profiles disable row level security;
alter table if exists projects disable row level security;
alter table if exists ingredients disable row level security;
alter table if exists clips disable row level security;
alter table if exists voiceovers disable row level security;
alter table if exists exports disable row level security;

drop policy if exists "Users can view own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;
drop policy if exists "Users can view own projects" on projects;
drop policy if exists "Users can create projects" on projects;
drop policy if exists "Users can update own projects" on projects;
drop policy if exists "Users can delete own projects" on projects;
drop policy if exists "Users can view own ingredients" on ingredients;
drop policy if exists "Users can create ingredients" on ingredients;
drop policy if exists "Users can update own ingredients" on ingredients;
drop policy if exists "Users can delete own ingredients" on ingredients;
drop policy if exists "Users can view project clips" on clips;
drop policy if exists "Users can create clips" on clips;
drop policy if exists "Users can update project clips" on clips;
drop policy if exists "Users can delete project clips" on clips;
drop policy if exists "Users can view clip voiceovers" on voiceovers;
drop policy if exists "Users can create voiceovers" on voiceovers;
drop policy if exists "Users can view project exports" on exports;
drop policy if exists "Users can create exports" on exports;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'anonymous',
  name text not null default 'Untitled Project',
  aspect_ratio text not null default '16:9',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists projects drop constraint if exists projects_user_id_fkey;
alter table if exists projects alter column user_id type text using user_id::text;
alter table if exists projects alter column user_id set default 'anonymous';

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'anonymous',
  name text not null default 'Untitled Collection',
  description text default '',
  created_at timestamptz not null default now()
);

alter table if exists collections alter column user_id type text using user_id::text;
alter table if exists collections alter column user_id set default 'anonymous';

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'anonymous',
  project_id uuid references projects(id) on delete cascade,
  collection_id uuid references collections(id) on delete set null,
  name text not null default 'Untitled',
  type text not null default 'character',
  image_url text not null default '',
  prompt text default '',
  locked boolean default false,
  created_at timestamptz not null default now()
);

alter table if exists ingredients drop constraint if exists ingredients_user_id_fkey;
alter table if exists ingredients alter column user_id type text using user_id::text;
alter table if exists ingredients alter column user_id set default 'anonymous';
alter table if exists ingredients add column if not exists collection_id uuid references collections(id) on delete set null;

create table if not exists clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  position integer not null default 0,
  prompt text not null default '',
  ingredients_used jsonb default '[]'::jsonb,
  camera_settings jsonb default '{}'::jsonb,
  video_url text,
  thumbnail_url text,
  duration_sec float not null default 8,
  status text not null default 'queued',
  job_id text,
  created_at timestamptz not null default now()
);

alter table if exists clips add column if not exists thumbnail_url text;

create table if not exists voiceovers (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid references clips(id) on delete cascade,
  text text not null default '',
  voice text not null default 'en-US-AriaNeural',
  audio_url text,
  created_at timestamptz not null default now()
);

create table if not exists exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  status text not null default 'queued',
  final_video_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_user on projects(user_id);
create index if not exists idx_ingredients_user on ingredients(user_id);
create index if not exists idx_ingredients_project on ingredients(project_id);
create index if not exists idx_clips_project on clips(project_id);
create index if not exists idx_exports_project on exports(project_id);

insert into storage.buckets (id, name, public)
values ('videos', 'videos', true)
on conflict (id) do update set public = true;
