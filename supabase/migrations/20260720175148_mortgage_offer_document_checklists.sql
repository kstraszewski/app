-- Mortgage offer document checklists, one selected offer per CRM case, and
-- private case-scoped document storage.

alter table public.mortgage_product_versions
  add column document_requirements jsonb not null default '[]'::jsonb,
  add column multiform_template_ids text[] not null default '{}'::text[],
  add constraint mortgage_product_versions_document_requirements_array_check
    check (jsonb_typeof(document_requirements) = 'array'),
  add constraint mortgage_product_versions_multiform_template_ids_no_null_check
    check (array_position(multiform_template_ids, null) is null);

comment on column public.mortgage_product_versions.document_requirements is
  'Structured document checklist used by a saved offer snapshot.';
comment on column public.mortgage_product_versions.multiform_template_ids is
  'Multiform template identifiers that can render this product application.';

-- Give existing catalogues a useful checklist without requiring another sync.
-- These are deliberately conservative expert defaults, not claims extracted
-- from a bank source document.
update public.mortgage_product_versions version
set
  multiform_template_ids = case bank.slug
    when 'pko-bp' then array['pko-bp-mortgage-2022']::text[]
    when 'erste' then array['erste-mortgage-2026']::text[]
    when 'pekao' then array['pekao-mortgage-2025']::text[]
    else '{}'::text[]
  end,
  document_requirements = jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object(
      'code', 'application.mortgage_request',
      'label', 'Wniosek o kredyt hipoteczny',
      'category', 'application',
      'itemKind', 'bank_document',
      'scope', 'case',
      'stage', 'analysis',
      'applicability', 'always',
      'evidence', 'expert_default',
      'required', true,
      'multiple', false,
      'allowedMimeTypes', jsonb_build_array('application/pdf'),
      'templateId', case bank.slug
        when 'pko-bp' then 'pko-bp-mortgage-2022'
        when 'erste' then 'erste-mortgage-2026'
        when 'pekao' then 'pekao-mortgage-2025'
        else null
      end,
      'notes', 'Bazowy dokument wniosku; przed wysłaniem potwierdź aktualny formularz banku.'
    )),
    jsonb_build_object(
      'code', 'identity.id_document',
      'label', 'Dokument tożsamości',
      'category', 'identity',
      'itemKind', 'client_document',
      'scope', 'each_applicant',
      'stage', 'analysis',
      'applicability', 'conditional',
      'evidence', 'expert_default',
      'required', true,
      'multiple', false,
      'allowedMimeTypes', jsonb_build_array('application/pdf', 'image/jpeg', 'image/png'),
      'notes', 'Wymagany, gdy bank prosi o kopię dokumentu tożsamości.'
    ),
    jsonb_build_object(
      'code', 'income.bank_statement',
      'label', 'Wyciąg z rachunku bankowego',
      'category', 'income_other',
      'itemKind', 'client_document',
      'scope', 'each_applicant',
      'stage', 'analysis',
      'applicability', 'conditional',
      'evidence', 'expert_default',
      'required', true,
      'multiple', true,
      'allowedMimeTypes', jsonb_build_array('application/pdf', 'image/jpeg', 'image/png'),
      'notes', 'Zakres miesięcy zależy od źródła dochodu i banku.'
    ),
    jsonb_build_object(
      'code', 'transaction.preliminary_agreement',
      'label', 'Umowa przedwstępna',
      'category', 'transaction',
      'itemKind', 'client_document',
      'scope', 'case',
      'stage', 'analysis',
      'applicability', 'conditional',
      'evidence', 'expert_default',
      'required', true,
      'multiple', false,
      'allowedMimeTypes', jsonb_build_array('application/pdf', 'image/jpeg', 'image/png'),
      'notes', 'Dotyczy transakcji, dla których zawarto umowę przedwstępną.'
    ),
    jsonb_build_object(
      'code', 'property.land_register',
      'label', 'Odpis lub numer księgi wieczystej',
      'category', 'property_legal',
      'itemKind', 'client_document',
      'scope', 'case',
      'stage', 'analysis',
      'applicability', 'conditional',
      'evidence', 'expert_default',
      'required', true,
      'multiple', false,
      'allowedMimeTypes', jsonb_build_array('application/pdf', 'image/jpeg', 'image/png'),
      'notes', 'Dotyczy nieruchomości posiadającej księgę wieczystą.'
    )
  )
from public.mortgage_products product
join public.mortgage_banks bank on bank.id = product.bank_id
where version.product_id = product.id
  and version.document_requirements = '[]'::jsonb;

grant select on public.mortgage_product_versions to authenticated;
grant all on public.mortgage_product_versions to service_role;

-- The selected offer remains replaceable, while its composite foreign key
-- makes a cross-organization or cross-case selection impossible.
alter table public.crm_case_offer_snapshots
  add constraint crm_case_offer_snapshots_organization_case_id_key
  unique (organization_id, case_id, id);

create table public.crm_case_offer_selections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null,
  offer_id uuid not null,
  selected_by_user_id uuid references public.users(id) on delete set null,
  selected_at timestamptz not null default now(),
  primary key (organization_id, case_id),
  constraint crm_case_offer_selections_organization_case_fkey
    foreign key (organization_id, case_id)
    references public.crm_cases(organization_id, id) on delete cascade,
  constraint crm_case_offer_selections_case_offer_fkey
    foreign key (organization_id, case_id, offer_id)
    references public.crm_case_offer_snapshots(organization_id, case_id, id) on delete cascade
);

create index crm_case_offer_selections_offer_idx
  on public.crm_case_offer_selections(organization_id, offer_id, case_id);

insert into public.crm_case_offer_selections (
  organization_id,
  case_id,
  offer_id,
  selected_by_user_id,
  selected_at
)
select distinct on (snapshot.organization_id, snapshot.case_id)
  snapshot.organization_id,
  snapshot.case_id,
  snapshot.id,
  snapshot.saved_by_user_id,
  snapshot.saved_at
from public.crm_case_offer_snapshots snapshot
order by snapshot.organization_id, snapshot.case_id, snapshot.saved_at desc, snapshot.id desc
on conflict (organization_id, case_id) do nothing;

alter table public.crm_case_offer_selections enable row level security;

create policy crm_case_offer_selections_member_read
  on public.crm_case_offer_selections for select to authenticated
  using ((select private.is_organization_member(organization_id)));
create policy crm_case_offer_selections_member_insert
  on public.crm_case_offer_selections for insert to authenticated
  with check ((select private.is_organization_member(organization_id)));
create policy crm_case_offer_selections_member_update
  on public.crm_case_offer_selections for update to authenticated
  using ((select private.is_organization_member(organization_id)))
  with check ((select private.is_organization_member(organization_id)));
create policy crm_case_offer_selections_member_delete
  on public.crm_case_offer_selections for delete to authenticated
  using ((select private.is_organization_member(organization_id)));

revoke all on public.crm_case_offer_selections from public, anon, authenticated;
grant select, insert, update, delete on public.crm_case_offer_selections to authenticated;
grant all on public.crm_case_offer_selections to service_role;

-- Typed metadata for files uploaded through the CRM. Columns stay nullable for
-- legacy rows, while the case-document integrity check requires all of them for
-- objects in the new bucket.
alter table public.crm_documents
  add column uploaded_by_user_id uuid,
  add column mime_type text,
  add column size_bytes bigint,
  add column sha256 text,
  add constraint crm_documents_organization_uploader_membership_fkey
    foreign key (organization_id, uploaded_by_user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete set null (uploaded_by_user_id),
  add constraint crm_documents_mime_type_check
    check (mime_type is null or mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  add constraint crm_documents_size_bytes_check
    check (size_bytes is null or size_bytes between 1 and 26214400),
  add constraint crm_documents_sha256_check
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add constraint crm_documents_storage_pair_check
    check ((storage_bucket is null) = (storage_path is null)),
  add constraint crm_documents_case_file_integrity_check
    check (
      storage_bucket <> 'crm-case-documents'
      or (
        case_id is not null
        and uploaded_by_user_id is not null
        and mime_type is not null
        and size_bytes is not null
        and sha256 is not null
        and storage_path like organization_id::text || '/' || case_id::text || '/%'
      )
    );

create unique index crm_documents_storage_object_key
  on public.crm_documents(storage_bucket, storage_path)
  where storage_bucket is not null and storage_path is not null;
create index crm_documents_organization_case_created_idx
  on public.crm_documents(organization_id, case_id, created_at desc, id)
  where case_id is not null;
create index crm_documents_organization_case_type_idx
  on public.crm_documents(organization_id, case_id, document_type, created_at desc)
  where case_id is not null;

revoke all on public.crm_documents from public, anon, authenticated;
grant select, insert, delete on public.crm_documents to authenticated;
grant update (status_code, verified_at, metadata) on public.crm_documents to authenticated;
grant all on public.crm_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-case-documents',
  'crm-case-documents',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Object paths are organization UUID / case UUID / random file name. The
-- security-definer helper validates both path components before casting them,
-- then proves that the authenticated user belongs to the case organization.
create or replace function private.can_access_crm_case_document(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[];
  path_organization_id uuid;
  path_case_id uuid;
begin
  path_parts := storage.foldername(object_name);
  if coalesce(array_length(path_parts, 1), 0) <> 2
    or path_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or path_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  path_organization_id := path_parts[1]::uuid;
  path_case_id := path_parts[2]::uuid;

  return exists (
    select 1
    from public.crm_cases crm_case
    join public.organization_memberships membership
      on membership.organization_id = crm_case.organization_id
     and membership.user_id = (select auth.uid())
    where crm_case.organization_id = path_organization_id
      and crm_case.id = path_case_id
  );
end;
$$;

revoke all on function private.can_access_crm_case_document(text) from public, anon, authenticated;
grant execute on function private.can_access_crm_case_document(text) to authenticated;
grant execute on function private.can_access_crm_case_document(text) to service_role;

create policy crm_case_documents_member_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'crm-case-documents'
    and private.can_access_crm_case_document(name)
  );
create policy crm_case_documents_member_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'crm-case-documents'
    and private.can_access_crm_case_document(name)
  );
create policy crm_case_documents_member_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'crm-case-documents'
    and private.can_access_crm_case_document(name)
  );

comment on table public.crm_case_offer_selections is
  'Current saved offer selected for a CRM case. One row exists per case.';
comment on column public.crm_documents.metadata is
  'Non-authoritative upload context; uploadedForOfferId may record the offer used to validate document_type.';
