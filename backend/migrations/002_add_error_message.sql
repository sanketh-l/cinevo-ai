-- Add error_message column to clips for notebook error reporting.
-- camera_settings JSONB PATCH silently drops unknown fields; this TEXT column is simpler.

alter table if exists clips add column if not exists error_message text;
