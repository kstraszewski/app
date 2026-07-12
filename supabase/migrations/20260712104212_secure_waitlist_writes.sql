alter table public.waitlist
  add column if not exists survey_token uuid default gen_random_uuid();

update public.waitlist
set survey_token = gen_random_uuid()
where survey_token is null;

alter table public.waitlist
  alter column survey_token set not null;

create unique index if not exists waitlist_survey_token_idx
  on public.waitlist(survey_token);

alter table public.waitlist enable row level security;

drop policy if exists "anyone can insert waitlist" on public.waitlist;
drop policy if exists "anyone can update waitlist survey" on public.waitlist;
