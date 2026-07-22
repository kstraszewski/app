-- A case can contain several candidate real-estate listings, while exactly one
-- of them can be selected as the property used by the credit process.
create table public.crm_case_property_selections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null,
  property_id uuid not null,
  selected_by_user_id uuid references public.users(id) on delete set null,
  selected_at timestamptz not null default now(),
  primary key (organization_id, case_id),
  constraint crm_case_property_selections_organization_case_fkey
    foreign key (organization_id, case_id)
    references public.crm_cases(organization_id, id) on delete cascade,
  constraint crm_case_property_selections_case_property_fkey
    foreign key (organization_id, case_id, property_id)
    references public.crm_properties(organization_id, case_id, id) on delete cascade
);

create index crm_case_property_selections_property_idx
  on public.crm_case_property_selections(organization_id, property_id, case_id);

-- Preserve the current single-property behaviour for existing cases. Cases
-- with multiple candidates intentionally require an explicit expert choice.
insert into public.crm_case_property_selections (
  organization_id,
  case_id,
  property_id,
  selected_at
)
select
  property.organization_id,
  property.case_id,
  (array_agg(property.id))[1],
  max(property.created_at)
from public.crm_properties property
where property.case_id is not null
group by property.organization_id, property.case_id
having count(*) = 1
on conflict (organization_id, case_id) do nothing;

alter table public.crm_case_property_selections enable row level security;

create policy crm_case_property_selections_member_read
  on public.crm_case_property_selections for select to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy crm_case_property_selections_member_insert
  on public.crm_case_property_selections for insert to authenticated
  with check ((select private.is_organization_member(organization_id)));

create policy crm_case_property_selections_member_update
  on public.crm_case_property_selections for update to authenticated
  using ((select private.is_organization_member(organization_id)))
  with check ((select private.is_organization_member(organization_id)));

create policy crm_case_property_selections_member_delete
  on public.crm_case_property_selections for delete to authenticated
  using ((select private.is_organization_member(organization_id)));

revoke all on public.crm_case_property_selections from public, anon, authenticated;
grant select, insert, update, delete on public.crm_case_property_selections to authenticated;
grant all on public.crm_case_property_selections to service_role;

comment on table public.crm_case_property_selections is
  'The real-estate listing selected from the candidate properties attached to a CRM case.';
