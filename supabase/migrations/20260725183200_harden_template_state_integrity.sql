-- Only the audited RPCs may mutate PDF template state. Published pointers and
-- product-version pins must reference matching immutable published snapshots.

-- Compatibility for environments that briefly applied the broader audit
-- uniqueness rule: draft revision numbers restart after every publication,
-- while published revisions remain monotonic.
drop index if exists public.mortgage_document_template_revisions_action_revision_idx;

create unique index if not exists mortgage_document_template_revisions_published_revision_idx
  on public.mortgage_document_template_revisions(template_id, revision)
  where action = 'published';

-- Reinstall the final function body as part of the upgrade migration too.
-- Editing the original migration alone would leave already-migrated databases
-- with the former, permissive behavior for schema-v2 requirements.
create or replace function private.pin_mortgage_product_version_document_templates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bank_id_value uuid;
  requirement jsonb;
  requirement_code_value text;
  template_key_value text;
  template_revision_id_value uuid;
  item_index integer := 0;
begin
  select product.bank_id
  into bank_id_value
  from public.mortgage_products product
  where product.id = new.product_id;

  for requirement in
    select item.value
    from jsonb_array_elements(coalesce(new.document_requirements, '[]'::jsonb)) item
  loop
    item_index := item_index + 1;
    template_key_value := nullif(btrim(requirement ->> 'templateId'), '');
    if template_key_value is null then
      continue;
    end if;

    requirement_code_value := coalesce(
      nullif(btrim(requirement ->> 'code'), ''),
      'template-' || item_index::text
    );
    select template.current_published_revision_id
    into template_revision_id_value
    from public.mortgage_document_templates template
    where template.bank_id = bank_id_value
      and template.template_key = template_key_value;

    if template_revision_id_value is null then
      if new.calculator_schema_version >= 2 then
        raise exception 'mortgage_document_template_is_not_published'
          using
            errcode = '23514',
            detail = format(
              'Template %s is not published for bank %s.',
              template_key_value,
              bank_id_value
            );
      end if;
      continue;
    end if;

    insert into public.mortgage_product_version_document_templates (
      product_version_id,
      template_revision_id,
      requirement_code,
      sort_order
    )
    values (
      new.id,
      template_revision_id_value,
      requirement_code_value,
      item_index
    )
    on conflict (product_version_id, requirement_code) do update
    set
      template_revision_id = excluded.template_revision_id,
      sort_order = excluded.sort_order;
  end loop;

  return new;
end;
$$;

revoke all on function private.pin_mortgage_product_version_document_templates()
  from public, anon, authenticated;

-- Pin document templates before the legacy publication finalizer marks a newly
-- inserted product version as current and therefore immutable.
drop trigger if exists mortgage_product_versions_pin_document_templates
  on public.mortgage_product_versions;
drop trigger if exists a_mortgage_product_versions_pin_document_templates
  on public.mortgage_product_versions;

create trigger a_mortgage_product_versions_pin_document_templates
  after insert on public.mortgage_product_versions
  for each row execute function private.pin_mortgage_product_version_document_templates();

create or replace function private.validate_mortgage_document_template_active_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_published_revision_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.mortgage_document_template_revisions revision
    where revision.id = new.current_published_revision_id
      and revision.template_id = new.id
      and revision.action = 'published'
      and revision.revision = new.active_revision
      and revision.template_json = new.active_json
      and revision.validation_report = new.active_validation_report
  ) then
    raise exception 'mortgage_document_template_active_state_mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_mortgage_document_template_active_state()
  from public, anon, authenticated;

do $migration$
begin
  if exists (
    select 1
    from public.mortgage_document_templates template
    where template.current_published_revision_id is not null
      and not exists (
        select 1
        from public.mortgage_document_template_revisions revision
        where revision.id = template.current_published_revision_id
          and revision.template_id = template.id
          and revision.action = 'published'
          and revision.revision = template.active_revision
          and revision.template_json = template.active_json
          and revision.validation_report = template.active_validation_report
      )
  ) then
    raise exception 'existing_mortgage_document_template_active_state_mismatch'
      using errcode = '23514';
  end if;
end;
$migration$;

create trigger mortgage_document_templates_validate_active_state
  before insert or update on public.mortgage_document_templates
  for each row execute function private.validate_mortgage_document_template_active_state();

create or replace function private.validate_mortgage_product_version_document_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.mortgage_document_template_revisions revision
    join public.mortgage_document_templates template
      on template.id = revision.template_id
    join public.mortgage_product_versions version
      on version.id = new.product_version_id
    join public.mortgage_products product
      on product.id = version.product_id
    where revision.id = new.template_revision_id
      and revision.action = 'published'
      and template.bank_id = product.bank_id
  ) then
    raise exception 'mortgage_product_version_template_pin_is_invalid'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_mortgage_product_version_document_template()
  from public, anon, authenticated;

do $migration$
begin
  if exists (
    select 1
    from public.mortgage_product_version_document_templates pin
    join public.mortgage_document_template_revisions revision
      on revision.id = pin.template_revision_id
    join public.mortgage_document_templates template
      on template.id = revision.template_id
    join public.mortgage_product_versions version
      on version.id = pin.product_version_id
    join public.mortgage_products product
      on product.id = version.product_id
    where revision.action <> 'published'
      or template.bank_id <> product.bank_id
  ) then
    raise exception 'existing_mortgage_product_version_template_pin_is_invalid'
      using errcode = '23514';
  end if;
end;
$migration$;

create trigger a_mortgage_product_version_document_templates_validate
  before insert or update
  on public.mortgage_product_version_document_templates
  for each row execute function private.validate_mortgage_product_version_document_template();

alter function public.save_mortgage_document_template_draft(
  uuid, text, text, text, text, integer, jsonb, jsonb, bigint, uuid
) security definer;

alter function public.publish_mortgage_document_template_draft(
  uuid, text, bigint, uuid
) security definer;

alter function private.pin_mortgage_product_version_document_templates()
  security definer;

revoke all on public.mortgage_document_templates from service_role;
revoke all on public.mortgage_document_template_revisions from service_role;
revoke all on public.mortgage_product_version_document_templates from service_role;

grant select on public.mortgage_document_templates to service_role;
grant select on public.mortgage_document_template_revisions to service_role;
grant select on public.mortgage_product_version_document_templates to service_role;

-- Facility media mutations are server-only. The authenticated session is
-- still used to authorize the API request, while the service-role client
-- performs the storage and metadata writes after that check.
drop policy if exists "facility admins can insert facility images"
  on public.facility_images;
drop policy if exists "facility admins can update facility images"
  on public.facility_images;
drop policy if exists "facility admins can delete facility images"
  on public.facility_images;

revoke insert, delete on public.facility_images from authenticated;
revoke update (sort_order, alt_text) on public.facility_images from authenticated;

drop policy if exists facility_images_admin_insert on storage.objects;
drop policy if exists facility_images_admin_delete on storage.objects;

create or replace function private.enforce_facility_image_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert-facility-images:'
        || new.organization_id::text
        || ':'
        || new.facility_id::text,
      0
    )
  );

  if (
    select count(*)
    from public.facility_images image
    where image.organization_id = new.organization_id
      and image.facility_id = new.facility_id
  ) >= 12 then
    raise exception 'facility_image_limit_reached'
      using errcode = '23514', constraint = 'facility_images_maximum_per_facility';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_facility_image_limit()
  from public, anon, authenticated;

create trigger facility_images_enforce_limit
  before insert on public.facility_images
  for each row execute function private.enforce_facility_image_limit();

comment on function private.validate_mortgage_document_template_active_state() is
  'Requires active PDF template state to equal its immutable published revision.';
comment on function private.validate_mortgage_product_version_document_template() is
  'Requires product versions to pin a published template revision for the same bank.';
comment on function private.enforce_facility_image_limit() is
  'Serializes facility image inserts and enforces at most 12 metadata rows per facility.';
