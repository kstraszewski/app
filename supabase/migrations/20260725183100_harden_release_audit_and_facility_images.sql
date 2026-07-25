-- Final production hardening for PDF-template audit history and facility images.

create unique index mortgage_document_template_revisions_published_revision_idx
  on public.mortgage_document_template_revisions(template_id, revision)
  where action = 'published';

create or replace function private.protect_mortgage_document_template_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'mortgage_document_template_revisions_are_append_only'
    using errcode = '55000';
end;
$$;

revoke all on function private.protect_mortgage_document_template_revision()
  from public, anon, authenticated;

create trigger mortgage_document_template_revisions_protect_append_only
  before update or delete on public.mortgage_document_template_revisions
  for each row execute function private.protect_mortgage_document_template_revision();

create trigger mortgage_product_version_document_templates_protect_immutable
  before insert or update or delete
  on public.mortgage_product_version_document_templates
  for each row execute function private.protect_published_mortgage_version_child();

drop policy if exists "facility admins can insert facility images"
  on public.facility_images;

create policy "facility admins can insert facility images"
  on public.facility_images for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and (
      (select private.is_organization_admin(organization_id))
      or (select private.is_facility_admin(organization_id, facility_id))
    )
  );

comment on function private.protect_mortgage_document_template_revision() is
  'Rejects mutation of append-only PDF template audit snapshots.';
