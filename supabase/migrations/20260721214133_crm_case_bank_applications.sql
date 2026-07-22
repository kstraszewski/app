-- Saved mortgage offers are shortlist items. A real application uses the
-- existing generic CRM submission lifecycle and this table only adds the
-- mortgage-specific offer, property and one-of-three slot.

alter table public.crm_case_offer_snapshots
  add constraint crm_case_offer_snapshots_organization_case_id_bank_key
  unique (organization_id, case_id, id, bank_id);

alter table public.crm_item_submissions
  add constraint crm_item_submissions_organization_item_id_key
  unique (organization_id, case_item_id, id);

alter table public.crm_documents
  add constraint crm_documents_organization_submission_fkey
  foreign key (organization_id, submission_id)
  references public.crm_item_submissions(organization_id, id)
  on delete cascade;

create table public.crm_case_bank_applications (
  submission_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null,
  case_item_id uuid not null,
  offer_id uuid not null,
  bank_id uuid not null references public.mortgage_banks(id) on delete restrict,
  property_id uuid,
  slot smallint not null,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint crm_case_bank_applications_slot_check
    check (slot between 1 and 3),
  constraint crm_case_bank_applications_organization_case_fkey
    foreign key (organization_id, case_id)
    references public.crm_cases(organization_id, id) on delete cascade,
  constraint crm_case_bank_applications_case_item_fkey
    foreign key (organization_id, case_item_id)
    references public.crm_case_items(organization_id, id) on delete cascade,
  constraint crm_case_bank_applications_submission_item_fkey
    foreign key (organization_id, case_item_id, submission_id)
    references public.crm_item_submissions(organization_id, case_item_id, id)
    on delete cascade,
  constraint crm_case_bank_applications_case_offer_bank_fkey
    foreign key (organization_id, case_id, offer_id, bank_id)
    references public.crm_case_offer_snapshots(organization_id, case_id, id, bank_id)
    on delete restrict,
  constraint crm_case_bank_applications_case_property_fkey
    foreign key (organization_id, case_id, property_id)
    references public.crm_properties(organization_id, case_id, id)
    on delete restrict,
  unique (organization_id, case_id, submission_id),
  unique (organization_id, case_id, offer_id),
  unique (organization_id, case_id, bank_id),
  unique (organization_id, case_id, slot)
);

create index crm_case_bank_applications_case_item_idx
  on public.crm_case_bank_applications(organization_id, case_id, case_item_id, slot);
create index crm_case_bank_applications_property_idx
  on public.crm_case_bank_applications(organization_id, property_id, case_id)
  where property_id is not null;

alter table public.crm_case_bank_applications enable row level security;

create policy crm_case_bank_applications_member_read
  on public.crm_case_bank_applications for select to authenticated
  using ((select private.is_organization_member(organization_id)));
create policy crm_case_bank_applications_member_insert
  on public.crm_case_bank_applications for insert to authenticated
  with check ((select private.is_organization_member(organization_id)));
create policy crm_case_bank_applications_member_update
  on public.crm_case_bank_applications for update to authenticated
  using ((select private.is_organization_member(organization_id)))
  with check ((select private.is_organization_member(organization_id)));
create policy crm_case_bank_applications_member_delete
  on public.crm_case_bank_applications for delete to authenticated
  using ((select private.is_organization_member(organization_id)));

revoke all on public.crm_case_bank_applications from public, anon, authenticated;
grant select, insert, update, delete on public.crm_case_bank_applications to authenticated;
grant all on public.crm_case_bank_applications to service_role;

-- Atomically creates (or reuses) the case's mortgage case item, creates the
-- generic submission and occupies the first free slot. Locking the case row
-- serializes concurrent attempts, while UNIQUE constraints remain the final
-- invariant.
create or replace function public.create_crm_case_bank_application(
  target_organization_id uuid,
  target_case_id uuid,
  target_offer_id uuid,
  target_property_id uuid default null
)
returns public.crm_case_bank_applications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_bank_id uuid;
  target_bank_name text;
  target_currency char(3);
  target_product_type_id uuid;
  target_case_item_id uuid;
  target_submission_id uuid;
  target_slot smallint;
  actor_user_id uuid := (select auth.uid());
  result public.crm_case_bank_applications;
begin
  if current_user <> 'service_role'
    and not private.is_organization_member(target_organization_id) then
    raise exception using errcode = '42501', message = 'Organization membership is required';
  end if;

  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = target_organization_id
    and crm_case.id = target_case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CRM case not found';
  end if;

  if exists (
    select 1
    from public.crm_case_contract_selections contract
    where contract.organization_id = target_organization_id
      and contract.case_id = target_case_id
  ) then
    raise exception using errcode = '23514', message = 'A credit agreement has already been signed for this CRM case';
  end if;

  select snapshot.bank_id, snapshot.bank_name, snapshot.currency
  into target_bank_id, target_bank_name, target_currency
  from public.crm_case_offer_snapshots snapshot
  where snapshot.organization_id = target_organization_id
    and snapshot.case_id = target_case_id
    and snapshot.id = target_offer_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Saved mortgage offer not found';
  end if;
  if target_bank_id is null then
    raise exception using errcode = '23514', message = 'Saved offer is not linked to an active mortgage bank';
  end if;

  if target_property_id is not null and not exists (
    select 1
    from public.crm_properties property
    where property.organization_id = target_organization_id
      and property.case_id = target_case_id
      and property.id = target_property_id
  ) then
    raise exception using errcode = '23503', message = 'Property does not belong to the CRM case';
  end if;

  if exists (
    select 1
    from public.crm_case_bank_applications application
    where application.organization_id = target_organization_id
      and application.case_id = target_case_id
      and application.bank_id = target_bank_id
  ) then
    raise exception using errcode = '23505', message = 'This bank already has an application in the CRM case';
  end if;

  select available_slot.slot
  into target_slot
  from generate_series(1, 3) available_slot(slot)
  where not exists (
    select 1
    from public.crm_case_bank_applications application
    where application.organization_id = target_organization_id
      and application.case_id = target_case_id
      and application.slot = available_slot.slot
  )
  order by available_slot.slot
  limit 1;
  if target_slot is null then
    raise exception using errcode = '23514', message = 'A CRM case can have at most three parallel bank applications';
  end if;

  select item.id
  into target_case_item_id
  from public.crm_case_items item
  join public.crm_product_types product_type on product_type.id = item.product_type_id
  where item.organization_id = target_organization_id
    and item.case_id = target_case_id
    and product_type.code = 'credit_mortgage'
  order by item.created_at, item.id
  limit 1;

  if target_case_item_id is null then
    select product_type.id
    into target_product_type_id
    from public.crm_product_types product_type
    where product_type.code = 'credit_mortgage'
      and product_type.is_active = true
      and (product_type.organization_id is null or product_type.organization_id = target_organization_id)
    order by (product_type.organization_id is not null) desc, product_type.id
    limit 1;
    if target_product_type_id is null then
      raise exception using errcode = 'P0002', message = 'Mortgage product type is not configured';
    end if;

    insert into public.crm_case_items (
      organization_id,
      case_id,
      product_type_id,
      owner_user_id,
      title,
      status_code,
      currency,
      metadata
    ) values (
      target_organization_id,
      target_case_id,
      target_product_type_id,
      actor_user_id,
      'Kredyt hipoteczny',
      'wniosek',
      target_currency,
      jsonb_build_object('managedBy', 'mortgage_applications')
    )
    returning id into target_case_item_id;
  end if;

  insert into public.crm_item_submissions (
    organization_id,
    case_item_id,
    status_code,
    currency,
    metadata
  ) values (
    target_organization_id,
    target_case_item_id,
    'draft',
    target_currency,
    jsonb_build_object(
      'mortgageOfferId', target_offer_id,
      'mortgageBankId', target_bank_id,
      'mortgageBankName', target_bank_name
    )
  )
  returning id into target_submission_id;

  insert into public.crm_case_bank_applications (
    submission_id,
    organization_id,
    case_id,
    case_item_id,
    offer_id,
    bank_id,
    property_id,
    slot,
    created_by_user_id
  ) values (
    target_submission_id,
    target_organization_id,
    target_case_id,
    target_case_item_id,
    target_offer_id,
    target_bank_id,
    target_property_id,
    target_slot,
    actor_user_id
  )
  returning * into result;

  insert into public.crm_case_offer_selections (
    organization_id,
    case_id,
    offer_id,
    selected_by_user_id,
    selected_at
  ) values (
    target_organization_id,
    target_case_id,
    target_offer_id,
    actor_user_id,
    now()
  )
  on conflict (organization_id, case_id) do nothing;

  return result;
end;
$$;

revoke all on function public.create_crm_case_bank_application(uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.create_crm_case_bank_application(uuid, uuid, uuid, uuid)
  to authenticated, service_role;

-- Backfill one draft application from the old focused offer. Other saved
-- offers remain a shortlist and no historical case gets a final contract.
insert into public.crm_case_items (
  organization_id,
  case_id,
  product_type_id,
  owner_user_id,
  title,
  status_code,
  currency,
  metadata,
  created_at,
  updated_at
)
select distinct on (selection.organization_id, selection.case_id)
  selection.organization_id,
  selection.case_id,
  product_type.id,
  selection.selected_by_user_id,
  'Kredyt hipoteczny',
  'wniosek',
  snapshot.currency,
  jsonb_build_object('managedBy', 'mortgage_applications', 'backfilled', true),
  selection.selected_at,
  selection.selected_at
from public.crm_case_offer_selections selection
join public.crm_case_offer_snapshots snapshot
  on snapshot.organization_id = selection.organization_id
 and snapshot.case_id = selection.case_id
 and snapshot.id = selection.offer_id
join lateral (
  select configured_type.id
  from public.crm_product_types configured_type
  where configured_type.code = 'credit_mortgage'
    and configured_type.is_active = true
    and (configured_type.organization_id is null or configured_type.organization_id = selection.organization_id)
  order by (configured_type.organization_id is not null) desc, configured_type.id
  limit 1
) product_type on true
where snapshot.bank_id is not null
  and not exists (
    select 1
    from public.crm_case_items existing_item
    join public.crm_product_types existing_type on existing_type.id = existing_item.product_type_id
    where existing_item.organization_id = selection.organization_id
      and existing_item.case_id = selection.case_id
      and existing_type.code = 'credit_mortgage'
  )
order by selection.organization_id, selection.case_id, selection.selected_at;

with selected_offer as (
  select
    selection.organization_id,
    selection.case_id,
    selection.offer_id,
    selection.selected_by_user_id,
    selection.selected_at,
    snapshot.bank_id,
    snapshot.bank_name,
    snapshot.currency,
    property_selection.property_id,
    (
      select item.id
      from public.crm_case_items item
      join public.crm_product_types product_type on product_type.id = item.product_type_id
      where item.organization_id = selection.organization_id
        and item.case_id = selection.case_id
        and product_type.code = 'credit_mortgage'
      order by item.created_at, item.id
      limit 1
    ) case_item_id
  from public.crm_case_offer_selections selection
  join public.crm_case_offer_snapshots snapshot
    on snapshot.organization_id = selection.organization_id
   and snapshot.case_id = selection.case_id
   and snapshot.id = selection.offer_id
  left join public.crm_case_property_selections property_selection
    on property_selection.organization_id = selection.organization_id
   and property_selection.case_id = selection.case_id
  where snapshot.bank_id is not null
), inserted_submission as (
  insert into public.crm_item_submissions (
    organization_id,
    case_item_id,
    status_code,
    currency,
    metadata,
    created_at,
    updated_at
  )
  select
    selected_offer.organization_id,
    selected_offer.case_item_id,
    'draft',
    selected_offer.currency,
    jsonb_build_object(
      'mortgageOfferId', selected_offer.offer_id,
      'mortgageBankId', selected_offer.bank_id,
      'mortgageBankName', selected_offer.bank_name,
      'backfilled', true
    ),
    selected_offer.selected_at,
    selected_offer.selected_at
  from selected_offer
  where selected_offer.case_item_id is not null
  returning id, organization_id, case_item_id, metadata, created_at
)
insert into public.crm_case_bank_applications (
  submission_id,
  organization_id,
  case_id,
  case_item_id,
  offer_id,
  bank_id,
  property_id,
  slot,
  created_by_user_id,
  created_at
)
select
  inserted_submission.id,
  selected_offer.organization_id,
  selected_offer.case_id,
  selected_offer.case_item_id,
  selected_offer.offer_id,
  selected_offer.bank_id,
  selected_offer.property_id,
  1,
  selected_offer.selected_by_user_id,
  selected_offer.selected_at
from inserted_submission
join selected_offer
  on selected_offer.organization_id = inserted_submission.organization_id
 and selected_offer.case_item_id = inserted_submission.case_item_id
 and selected_offer.offer_id = (inserted_submission.metadata ->> 'mortgageOfferId')::uuid
on conflict (organization_id, case_id, offer_id) do nothing;

-- Remove only an orphaned, ephemeral focus that cannot represent a bank
-- application (for example after the bank catalogue entry was deleted).
delete from public.crm_case_offer_selections selection
where not exists (
  select 1
  from public.crm_case_bank_applications application
  where application.organization_id = selection.organization_id
    and application.case_id = selection.case_id
    and application.offer_id = selection.offer_id
);

alter table public.crm_case_offer_selections
  add constraint crm_case_offer_selections_focused_application_fkey
  foreign key (organization_id, case_id, offer_id)
  references public.crm_case_bank_applications(organization_id, case_id, offer_id)
  on delete cascade;

comment on table public.crm_case_offer_selections is
  'The bank application currently open in the CRM UI; never the final contract choice.';

create table public.crm_case_contract_selections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null,
  application_id uuid not null,
  signed_by_user_id uuid not null references public.users(id) on delete restrict,
  signed_at timestamptz not null default now(),
  primary key (organization_id, case_id),
  constraint crm_case_contract_selections_organization_case_fkey
    foreign key (organization_id, case_id)
    references public.crm_cases(organization_id, id) on delete cascade,
  constraint crm_case_contract_selections_application_fkey
    foreign key (organization_id, case_id, application_id)
    references public.crm_case_bank_applications(organization_id, case_id, submission_id)
    on delete restrict
);

create index crm_case_contract_selections_application_idx
  on public.crm_case_contract_selections(organization_id, application_id, case_id);

alter table public.crm_case_contract_selections enable row level security;

create policy crm_case_contract_selections_member_read
  on public.crm_case_contract_selections for select to authenticated
  using ((select private.is_organization_member(organization_id)));
create policy crm_case_contract_selections_member_insert
  on public.crm_case_contract_selections for insert to authenticated
  with check (
    (select private.is_organization_member(organization_id))
    and signed_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.crm_case_bank_applications application
      join public.crm_item_submissions submission
        on submission.organization_id = application.organization_id
       and submission.id = application.submission_id
      where application.organization_id = crm_case_contract_selections.organization_id
        and application.case_id = crm_case_contract_selections.case_id
        and application.submission_id = crm_case_contract_selections.application_id
        and submission.status_code = 'zaakceptowane'
    )
  );

revoke all on public.crm_case_contract_selections from public, anon, authenticated;
grant select, insert on public.crm_case_contract_selections to authenticated;
grant all on public.crm_case_contract_selections to service_role;

-- Keep the invariants below at table level too. Both tables are exposed through
-- the Data API, so a member must not be able to bypass the atomic RPCs with a
-- direct INSERT. Taking the same case-row lock in both guards also serializes a
-- direct insert against create_crm_case_bank_application/sign_crm_case_contract.
create or replace function private.guard_crm_case_bank_application_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = new.organization_id
    and crm_case.id = new.case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CRM case not found';
  end if;

  if exists (
    select 1
    from public.crm_case_contract_selections contract
    where contract.organization_id = new.organization_id
      and contract.case_id = new.case_id
  ) then
    raise exception using errcode = '23514', message = 'A credit agreement has already been signed for this CRM case';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_crm_case_bank_application_insert()
  from public, anon, authenticated;

create trigger crm_case_bank_applications_guard_insert
before insert on public.crm_case_bank_applications
for each row execute function private.guard_crm_case_bank_application_insert();

create or replace function private.guard_crm_case_contract_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_status text;
begin
  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = new.organization_id
    and crm_case.id = new.case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CRM case not found';
  end if;

  select submission.status_code
  into target_status
  from public.crm_case_bank_applications application
  join public.crm_item_submissions submission
    on submission.organization_id = application.organization_id
   and submission.id = application.submission_id
  where application.organization_id = new.organization_id
    and application.case_id = new.case_id
    and application.submission_id = new.application_id
  for update of submission;

  if target_status is distinct from 'zaakceptowane' then
    raise exception using errcode = '23514', message = 'Only an accepted bank application can be signed';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.signed_by_user_id
  ) then
    raise exception using errcode = '23503', message = 'The signing user must belong to the CRM case organization';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_crm_case_contract_insert()
  from public, anon, authenticated;

create trigger crm_case_contract_selections_guard_insert
before insert on public.crm_case_contract_selections
for each row execute function private.guard_crm_case_contract_insert();

create or replace function private.close_other_crm_case_bank_applications()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.crm_item_submissions submission
  set status_code = 'wycofane',
      decision_at = coalesce(submission.decision_at, now()),
      metadata = submission.metadata || jsonb_build_object(
        'closureReason', 'contract_signed_elsewhere',
        'selectedApplicationId', new.application_id
      )
  from public.crm_case_bank_applications application
  where application.organization_id = new.organization_id
    and application.case_id = new.case_id
    and application.submission_id <> new.application_id
    and submission.organization_id = application.organization_id
    and submission.id = application.submission_id
    and submission.status_code in ('draft', 'wyslane', 'w_analizie', 'braki', 'zaakceptowane');

  return new;
end;
$$;

revoke all on function private.close_other_crm_case_bank_applications()
  from public, anon, authenticated;

create trigger crm_case_contract_selections_close_other_applications
after insert on public.crm_case_contract_selections
for each row execute function private.close_other_crm_case_bank_applications();

-- A signed process is terminal. This also closes the small race between the
-- PATCH endpoint checking for a contract and updating the generic submission,
-- and prevents an authenticated Data API caller from reactivating a loser.
create or replace function private.guard_signed_crm_bank_application_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  final_application_id uuid;
begin
  select contract.application_id
  into final_application_id
  from public.crm_case_bank_applications application
  join public.crm_case_contract_selections contract
    on contract.organization_id = application.organization_id
   and contract.case_id = application.case_id
  where application.organization_id = new.organization_id
    and application.submission_id = new.id;

  if final_application_id is null then
    return new;
  end if;

  if new.id = final_application_id then
    if new.status_code <> 'zaakceptowane' then
      raise exception using errcode = '23514', message = 'The signed bank application must remain accepted';
    end if;
  elsif old.status_code = 'odrzucone' then
    if new.status_code <> 'odrzucone' then
      raise exception using errcode = '23514', message = 'A rejected bank application cannot be reopened after signing';
    end if;
  elsif new.status_code <> 'wycofane' then
    raise exception using errcode = '23514', message = 'A competing bank application must remain withdrawn after signing';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_signed_crm_bank_application_status()
  from public, anon, authenticated;

create trigger crm_item_submissions_guard_signed_bank_application_status
before update of status_code on public.crm_item_submissions
for each row execute function private.guard_signed_crm_bank_application_status();

-- Signing is final and serialized per case. Only an accepted bank decision can
-- win; all other still-active submissions are retained in history as withdrawn.
create or replace function public.sign_crm_case_contract(
  target_organization_id uuid,
  target_case_id uuid,
  target_application_id uuid
)
returns public.crm_case_contract_selections
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_status text;
  actor_user_id uuid := (select auth.uid());
  result public.crm_case_contract_selections;
begin
  if current_user <> 'service_role'
    and not private.is_organization_member(target_organization_id) then
    raise exception using errcode = '42501', message = 'Organization membership is required';
  end if;

  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = target_organization_id
    and crm_case.id = target_case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CRM case not found';
  end if;

  if exists (
    select 1
    from public.crm_case_contract_selections contract
    where contract.organization_id = target_organization_id
      and contract.case_id = target_case_id
  ) then
    raise exception using errcode = '23505', message = 'A credit agreement has already been signed for this CRM case';
  end if;

  select submission.status_code
  into target_status
  from public.crm_case_bank_applications application
  join public.crm_item_submissions submission
    on submission.organization_id = application.organization_id
   and submission.id = application.submission_id
  where application.organization_id = target_organization_id
    and application.case_id = target_case_id
    and application.submission_id = target_application_id
  for update of submission;
  if target_status is null then
    raise exception using errcode = 'P0002', message = 'Bank application not found';
  end if;
  if target_status <> 'zaakceptowane' then
    raise exception using errcode = '23514', message = 'Only an accepted bank application can be signed';
  end if;

  insert into public.crm_case_contract_selections (
    organization_id,
    case_id,
    application_id,
    signed_by_user_id,
    signed_at
  ) values (
    target_organization_id,
    target_case_id,
    target_application_id,
    actor_user_id,
    now()
  )
  returning * into result;

  return result;
end;
$$;

revoke all on function public.sign_crm_case_contract(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.sign_crm_case_contract(uuid, uuid, uuid)
  to authenticated;

comment on table public.crm_case_bank_applications is
  'Mortgage-specific extension of up to three generic CRM submissions, one per bank.';
comment on table public.crm_case_contract_selections is
  'The one immutable, signed credit agreement selected from a CRM case bank application.';
