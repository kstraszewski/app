-- Administrative access is organization-scoped and deliberately separate from
-- expert/product accreditation. The legacy organization_memberships.role =
-- 'admin' remains the single source of truth for organization_admin.

create table public.administrative_roles (
  role_key text primary key,
  label text not null,
  description text not null,
  risk_level text not null default 'standard',
  sort_order smallint not null,
  constraint administrative_roles_role_key_not_blank
    check (role_key = btrim(role_key) and char_length(role_key) between 3 and 80),
  constraint administrative_roles_risk_level_valid
    check (risk_level in ('standard', 'sensitive'))
);

create table public.administrative_role_permissions (
  role_key text not null
    references public.administrative_roles(role_key) on delete cascade,
  permission_key text not null,
  primary key (role_key, permission_key),
  constraint administrative_role_permissions_key_not_blank
    check (
      permission_key = btrim(permission_key)
      and char_length(permission_key) between 3 and 120
    )
);

insert into public.administrative_roles (
  role_key,
  label,
  description,
  risk_level,
  sort_order
)
values
  (
    'organization_admin',
    'Administrator organizacji',
    'Zarządza organizacją, użytkownikami, strukturą i ustawieniami operacyjnymi bez prawa do edycji lub publikacji definicji zgód.',
    'standard',
    10
  ),
  (
    'access_admin',
    'Administrator dostępów',
    'Zaprasza użytkowników, nadaje role administracyjne i zarządza bezpośrednimi grantami.',
    'standard',
    20
  ),
  (
    'structure_admin',
    'Administrator struktury',
    'Zarządza zespołami, hierarchią oraz placówkami organizacji.',
    'standard',
    30
  ),
  (
    'consents_admin',
    'Administrator zgód',
    'Tworzy i edytuje robocze definicje zgód bez prawa do samodzielnej publikacji.',
    'sensitive',
    40
  ),
  (
    'crm_config_admin',
    'Administrator ustawień operacyjnych',
    'Zarządza założeniami zdolności i wspólnymi parametrami usług.',
    'standard',
    50
  );

insert into public.administrative_role_permissions (role_key, permission_key)
values
  ('organization_admin', 'organization.settings.manage'),
  ('organization_admin', 'iam.members.read'),
  ('organization_admin', 'iam.members.manage'),
  ('organization_admin', 'iam.roles.manage'),
  ('organization_admin', 'iam.grants.manage'),
  ('organization_admin', 'iam.grants.approve'),
  ('organization_admin', 'iam.audit.read'),
  ('organization_admin', 'structure.read'),
  ('organization_admin', 'structure.manage'),
  ('organization_admin', 'crm.configuration.read'),
  ('organization_admin', 'crm.configuration.manage'),
  ('organization_admin', 'privacy.requests.read'),
  ('organization_admin', 'privacy.grants.request'),
  ('organization_admin', 'privacy.grants.approve'),
  ('access_admin', 'iam.members.read'),
  ('access_admin', 'iam.members.manage'),
  ('access_admin', 'iam.roles.manage'),
  ('access_admin', 'iam.grants.manage'),
  ('access_admin', 'iam.grants.approve'),
  ('access_admin', 'iam.audit.read'),
  ('access_admin', 'privacy.requests.read'),
  ('access_admin', 'privacy.grants.request'),
  ('access_admin', 'privacy.grants.approve'),
  ('structure_admin', 'structure.read'),
  ('structure_admin', 'structure.manage'),
  ('consents_admin', 'compliance.consents.definitions.read'),
  ('consents_admin', 'compliance.consents.definitions.manage'),
  ('consents_admin', 'compliance.consents.audit.read'),
  ('consents_admin', 'privacy.requests.read'),
  ('consents_admin', 'privacy.grants.approve'),
  ('crm_config_admin', 'crm.configuration.read'),
  ('crm_config_admin', 'crm.configuration.manage');

create table public.organization_user_access_states (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  user_id uuid not null,
  revision bigint not null default 0,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint organization_user_access_states_membership_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade,
  constraint organization_user_access_states_updated_by_fkey
    foreign key (updated_by_user_id)
    references public.users(id) on delete set null,
  constraint organization_user_access_states_revision_valid
    check (revision >= 0)
);

create index organization_user_access_states_updated_by_idx
  on public.organization_user_access_states(updated_by_user_id)
  where updated_by_user_id is not null;

create table public.organization_user_admin_roles (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role_key text not null
    references public.administrative_roles(role_key),
  assigned_by_user_id uuid not null,
  reason text not null,
  assigned_at timestamptz not null default now(),
  primary key (organization_id, user_id, role_key),
  constraint organization_user_admin_roles_membership_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade,
  constraint organization_user_admin_roles_assigner_fkey
    foreign key (assigned_by_user_id)
    references public.users(id) on delete restrict,
  constraint organization_user_admin_roles_role_valid
    check (
      role_key in (
        'access_admin',
        'structure_admin',
        'consents_admin',
        'crm_config_admin'
      )
    ),
  constraint organization_user_admin_roles_reason_not_blank
    check (char_length(btrim(reason)) between 10 and 2000)
);

create index organization_user_admin_roles_user_idx
  on public.organization_user_admin_roles(user_id, organization_id);

create index organization_user_admin_roles_assigner_idx
  on public.organization_user_admin_roles(assigned_by_user_id);

create table public.organization_user_direct_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  user_id uuid not null,
  permission_key text not null,
  status text not null default 'active',
  justification text not null,
  valid_from timestamptz not null default now(),
  expires_at timestamptz not null,
  granted_by_user_id uuid not null,
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_user_direct_grants_membership_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade,
  constraint organization_user_direct_grants_granter_fkey
    foreign key (granted_by_user_id)
    references public.users(id) on delete restrict,
  constraint organization_user_direct_grants_revoker_fkey
    foreign key (revoked_by_user_id)
    references public.users(id) on delete restrict,
  constraint organization_user_direct_grants_permission_valid
    check (permission_key = 'compliance.consents.definitions.publish'),
  constraint organization_user_direct_grants_status_valid
    check (status in ('active', 'revoked')),
  constraint organization_user_direct_grants_justification_not_blank
    check (char_length(btrim(justification)) between 10 and 2000),
  constraint organization_user_direct_grants_timeline_valid
    check (
      expires_at > valid_from
      and (
        (
          status = 'active'
          and revoked_at is null
          and revoked_by_user_id is null
          and revocation_reason is null
        )
        or
        (
          status = 'revoked'
          and revoked_at is not null
          and revoked_by_user_id is not null
          and char_length(btrim(revocation_reason)) between 10 and 2000
        )
      )
    ),
  constraint organization_user_direct_grants_revision_valid
    check (revision >= 1),
  constraint organization_user_direct_grants_organization_id_id_key
    unique (organization_id, id)
);

create unique index organization_user_direct_grants_one_active_idx
  on public.organization_user_direct_grants(
    organization_id,
    user_id,
    permission_key
  )
  where status = 'active';

create index organization_user_direct_grants_effective_idx
  on public.organization_user_direct_grants(
    organization_id,
    user_id,
    permission_key,
    expires_at
  )
  where status = 'active';

create trigger organization_user_direct_grants_set_updated_at
  before update on public.organization_user_direct_grants
  for each row execute function public.set_updated_at();

create table public.organization_user_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  target_user_id uuid not null,
  actor_user_id uuid,
  actor_snapshot jsonb not null default '{}'::jsonb,
  target_snapshot jsonb not null default '{}'::jsonb,
  event_type text not null,
  resource_type text not null,
  resource_id text,
  resource_label text,
  changes jsonb not null default '[]'::jsonb,
  reason text,
  source text not null default 'admin_panel',
  correlation_id uuid not null default gen_random_uuid(),
  revision_before bigint,
  revision_after bigint,
  created_at timestamptz not null default now(),
  constraint organization_user_audit_events_actor_fkey
    foreign key (actor_user_id)
    references public.users(id) on delete set null,
  constraint organization_user_audit_events_target_fkey
    foreign key (target_user_id)
    references public.users(id) on delete restrict,
  constraint organization_user_audit_events_event_type_not_blank
    check (char_length(btrim(event_type)) between 3 and 100),
  constraint organization_user_audit_events_resource_type_not_blank
    check (char_length(btrim(resource_type)) between 3 and 100),
  constraint organization_user_audit_events_changes_array
    check (jsonb_typeof(changes) = 'array'),
  constraint organization_user_audit_events_snapshots_objects
    check (
      jsonb_typeof(actor_snapshot) = 'object'
      and jsonb_typeof(target_snapshot) = 'object'
    ),
  constraint organization_user_audit_events_revision_order
    check (
      (revision_before is null and revision_after is null)
      or (
        revision_before is not null
        and revision_after is not null
        and revision_before >= 0
        and revision_after >= revision_before
      )
    )
);

create index organization_user_audit_events_target_timeline_idx
  on public.organization_user_audit_events(
    organization_id,
    target_user_id,
    created_at desc,
    id desc
  );

create index organization_user_audit_events_actor_timeline_idx
  on public.organization_user_audit_events(
    organization_id,
    actor_user_id,
    created_at desc
  )
  where actor_user_id is not null;

create index organization_user_audit_events_correlation_idx
  on public.organization_user_audit_events(organization_id, correlation_id);

create table private.organization_admin_access_commands (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  idempotency_key uuid not null,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  command_type text not null,
  request_fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, idempotency_key)
);

revoke all on table private.organization_admin_access_commands
from public, anon, authenticated;

create or replace function private.initialize_organization_user_access_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_user_access_states (
    organization_id,
    user_id
  )
  values (
    new.organization_id,
    new.user_id
  )
  on conflict (organization_id, user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.initialize_organization_user_access_state()
from public, anon, authenticated;

create trigger organization_memberships_initialize_access_state
  after insert on public.organization_memberships
  for each row execute function private.initialize_organization_user_access_state();

insert into public.organization_user_access_states (
  organization_id,
  user_id,
  created_at,
  updated_at
)
select
  membership.organization_id,
  membership.user_id,
  membership.created_at,
  membership.updated_at
from public.organization_memberships membership
on conflict (organization_id, user_id) do nothing;

create or replace function private.user_has_administrative_role(
  target_organization_id uuid,
  target_user_id uuid,
  target_role_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_role_key = 'organization_admin' then exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = target_user_id
        and membership.role = 'admin'
    )
    else exists (
      select 1
      from public.organization_user_admin_roles assignment
      where assignment.organization_id = target_organization_id
        and assignment.user_id = target_user_id
        and assignment.role_key = target_role_key
    )
  end;
$$;

create or replace function private.user_has_administrative_permission(
  target_organization_id uuid,
  target_user_id uuid,
  target_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.administrative_role_permissions permission
    where permission.permission_key = target_permission_key
      and private.user_has_administrative_role(
        target_organization_id,
        target_user_id,
        permission.role_key
      )
  )
  or exists (
    select 1
    from public.organization_user_direct_grants direct_grant
    where direct_grant.organization_id = target_organization_id
      and direct_grant.user_id = target_user_id
      and direct_grant.permission_key = target_permission_key
      and direct_grant.status = 'active'
      and direct_grant.valid_from <= statement_timestamp()
      and direct_grant.expires_at > statement_timestamp()
  );
$$;

create or replace function private.has_administrative_permission(
  target_organization_id uuid,
  target_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_has_administrative_permission(
    target_organization_id,
    (select auth.uid()),
    target_permission_key
  );
$$;

revoke all on function private.user_has_administrative_role(uuid, uuid, text)
from public, anon;
revoke all on function private.user_has_administrative_permission(uuid, uuid, text)
from public, anon;
revoke all on function private.has_administrative_permission(uuid, text)
from public, anon;

grant execute on function private.user_has_administrative_role(uuid, uuid, text)
to authenticated;
grant execute on function private.user_has_administrative_permission(uuid, uuid, text)
to authenticated;
grant execute on function private.has_administrative_permission(uuid, text)
to authenticated;

create or replace function private.protect_organization_user_audit_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'organization_user_audit_events_are_append_only'
    using errcode = '55000';
end;
$$;

revoke all on function private.protect_organization_user_audit_event()
from public, anon, authenticated;

create trigger organization_user_audit_events_protect_append_only
  before update or delete on public.organization_user_audit_events
  for each row execute function private.protect_organization_user_audit_event();

alter table public.administrative_roles enable row level security;
alter table public.administrative_role_permissions enable row level security;
alter table public.organization_user_access_states enable row level security;
alter table public.organization_user_admin_roles enable row level security;
alter table public.organization_user_direct_grants enable row level security;
alter table public.organization_user_audit_events enable row level security;

create policy administrative_roles_authenticated_read
  on public.administrative_roles
  for select to authenticated
  using (true);

create policy administrative_role_permissions_authenticated_read
  on public.administrative_role_permissions
  for select to authenticated
  using (true);

create policy organization_user_access_states_scoped_read
  on public.organization_user_access_states
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_administrative_permission(
      organization_id,
      'iam.members.read'
    ))
  );

create policy organization_user_admin_roles_scoped_read
  on public.organization_user_admin_roles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_administrative_permission(
      organization_id,
      'iam.members.read'
    ))
  );

create policy organization_user_direct_grants_scoped_read
  on public.organization_user_direct_grants
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_administrative_permission(
      organization_id,
      'iam.grants.manage'
    ))
  );

create policy organization_user_audit_events_access_admin_read
  on public.organization_user_audit_events
  for select to authenticated
  using ((select private.has_administrative_permission(
    organization_id,
    'iam.audit.read'
  )));

revoke all on table public.administrative_roles
from anon, authenticated;
revoke all on table public.administrative_role_permissions
from anon, authenticated;
revoke all on table public.organization_user_access_states
from anon, authenticated;
revoke all on table public.organization_user_admin_roles
from anon, authenticated;
revoke all on table public.organization_user_direct_grants
from anon, authenticated;
revoke all on table public.organization_user_audit_events
from anon, authenticated;

grant select on table public.administrative_roles to authenticated;
grant select on table public.administrative_role_permissions to authenticated;
grant select on table public.organization_user_access_states to authenticated;
grant select on table public.organization_user_admin_roles to authenticated;
grant select on table public.organization_user_direct_grants to authenticated;
grant select on table public.organization_user_audit_events to authenticated;

grant all privileges on table public.administrative_roles to service_role;
grant all privileges on table public.administrative_role_permissions to service_role;
grant all privileges on table public.organization_user_access_states to service_role;
grant all privileges on table public.organization_user_admin_roles to service_role;
grant all privileges on table public.organization_user_direct_grants to service_role;
grant all privileges on table public.organization_user_audit_events to service_role;

comment on table public.organization_user_admin_roles is
  'Direct organization-scoped administrative roles. organization_admin remains organization_memberships.role = admin.';

comment on table public.organization_user_direct_grants is
  'Time-limited direct grants that never inherit from an administrative role or team.';

comment on table public.organization_user_audit_events is
  'Append-only audit history for administrative access, grants and organization structure changes.';

create or replace function private.administrative_access_state_json(
  target_organization_id uuid,
  target_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  access_state public.organization_user_access_states%rowtype;
  membership public.organization_memberships%rowtype;
  role_rows jsonb;
  consent_grant jsonb;
  updater jsonb;
begin
  select *
  into membership
  from public.organization_memberships
  where organization_id = target_organization_id
    and user_id = target_user_id;

  if not found then
    raise exception 'organization_member_not_found'
      using errcode = 'P0002';
  end if;

  select *
  into access_state
  from public.organization_user_access_states
  where organization_id = target_organization_id
    and user_id = target_user_id;

  if not found then
    access_state.organization_id := target_organization_id;
    access_state.user_id := target_user_id;
    access_state.revision := 0;
    access_state.created_at := membership.created_at;
    access_state.updated_at := membership.updated_at;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', available_role.role_key,
        'source', available_role.source,
        'assignedAt', available_role.assigned_at,
        'assignedBy',
          case
            when available_role.assigned_by_user_id is null then null
            else jsonb_build_object(
              'userId', available_role.assigned_by_user_id,
              'fullName', coalesce(assigner.full_name, assigner.email),
              'email', assigner.email,
              'avatarUrl', assigner.avatar_url
            )
          end
      )
      order by role_definition.sort_order
    ),
    '[]'::jsonb
  )
  into role_rows
  from (
    select
      'organization_admin'::text as role_key,
      'organization_membership'::text as source,
      membership.updated_at as assigned_at,
      null::uuid as assigned_by_user_id
    where membership.role = 'admin'

    union all

    select
      assignment.role_key,
      'direct'::text,
      assignment.assigned_at,
      assignment.assigned_by_user_id
    from public.organization_user_admin_roles assignment
    where assignment.organization_id = target_organization_id
      and assignment.user_id = target_user_id
  ) available_role
  join public.administrative_roles role_definition
    on role_definition.role_key = available_role.role_key
  left join public.users assigner
    on assigner.id = available_role.assigned_by_user_id;

  select jsonb_build_object(
    'id', direct_grant.id,
    'permissionKey', direct_grant.permission_key,
    'status',
      case
        when direct_grant.expires_at <= statement_timestamp() then 'expired'
        else direct_grant.status
      end,
    'justification', direct_grant.justification,
    'validFrom', direct_grant.valid_from,
    'expiresAt', direct_grant.expires_at,
    'revision', direct_grant.revision,
    'grantedByUserId', direct_grant.granted_by_user_id
  )
  into consent_grant
  from public.organization_user_direct_grants direct_grant
  where direct_grant.organization_id = target_organization_id
    and direct_grant.user_id = target_user_id
    and direct_grant.permission_key = 'compliance.consents.definitions.publish'
    and direct_grant.status = 'active'
  order by direct_grant.created_at desc
  limit 1;

  select jsonb_build_object(
    'userId', updater_user.id,
    'fullName', coalesce(updater_user.full_name, updater_user.email),
    'email', updater_user.email,
    'avatarUrl', updater_user.avatar_url
  )
  into updater
  from public.users updater_user
  where updater_user.id = access_state.updated_by_user_id;

  return jsonb_build_object(
    'userId', target_user_id,
    'revision', access_state.revision,
    'roles', role_rows,
    'consentPublishingGrant', consent_grant,
    'updatedAt', access_state.updated_at,
    'updatedBy', updater
  );
end;
$$;

revoke all on function private.administrative_access_state_json(uuid, uuid)
from public, anon, authenticated;

create or replace function public.get_organization_user_admin_access(
  p_organization_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
begin
  if actor_user_id is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if not private.is_organization_member(p_organization_id) then
    raise exception 'organization_not_found'
      using errcode = '42501';
  end if;

  if actor_user_id <> p_user_id
    and not private.has_administrative_permission(
      p_organization_id,
      'iam.members.read'
    )
  then
    raise exception 'administrative_access_read_forbidden'
      using errcode = '42501';
  end if;

  return private.administrative_access_state_json(
    p_organization_id,
    p_user_id
  );
end;
$$;

revoke all on function public.get_organization_user_admin_access(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.get_organization_user_admin_access(uuid, uuid)
to authenticated;

create or replace function public.set_organization_user_admin_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_expected_revision bigint,
  p_idempotency_key uuid,
  p_role_keys text[],
  p_consent_publish boolean,
  p_consent_justification text,
  p_consent_expires_at timestamptz,
  p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  actor_snapshot jsonb;
  target_snapshot jsonb;
  normalized_role_keys text[];
  previous_role_keys text[];
  previous_membership_role text;
  requested_membership_role text;
  access_state public.organization_user_access_states%rowtype;
  current_consent_grant public.organization_user_direct_grants%rowtype;
  consent_changed boolean := false;
  roles_changed boolean := false;
  changed boolean := false;
  audit_event_id uuid;
  request_fingerprint text;
  previous_command private.organization_admin_access_commands%rowtype;
  response_payload jsonb;
  previous_state jsonb;
  next_state jsonb;
begin
  if actor_user_id is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if not private.has_administrative_permission(
    p_organization_id,
    'iam.roles.manage'
  ) then
    raise exception 'administrative_access_manage_forbidden'
      using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'administrative_access_revision_invalid'
      using errcode = '22023';
  end if;

  if p_idempotency_key is null then
    raise exception 'administrative_access_idempotency_key_required'
      using errcode = '22023';
  end if;

  if p_change_reason is null
    or char_length(btrim(p_change_reason)) not between 10 and 2000
  then
    raise exception 'administrative_access_change_reason_invalid'
      using errcode = '22023';
  end if;

  if p_role_keys is null then
    raise exception 'administrative_access_roles_required'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_role_keys) requested_role(role_key)
    where requested_role.role_key not in (
      'organization_admin',
      'access_admin',
      'structure_admin',
      'consents_admin',
      'crm_config_admin'
    )
  ) then
    raise exception 'administrative_access_role_invalid'
      using errcode = '22023';
  end if;

  select coalesce(
    array_agg(distinct requested_role.role_key order by requested_role.role_key),
    array[]::text[]
  )
  into normalized_role_keys
  from unnest(p_role_keys) requested_role(role_key);

  if cardinality(normalized_role_keys) <> cardinality(p_role_keys) then
    raise exception 'administrative_access_roles_duplicate'
      using errcode = '22023';
  end if;

  if coalesce(p_consent_publish, false) then
    if p_consent_justification is null
      or char_length(btrim(p_consent_justification)) not between 10 and 2000
    then
      raise exception 'consent_publishing_justification_invalid'
        using errcode = '22023';
    end if;

    if p_consent_expires_at is null
      or p_consent_expires_at <= statement_timestamp()
    then
      raise exception 'consent_publishing_expiry_invalid'
        using errcode = '22023';
    end if;
  elsif p_consent_justification is not null or p_consent_expires_at is not null then
    raise exception 'consent_publishing_fields_without_grant'
      using errcode = '22023';
  end if;

  request_fingerprint := pg_catalog.md5(
    jsonb_build_object(
      'targetUserId', p_user_id,
      'expectedRevision', p_expected_revision,
      'roleKeys', to_jsonb(normalized_role_keys),
      'consentPublish', coalesce(p_consent_publish, false),
      'consentJustification',
        case
          when coalesce(p_consent_publish, false)
            then btrim(p_consent_justification)
          else null
        end,
      'consentExpiresAt',
        case
          when coalesce(p_consent_publish, false)
            then p_consent_expires_at
          else null
        end,
      'changeReason', btrim(p_change_reason)
    )::text
  );

  select *
  into previous_command
  from private.organization_admin_access_commands command
  where command.organization_id = p_organization_id
    and command.idempotency_key = p_idempotency_key;

  if found then
    if previous_command.actor_user_id <> actor_user_id
      or previous_command.target_user_id <> p_user_id
      or previous_command.command_type <> 'set_admin_access'
      or previous_command.request_fingerprint <> request_fingerprint
    then
      raise exception 'administrative_access_idempotency_conflict'
        using errcode = '23505';
    end if;

    return jsonb_set(
      previous_command.response,
      '{replayed}',
      'true'::jsonb,
      true
    );
  end if;

  select membership.role
  into previous_membership_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_user_id
  for update;

  if not found then
    raise exception 'organization_member_not_found'
      using errcode = 'P0002';
  end if;

  insert into public.organization_user_access_states (
    organization_id,
    user_id
  )
  values (
    p_organization_id,
    p_user_id
  )
  on conflict (organization_id, user_id) do nothing;

  select *
  into access_state
  from public.organization_user_access_states state
  where state.organization_id = p_organization_id
    and state.user_id = p_user_id
  for update;

  if access_state.revision <> p_expected_revision then
    raise exception 'administrative_access_revision_conflict'
      using
        errcode = '40001',
        detail = jsonb_build_object(
          'expectedRevision', p_expected_revision,
          'currentRevision', access_state.revision
        )::text;
  end if;

  select coalesce(
    array_agg(existing_role.role_key order by existing_role.role_key),
    array[]::text[]
  )
  into previous_role_keys
  from (
    select 'organization_admin'::text as role_key
    where previous_membership_role = 'admin'

    union all

    select assignment.role_key
    from public.organization_user_admin_roles assignment
    where assignment.organization_id = p_organization_id
      and assignment.user_id = p_user_id
  ) existing_role;

  previous_state := private.administrative_access_state_json(
    p_organization_id,
    p_user_id
  );

  requested_membership_role :=
    case
      when 'organization_admin' = any(normalized_role_keys) then 'admin'
      else 'expert'
    end;

  if previous_membership_role = 'admin'
    and requested_membership_role <> 'admin'
    and (
      select count(*)
      from public.organization_memberships other_admin
      where other_admin.organization_id = p_organization_id
        and other_admin.role = 'admin'
    ) <= 1
  then
    raise exception 'administrative_access_last_organization_admin'
      using errcode = '23514';
  end if;

  roles_changed := previous_role_keys is distinct from normalized_role_keys;

  if previous_membership_role is distinct from requested_membership_role then
    update public.organization_memberships
    set role = requested_membership_role
    where organization_id = p_organization_id
      and user_id = p_user_id;
  end if;

  delete from public.organization_user_admin_roles assignment
  where assignment.organization_id = p_organization_id
    and assignment.user_id = p_user_id
    and not (assignment.role_key = any(normalized_role_keys));

  insert into public.organization_user_admin_roles (
    organization_id,
    user_id,
    role_key,
    assigned_by_user_id,
    reason
  )
  select
    p_organization_id,
    p_user_id,
    requested_role.role_key,
    actor_user_id,
    btrim(p_change_reason)
  from unnest(normalized_role_keys) requested_role(role_key)
  where requested_role.role_key <> 'organization_admin'
  on conflict (organization_id, user_id, role_key) do nothing;

  select *
  into current_consent_grant
  from public.organization_user_direct_grants direct_grant
  where direct_grant.organization_id = p_organization_id
    and direct_grant.user_id = p_user_id
    and direct_grant.permission_key = 'compliance.consents.definitions.publish'
    and direct_grant.status = 'active'
  for update;

  if coalesce(p_consent_publish, false) then
    consent_changed :=
      not found
      or current_consent_grant.expires_at <= statement_timestamp()
      or current_consent_grant.justification is distinct from btrim(p_consent_justification)
      or current_consent_grant.expires_at is distinct from p_consent_expires_at;

    if consent_changed and current_consent_grant.id is not null then
      update public.organization_user_direct_grants
      set
        status = 'revoked',
        revoked_by_user_id = actor_user_id,
        revoked_at = statement_timestamp(),
        revocation_reason = btrim(p_change_reason),
        revision = revision + 1
      where id = current_consent_grant.id;
    end if;

    if consent_changed then
      insert into public.organization_user_direct_grants (
        organization_id,
        user_id,
        permission_key,
        justification,
        expires_at,
        granted_by_user_id
      )
      values (
        p_organization_id,
        p_user_id,
        'compliance.consents.definitions.publish',
        btrim(p_consent_justification),
        p_consent_expires_at,
        actor_user_id
      );
    end if;
  else
    consent_changed := current_consent_grant.id is not null;

    if consent_changed then
      update public.organization_user_direct_grants
      set
        status = 'revoked',
        revoked_by_user_id = actor_user_id,
        revoked_at = statement_timestamp(),
        revocation_reason = btrim(p_change_reason),
        revision = revision + 1
      where id = current_consent_grant.id;
    end if;
  end if;

  changed := roles_changed or consent_changed;

  if changed then
    update public.organization_user_access_states
    set
      revision = revision + 1,
      updated_by_user_id = actor_user_id,
      updated_at = statement_timestamp()
    where organization_id = p_organization_id
      and user_id = p_user_id
    returning *
    into access_state;

    select jsonb_build_object(
      'userId', actor.id,
      'fullName', coalesce(actor.full_name, actor.email),
      'email', actor.email,
      'avatarUrl', actor.avatar_url
    )
    into actor_snapshot
    from public.users actor
    where actor.id = actor_user_id;

    select jsonb_build_object(
      'userId', target.id,
      'fullName', coalesce(target.full_name, target.email),
      'email', target.email,
      'avatarUrl', target.avatar_url
    )
    into target_snapshot
    from public.users target
    where target.id = p_user_id;

    insert into public.organization_user_audit_events (
      organization_id,
      target_user_id,
      actor_user_id,
      actor_snapshot,
      target_snapshot,
      event_type,
      resource_type,
      resource_id,
      resource_label,
      changes,
      reason,
      source,
      correlation_id,
      revision_before,
      revision_after
    )
    values (
      p_organization_id,
      p_user_id,
      actor_user_id,
      coalesce(actor_snapshot, '{}'::jsonb),
      coalesce(target_snapshot, '{}'::jsonb),
      'admin_access_updated',
      'user_admin_access',
      p_user_id::text,
      'Dostęp administracyjny użytkownika',
      jsonb_build_array(
        jsonb_build_object(
          'field', 'roles',
          'before', to_jsonb(previous_role_keys),
          'after', to_jsonb(normalized_role_keys)
        ),
        jsonb_build_object(
          'field', 'consentPublishingGrant',
          'before', previous_state -> 'consentPublishingGrant',
          'after',
            case
              when coalesce(p_consent_publish, false)
                then jsonb_build_object(
                  'permissionKey', 'compliance.consents.definitions.publish',
                  'expiresAt', p_consent_expires_at
                )
              else null
            end
        )
      ),
      btrim(p_change_reason),
      'admin_panel',
      p_idempotency_key,
      p_expected_revision,
      access_state.revision
    )
    returning id into audit_event_id;
  end if;

  next_state := private.administrative_access_state_json(
    p_organization_id,
    p_user_id
  );

  response_payload := jsonb_build_object(
    'data', next_state,
    'changed', changed,
    'replayed', false,
    'auditEventId', audit_event_id
  );

  insert into private.organization_admin_access_commands (
    organization_id,
    idempotency_key,
    actor_user_id,
    target_user_id,
    command_type,
    request_fingerprint,
    response
  )
  values (
    p_organization_id,
    p_idempotency_key,
    actor_user_id,
    p_user_id,
    'set_admin_access',
    request_fingerprint,
    response_payload
  );

  return response_payload;
end;
$$;

revoke all on function public.set_organization_user_admin_access(
  uuid,
  uuid,
  bigint,
  uuid,
  text[],
  boolean,
  text,
  timestamptz,
  text
)
from public, anon, authenticated;

grant execute on function public.set_organization_user_admin_access(
  uuid,
  uuid,
  bigint,
  uuid,
  text[],
  boolean,
  text,
  timestamptz,
  text
)
to authenticated;

create table public.crm_client_anonymization_execution_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  request_id uuid not null,
  grantee_user_id uuid not null,
  requested_by_user_id uuid not null,
  approver_user_id uuid not null,
  permission_key text not null default 'clients.anonymization.execute',
  status text not null default 'pending_approval',
  justification text not null,
  expires_at timestamptz not null,
  decision_reason text,
  approved_at timestamptz,
  rejected_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  consumed_at timestamptz,
  consumed_by_user_id uuid,
  revision bigint not null default 1,
  request_idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_client_anonymization_execution_grants_request_fkey
    foreign key (organization_id, request_id)
    references public.crm_client_anonymization_requests(organization_id, id)
    on delete restrict,
  constraint crm_client_anonymization_execution_grants_grantee_fkey
    foreign key (organization_id, grantee_user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade,
  constraint crm_client_anonymization_execution_grants_requester_fkey
    foreign key (requested_by_user_id)
    references public.users(id) on delete restrict,
  constraint crm_client_anonymization_execution_grants_approver_fkey
    foreign key (approver_user_id)
    references public.users(id) on delete restrict,
  constraint crm_client_anonymization_execution_grants_revoker_fkey
    foreign key (revoked_by_user_id)
    references public.users(id) on delete restrict,
  constraint crm_client_anonymization_execution_grants_consumer_fkey
    foreign key (consumed_by_user_id)
    references public.users(id) on delete restrict,
  constraint crm_client_anonymization_execution_grants_permission_valid
    check (permission_key = 'clients.anonymization.execute'),
  constraint crm_client_anonymization_execution_grants_status_valid
    check (status in (
      'pending_approval',
      'active',
      'rejected',
      'revoked',
      'consumed'
    )),
  constraint crm_client_anonymization_execution_grants_justification_valid
    check (char_length(btrim(justification)) between 20 and 2000),
  constraint crm_client_anonymization_execution_grants_four_eyes
    check (
      approver_user_id <> grantee_user_id
      and approver_user_id <> requested_by_user_id
    ),
  constraint crm_client_anonymization_execution_grants_expiry_valid
    check (
      expires_at > created_at
      and expires_at <= created_at + interval '24 hours'
    ),
  constraint crm_client_anonymization_execution_grants_lifecycle_valid
    check (
      (
        status = 'pending_approval'
        and approved_at is null
        and rejected_at is null
        and revoked_at is null
        and consumed_at is null
      )
      or (
        status = 'active'
        and approved_at is not null
        and rejected_at is null
        and revoked_at is null
        and consumed_at is null
      )
      or (
        status = 'rejected'
        and approved_at is null
        and rejected_at is not null
        and revoked_at is null
        and consumed_at is null
        and char_length(btrim(decision_reason)) between 10 and 2000
      )
      or (
        status = 'revoked'
        and revoked_at is not null
        and revoked_by_user_id is not null
        and consumed_at is null
        and char_length(btrim(decision_reason)) between 10 and 2000
      )
      or (
        status = 'consumed'
        and approved_at is not null
        and consumed_at is not null
        and consumed_by_user_id = grantee_user_id
        and revoked_at is null
      )
    ),
  constraint crm_client_anonymization_execution_grants_revision_valid
    check (revision >= 1),
  constraint crm_client_anonymization_execution_grants_organization_id_id_key
    unique (organization_id, id),
  constraint crm_client_anonymization_execution_grants_request_idempotency_unique
    unique (organization_id, requested_by_user_id, request_idempotency_key)
);

create unique index crm_client_anonymization_execution_grants_one_open_idx
  on public.crm_client_anonymization_execution_grants(
    organization_id,
    request_id
  )
  where status in ('pending_approval', 'active');

create index crm_client_anonymization_execution_grants_grantee_idx
  on public.crm_client_anonymization_execution_grants(
    organization_id,
    grantee_user_id,
    status,
    expires_at
  );

create index crm_client_anonymization_execution_grants_approver_queue_idx
  on public.crm_client_anonymization_execution_grants(
    organization_id,
    approver_user_id,
    created_at,
    id
  )
  where status = 'pending_approval';

create trigger crm_client_anonymization_execution_grants_set_updated_at
  before update on public.crm_client_anonymization_execution_grants
  for each row execute function public.set_updated_at();

alter table public.crm_client_anonymization_execution_grants
  enable row level security;

create policy crm_client_anonymization_execution_grants_scoped_read
  on public.crm_client_anonymization_execution_grants
  for select to authenticated
  using (
    grantee_user_id = (select auth.uid())
    or requested_by_user_id = (select auth.uid())
    or approver_user_id = (select auth.uid())
    or (select private.has_administrative_permission(
      organization_id,
      'iam.grants.manage'
    ))
  );

revoke all on table public.crm_client_anonymization_execution_grants
from anon, authenticated;
grant select on table public.crm_client_anonymization_execution_grants
to authenticated;
grant all privileges on table public.crm_client_anonymization_execution_grants
to service_role;

drop policy if exists crm_client_anonymization_requests_admin_read
  on public.crm_client_anonymization_requests;
create policy crm_client_anonymization_requests_privacy_read
  on public.crm_client_anonymization_requests
  for select to authenticated
  using ((select private.has_administrative_permission(
    organization_id,
    'privacy.requests.read'
  )));

drop policy if exists crm_client_anonymization_request_events_admin_read
  on public.crm_client_anonymization_request_events;
create policy crm_client_anonymization_request_events_privacy_read
  on public.crm_client_anonymization_request_events
  for select to authenticated
  using ((select private.has_administrative_permission(
    organization_id,
    'privacy.requests.read'
  )));

comment on table public.crm_client_anonymization_execution_grants is
  'Four-eyes, single-use execution grants bound to one approved client anonymization request.';

create or replace function private.anonymization_execution_grant_state_json(
  target_organization_id uuid,
  target_grant_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', execution_grant.id,
    'revision', execution_grant.revision,
    'permissionKey', execution_grant.permission_key,
    'status',
      case
        when execution_grant.status in ('pending_approval', 'active')
          and execution_grant.expires_at <= statement_timestamp()
          then 'expired'
        else execution_grant.status
      end,
    'singleUse', true,
    'request', jsonb_build_object(
      'id', anonymization_request.id,
      'requestNumber', anonymization_request.request_number,
      'status', anonymization_request.status,
      'dueAt', anonymization_request.due_at,
      'client', jsonb_build_object(
        'id', client.id,
        'displayName', client.display_name
      )
    ),
    'grantee', jsonb_build_object(
      'userId', grantee.id,
      'fullName', coalesce(grantee.full_name, grantee.email),
      'email', grantee.email,
      'avatarUrl', grantee.avatar_url
    ),
    'requestedBy', jsonb_build_object(
      'userId', requester.id,
      'fullName', coalesce(requester.full_name, requester.email),
      'email', requester.email,
      'avatarUrl', requester.avatar_url
    ),
    'approver', jsonb_build_object(
      'userId', approver.id,
      'fullName', coalesce(approver.full_name, approver.email),
      'email', approver.email,
      'avatarUrl', approver.avatar_url
    ),
    'justification', execution_grant.justification,
    'decisionReason', execution_grant.decision_reason,
    'requestedAt', execution_grant.created_at,
    'approvedAt', execution_grant.approved_at,
    'expiresAt', execution_grant.expires_at,
    'consumedAt', execution_grant.consumed_at,
    'revokedAt', execution_grant.revoked_at
  )
  from public.crm_client_anonymization_execution_grants execution_grant
  join public.crm_client_anonymization_requests anonymization_request
    on anonymization_request.organization_id = execution_grant.organization_id
   and anonymization_request.id = execution_grant.request_id
  join public.crm_clients client
    on client.organization_id = anonymization_request.organization_id
   and client.id = anonymization_request.client_id
  join public.users grantee
    on grantee.id = execution_grant.grantee_user_id
  join public.users requester
    on requester.id = execution_grant.requested_by_user_id
  join public.users approver
    on approver.id = execution_grant.approver_user_id
  where execution_grant.organization_id = target_organization_id
    and execution_grant.id = target_grant_id;
$$;

revoke all on function private.anonymization_execution_grant_state_json(uuid, uuid)
from public, anon, authenticated;

create or replace function public.request_crm_client_anonymization_execution_grant(
  p_organization_id uuid,
  p_request_id uuid,
  p_grantee_user_id uuid,
  p_approver_user_id uuid,
  p_justification text,
  p_expires_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  request_row public.crm_client_anonymization_requests%rowtype;
  grant_id uuid;
  audit_event_id uuid;
  actor_snapshot jsonb;
  target_snapshot jsonb;
  request_fingerprint text;
  previous_command private.organization_admin_access_commands%rowtype;
  response_payload jsonb;
  expired_grant record;
begin
  if actor_user_id is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if not private.has_administrative_permission(
    p_organization_id,
    'privacy.grants.request'
  ) then
    raise exception 'anonymization_grant_request_forbidden'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'anonymization_grant_idempotency_key_required'
      using errcode = '22023';
  end if;

  if p_justification is null
    or char_length(btrim(p_justification)) not between 20 and 2000
  then
    raise exception 'anonymization_grant_justification_invalid'
      using errcode = '22023';
  end if;

  if p_expires_at is null
    or p_expires_at <= statement_timestamp()
    or p_expires_at > statement_timestamp() + interval '24 hours'
  then
    raise exception 'anonymization_grant_expiry_invalid'
      using errcode = '22023';
  end if;

  if p_approver_user_id = actor_user_id
    or p_approver_user_id = p_grantee_user_id
  then
    raise exception 'anonymization_grant_four_eyes_required'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_grantee_user_id
  ) then
    raise exception 'anonymization_grantee_not_found'
      using errcode = 'P0002';
  end if;

  if not private.user_has_administrative_permission(
    p_organization_id,
    p_approver_user_id,
    'privacy.grants.approve'
  ) then
    raise exception 'anonymization_grant_approver_not_eligible'
      using errcode = '23514';
  end if;

  request_fingerprint := pg_catalog.md5(
    jsonb_build_object(
      'requestId', p_request_id,
      'granteeUserId', p_grantee_user_id,
      'approverUserId', p_approver_user_id,
      'justification', btrim(p_justification),
      'expiresAt', p_expires_at
    )::text
  );

  select *
  into previous_command
  from private.organization_admin_access_commands command
  where command.organization_id = p_organization_id
    and command.idempotency_key = p_idempotency_key;

  if found then
    if previous_command.actor_user_id <> actor_user_id
      or previous_command.target_user_id <> p_grantee_user_id
      or previous_command.command_type <> 'request_anonymization_grant'
      or previous_command.request_fingerprint <> request_fingerprint
    then
      raise exception 'administrative_access_idempotency_conflict'
        using errcode = '23505';
    end if;

    return jsonb_set(
      previous_command.response,
      '{replayed}',
      'true'::jsonb,
      true
    );
  end if;

  select *
  into request_row
  from public.crm_client_anonymization_requests anonymization_request
  where anonymization_request.organization_id = p_organization_id
    and anonymization_request.id = p_request_id
  for update;

  if not found then
    raise exception 'anonymization_request_not_found'
      using errcode = 'P0002';
  end if;

  if request_row.status not in ('approved', 'in_progress')
    or request_row.identity_verified_at is null
    or request_row.approved_at is null
  then
    raise exception 'anonymization_request_not_executable'
      using errcode = '23514';
  end if;

  if p_expires_at > request_row.due_at then
    raise exception 'anonymization_grant_exceeds_request_deadline'
      using errcode = '23514';
  end if;

  -- An expired open grant is terminal state even if no one explicitly opened
  -- its approval screen. Close it under the same request lock before the new
  -- insert so the one-open-grant index cannot turn clock expiry into a
  -- permanent workflow dead end.
  for expired_grant in
    select
      execution_grant.id,
      execution_grant.grantee_user_id,
      execution_grant.status as previous_status,
      execution_grant.revision as previous_revision
    from public.crm_client_anonymization_execution_grants execution_grant
    where execution_grant.organization_id = p_organization_id
      and execution_grant.request_id = p_request_id
      and execution_grant.status in ('pending_approval', 'active')
      and execution_grant.expires_at <= statement_timestamp()
    order by execution_grant.id
    for update
  loop
    update public.crm_client_anonymization_execution_grants
    set
      status = 'revoked',
      decision_reason =
        'Grant wygasł automatycznie przed utworzeniem nowego wniosku.',
      revoked_at = statement_timestamp(),
      revoked_by_user_id = actor_user_id,
      revision = revision + 1
    where organization_id = p_organization_id
      and id = expired_grant.id;

    insert into public.organization_user_audit_events (
      organization_id,
      target_user_id,
      actor_user_id,
      actor_snapshot,
      target_snapshot,
      event_type,
      resource_type,
      resource_id,
      resource_label,
      changes,
      reason,
      source,
      correlation_id,
      revision_before,
      revision_after
    )
    values (
      p_organization_id,
      expired_grant.grantee_user_id,
      actor_user_id,
      jsonb_build_object('userId', actor_user_id),
      jsonb_build_object('userId', expired_grant.grantee_user_id),
      'anonymization_grant_expired',
      'crm_client_anonymization_execution_grant',
      expired_grant.id::text,
      'Jednorazowy grant anonimizacji',
      jsonb_build_array(
        jsonb_build_object(
          'field', 'status',
          'before', expired_grant.previous_status,
          'after', 'revoked'
        )
      ),
      'Grant wygasł automatycznie przed utworzeniem nowego wniosku.',
      'system_expiry',
      p_idempotency_key,
      expired_grant.previous_revision,
      expired_grant.previous_revision + 1
    );
  end loop;

  insert into public.crm_client_anonymization_execution_grants (
    organization_id,
    request_id,
    grantee_user_id,
    requested_by_user_id,
    approver_user_id,
    justification,
    expires_at,
    request_idempotency_key
  )
  values (
    p_organization_id,
    p_request_id,
    p_grantee_user_id,
    actor_user_id,
    p_approver_user_id,
    btrim(p_justification),
    p_expires_at,
    p_idempotency_key
  )
  returning id into grant_id;

  select jsonb_build_object(
    'userId', actor.id,
    'fullName', coalesce(actor.full_name, actor.email),
    'email', actor.email,
    'avatarUrl', actor.avatar_url
  )
  into actor_snapshot
  from public.users actor
  where actor.id = actor_user_id;

  select jsonb_build_object(
    'userId', target.id,
    'fullName', coalesce(target.full_name, target.email),
    'email', target.email,
    'avatarUrl', target.avatar_url
  )
  into target_snapshot
  from public.users target
  where target.id = p_grantee_user_id;

  insert into public.organization_user_audit_events (
    organization_id,
    target_user_id,
    actor_user_id,
    actor_snapshot,
    target_snapshot,
    event_type,
    resource_type,
    resource_id,
    resource_label,
    changes,
    reason,
    source,
    correlation_id,
    revision_before,
    revision_after
  )
  values (
    p_organization_id,
    p_grantee_user_id,
    actor_user_id,
    coalesce(actor_snapshot, '{}'::jsonb),
    coalesce(target_snapshot, '{}'::jsonb),
    'anonymization_grant_requested',
    'crm_client_anonymization_request',
    p_request_id::text,
    request_row.request_number,
    jsonb_build_array(
      jsonb_build_object(
        'field', 'status',
        'before', null,
        'after', 'pending_approval'
      ),
      jsonb_build_object(
        'field', 'expiresAt',
        'before', null,
        'after', p_expires_at
      ),
      jsonb_build_object(
        'field', 'approverUserId',
        'before', null,
        'after', p_approver_user_id
      )
    ),
    'Wniosek o jednorazowy grant do zatwierdzonego żądania anonimizacji.',
    'admin_panel',
    p_idempotency_key,
    0,
    1
  )
  returning id into audit_event_id;

  response_payload := jsonb_build_object(
    'data', private.anonymization_execution_grant_state_json(
      p_organization_id,
      grant_id
    ),
    'replayed', false,
    'auditEventId', audit_event_id
  );

  insert into private.organization_admin_access_commands (
    organization_id,
    idempotency_key,
    actor_user_id,
    target_user_id,
    command_type,
    request_fingerprint,
    response
  )
  values (
    p_organization_id,
    p_idempotency_key,
    actor_user_id,
    p_grantee_user_id,
    'request_anonymization_grant',
    request_fingerprint,
    response_payload
  );

  return response_payload;
exception
  when unique_violation then
    if sqlerrm like '%crm_client_anonymization_execution_grants_one_open_idx%' then
      raise exception 'anonymization_request_already_has_open_grant'
        using errcode = '23505';
    end if;
    raise;
end;
$$;

revoke all on function public.request_crm_client_anonymization_execution_grant(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  uuid
)
from public, anon, authenticated;
grant execute on function public.request_crm_client_anonymization_execution_grant(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  uuid
)
to authenticated;

create or replace function public.respond_crm_client_anonymization_execution_grant(
  p_organization_id uuid,
  p_grant_id uuid,
  p_expected_revision bigint,
  p_action text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  grant_row public.crm_client_anonymization_execution_grants%rowtype;
  request_row public.crm_client_anonymization_requests%rowtype;
  actor_snapshot jsonb;
  target_snapshot jsonb;
  request_fingerprint text;
  previous_command private.organization_admin_access_commands%rowtype;
  response_payload jsonb;
  audit_event_id uuid;
  next_status text;
  event_type text;
begin
  if actor_user_id is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if p_action not in ('approve', 'reject') then
    raise exception 'anonymization_grant_response_invalid'
      using errcode = '22023';
  end if;

  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'anonymization_grant_revision_invalid'
      using errcode = '22023';
  end if;

  if p_idempotency_key is null then
    raise exception 'anonymization_grant_idempotency_key_required'
      using errcode = '22023';
  end if;

  if p_action = 'reject'
    and (
      p_reason is null
      or char_length(btrim(p_reason)) not between 10 and 2000
    )
  then
    raise exception 'anonymization_grant_rejection_reason_invalid'
      using errcode = '22023';
  end if;

  if p_action = 'approve'
    and p_reason is not null
    and char_length(btrim(p_reason)) not between 10 and 2000
  then
    raise exception 'anonymization_grant_approval_reason_invalid'
      using errcode = '22023';
  end if;

  request_fingerprint := pg_catalog.md5(
    jsonb_build_object(
      'grantId', p_grant_id,
      'expectedRevision', p_expected_revision,
      'action', p_action,
      'reason', nullif(btrim(p_reason), '')
    )::text
  );

  select *
  into previous_command
  from private.organization_admin_access_commands command
  where command.organization_id = p_organization_id
    and command.idempotency_key = p_idempotency_key;

  if found then
    if previous_command.actor_user_id <> actor_user_id
      or previous_command.command_type <> 'respond_anonymization_grant'
      or previous_command.request_fingerprint <> request_fingerprint
    then
      raise exception 'administrative_access_idempotency_conflict'
        using errcode = '23505';
    end if;

    return jsonb_set(
      previous_command.response,
      '{replayed}',
      'true'::jsonb,
      true
    );
  end if;

  select *
  into grant_row
  from public.crm_client_anonymization_execution_grants execution_grant
  where execution_grant.organization_id = p_organization_id
    and execution_grant.id = p_grant_id
  for update;

  if not found then
    raise exception 'anonymization_grant_not_found'
      using errcode = 'P0002';
  end if;

  if grant_row.approver_user_id <> actor_user_id
    or not private.has_administrative_permission(
      p_organization_id,
      'privacy.grants.approve'
    )
  then
    raise exception 'anonymization_grant_response_forbidden'
      using errcode = '42501';
  end if;

  if grant_row.revision <> p_expected_revision then
    raise exception 'administrative_access_revision_conflict'
      using
        errcode = '40001',
        detail = jsonb_build_object(
          'expectedRevision', p_expected_revision,
          'currentRevision', grant_row.revision
        )::text;
  end if;

  if grant_row.status <> 'pending_approval' then
    raise exception 'anonymization_grant_not_pending'
      using errcode = '23514';
  end if;

  if grant_row.expires_at <= statement_timestamp() then
    raise exception 'anonymization_grant_expired'
      using errcode = '23514';
  end if;

  select *
  into request_row
  from public.crm_client_anonymization_requests anonymization_request
  where anonymization_request.organization_id = p_organization_id
    and anonymization_request.id = grant_row.request_id
  for update;

  if not found
    or request_row.status not in ('approved', 'in_progress')
    or request_row.identity_verified_at is null
    or request_row.approved_at is null
  then
    raise exception 'anonymization_request_not_executable'
      using errcode = '23514';
  end if;

  next_status := case when p_action = 'approve' then 'active' else 'rejected' end;
  event_type := case
    when p_action = 'approve' then 'anonymization_grant_approved'
    else 'anonymization_grant_rejected'
  end;

  update public.crm_client_anonymization_execution_grants
  set
    status = next_status,
    decision_reason = nullif(btrim(p_reason), ''),
    approved_at =
      case when p_action = 'approve' then statement_timestamp() else null end,
    rejected_at =
      case when p_action = 'reject' then statement_timestamp() else null end,
    revision = revision + 1
  where id = p_grant_id
  returning *
  into grant_row;

  select jsonb_build_object(
    'userId', actor.id,
    'fullName', coalesce(actor.full_name, actor.email),
    'email', actor.email,
    'avatarUrl', actor.avatar_url
  )
  into actor_snapshot
  from public.users actor
  where actor.id = actor_user_id;

  select jsonb_build_object(
    'userId', target.id,
    'fullName', coalesce(target.full_name, target.email),
    'email', target.email,
    'avatarUrl', target.avatar_url
  )
  into target_snapshot
  from public.users target
  where target.id = grant_row.grantee_user_id;

  insert into public.organization_user_audit_events (
    organization_id,
    target_user_id,
    actor_user_id,
    actor_snapshot,
    target_snapshot,
    event_type,
    resource_type,
    resource_id,
    resource_label,
    changes,
    reason,
    source,
    correlation_id,
    revision_before,
    revision_after
  )
  values (
    p_organization_id,
    grant_row.grantee_user_id,
    actor_user_id,
    coalesce(actor_snapshot, '{}'::jsonb),
    coalesce(target_snapshot, '{}'::jsonb),
    event_type,
    'crm_client_anonymization_request',
    grant_row.request_id::text,
    request_row.request_number,
    jsonb_build_array(
      jsonb_build_object(
        'field', 'status',
        'before', 'pending_approval',
        'after', next_status
      )
    ),
    coalesce(
      nullif(btrim(p_reason), ''),
      'Zakres żądania i odbiorca grantu zostały zweryfikowane.'
    ),
    'approval_workflow',
    p_idempotency_key,
    p_expected_revision,
    grant_row.revision
  )
  returning id into audit_event_id;

  response_payload := jsonb_build_object(
    'data', private.anonymization_execution_grant_state_json(
      p_organization_id,
      p_grant_id
    ),
    'replayed', false,
    'auditEventId', audit_event_id
  );

  insert into private.organization_admin_access_commands (
    organization_id,
    idempotency_key,
    actor_user_id,
    target_user_id,
    command_type,
    request_fingerprint,
    response
  )
  values (
    p_organization_id,
    p_idempotency_key,
    actor_user_id,
    grant_row.grantee_user_id,
    'respond_anonymization_grant',
    request_fingerprint,
    response_payload
  );

  return response_payload;
end;
$$;

revoke all on function public.respond_crm_client_anonymization_execution_grant(
  uuid,
  uuid,
  bigint,
  text,
  text,
  uuid
)
from public, anon, authenticated;
grant execute on function public.respond_crm_client_anonymization_execution_grant(
  uuid,
  uuid,
  bigint,
  text,
  text,
  uuid
)
to authenticated;

create or replace function public.revoke_crm_client_anonymization_execution_grant(
  p_organization_id uuid,
  p_grant_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  grant_row public.crm_client_anonymization_execution_grants%rowtype;
  request_number text;
  actor_snapshot jsonb;
  target_snapshot jsonb;
  request_fingerprint text;
  previous_command private.organization_admin_access_commands%rowtype;
  response_payload jsonb;
  audit_event_id uuid;
  previous_status text;
begin
  if actor_user_id is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if not private.has_administrative_permission(
    p_organization_id,
    'iam.grants.manage'
  ) then
    raise exception 'anonymization_grant_revoke_forbidden'
      using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'anonymization_grant_revision_invalid'
      using errcode = '22023';
  end if;

  if p_reason is null
    or char_length(btrim(p_reason)) not between 10 and 2000
  then
    raise exception 'anonymization_grant_revocation_reason_invalid'
      using errcode = '22023';
  end if;

  if p_idempotency_key is null then
    raise exception 'anonymization_grant_idempotency_key_required'
      using errcode = '22023';
  end if;

  request_fingerprint := pg_catalog.md5(
    jsonb_build_object(
      'grantId', p_grant_id,
      'expectedRevision', p_expected_revision,
      'reason', btrim(p_reason)
    )::text
  );

  select *
  into previous_command
  from private.organization_admin_access_commands command
  where command.organization_id = p_organization_id
    and command.idempotency_key = p_idempotency_key;

  if found then
    if previous_command.actor_user_id <> actor_user_id
      or previous_command.command_type <> 'revoke_anonymization_grant'
      or previous_command.request_fingerprint <> request_fingerprint
    then
      raise exception 'administrative_access_idempotency_conflict'
        using errcode = '23505';
    end if;

    return jsonb_set(
      previous_command.response,
      '{replayed}',
      'true'::jsonb,
      true
    );
  end if;

  select execution_grant.*
  into grant_row
  from public.crm_client_anonymization_execution_grants execution_grant
  where execution_grant.organization_id = p_organization_id
    and execution_grant.id = p_grant_id
  for update;

  if not found then
    raise exception 'anonymization_grant_not_found'
      using errcode = 'P0002';
  end if;

  if grant_row.revision <> p_expected_revision then
    raise exception 'administrative_access_revision_conflict'
      using
        errcode = '40001',
        detail = jsonb_build_object(
          'expectedRevision', p_expected_revision,
          'currentRevision', grant_row.revision
        )::text;
  end if;

  if grant_row.status not in ('pending_approval', 'active') then
    raise exception 'anonymization_grant_not_revocable'
      using errcode = '23514';
  end if;

  select anonymization_request.request_number
  into request_number
  from public.crm_client_anonymization_requests anonymization_request
  where anonymization_request.organization_id = p_organization_id
    and anonymization_request.id = grant_row.request_id;

  previous_status := grant_row.status;

  update public.crm_client_anonymization_execution_grants
  set
    status = 'revoked',
    decision_reason = btrim(p_reason),
    revoked_at = statement_timestamp(),
    revoked_by_user_id = actor_user_id,
    revision = revision + 1
  where id = p_grant_id
  returning *
  into grant_row;

  select jsonb_build_object(
    'userId', actor.id,
    'fullName', coalesce(actor.full_name, actor.email),
    'email', actor.email,
    'avatarUrl', actor.avatar_url
  )
  into actor_snapshot
  from public.users actor
  where actor.id = actor_user_id;

  select jsonb_build_object(
    'userId', target.id,
    'fullName', coalesce(target.full_name, target.email),
    'email', target.email,
    'avatarUrl', target.avatar_url
  )
  into target_snapshot
  from public.users target
  where target.id = grant_row.grantee_user_id;

  insert into public.organization_user_audit_events (
    organization_id,
    target_user_id,
    actor_user_id,
    actor_snapshot,
    target_snapshot,
    event_type,
    resource_type,
    resource_id,
    resource_label,
    changes,
    reason,
    source,
    correlation_id,
    revision_before,
    revision_after
  )
  values (
    p_organization_id,
    grant_row.grantee_user_id,
    actor_user_id,
    coalesce(actor_snapshot, '{}'::jsonb),
    coalesce(target_snapshot, '{}'::jsonb),
    'anonymization_grant_revoked',
    'crm_client_anonymization_request',
    grant_row.request_id::text,
    request_number,
    jsonb_build_array(
      jsonb_build_object(
        'field', 'status',
        'before', previous_status,
        'after', 'revoked'
      )
    ),
    btrim(p_reason),
    'admin_panel',
    p_idempotency_key,
    p_expected_revision,
    grant_row.revision
  )
  returning id into audit_event_id;

  response_payload := jsonb_build_object(
    'data', private.anonymization_execution_grant_state_json(
      p_organization_id,
      p_grant_id
    ),
    'replayed', false,
    'auditEventId', audit_event_id
  );

  insert into private.organization_admin_access_commands (
    organization_id,
    idempotency_key,
    actor_user_id,
    target_user_id,
    command_type,
    request_fingerprint,
    response
  )
  values (
    p_organization_id,
    p_idempotency_key,
    actor_user_id,
    grant_row.grantee_user_id,
    'revoke_anonymization_grant',
    request_fingerprint,
    response_payload
  );

  return response_payload;
end;
$$;

revoke all on function public.revoke_crm_client_anonymization_execution_grant(
  uuid,
  uuid,
  bigint,
  text,
  uuid
)
from public, anon, authenticated;
grant execute on function public.revoke_crm_client_anonymization_execution_grant(
  uuid,
  uuid,
  bigint,
  text,
  uuid
)
to authenticated;

-- Administrative permissions are the database authorization boundary for the
-- existing organization-management RPCs as well as for direct table writes.
-- Keep the legacy behavior intact and replace only their authorization guard.
create or replace function private.add_organization_member_by_email(
  target_organization_id uuid,
  target_email text,
  target_role text default 'expert'
)
returns public.organization_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  inserted_membership public.organization_memberships;
begin
  if not private.has_administrative_permission(
    target_organization_id,
    'iam.members.manage'
  ) then
    raise exception 'organization_admin_required' using errcode = '42501';
  end if;

  if target_role not in ('expert', 'admin') then
    raise exception 'invalid_organization_role' using errcode = '23514';
  end if;

  select app_user.id
  into target_user_id
  from public.users app_user
  where lower(app_user.email) = lower(btrim(target_email))
  limit 1;

  if target_user_id is null then
    raise exception 'user_not_found' using errcode = '23503';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (target_organization_id, target_user_id, target_role)
  on conflict (organization_id, user_id) do update
  set role = excluded.role
  returning * into inserted_membership;

  return inserted_membership;
end;
$$;

revoke all on function private.add_organization_member_by_email(uuid, text, text)
from public, anon;
grant execute on function private.add_organization_member_by_email(uuid, text, text)
to authenticated;

create or replace function private.add_team_edge(
  target_organization_id uuid,
  target_parent_team_id uuid,
  target_child_team_id uuid
)
returns public.team_edges
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_edge public.team_edges;
begin
  if not private.has_administrative_permission(
    target_organization_id,
    'structure.manage'
  ) then
    raise exception 'organization_admin_required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert-team-dag:' || target_organization_id::text,
      0
    )
  );

  insert into private.team_graph_revisions (organization_id, revision)
  values (target_organization_id, 1)
  on conflict (organization_id) do update
  set revision = private.team_graph_revisions.revision + 1;

  if private.team_edge_would_create_cycle(
    target_organization_id,
    target_parent_team_id,
    target_child_team_id
  ) then
    raise exception 'team_edge_would_create_cycle'
      using errcode = '23514', constraint = 'team_edges_acyclic';
  end if;

  insert into public.team_edges (
    organization_id,
    parent_team_id,
    child_team_id
  )
  values (
    target_organization_id,
    target_parent_team_id,
    target_child_team_id
  )
  returning * into inserted_edge;

  return inserted_edge;
end;
$$;

revoke all on function private.add_team_edge(uuid, uuid, uuid)
from public, anon;
grant execute on function private.add_team_edge(uuid, uuid, uuid)
to authenticated;

-- A global structure administrator needs read policies too: PostgreSQL applies
-- SELECT policy visibility to UPDATE targets. Scoped team/facility
-- administrators retain their narrower authority.
drop policy if exists "scoped members can view teams" on public.teams;
drop policy if exists "organization admins can insert teams" on public.teams;
drop policy if exists "organization or team admins can update teams" on public.teams;
drop policy if exists "organization admins can delete teams" on public.teams;

create policy "structure readers can view teams"
  on public.teams for select to authenticated
  using (
    (select private.has_administrative_permission(
      organization_id,
      'structure.read'
    ))
    or (select private.can_view_team(organization_id, id))
  );

create policy "structure managers can insert teams"
  on public.teams for insert to authenticated
  with check ((select private.has_administrative_permission(
    organization_id,
    'structure.manage'
  )));

create policy "structure or scoped team admins can update teams"
  on public.teams for update to authenticated
  using (
    (select private.has_administrative_permission(
      organization_id,
      'structure.manage'
    ))
    or (select private.is_team_admin(organization_id, id))
  )
  with check (
    (select private.has_administrative_permission(
      organization_id,
      'structure.manage'
    ))
    or (select private.is_team_admin(organization_id, id))
  );

create policy "structure managers can delete teams"
  on public.teams for delete to authenticated
  using ((select private.has_administrative_permission(
    organization_id,
    'structure.manage'
  )));

drop policy if exists "scoped members can view team edges" on public.team_edges;
drop policy if exists "admins can delete team edges" on public.team_edges;

create policy "structure readers can view team edges"
  on public.team_edges for select to authenticated
  using (
    (select private.has_administrative_permission(
      organization_id,
      'structure.read'
    ))
    or (select private.can_view_team(organization_id, parent_team_id))
    or (select private.can_view_team(organization_id, child_team_id))
  );

create policy "structure managers can delete team edges"
  on public.team_edges for delete to authenticated
  using ((select private.has_administrative_permission(
    organization_id,
    'structure.manage'
  )));

drop policy if exists "scoped members can view facilities" on public.facilities;
drop policy if exists "organization admins can create facilities" on public.facilities;
drop policy if exists "facility admins can update facilities" on public.facilities;
drop policy if exists "organization admins can delete facilities" on public.facilities;

create policy "structure readers can view facilities"
  on public.facilities for select to authenticated
  using (
    (select private.has_administrative_permission(
      organization_id,
      'structure.read'
    ))
    or (select private.can_view_facility(organization_id, id))
  );

create policy "structure managers can create facilities"
  on public.facilities for insert to authenticated
  with check ((select private.has_administrative_permission(
    organization_id,
    'structure.manage'
  )));

create policy "structure or scoped facility admins can update facilities"
  on public.facilities for update to authenticated
  using (
    (select private.has_administrative_permission(
      organization_id,
      'structure.manage'
    ))
    or (select private.is_facility_admin(organization_id, id))
  )
  with check (
    (select private.has_administrative_permission(
      organization_id,
      'structure.manage'
    ))
    or (select private.is_facility_admin(organization_id, id))
  );

create policy "structure managers can delete facilities"
  on public.facilities for delete to authenticated
  using ((select private.has_administrative_permission(
    organization_id,
    'structure.manage'
  )));

drop policy if exists mortgage_capacity_settings_admin_insert
  on public.mortgage_capacity_settings;
drop policy if exists mortgage_capacity_settings_admin_update
  on public.mortgage_capacity_settings;
drop policy if exists mortgage_capacity_settings_admin_delete
  on public.mortgage_capacity_settings;

create policy mortgage_capacity_settings_configuration_insert
  on public.mortgage_capacity_settings for insert to authenticated
  with check ((select private.has_administrative_permission(
    organization_id,
    'crm.configuration.manage'
  )));

create policy mortgage_capacity_settings_configuration_update
  on public.mortgage_capacity_settings for update to authenticated
  using ((select private.has_administrative_permission(
    organization_id,
    'crm.configuration.manage'
  )))
  with check ((select private.has_administrative_permission(
    organization_id,
    'crm.configuration.manage'
  )));

create policy mortgage_capacity_settings_configuration_delete
  on public.mortgage_capacity_settings for delete to authenticated
  using ((select private.has_administrative_permission(
    organization_id,
    'crm.configuration.manage'
  )));

-- Consent managers may author versions, while publication remains a separate,
-- short-lived direct grant checked both in the RPC and at the version RLS
-- boundary.
drop policy if exists crm_consent_definitions_admin_insert
  on public.crm_consent_definitions;
drop policy if exists crm_consent_definitions_admin_update
  on public.crm_consent_definitions;
drop policy if exists crm_consent_versions_admin_insert
  on public.crm_consent_definition_versions;

create policy crm_consent_definitions_manager_insert
  on public.crm_consent_definitions for insert to authenticated
  with check ((select private.has_administrative_permission(
    organization_id,
    'compliance.consents.definitions.manage'
  )));

create policy crm_consent_definitions_manager_update
  on public.crm_consent_definitions for update to authenticated
  using ((select private.has_administrative_permission(
    organization_id,
    'compliance.consents.definitions.manage'
  )))
  with check ((select private.has_administrative_permission(
    organization_id,
    'compliance.consents.definitions.manage'
  )));

create policy crm_consent_versions_manager_insert
  on public.crm_consent_definition_versions for insert to authenticated
  with check (
    (select private.has_administrative_permission(
      organization_id,
      'compliance.consents.definitions.manage'
    ))
    and (
      status <> 'published'
      or (select private.has_administrative_permission(
        organization_id,
        'compliance.consents.definitions.publish'
      ))
    )
  );

create or replace function public.create_crm_consent_definition(
  p_organization_id uuid,
  p_code text,
  p_internal_name text,
  p_display_title text,
  p_content text,
  p_purpose text,
  p_channel text,
  p_legal_basis text,
  p_is_required boolean,
  p_status text,
  p_sort_order integer,
  p_language_code text,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_change_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_definition_id uuid := gen_random_uuid();
  new_version_id uuid := gen_random_uuid();
begin
  if not private.has_administrative_permission(
    p_organization_id,
    'compliance.consents.definitions.manage'
  ) then
    raise exception 'organization_admin_required' using errcode = '42501';
  end if;

  if p_status = 'published'
    and not private.has_administrative_permission(
      p_organization_id,
      'compliance.consents.definitions.publish'
    )
  then
    raise exception 'consent_definition_publish_grant_required'
      using errcode = '42501';
  end if;

  insert into public.crm_consent_definitions (
    id,
    organization_id,
    code,
    context,
    current_version_id,
    created_by_user_id,
    updated_by_user_id
  ) values (
    new_definition_id,
    p_organization_id,
    p_code,
    'client_creation',
    new_version_id,
    (select auth.uid()),
    (select auth.uid())
  );

  insert into public.crm_consent_definition_versions (
    id,
    organization_id,
    definition_id,
    version,
    internal_name,
    display_title,
    content,
    purpose,
    channel,
    legal_basis,
    is_required,
    status,
    sort_order,
    language_code,
    effective_from,
    effective_to,
    change_note,
    created_by_user_id
  ) values (
    new_version_id,
    p_organization_id,
    new_definition_id,
    1,
    p_internal_name,
    p_display_title,
    p_content,
    p_purpose,
    p_channel,
    p_legal_basis,
    coalesce(p_is_required, false),
    p_status,
    p_sort_order,
    p_language_code,
    coalesce(p_effective_from, now()),
    p_effective_to,
    p_change_note,
    (select auth.uid())
  );

  return new_definition_id;
end;
$$;

create or replace function public.update_crm_consent_definition(
  p_definition_id uuid,
  p_organization_id uuid,
  p_internal_name text,
  p_display_title text,
  p_content text,
  p_purpose text,
  p_channel text,
  p_legal_basis text,
  p_is_required boolean,
  p_status text,
  p_sort_order integer,
  p_language_code text,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_change_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_definition public.crm_consent_definitions;
  previous_version integer;
  new_version_id uuid := gen_random_uuid();
begin
  if not private.has_administrative_permission(
    p_organization_id,
    'compliance.consents.definitions.manage'
  ) then
    raise exception 'organization_admin_required' using errcode = '42501';
  end if;

  if p_status = 'published'
    and not private.has_administrative_permission(
      p_organization_id,
      'compliance.consents.definitions.publish'
    )
  then
    raise exception 'consent_definition_publish_grant_required'
      using errcode = '42501';
  end if;

  select definition.*
  into target_definition
  from public.crm_consent_definitions definition
  where definition.organization_id = p_organization_id
    and definition.id = p_definition_id
  for update;

  if not found then
    raise exception 'consent_definition_not_found' using errcode = 'P0002';
  end if;

  select consent_version.version
  into previous_version
  from public.crm_consent_definition_versions consent_version
  where consent_version.organization_id = p_organization_id
    and consent_version.definition_id = p_definition_id
    and consent_version.id = target_definition.current_version_id;

  insert into public.crm_consent_definition_versions (
    id,
    organization_id,
    definition_id,
    version,
    internal_name,
    display_title,
    content,
    purpose,
    channel,
    legal_basis,
    is_required,
    status,
    sort_order,
    language_code,
    effective_from,
    effective_to,
    change_note,
    created_by_user_id
  ) values (
    new_version_id,
    p_organization_id,
    p_definition_id,
    previous_version + 1,
    p_internal_name,
    p_display_title,
    p_content,
    p_purpose,
    p_channel,
    p_legal_basis,
    coalesce(p_is_required, false),
    p_status,
    p_sort_order,
    p_language_code,
    coalesce(p_effective_from, now()),
    p_effective_to,
    p_change_note,
    (select auth.uid())
  );

  update public.crm_consent_definitions
  set current_version_id = new_version_id,
      updated_by_user_id = (select auth.uid())
  where organization_id = p_organization_id
    and id = p_definition_id;

  return new_version_id;
end;
$$;

revoke all on function public.create_crm_consent_definition(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  text
)
from public, anon;
grant execute on function public.create_crm_consent_definition(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  text
)
to authenticated;

revoke all on function public.update_crm_consent_definition(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  text
)
from public, anon;
grant execute on function public.update_crm_consent_definition(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  text
)
to authenticated;

-- Team and facility membership audit is written by a trigger so the structure
-- mutation and its evidence either commit together or both roll back.
create or replace function private.audit_structure_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  organization_id_value uuid;
  target_user_id_value uuid;
  resource_id_value uuid;
  resource_label_value text;
  resource_type_value text;
  event_type_value text;
  row_before jsonb;
  row_after jsonb;
  changes_value jsonb := '[]'::jsonb;
  actor_snapshot_value jsonb;
  target_snapshot_value jsonb;
begin
  if actor_user_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    row_after := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    row_before := to_jsonb(old);
  else
    row_before := to_jsonb(old);
    row_after := to_jsonb(new);
  end if;

  organization_id_value := (
    coalesce(row_after, row_before) ->> 'organization_id'
  )::uuid;
  target_user_id_value := (
    coalesce(row_after, row_before) ->> 'user_id'
  )::uuid;

  if tg_table_name = 'team_memberships' then
    resource_type_value := 'team_membership';
    resource_id_value := (
      coalesce(row_after, row_before) ->> 'team_id'
    )::uuid;
    event_type_value := case tg_op
      when 'INSERT' then 'team_membership_added'
      when 'DELETE' then 'team_membership_removed'
      else 'team_membership_updated'
    end;

    select team.name
    into resource_label_value
    from public.teams team
    where team.organization_id = organization_id_value
      and team.id = resource_id_value;

    if row_before -> 'role' is distinct from row_after -> 'role' then
      changes_value := changes_value || jsonb_build_array(
        jsonb_build_object(
          'field', 'role',
          'before', row_before -> 'role',
          'after', row_after -> 'role'
        )
      );
    end if;
  elsif tg_table_name = 'facility_memberships' then
    resource_type_value := 'facility_membership';
    resource_id_value := (
      coalesce(row_after, row_before) ->> 'facility_id'
    )::uuid;
    event_type_value := case tg_op
      when 'INSERT' then 'facility_membership_added'
      when 'DELETE' then 'facility_membership_removed'
      else 'facility_membership_updated'
    end;

    select facility.name
    into resource_label_value
    from public.facilities facility
    where facility.organization_id = organization_id_value
      and facility.id = resource_id_value;

    if row_before -> 'role' is distinct from row_after -> 'role' then
      changes_value := changes_value || jsonb_build_array(
        jsonb_build_object(
          'field', 'role',
          'before', row_before -> 'role',
          'after', row_after -> 'role'
        )
      );
    end if;

    if row_before -> 'is_bookable'
      is distinct from row_after -> 'is_bookable'
    then
      changes_value := changes_value || jsonb_build_array(
        jsonb_build_object(
          'field', 'isBookable',
          'before', row_before -> 'is_bookable',
          'after', row_after -> 'is_bookable'
        )
      );
    end if;

    if row_before -> 'booking_priority'
      is distinct from row_after -> 'booking_priority'
    then
      changes_value := changes_value || jsonb_build_array(
        jsonb_build_object(
          'field', 'bookingPriority',
          'before', row_before -> 'booking_priority',
          'after', row_after -> 'booking_priority'
        )
      );
    end if;
  else
    raise exception 'unsupported_structure_membership_audit_table'
      using errcode = '55000';
  end if;

  if changes_value = '[]'::jsonb then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select jsonb_build_object(
    'userId', actor.id,
    'fullName', coalesce(actor.full_name, actor.email),
    'email', actor.email,
    'avatarUrl', actor.avatar_url
  )
  into actor_snapshot_value
  from public.users actor
  where actor.id = actor_user_id;

  select jsonb_build_object(
    'userId', target.id,
    'fullName', coalesce(target.full_name, target.email),
    'email', target.email,
    'avatarUrl', target.avatar_url
  )
  into target_snapshot_value
  from public.users target
  where target.id = target_user_id_value;

  -- Cascading public.users deletion must not be blocked by the audit table's
  -- target-user FK. In that path the target row is already unavailable; the
  -- dedicated user-removal workflow owns that evidence.
  if target_snapshot_value is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  insert into public.organization_user_audit_events (
    organization_id,
    target_user_id,
    actor_user_id,
    actor_snapshot,
    target_snapshot,
    event_type,
    resource_type,
    resource_id,
    resource_label,
    changes,
    reason,
    source
  )
  values (
    organization_id_value,
    target_user_id_value,
    actor_user_id,
    coalesce(
      actor_snapshot_value,
      jsonb_build_object('userId', actor_user_id)
    ),
    coalesce(
      target_snapshot_value,
      jsonb_build_object('userId', target_user_id_value)
    ),
    event_type_value,
    resource_type_value,
    resource_id_value::text,
    coalesce(resource_label_value, resource_type_value),
    changes_value,
    'Zmieniono przypisanie użytkownika w strukturze organizacji.',
    'structure_management'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_structure_membership_change()
from public, anon, authenticated;

drop trigger if exists team_memberships_audit_structure_change
  on public.team_memberships;
drop trigger if exists team_memberships_audit_structure_delete
  on public.team_memberships;
create trigger team_memberships_audit_structure_change
  after insert or update of role on public.team_memberships
  for each row execute function private.audit_structure_membership_change();
create trigger team_memberships_audit_structure_delete
  before delete on public.team_memberships
  for each row execute function private.audit_structure_membership_change();

drop trigger if exists facility_memberships_audit_structure_change
  on public.facility_memberships;
drop trigger if exists facility_memberships_audit_structure_delete
  on public.facility_memberships;
create trigger facility_memberships_audit_structure_change
  after insert or update of role, is_bookable, booking_priority
  on public.facility_memberships
  for each row execute function private.audit_structure_membership_change();
create trigger facility_memberships_audit_structure_delete
  before delete on public.facility_memberships
  for each row execute function private.audit_structure_membership_change();

-- Execute one approved erasure request in a single transaction. The RPC is the
-- only write surface: direct table grants remain read-only, and a grant is
-- consumed in the same commit as the scrub and both audit records.
create or replace function public.execute_crm_client_anonymization_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_grant_id uuid,
  p_expected_revision bigint,
  p_idempotency_key uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  actor_snapshot jsonb;
  grant_row public.crm_client_anonymization_execution_grants%rowtype;
  request_row public.crm_client_anonymization_requests%rowtype;
  client_row public.crm_clients%rowtype;
  previous_command private.organization_admin_access_commands%rowtype;
  request_fingerprint text;
  response_payload jsonb;
  audit_event_id uuid;
  execution_timestamp timestamptz;
  case_ids uuid[] := array[]::uuid[];
  item_ids uuid[] := array[]::uuid[];
  submission_ids uuid[] := array[]::uuid[];
  property_ids uuid[] := array[]::uuid[];
  task_ids uuid[] := array[]::uuid[];
  appointment_ids uuid[] := array[]::uuid[];
  document_count integer := 0;
  property_image_count integer := 0;
  offer_snapshot_count integer := 0;
  account_link_count integer := 0;
  consent_event_count integer := 0;
  person_count integer := 0;
  appointment_count integer := 0;
  case_count integer := 0;
  item_count integer := 0;
  submission_count integer := 0;
  settlement_count integer := 0;
  property_count integer := 0;
  task_count integer := 0;
  activity_count integer := 0;
  original_jwt_sub text;
  original_jwt_claims text;
begin
  if actor_user_id is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'userId', actor.id,
    'fullName', coalesce(actor.full_name, actor.email),
    'email', actor.email,
    'avatarUrl', actor.avatar_url
  )
  into actor_snapshot
  from public.users actor
  where actor.id = actor_user_id;

  actor_snapshot := coalesce(
    actor_snapshot,
    jsonb_build_object('userId', actor_user_id)
  );

  if p_confirmation is distinct from 'ANONIMIZUJ' then
    raise exception 'anonymization_confirmation_invalid'
      using errcode = '22023';
  end if;

  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'anonymization_grant_revision_invalid'
      using errcode = '22023';
  end if;

  if p_idempotency_key is null then
    raise exception 'anonymization_execution_idempotency_key_required'
      using errcode = '22023';
  end if;

  request_fingerprint := pg_catalog.md5(
    jsonb_build_object(
      'requestId', p_request_id,
      'grantId', p_grant_id,
      'expectedRevision', p_expected_revision,
      'confirmation', p_confirmation
    )::text
  );

  -- Serialize retries before reading the command log. A concurrent retry waits
  -- and then returns the first committed response instead of observing a
  -- consumed grant as an unrelated error.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert-anonymization-execution:'
        || p_organization_id::text
        || ':'
        || p_idempotency_key::text,
      0
    )
  );

  select *
  into previous_command
  from private.organization_admin_access_commands command
  where command.organization_id = p_organization_id
    and command.idempotency_key = p_idempotency_key;

  if found then
    if previous_command.actor_user_id <> actor_user_id
      or previous_command.target_user_id <> actor_user_id
      or previous_command.command_type <> 'execute_client_anonymization'
      or previous_command.request_fingerprint <> request_fingerprint
    then
      raise exception 'administrative_access_idempotency_conflict'
        using errcode = '23505';
    end if;

    return jsonb_set(
      previous_command.response,
      '{data,replayed}',
      'true'::jsonb,
      true
    );
  end if;

  -- All grant mutations lock grant then request. Keeping that order avoids a
  -- deadlock with approval/revocation while making grant consumption atomic.
  select execution_grant.*
  into grant_row
  from public.crm_client_anonymization_execution_grants execution_grant
  where execution_grant.organization_id = p_organization_id
    and execution_grant.id = p_grant_id
    and execution_grant.request_id = p_request_id
  for update;

  if not found then
    raise exception 'anonymization_grant_not_found'
      using errcode = 'P0002';
  end if;

  if grant_row.grantee_user_id <> actor_user_id
    or grant_row.permission_key <> 'clients.anonymization.execute'
  then
    raise exception 'anonymization_execution_forbidden'
      using errcode = '42501';
  end if;

  if grant_row.revision <> p_expected_revision then
    raise exception 'administrative_access_revision_conflict'
      using
        errcode = '40001',
        detail = jsonb_build_object(
          'expectedRevision', p_expected_revision,
          'currentRevision', grant_row.revision
        )::text;
  end if;

  if grant_row.status <> 'active'
    or grant_row.approved_at is null
    or grant_row.consumed_at is not null
    or grant_row.expires_at <= statement_timestamp()
  then
    raise exception 'anonymization_grant_not_active'
      using errcode = '23514';
  end if;

  select anonymization_request.*
  into request_row
  from public.crm_client_anonymization_requests anonymization_request
  where anonymization_request.organization_id = p_organization_id
    and anonymization_request.id = p_request_id
  for update;

  if not found then
    raise exception 'anonymization_request_not_found'
      using errcode = 'P0002';
  end if;

  if request_row.status <> 'approved'
    or request_row.identity_verified_at is null
    or request_row.approved_at is null
  then
    raise exception 'anonymization_request_not_executable'
      using errcode = '23514';
  end if;

  select client.*
  into client_row
  from public.crm_clients client
  where client.organization_id = p_organization_id
    and client.id = request_row.client_id
  for update;

  if not found then
    raise exception 'anonymization_client_not_found'
      using errcode = 'P0002';
  end if;

  -- Lock the relationship spine in deterministic identifier order. These row
  -- locks also conflict with the FK key-share locks required by a concurrent
  -- insert, so no new linked PII row can appear after the retention check.
  perform 1
  from public.crm_case_clients case_client
  where case_client.organization_id = p_organization_id
    and case_client.client_id = request_row.client_id
  order by case_client.case_id
  for update;

  select coalesce(
    array_agg(locked_case.id order by locked_case.id),
    array[]::uuid[]
  )
  into case_ids
  from (
    select crm_case.id
    from public.crm_cases crm_case
    where crm_case.organization_id = p_organization_id
      and (
        crm_case.client_id = request_row.client_id
        or exists (
          select 1
          from public.crm_case_clients case_client
          where case_client.organization_id = p_organization_id
            and case_client.case_id = crm_case.id
            and case_client.client_id = request_row.client_id
        )
      )
    order by crm_case.id
    for update
  ) locked_case;

  select coalesce(
    array_agg(locked_item.id order by locked_item.id),
    array[]::uuid[]
  )
  into item_ids
  from (
    select item.id
    from public.crm_case_items item
    where item.organization_id = p_organization_id
      and item.case_id = any(case_ids)
    order by item.id
    for update
  ) locked_item;

  select coalesce(
    array_agg(locked_submission.id order by locked_submission.id),
    array[]::uuid[]
  )
  into submission_ids
  from (
    select submission.id
    from public.crm_item_submissions submission
    where submission.organization_id = p_organization_id
      and submission.case_item_id = any(item_ids)
    order by submission.id
    for update
  ) locked_submission;

  select coalesce(
    array_agg(locked_property.id order by locked_property.id),
    array[]::uuid[]
  )
  into property_ids
  from (
    select property.id
    from public.crm_properties property
    where property.organization_id = p_organization_id
      and (
        property.case_id = any(case_ids)
        or property.case_item_id = any(item_ids)
      )
    order by property.id
    for update
  ) locked_property;

  select coalesce(
    array_agg(locked_task.id order by locked_task.id),
    array[]::uuid[]
  )
  into task_ids
  from (
    select task.id
    from public.crm_tasks task
    where task.organization_id = p_organization_id
      and (
        task.client_id = request_row.client_id
        or task.case_id = any(case_ids)
        or task.case_item_id = any(item_ids)
      )
    order by task.id
    for update
  ) locked_task;

  select coalesce(
    array_agg(locked_appointment.id order by locked_appointment.id),
    array[]::uuid[]
  )
  into appointment_ids
  from (
    select appointment.id
    from public.appointments appointment
    where appointment.organization_id = p_organization_id
      and (
        appointment.client_id = request_row.client_id
        or appointment.crm_task_id = any(task_ids)
      )
    order by appointment.id
    for update
  ) locked_appointment;

  select count(*)
  into document_count
  from public.crm_documents document
  where document.organization_id = p_organization_id
    and (
      document.client_id = request_row.client_id
      or document.case_id = any(case_ids)
      or document.case_item_id = any(item_ids)
      or document.submission_id = any(submission_ids)
    );

  select count(*)
  into property_image_count
  from public.crm_property_images property_image
  where property_image.organization_id = p_organization_id
    and (
      property_image.case_id = any(case_ids)
      or property_image.property_id = any(property_ids)
    );

  select count(*)
  into offer_snapshot_count
  from public.crm_case_offer_snapshots offer_snapshot
  where offer_snapshot.organization_id = p_organization_id
    and offer_snapshot.case_id = any(case_ids);

  if document_count > 0
    or property_image_count > 0
    or offer_snapshot_count > 0
  then
    raise exception 'anonymization_documents_require_manual_retention_review'
      using
        errcode = '23514',
        detail = jsonb_build_object(
          'documentCount', document_count,
          'propertyImageCount', property_image_count,
          'offerSnapshotCount', offer_snapshot_count
        )::text;
  end if;

  execution_timestamp := statement_timestamp();

  -- Stored idempotency responses for grant lifecycle commands used to include
  -- the client's display name. Replace only that nested client snapshot before
  -- the source row itself is scrubbed.
  update private.organization_admin_access_commands command
  set response = jsonb_set(
    command.response,
    '{data,request,client}',
    jsonb_build_object(
      'id', request_row.client_id,
      'displayName', 'Klient zanonimizowany'
    ),
    false
  )
  where command.organization_id = p_organization_id
    and command.response #>> '{data,request,id}' = p_request_id::text;

  delete from public.client_account_links account_link
  where account_link.organization_id = p_organization_id
    and account_link.client_id = request_row.client_id;
  get diagnostics account_link_count = row_count;

  update public.crm_client_consent_events consent_event
  set
    contact_value = null,
    evidence_reference = null,
    metadata = '{}'::jsonb
  where consent_event.organization_id = p_organization_id
    and consent_event.client_id = request_row.client_id;
  get diagnostics consent_event_count = row_count;

  update public.appointments appointment
  set
    customer_name = 'Klient zanonimizowany',
    customer_email = null,
    customer_phone = null,
    notes = null,
    cancellation_reason = null,
    meeting_url = null,
    idempotency_key = null,
    request_fingerprint = null,
    booking_context = '{}'::jsonb,
    manage_token = gen_random_uuid()
  where appointment.organization_id = p_organization_id
    and appointment.id = any(appointment_ids);
  get diagnostics appointment_count = row_count;

  update public.crm_client_people person
  set
    first_name = null,
    last_name = null,
    display_name = 'Osoba zanonimizowana',
    email = null,
    phone = null,
    pesel = null,
    date_of_birth = null,
    metadata = '{}'::jsonb
  where person.organization_id = p_organization_id
    and person.client_id = request_row.client_id;
  get diagnostics person_count = row_count;

  update public.crm_cases crm_case
  set
    title = 'Sprawa zanonimizowana',
    description = null,
    metadata = '{}'::jsonb
  where crm_case.organization_id = p_organization_id
    and crm_case.id = any(case_ids);
  get diagnostics case_count = row_count;

  update public.crm_case_items item
  set
    title = 'Produkt zanonimizowany',
    metadata = '{}'::jsonb
  where item.organization_id = p_organization_id
    and item.id = any(item_ids);
  get diagnostics item_count = row_count;

  update public.crm_item_submissions submission
  set
    external_reference = null,
    notes = null,
    metadata = '{}'::jsonb
  where submission.organization_id = p_organization_id
    and submission.id = any(submission_ids);
  get diagnostics submission_count = row_count;

  update public.crm_case_item_settlements settlement
  set
    notes = null,
    metadata = '{}'::jsonb
  where settlement.organization_id = p_organization_id
    and settlement.case_item_id = any(item_ids);
  get diagnostics settlement_count = row_count;

  update public.crm_properties property
  set
    address = 'Adres zanonimizowany',
    city = null,
    postal_code = null,
    listing_title = null,
    description = null,
    source_url = null,
    metadata = '{}'::jsonb
  where property.organization_id = p_organization_id
    and property.id = any(property_ids);
  get diagnostics property_count = row_count;

  -- Delegated-task validation treats auth.uid() = NULL as a trusted internal
  -- maintenance path. Blank both JWT settings only around this update, then
  -- restore them before writing the compliance events as the real actor.
  original_jwt_sub := pg_catalog.current_setting(
    'request.jwt.claim.sub',
    true
  );
  original_jwt_claims := pg_catalog.current_setting(
    'request.jwt.claims',
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);

  update public.crm_tasks task
  set
    title = 'Zadanie zanonimizowane',
    description = null,
    rejection_reason = case
      when task.delegation_status = 'rejected'
        then 'Powód zanonimizowany.'
      else null
    end,
    metadata = '{}'::jsonb
  where task.organization_id = p_organization_id
    and task.id = any(task_ids);
  get diagnostics task_count = row_count;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    coalesce(original_jwt_sub, ''),
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claims',
    coalesce(original_jwt_claims, ''),
    true
  );

  -- Run this after task updates because their audit trigger may create linked
  -- activities containing the pre-anonymization task title or reason.
  update public.crm_activities activity
  set
    title = 'Aktywność zanonimizowana',
    body = null,
    payload = '{}'::jsonb
  where activity.organization_id = p_organization_id
    and (
      activity.client_id = request_row.client_id
      or activity.case_id = any(case_ids)
      or activity.case_item_id = any(item_ids)
      or activity.submission_id = any(submission_ids)
      or activity.task_id = any(task_ids)
    );
  get diagnostics activity_count = row_count;

  update public.crm_clients client
  set
    display_name = 'Klient zanonimizowany',
    status_code = 'anonymized',
    primary_email = null,
    primary_phone = null,
    tags = array[]::text[],
    notes = null,
    metadata = '{}'::jsonb
  where client.organization_id = p_organization_id
    and client.id = request_row.client_id;

  update public.crm_client_anonymization_requests anonymization_request
  set
    status = 'completed',
    justification =
      'Żądanie zrealizowane przez kontrolowaną anonimizację danych klienta.',
    review_note = null,
    completed_at = execution_timestamp,
    completed_by_user_id = actor_user_id,
    metadata = '{}'::jsonb
  where anonymization_request.organization_id = p_organization_id
    and anonymization_request.id = p_request_id
  returning *
  into request_row;

  update public.crm_client_anonymization_execution_grants execution_grant
  set
    status = 'consumed',
    justification =
      'Jednorazowy grant wykonania anonimizacji danych klienta.',
    decision_reason =
      'Grant zatwierdzony i wykorzystany do wykonania anonimizacji.',
    consumed_at = execution_timestamp,
    consumed_by_user_id = actor_user_id,
    revision = revision + 1
  where execution_grant.organization_id = p_organization_id
    and execution_grant.id = p_grant_id
    and execution_grant.status = 'active'
    and execution_grant.revision = p_expected_revision
  returning *
  into grant_row;

  if not found then
    raise exception 'administrative_access_revision_conflict'
      using errcode = '40001';
  end if;

  insert into public.crm_client_anonymization_request_events (
    organization_id,
    request_id,
    event_type,
    from_status,
    to_status,
    actor_user_id,
    reason_code,
    evidence_reference
  )
  values (
    p_organization_id,
    p_request_id,
    'completed',
    'approved',
    'completed',
    actor_user_id,
    'approved_single_use_grant_executed',
    'grant:' || p_grant_id::text
  );

  insert into public.organization_user_audit_events (
    organization_id,
    target_user_id,
    actor_user_id,
    actor_snapshot,
    target_snapshot,
    event_type,
    resource_type,
    resource_id,
    resource_label,
    changes,
    reason,
    source,
    correlation_id,
    revision_before,
    revision_after
  )
  values (
    p_organization_id,
    actor_user_id,
    actor_user_id,
    actor_snapshot,
    actor_snapshot,
    'client_anonymization_executed',
    'crm_client_anonymization_request',
    p_request_id::text,
    request_row.request_number,
    jsonb_build_array(
      jsonb_build_object(
        'field', 'requestStatus',
        'before', 'approved',
        'after', 'completed'
      ),
      jsonb_build_object(
        'field', 'grantStatus',
        'before', 'active',
        'after', 'consumed'
      ),
      jsonb_build_object(
        'field', 'anonymizedRecords',
        'before', null,
        'after', jsonb_build_object(
          'accountLinks', account_link_count,
          'consentEvents', consent_event_count,
          'people', person_count,
          'appointments', appointment_count,
          'cases', case_count,
          'items', item_count,
          'submissions', submission_count,
          'settlements', settlement_count,
          'properties', property_count,
          'tasks', task_count,
          'activities', activity_count
        )
      )
    ),
    'Wykonano zatwierdzoną anonimizację przy użyciu jednorazowego grantu.',
    'privacy_execution',
    p_idempotency_key,
    p_expected_revision,
    grant_row.revision
  )
  returning id into audit_event_id;

  response_payload := jsonb_build_object(
    'data', jsonb_build_object(
      'request', jsonb_build_object(
        'id', request_row.id,
        'requestNumber', request_row.request_number,
        'status', request_row.status,
        'completedAt', request_row.completed_at
      ),
      'grant', jsonb_build_object(
        'id', grant_row.id,
        'status', grant_row.status,
        'revision', grant_row.revision,
        'consumedAt', grant_row.consumed_at
      ),
      'anonymized', jsonb_build_object(
        'clientId', request_row.client_id,
        'records', jsonb_build_object(
          'accountLinks', account_link_count,
          'consentEvents', consent_event_count,
          'people', person_count,
          'appointments', appointment_count,
          'cases', case_count,
          'items', item_count,
          'submissions', submission_count,
          'settlements', settlement_count,
          'properties', property_count,
          'tasks', task_count,
          'activities', activity_count
        )
      ),
      'replayed', false,
      'auditEventId', audit_event_id
    )
  );

  insert into private.organization_admin_access_commands (
    organization_id,
    idempotency_key,
    actor_user_id,
    target_user_id,
    command_type,
    request_fingerprint,
    response
  )
  values (
    p_organization_id,
    p_idempotency_key,
    actor_user_id,
    actor_user_id,
    'execute_client_anonymization',
    request_fingerprint,
    response_payload
  );

  return response_payload;
end;
$$;

revoke all on function public.execute_crm_client_anonymization_request(
  uuid,
  uuid,
  uuid,
  bigint,
  uuid,
  text
)
from public, anon, authenticated;
grant execute on function public.execute_crm_client_anonymization_request(
  uuid,
  uuid,
  uuid,
  bigint,
  uuid,
  text
)
to authenticated;

comment on function public.execute_crm_client_anonymization_request(
  uuid,
  uuid,
  uuid,
  bigint,
  uuid,
  text
) is
  'Atomically executes one approved client anonymization request using an active, unexpired, single-use grant held by the authenticated grantee.';
