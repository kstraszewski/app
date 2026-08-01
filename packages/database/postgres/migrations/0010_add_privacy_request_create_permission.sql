-- The portable privacy workflow introduced privacy.requests.create after the
-- historical administrative role catalog was authored. Keep it reachable for
-- organization administrators without granting any scoped execution power.

insert into public.administrative_role_permissions (role_key, permission_key)
values ('organization_admin', 'privacy.requests.create')
on conflict (role_key, permission_key) do nothing;
