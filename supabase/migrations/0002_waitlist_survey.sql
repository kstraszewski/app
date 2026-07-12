-- Add survey answer columns to waitlist table
alter table public.waitlist
  add column if not exists survey_domain         text[],
  add column if not exists survey_usecase        text[],
  add column if not exists survey_priority       text,
  add column if not exists survey_contrib        text,
  add column if not exists survey_notes          text,
  add column if not exists survey_completed_at   timestamptz;

-- Writes are performed by the landing server with a server-only key.
drop policy if exists "anyone can update waitlist survey" on public.waitlist;
