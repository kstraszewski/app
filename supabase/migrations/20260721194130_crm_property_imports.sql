alter table public.crm_properties
  add column listing_title text,
  add column description text,
  add column source_url text,
  add column source_published_at timestamptz,
  add column imported_at timestamptz;

alter table public.crm_properties
  add constraint crm_properties_listing_title_length_check
    check (listing_title is null or char_length(listing_title) <= 500),
  add constraint crm_properties_description_length_check
    check (description is null or char_length(description) <= 50000),
  add constraint crm_properties_source_url_check
    check (
      source_url is null
      or (char_length(source_url) <= 4096 and source_url ~* '^https?://')
    ),
  add constraint crm_properties_import_source_check
    check (imported_at is null or source_url is not null),
  add constraint crm_properties_organization_case_id_key
    unique (organization_id, case_id, id);

create table public.crm_property_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.crm_cases(id) on delete cascade,
  property_id uuid not null,
  storage_bucket text not null default 'crm-property-images',
  storage_path text not null,
  source_url text,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  width_px integer,
  height_px integer,
  sort_order integer not null default 0,
  alt_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_property_images_property_fkey
    foreign key (organization_id, case_id, property_id)
    references public.crm_properties(organization_id, case_id, id)
    on delete cascade,
  constraint crm_property_images_bucket_check
    check (storage_bucket = 'crm-property-images'),
  constraint crm_property_images_path_check
    check (
      storage_path like organization_id::text || '/' || case_id::text || '/' || property_id::text || '/%'
    ),
  constraint crm_property_images_source_url_check
    check (
      source_url is null
      or (char_length(source_url) <= 4096 and source_url ~* '^https?://')
    ),
  constraint crm_property_images_mime_type_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint crm_property_images_size_check
    check (size_bytes between 1 and 8388608),
  constraint crm_property_images_sha256_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint crm_property_images_dimensions_check
    check (
      (width_px is null or width_px between 1 and 20000)
      and (height_px is null or height_px between 1 and 20000)
    ),
  constraint crm_property_images_sort_order_check
    check (sort_order >= 0),
  constraint crm_property_images_alt_text_length_check
    check (alt_text is null or char_length(alt_text) <= 500),
  constraint crm_property_images_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  unique (storage_bucket, storage_path),
  unique (property_id, sha256)
);

create index crm_property_images_property_sort_idx
  on public.crm_property_images(organization_id, property_id, sort_order, id);

create trigger set_crm_property_images_updated_at
  before update on public.crm_property_images
  for each row execute function public.set_updated_at();

alter table public.crm_property_images enable row level security;

create policy "crm property images are scoped to org"
  on public.crm_property_images for select to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy "crm property images can be inserted in org"
  on public.crm_property_images for insert to authenticated
  with check ((select private.is_organization_member(organization_id)));

create policy "crm property images can be updated in org"
  on public.crm_property_images for update to authenticated
  using ((select private.is_organization_member(organization_id)))
  with check ((select private.is_organization_member(organization_id)));

create policy "crm property images can be deleted in org"
  on public.crm_property_images for delete to authenticated
  using ((select private.is_organization_member(organization_id)));

revoke all on public.crm_property_images from public, anon, authenticated;
grant select, insert, delete on public.crm_property_images to authenticated;
grant update (sort_order, alt_text, metadata) on public.crm_property_images to authenticated;
grant all on public.crm_property_images to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-property-images',
  'crm-property-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_access_crm_property_image(object_name text)
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
  path_property_id uuid;
begin
  path_parts := storage.foldername(object_name);
  if coalesce(array_length(path_parts, 1), 0) <> 3
    or path_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or path_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or path_parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  path_organization_id := path_parts[1]::uuid;
  path_case_id := path_parts[2]::uuid;
  path_property_id := path_parts[3]::uuid;

  return exists (
    select 1
    from public.crm_properties property
    join public.organization_memberships membership
      on membership.organization_id = property.organization_id
     and membership.user_id = (select auth.uid())
    where property.organization_id = path_organization_id
      and property.case_id = path_case_id
      and property.id = path_property_id
  );
end;
$$;

revoke all on function private.can_access_crm_property_image(text) from public, anon, authenticated;
grant execute on function private.can_access_crm_property_image(text) to authenticated;
grant execute on function private.can_access_crm_property_image(text) to service_role;

create policy crm_property_images_member_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'crm-property-images'
    and private.can_access_crm_property_image(name)
  );

create policy crm_property_images_member_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'crm-property-images'
    and private.can_access_crm_property_image(name)
  );

create policy crm_property_images_member_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'crm-property-images'
    and private.can_access_crm_property_image(name)
  );

comment on table public.crm_property_images is
  'Private, immutable image assets imported for a CRM property.';
comment on column public.crm_properties.metadata is
  'Versioned, non-authoritative import provenance and additional listing attributes.';
