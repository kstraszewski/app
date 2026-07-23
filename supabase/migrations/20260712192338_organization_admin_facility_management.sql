-- Facility configuration belongs to the organization administration domain.
-- Keep the legacy helper signature because existing policies and RPCs depend
-- on it, but make organization administration the only management authority.
create or replace function private.is_facility_admin(
  target_organization_id uuid,
  target_facility_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_organization_admin(target_organization_id);
$$;

comment on function private.is_facility_admin(uuid, uuid) is
  'Compatibility helper. Facility configuration may be managed only by an organization administrator.';

-- The facility-level admin role no longer grants elevated permissions. Keep
-- the column for backwards-compatible payloads while normalizing existing
-- memberships to the single supported facility role.
update public.facility_memberships
set role = 'member'
where role = 'admin';
