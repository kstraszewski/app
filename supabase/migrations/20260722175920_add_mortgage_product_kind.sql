-- Keep the existing mortgage tables and UUIDs while making the offer kind
-- explicit. `category` remains the legacy purpose/tag dimension.
alter table public.mortgage_products
  add column if not exists product_kind text;

update public.mortgage_products
set product_kind = 'mortgage'
where product_kind is null;

alter table public.mortgage_products
  alter column product_kind set default 'mortgage',
  alter column product_kind set not null;

alter table public.mortgage_products
  add constraint mortgage_products_product_kind_check
  check (product_kind in ('mortgage', 'home_equity'));

comment on column public.mortgage_products.product_kind is
  'Calculator/domain kind of the bank offer. mortgage and home_equity currently share the mortgage V2 engine; cash loans require a separate engine before this constraint is extended.';

create index mortgage_products_bank_product_kind_active_idx
  on public.mortgage_products(bank_id, product_kind, is_active)
  where archived_at is null;

-- Preserve the RPC signature so older generated database types and clients keep
-- working. The category argument accepts the legacy UI aliases and normalizes
-- them atomically into product_kind + category.
create or replace function public.create_mortgage_product_draft_v2(
  p_bank_id uuid,
  p_slug text,
  p_name text,
  p_category text,
  p_distribution_channel text,
  p_draft_data jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  product_record public.mortgage_products%rowtype;
  draft_record public.mortgage_product_drafts%rowtype;
  normalized_category text;
  normalized_product_kind text;
begin
  if not exists (
    select 1
    from public.platform_user_roles platform_role
    where platform_role.user_id = p_actor_user_id
      and platform_role.role = 'super_admin'
  ) then
    raise exception 'super_admin_actor_required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_draft_data) <> 'object'
     or p_draft_data ->> 'schemaVersion' <> 'openexpert.mortgage-offer/2.0' then
    raise exception 'invalid_mortgage_offer_v2_draft' using errcode = '23514';
  end if;

  case lower(btrim(p_category))
    when 'secured_loan' then
      normalized_product_kind := 'home_equity';
      normalized_category := 'housing';
    when 'home_equity' then
      normalized_product_kind := 'home_equity';
      normalized_category := 'housing';
    when 'mortgage' then
      normalized_product_kind := 'mortgage';
      normalized_category := 'housing';
    when 'housing' then
      normalized_product_kind := 'mortgage';
      normalized_category := 'housing';
    when 'construction' then
      normalized_product_kind := 'mortgage';
      normalized_category := 'construction';
    when 'refinance' then
      normalized_product_kind := 'mortgage';
      normalized_category := 'refinance';
    when 'eco' then
      normalized_product_kind := 'mortgage';
      normalized_category := 'eco';
    when 'family' then
      normalized_product_kind := 'mortgage';
      normalized_category := 'family';
    else
      raise exception 'unsupported_mortgage_product_classification'
        using errcode = '23514';
  end case;

  insert into public.mortgage_products (
    bank_id,
    slug,
    name,
    product_kind,
    category,
    distribution_channel,
    is_active,
    created_by_user_id,
    updated_by_user_id
  ) values (
    p_bank_id,
    p_slug,
    p_name,
    normalized_product_kind,
    normalized_category,
    p_distribution_channel,
    false,
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into product_record;

  insert into public.mortgage_product_drafts (
    product_id,
    revision,
    draft_data,
    validation_report,
    created_by_user_id,
    updated_by_user_id
  ) values (
    product_record.id,
    1,
    p_draft_data,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into draft_record;

  insert into public.mortgage_catalog_events (
    bank_id,
    product_id,
    draft_id,
    event_type,
    actor_user_id,
    revision_before,
    revision_after,
    metadata
  ) values (
    p_bank_id,
    product_record.id,
    draft_record.id,
    'offer_created',
    p_actor_user_id,
    0,
    1,
    jsonb_build_object(
      'schemaVersion', p_draft_data ->> 'schemaVersion',
      'productKind', product_record.product_kind,
      'category', product_record.category
    )
  );

  return jsonb_build_object(
    'productId', product_record.id,
    'bankId', product_record.bank_id,
    'slug', product_record.slug,
    'name', product_record.name,
    'productKind', product_record.product_kind,
    'category', product_record.category,
    'distributionChannel', product_record.distribution_channel,
    'productCreatedAt', product_record.created_at,
    'productUpdatedAt', product_record.updated_at,
    'draftId', draft_record.id,
    'draftRevision', draft_record.revision,
    'draftData', draft_record.draft_data,
    'draftUpdatedAt', draft_record.updated_at,
    'draftUpdatedBy', draft_record.updated_by_user_id
  );
end;
$$;

comment on function public.create_mortgage_product_draft_v2(uuid, text, text, text, text, jsonb, uuid) is
  'Service-role-only atomic creation of a mortgage/home-equity offer, its initial V2 draft and audit event. Legacy category aliases are normalized into product_kind and category.';
