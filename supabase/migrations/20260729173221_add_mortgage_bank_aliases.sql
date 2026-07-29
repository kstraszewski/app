-- Keep the catalogue identity stable when an institution changes its brand.
-- Products, cases, and source documents continue to reference mortgage_banks.id,
-- while former names and domains remain searchable through this history table.

create table public.mortgage_bank_aliases (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.mortgage_banks(id) on delete cascade,
  value text not null check (btrim(value) <> '' and char_length(value) <= 200),
  alias_type text not null check (
    alias_type in ('former_name', 'short_name', 'legal_name', 'former_domain', 'search_term')
  ),
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_id, alias_type, value),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create index mortgage_bank_aliases_bank_idx
  on public.mortgage_bank_aliases(bank_id);

create trigger mortgage_bank_aliases_set_updated_at
  before update on public.mortgage_bank_aliases
  for each row execute function public.set_updated_at();

alter table public.mortgage_bank_aliases enable row level security;

create policy mortgage_bank_aliases_authenticated_read
  on public.mortgage_bank_aliases for select to authenticated using (true);

revoke all on public.mortgage_bank_aliases from anon, authenticated;
grant select on public.mortgage_bank_aliases to authenticated;
grant all on public.mortgage_bank_aliases to service_role;

-- Erste is the first catalogue entry that already carries source material under
-- the former Santander brand/domain. This also makes the migration useful for
-- installations whose mortgage catalogue was synchronized before aliases existed.
insert into public.mortgage_bank_aliases (bank_id, value, alias_type)
select bank.id, alias.value, alias.alias_type
from public.mortgage_banks bank
cross join (
  values
    ('Santander Bank Polska', 'former_name'),
    ('santander.pl', 'former_domain')
) as alias(value, alias_type)
where bank.slug = 'erste'
on conflict (bank_id, alias_type, value) do nothing;
