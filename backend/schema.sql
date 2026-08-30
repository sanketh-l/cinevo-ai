-- Cinevo Database Schema for Supabase
-- Run this in the Supabase SQL Editor

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'anonymous',
  name text not null default 'Untitled Project',
  aspect_ratio text not null default '16:9',
  status text not null default 'draft' check (status in ('draft', 'generating', 'exporting', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'anonymous',
  name text not null default 'Untitled Collection',
  description text default '',
  created_at timestamptz not null default now()
);

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'anonymous',
  project_id uuid references projects(id) on delete cascade,
  collection_id uuid references collections(id) on delete set null,
  name text not null default 'Untitled',
  type text not null default 'character' check (type in ('character', 'scene', 'style', 'object')),
  image_url text not null default '',
  prompt text default '',
  locked boolean default false,
  created_at timestamptz not null default now()
);

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
  status text not null default 'queued' check (status in ('queued', 'generating', 'ready', 'failed')),
  job_id text,
  created_at timestamptz not null default now()
);

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
  status text not null default 'queued' check (status in ('queued', 'stitching', 'done', 'failed')),
  final_video_url text,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_projects_user on projects(user_id);
create index if not exists idx_ingredients_user on ingredients(user_id);
create index if not exists idx_ingredients_project on ingredients(project_id);
create index if not exists idx_clips_project on clips(project_id);
create index if not exists idx_voiceovers_clip on voiceovers(clip_id);
create index if not exists idx_exports_project on exports(project_id);
