create table public.facility_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null,
  storage_bucket text not null default 'facility-images',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null default 'image/webp',
  size_bytes bigint not null,
  sha256 text not null,
  width_px integer not null,
  height_px integer not null,
  sort_order integer not null default 0,
  alt_text text,
  uploaded_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facility_images_facility_fkey
    foreign key (organization_id, facility_id)
    references public.facilities(organization_id, id)
    on delete cascade,
  constraint facility_images_bucket_check
    check (storage_bucket = 'facility-images'),
  constraint facility_images_path_check
    check (
      storage_path like organization_id::text || '/' || facility_id::text || '/%'
    ),
  constraint facility_images_filename_length_check
    check (char_length(original_filename) between 1 and 255),
  constraint facility_images_mime_type_check
    check (mime_type = 'image/webp'),
  constraint facility_images_size_check
    check (size_bytes between 1 and 8388608),
  constraint facility_images_sha256_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint facility_images_dimensions_check
    check (
      width_px between 1 and 2000
      and height_px between 1 and 2000
    ),
  constraint facility_images_sort_order_check
    check (sort_order >= 0),
  constraint facility_images_alt_text_length_check
    check (alt_text is null or char_length(alt_text) <= 500),
  unique (storage_bucket, storage_path),
  unique (facility_id, sha256)
);

create index facility_images_facility_sort_idx
  on public.facility_images(organization_id, facility_id, sort_order, created_at, id);

create trigger set_facility_images_updated_at
  before update on public.facility_images
  for each row execute function public.set_updated_at();

alter table public.facility_images enable row level security;

create policy "scoped members can view facility images"
  on public.facility_images for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));

create policy "facility admins can insert facility images"
  on public.facility_images for insert to authenticated
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "facility admins can update facility images"
  on public.facility_images for update to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "facility admins can delete facility images"
  on public.facility_images for delete to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

revoke all on public.facility_images from public, anon, authenticated;
grant select, insert, delete on public.facility_images to authenticated;
grant update (sort_order, alt_text) on public.facility_images to authenticated;
grant all on public.facility_images to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'facility-images',
  'facility-images',
  false,
  8388608,
  array['image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_access_facility_image(
  object_name text,
  require_manage boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_parts text[];
  path_organization_id uuid;
  path_facility_id uuid;
begin
  path_parts := storage.foldername(object_name);
  if coalesce(array_length(path_parts, 1), 0) <> 2
    or path_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or path_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  path_organization_id := path_parts[1]::uuid;
  path_facility_id := path_parts[2]::uuid;

  if require_manage then
    return private.is_organization_admin(path_organization_id)
      or private.is_facility_admin(path_organization_id, path_facility_id);
  end if;

  return private.can_view_facility(path_organization_id, path_facility_id);
end;
$$;

revoke all on function private.can_access_facility_image(text, boolean)
  from public, anon, authenticated;
grant execute on function private.can_access_facility_image(text, boolean)
  to authenticated, service_role;

create policy facility_images_member_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'facility-images'
    and private.can_access_facility_image(name, false)
  );

create policy facility_images_admin_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'facility-images'
    and private.can_access_facility_image(name, true)
  );

create policy facility_images_admin_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'facility-images'
    and private.can_access_facility_image(name, true)
  );

comment on table public.facility_images is
  'Private, optimized presentation photos assigned to an organization facility.';
