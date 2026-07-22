-- Mortgage calculation snapshots are evidence used later in a bank
-- application. Browser-authenticated clients may read them, but only the
-- trusted server may create or remove them.

drop policy if exists crm_case_bank_applications_member_insert
  on public.crm_case_bank_applications;
drop policy if exists crm_case_bank_applications_member_update
  on public.crm_case_bank_applications;
drop policy if exists crm_case_bank_applications_member_delete
  on public.crm_case_bank_applications;

revoke insert, update, delete on public.crm_case_bank_applications
  from authenticated;

-- The legacy RPC creates an application without the complete, immutable
-- property x offer calculation. The current server uses the service-only
-- create_crm_case_bank_application_snapshot RPC instead.
revoke execute on function public.create_crm_case_bank_application(
  uuid, uuid, uuid, uuid
) from authenticated;

drop policy if exists crm_case_offer_snapshots_member_insert
  on public.crm_case_offer_snapshots;
drop policy if exists crm_case_offer_snapshots_member_delete
  on public.crm_case_offer_snapshots;

revoke insert, delete on public.crm_case_offer_snapshots
  from authenticated;

-- Fail closed if a trusted-server call attempts to persist a snapshot that
-- cannot be traced to the exact current publication. The immutable version ID
-- is canonical; content_sha256 makes that provenance explicit in the snapshot.
create or replace function private.validate_crm_case_offer_snapshot_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  canonical_version public.mortgage_product_versions%rowtype;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'Saved mortgage offers may only be created by the trusted server';
  end if;

  if new.offer_type <> 'mortgage'
    or new.mortgage_product_id is null
    or new.mortgage_product_version_id is null
    or new.bank_id is null
    or new.saved_by_user_id is null
    or new.version_key is null
    or btrim(new.version_key) = '' then
    raise exception using
      errcode = '23514',
      message = 'Saved mortgage offer provenance is incomplete';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.saved_by_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'The user saving a mortgage offer must belong to its organization';
  end if;

  select version.*
  into canonical_version
  from public.mortgage_products product
  join public.mortgage_product_versions version
    on version.product_id = product.id
   and version.id = product.current_published_version_id
  where product.id = new.mortgage_product_id
    and product.bank_id = new.bank_id
    and product.is_active
    and product.archived_at is null
    and version.id = new.mortgage_product_version_id
    and version.lifecycle_status = 'published';

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Saved mortgage offer does not reference the current published bank product version';
  end if;

  if new.version_key <> canonical_version.version_key
    or jsonb_typeof(new.catalog_snapshot -> 'baseVersion') is distinct from 'object'
    or jsonb_typeof(new.catalog_snapshot -> 'version') is distinct from 'object'
    or new.catalog_snapshot ->> 'id' is distinct from new.mortgage_product_id::text
    or new.catalog_snapshot #>> '{bank,id}' is distinct from new.bank_id::text
    or new.catalog_snapshot #>> '{baseVersion,id}' is distinct from canonical_version.id::text
    or new.catalog_snapshot #>> '{baseVersion,version_key}' is distinct from canonical_version.version_key
    or new.catalog_snapshot #>> '{baseVersion,content_sha256}' is distinct from canonical_version.content_sha256
    or new.catalog_snapshot #>> '{version,id}' is distinct from canonical_version.id::text
    or new.catalog_snapshot #>> '{version,version_key}' is distinct from canonical_version.version_key
    or new.catalog_snapshot #>> '{version,content_sha256}' is distinct from canonical_version.content_sha256
    or not (
      to_jsonb(canonical_version)
      <@ (new.catalog_snapshot -> 'baseVersion')
    ) then
    raise exception using
      errcode = '23514',
      message = 'Saved mortgage offer catalogue payload does not match its published version';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_crm_case_offer_snapshot_insert()
  from public, anon, authenticated;

drop trigger if exists crm_case_offer_snapshots_validate_insert
  on public.crm_case_offer_snapshots;
create trigger crm_case_offer_snapshots_validate_insert
before insert on public.crm_case_offer_snapshots
for each row execute function private.validate_crm_case_offer_snapshot_insert();

-- Validate the saved offer again when it becomes an application. This closes
-- the migration window for snapshots written before the INSERT provenance
-- trigger existed. Historical versions may have been retired since saving, so
-- compare their immutable payload while ignoring only the retirement fields.
create or replace function private.guard_crm_case_bank_application_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_offer public.crm_case_offer_snapshots%rowtype;
  canonical_version public.mortgage_product_versions%rowtype;
  mutable_version_fields constant text[] := array[
    'updated_at',
    'lifecycle_status',
    'retired_at',
    'retired_by_user_id'
  ];
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'Mortgage applications may only be created by the trusted server or maintenance role';
  end if;

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
    raise exception using
      errcode = '23514',
      message = 'A credit agreement has already been signed for this CRM case';
  end if;

  select snapshot.*
  into saved_offer
  from public.crm_case_offer_snapshots snapshot
  where snapshot.organization_id = new.organization_id
    and snapshot.case_id = new.case_id
    and snapshot.id = new.offer_id
    and snapshot.bank_id = new.bank_id;
  if not found
    or saved_offer.mortgage_product_id is null
    or saved_offer.mortgage_product_version_id is null
    or saved_offer.version_key is null then
    raise exception using
      errcode = '23503',
      message = 'Mortgage application offer provenance is incomplete';
  end if;

  select version.*
  into canonical_version
  from public.mortgage_products product
  join public.mortgage_product_versions version
    on version.product_id = product.id
  where product.id = saved_offer.mortgage_product_id
    and product.bank_id = saved_offer.bank_id
    and product.is_active
    and product.archived_at is null
    and version.id = saved_offer.mortgage_product_version_id;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'Mortgage application offer does not reference a canonical bank product version';
  end if;

  if saved_offer.version_key <> canonical_version.version_key
    or jsonb_typeof(saved_offer.catalog_snapshot -> 'baseVersion') is distinct from 'object'
    or jsonb_typeof(saved_offer.catalog_snapshot -> 'version') is distinct from 'object'
    or saved_offer.catalog_snapshot ->> 'id' is distinct from saved_offer.mortgage_product_id::text
    or saved_offer.catalog_snapshot #>> '{bank,id}' is distinct from saved_offer.bank_id::text
    or saved_offer.catalog_snapshot #>> '{baseVersion,id}' is distinct from canonical_version.id::text
    or saved_offer.catalog_snapshot #>> '{baseVersion,version_key}' is distinct from canonical_version.version_key
    or saved_offer.catalog_snapshot #>> '{baseVersion,content_sha256}' is distinct from canonical_version.content_sha256
    or saved_offer.catalog_snapshot #>> '{version,id}' is distinct from canonical_version.id::text
    or saved_offer.catalog_snapshot #>> '{version,version_key}' is distinct from canonical_version.version_key
    or saved_offer.catalog_snapshot #>> '{version,content_sha256}' is distinct from canonical_version.content_sha256
    or not (
      (to_jsonb(canonical_version) - mutable_version_fields)
      <@ ((saved_offer.catalog_snapshot -> 'baseVersion') - mutable_version_fields)
    ) then
    raise exception using
      errcode = '23514',
      message = 'Mortgage application offer payload does not match its canonical version';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_crm_case_bank_application_insert()
  from public, anon, authenticated;

-- Mortgage submissions become retained history as soon as they leave draft.
-- Even draft deletion is a trusted-server operation; the trigger protects
-- direct Data API calls and cascades through a parent CRM row alike.
create or replace function private.guard_crm_bank_application_submission_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  mortgage_case_id uuid;
begin
  select application.case_id
  into mortgage_case_id
  from public.crm_case_bank_applications application
  where application.organization_id = old.organization_id
    and application.submission_id = old.id;

  if not found then
    return old;
  end if;

  if current_user not in ('service_role', 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'Mortgage applications may only be deleted by the trusted server';
  end if;

  if old.status_code <> 'draft' then
    raise exception using
      errcode = '23514',
      message = 'Only a draft mortgage application may be deleted; submitted applications are retained';
  end if;

  if exists (
    select 1
    from public.crm_case_contract_selections contract
    where contract.organization_id = old.organization_id
      and contract.case_id = mortgage_case_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A mortgage application from a signed credit process cannot be deleted';
  end if;

  return old;
end;
$$;

revoke all on function private.guard_crm_bank_application_submission_delete()
  from public, anon, authenticated;

drop trigger if exists crm_item_submissions_guard_mortgage_application_delete
  on public.crm_item_submissions;
create trigger crm_item_submissions_guard_mortgage_application_delete
before delete on public.crm_item_submissions
for each row execute function private.guard_crm_bank_application_submission_delete();

comment on function private.validate_crm_case_offer_snapshot_insert() is
  'Accepts only trusted-server snapshots of the exact current published mortgage version and an organization member as actor.';
comment on function private.guard_crm_bank_application_submission_delete() is
  'Retains submitted mortgage applications and permits deletion of drafts only through the trusted server.';
