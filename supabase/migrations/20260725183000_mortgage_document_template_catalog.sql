-- Versioned PDF template administration for the global mortgage catalogue.
-- The code registry remains the safe fallback until a validated template is
-- explicitly published from the institution profile in CRM.

create table public.mortgage_document_templates (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.mortgage_banks(id) on delete cascade,
  template_key text not null unique
    check (template_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  label text not null check (btrim(label) <> ''),
  source_file_name text not null check (btrim(source_file_name) <> ''),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  registry_version integer not null check (registry_version > 0),
  draft_json jsonb,
  draft_validation_report jsonb,
  draft_revision bigint not null default 0 check (draft_revision >= 0),
  draft_updated_at timestamptz,
  draft_updated_by_user_id uuid references public.users(id) on delete set null,
  active_json jsonb,
  active_validation_report jsonb,
  active_revision bigint not null default 0 check (active_revision >= 0),
  active_published_at timestamptz,
  active_published_by_user_id uuid references public.users(id) on delete set null,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mortgage_document_templates_draft_object_check
    check (draft_json is null or jsonb_typeof(draft_json) = 'object'),
  constraint mortgage_document_templates_draft_validation_object_check
    check (
      draft_validation_report is null
      or jsonb_typeof(draft_validation_report) = 'object'
    ),
  constraint mortgage_document_templates_active_object_check
    check (active_json is null or jsonb_typeof(active_json) = 'object'),
  constraint mortgage_document_templates_active_validation_object_check
    check (
      active_validation_report is null
      or jsonb_typeof(active_validation_report) = 'object'
    ),
  constraint mortgage_document_templates_draft_state_check
    check (
      (
        draft_revision = 0
        and draft_json is null
        and draft_validation_report is null
        and draft_updated_at is null
      )
      or (
        draft_revision > 0
        and draft_json is not null
        and draft_validation_report is not null
        and draft_updated_at is not null
      )
    ),
  constraint mortgage_document_templates_active_state_check
    check (
      (
        active_revision = 0
        and active_json is null
        and active_validation_report is null
        and active_published_at is null
      )
      or (
        active_revision > 0
        and active_json is not null
        and active_validation_report is not null
        and active_published_at is not null
      )
    )
);

create table public.mortgage_document_template_revisions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null
    references public.mortgage_document_templates(id) on delete cascade,
  action text not null check (action in ('draft_saved', 'published')),
  revision bigint not null check (revision > 0),
  template_json jsonb not null
    check (jsonb_typeof(template_json) = 'object'),
  validation_report jsonb not null
    check (jsonb_typeof(validation_report) = 'object'),
  actor_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.mortgage_document_templates
  add column current_published_revision_id uuid
    references public.mortgage_document_template_revisions(id) on delete restrict,
  add constraint mortgage_document_templates_current_revision_state_check
    check (
      (active_revision = 0 and current_published_revision_id is null)
      or (active_revision > 0 and current_published_revision_id is not null)
    );

create table public.mortgage_product_version_document_templates (
  product_version_id uuid not null
    references public.mortgage_product_versions(id) on delete cascade,
  template_revision_id uuid not null
    references public.mortgage_document_template_revisions(id) on delete restrict,
  requirement_code text not null
    check (requirement_code ~ '^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_version_id, requirement_code)
);

create index mortgage_document_templates_bank_idx
  on public.mortgage_document_templates(bank_id, template_key);

create index mortgage_document_template_revisions_template_created_idx
  on public.mortgage_document_template_revisions(template_id, created_at desc);

create index mortgage_product_version_document_templates_revision_idx
  on public.mortgage_product_version_document_templates(template_revision_id);

create trigger mortgage_document_templates_set_updated_at
  before update on public.mortgage_document_templates
  for each row execute function public.set_updated_at();

create or replace function private.pin_mortgage_product_version_document_templates()
returns trigger
language plpgsql
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

create trigger a_mortgage_product_versions_pin_document_templates
  after insert on public.mortgage_product_versions
  for each row execute function private.pin_mortgage_product_version_document_templates();

alter table public.mortgage_document_templates enable row level security;
alter table public.mortgage_document_template_revisions enable row level security;
alter table public.mortgage_product_version_document_templates enable row level security;

revoke all on public.mortgage_document_templates
  from public, anon, authenticated;
revoke all on public.mortgage_document_template_revisions
  from public, anon, authenticated;
revoke all on public.mortgage_product_version_document_templates
  from public, anon, authenticated;

grant all on public.mortgage_document_templates to service_role;
grant all on public.mortgage_document_template_revisions to service_role;
grant all on public.mortgage_product_version_document_templates to service_role;

create or replace function public.save_mortgage_document_template_draft(
  p_bank_id uuid,
  p_template_key text,
  p_label text,
  p_source_file_name text,
  p_source_sha256 text,
  p_registry_version integer,
  p_template_json jsonb,
  p_validation_report jsonb,
  p_expected_revision bigint,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  template_record public.mortgage_document_templates%rowtype;
  next_revision bigint;
begin
  select template.*
  into template_record
  from public.mortgage_document_templates template
  where template.bank_id = p_bank_id
    and template.template_key = p_template_key
  for update;

  if template_record.id is null then
    if p_expected_revision <> 0 then
      raise exception 'mortgage_document_template_revision_conflict'
        using errcode = '40001';
    end if;

    insert into public.mortgage_document_templates (
      bank_id,
      template_key,
      label,
      source_file_name,
      source_sha256,
      registry_version,
      draft_json,
      draft_validation_report,
      draft_revision,
      draft_updated_at,
      draft_updated_by_user_id,
      created_by_user_id
    )
    values (
      p_bank_id,
      p_template_key,
      p_label,
      p_source_file_name,
      p_source_sha256,
      p_registry_version,
      p_template_json,
      p_validation_report,
      1,
      now(),
      p_actor_user_id,
      p_actor_user_id
    )
    returning * into template_record;
  else
    if template_record.draft_revision <> p_expected_revision then
      raise exception 'mortgage_document_template_revision_conflict'
        using errcode = '40001';
    end if;

    next_revision := template_record.draft_revision + 1;
    update public.mortgage_document_templates template
    set
      label = p_label,
      source_file_name = p_source_file_name,
      source_sha256 = p_source_sha256,
      registry_version = p_registry_version,
      draft_json = p_template_json,
      draft_validation_report = p_validation_report,
      draft_revision = next_revision,
      draft_updated_at = now(),
      draft_updated_by_user_id = p_actor_user_id
    where template.id = template_record.id
    returning * into template_record;
  end if;

  insert into public.mortgage_document_template_revisions (
    template_id,
    action,
    revision,
    template_json,
    validation_report,
    actor_user_id
  )
  values (
    template_record.id,
    'draft_saved',
    template_record.draft_revision,
    template_record.draft_json,
    template_record.draft_validation_report,
    p_actor_user_id
  );

  return jsonb_build_object(
    'id', template_record.id,
    'draftRevision', template_record.draft_revision,
    'draftUpdatedAt', template_record.draft_updated_at
  );
end;
$$;

create or replace function public.publish_mortgage_document_template_draft(
  p_bank_id uuid,
  p_template_key text,
  p_expected_revision bigint,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  template_record public.mortgage_document_templates%rowtype;
  published_revision_id uuid;
  next_active_revision bigint;
begin
  select template.*
  into template_record
  from public.mortgage_document_templates template
  where template.bank_id = p_bank_id
    and template.template_key = p_template_key
  for update;

  if template_record.id is null
    or template_record.draft_json is null then
    raise exception 'mortgage_document_template_draft_not_found'
      using errcode = 'P0002';
  end if;
  if template_record.draft_revision <> p_expected_revision then
    raise exception 'mortgage_document_template_revision_conflict'
      using errcode = '40001';
  end if;
  if coalesce(
    (template_record.draft_validation_report -> 'summary' ->> 'activationReady')::boolean,
    false
  ) is not true then
    raise exception 'mortgage_document_template_not_ready'
      using errcode = '23514';
  end if;

  next_active_revision := template_record.active_revision + 1;
  insert into public.mortgage_document_template_revisions (
    template_id,
    action,
    revision,
    template_json,
    validation_report,
    actor_user_id
  )
  values (
    template_record.id,
    'published',
    next_active_revision,
    template_record.draft_json,
    template_record.draft_validation_report,
    p_actor_user_id
  )
  returning id into published_revision_id;

  update public.mortgage_document_templates template
  set
    active_json = template_record.draft_json,
    active_validation_report = template_record.draft_validation_report,
    active_revision = next_active_revision,
    active_published_at = now(),
    active_published_by_user_id = p_actor_user_id,
    current_published_revision_id = published_revision_id,
    draft_json = null,
    draft_validation_report = null,
    draft_revision = 0,
    draft_updated_at = null,
    draft_updated_by_user_id = null
  where template.id = template_record.id
  returning * into template_record;

  return jsonb_build_object(
    'id', template_record.id,
    'activeRevision', template_record.active_revision,
    'publishedRevisionId', published_revision_id,
    'publishedAt', template_record.active_published_at
  );
end;
$$;

revoke all on function public.save_mortgage_document_template_draft(
  uuid, text, text, text, text, integer, jsonb, jsonb, bigint, uuid
) from public, anon, authenticated;
revoke all on function public.publish_mortgage_document_template_draft(
  uuid, text, bigint, uuid
) from public, anon, authenticated;

grant execute on function public.save_mortgage_document_template_draft(
  uuid, text, text, text, text, integer, jsonb, jsonb, bigint, uuid
) to service_role;
grant execute on function public.publish_mortgage_document_template_draft(
  uuid, text, bigint, uuid
) to service_role;

comment on table public.mortgage_document_templates is
  'Global, institution-owned PDF template drafts and explicitly published runtime configurations.';
comment on column public.mortgage_document_templates.active_json is
  'Validated configuration used by Multiwniosek instead of the bundled code registry.';
comment on table public.mortgage_document_template_revisions is
  'Immutable audit snapshots created for every draft save and publication.';
comment on table public.mortgage_product_version_document_templates is
  'Pins a product version to an immutable published PDF template revision.';
