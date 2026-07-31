-- Generated PostgreSQL 17.6 baseline for the application public/private
-- schemas. Provider-owned schemas, ownership, and ACL statements are replaced
-- by the portable bootstrap and follow-up migrations in this directory.
--
-- PostgreSQL database dump

\restrict ZT8nAR96TTjvtLhJtM7AkaGSovb0iUb6nb7eU4XoJOVTnHl3wO3iJtHT3avWocl

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: organization_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_memberships (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'expert'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_memberships_role_check CHECK ((role = ANY (ARRAY['expert'::text, 'admin'::text])))
);


--
-- Name: add_organization_member_by_email(uuid, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.add_organization_member_by_email(target_organization_id uuid, target_email text, target_role text DEFAULT 'expert'::text) RETURNS public.organization_memberships
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: team_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_edges (
    organization_id uuid NOT NULL,
    parent_team_id uuid NOT NULL,
    child_team_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_edges_no_self_reference CHECK ((parent_team_id <> child_team_id))
);


--
-- Name: add_team_edge(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.add_team_edge(target_organization_id uuid, target_parent_team_id uuid, target_child_team_id uuid) RETURNS public.team_edges
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: administrative_access_state_json(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.administrative_access_state_json(target_organization_id uuid, target_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: anonymization_execution_grant_state_json(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.anonymization_execution_grant_state_json(target_organization_id uuid, target_grant_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: assert_widget_origin_allowed(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.assert_widget_origin_allowed(target_widget_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  permitted_origins text[];
  request_origin text;
begin
  select widget.allowed_origins
  into strict permitted_origins
  from public.booking_widgets widget
  where widget.id = target_widget_id;

  request_origin := nullif(
    current_setting('request.headers', true)::jsonb ->> 'origin',
    ''
  );

  if cardinality(permitted_origins) > 0
     and request_origin is not null
     and not (request_origin = any(permitted_origins)) then
    raise exception 'booking_widget_origin_not_allowed' using errcode = '42501';
  end if;
end;
$$;


--
-- Name: audit_mortgage_bank_override(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.audit_mortgage_bank_override() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    insert into public.mortgage_bank_override_revisions (
      override_id, organization_id, bank_id, revision, action,
      is_enabled, custom_name, custom_website_url, logo_path, notes, changed_by
    ) values (
      null, old.organization_id, old.bank_id, old.revision + 1, 'reset',
      old.is_enabled, old.custom_name, old.custom_website_url, old.logo_path,
      old.notes, coalesce((select app.current_user_id()), old.updated_by)
    );
    return old;
  end if;

  insert into public.mortgage_bank_override_revisions (
    override_id, organization_id, bank_id, revision, action,
    is_enabled, custom_name, custom_website_url, logo_path, notes, changed_by
  ) values (
    new.id, new.organization_id, new.bank_id, new.revision,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    new.is_enabled, new.custom_name, new.custom_website_url, new.logo_path,
    new.notes, new.updated_by
  );
  return new;
end;
$$;


--
-- Name: audit_mortgage_capacity_settings(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.audit_mortgage_capacity_settings() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  source_row public.mortgage_capacity_settings%rowtype;
  audit_revision integer;
  audit_action text;
  actor_id uuid;
begin
  if tg_op = 'DELETE' then
    source_row := old;
    audit_revision := old.revision + 1;
    audit_action := 'reset';
    actor_id := coalesce((select app.current_user_id()), old.updated_by);
  else
    source_row := new;
    audit_revision := new.revision;
    audit_action := case when tg_op = 'INSERT' then 'created' else 'updated' end;
    actor_id := new.updated_by;
  end if;

  insert into public.mortgage_capacity_setting_revisions (
    organization_id,
    revision,
    action,
    settings,
    changed_by
  ) values (
    source_row.organization_id,
    audit_revision,
    audit_action,
    to_jsonb(source_row)
      - 'organization_id'
      - 'revision'
      - 'created_by'
      - 'updated_by'
      - 'created_at'
      - 'updated_at',
    actor_id
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: audit_mortgage_product_override(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.audit_mortgage_product_override() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    insert into public.mortgage_product_override_revisions (
      override_id, organization_id, product_id, revision, action,
      is_enabled, custom_name, parameters, notes, changed_by
    ) values (
      null, old.organization_id, old.product_id, old.revision + 1, 'reset',
      old.is_enabled, old.custom_name, old.parameters, old.notes,
      coalesce((select app.current_user_id()), old.updated_by)
    );
    return old;
  end if;

  insert into public.mortgage_product_override_revisions (
    override_id, organization_id, product_id, revision, action,
    is_enabled, custom_name, parameters, notes, changed_by
  ) values (
    new.id, new.organization_id, new.product_id, new.revision,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    new.is_enabled, new.custom_name, new.parameters, new.notes, new.updated_by
  );
  return new;
end;
$$;


--
-- Name: audit_structure_membership_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.audit_structure_membership_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
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


--
-- Name: can_access_crm_case_document(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_access_crm_case_document(object_name text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  path_parts text[];
  path_organization_id uuid;
  path_case_id uuid;
begin
  path_parts := app.storage_folder_segments(object_name);
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
     and membership.user_id = (select app.current_user_id())
    where crm_case.organization_id = path_organization_id
      and crm_case.id = path_case_id
  );
end;
$_$;


--
-- Name: can_access_crm_property_image(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_access_crm_property_image(object_name text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  path_parts text[];
  path_organization_id uuid;
  path_case_id uuid;
  path_property_id uuid;
begin
  path_parts := app.storage_folder_segments(object_name);
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
     and membership.user_id = (select app.current_user_id())
    where property.organization_id = path_organization_id
      and property.case_id = path_case_id
      and property.id = path_property_id
  );
end;
$_$;


--
-- Name: can_access_facility_image(text, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_access_facility_image(object_name text, require_manage boolean DEFAULT false) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  path_parts text[];
  path_organization_id uuid;
  path_facility_id uuid;
begin
  path_parts := app.storage_folder_segments(object_name);
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
$_$;


--
-- Name: can_manage_booking_widget(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_manage_booking_widget(target_organization_id uuid, target_facility_id uuid, target_fixed_expert_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(
    (select app.current_user_id()) is not null
      and (
        private.is_organization_admin(target_organization_id)
        or private.is_facility_admin(target_organization_id, target_facility_id)
        or (
          target_fixed_expert_user_id = (select app.current_user_id())
          and exists (
            select 1
            from public.facility_memberships membership
            where membership.organization_id = target_organization_id
              and membership.facility_id = target_facility_id
              and membership.user_id = (select app.current_user_id())
              and membership.is_bookable
          )
        )
      ),
    false
  );
$$;


--
-- Name: can_manage_mortgage_bank_logo(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_manage_mortgage_bank_logo(object_name text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.is_super_admin()
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.user_id = (select app.current_user_id())
        and membership.organization_id::text = (app.storage_folder_segments(object_name))[1]
    );
$$;


--
-- Name: can_view_facility(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_view_facility(target_organization_id uuid, target_facility_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.is_organization_admin(target_organization_id)
    or exists (
      select 1
      from public.facility_memberships membership
      where membership.organization_id = target_organization_id
        and membership.facility_id = target_facility_id
        and membership.user_id = (select app.current_user_id())
    )
    or exists (
      select 1
      from public.team_facilities link
      where link.organization_id = target_organization_id
        and link.facility_id = target_facility_id
        and private.can_view_team(link.organization_id, link.team_id)
    );
$$;


--
-- Name: can_view_team(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_view_team(target_organization_id uuid, target_team_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.is_organization_admin(target_organization_id)
    or exists (
      with recursive ancestors(team_id) as (
        select target_team_id

        union

        select edge.parent_team_id
        from public.team_edges edge
        join ancestors current_team
          on current_team.team_id = edge.child_team_id
        where edge.organization_id = target_organization_id
      )
      select 1
      from ancestors
      join public.team_memberships membership
        on membership.organization_id = target_organization_id
       and membership.team_id = ancestors.team_id
      where membership.user_id = (select app.current_user_id())
        and (
          ancestors.team_id = target_team_id
          or membership.role = 'admin'
        )
    );
$$;


--
-- Name: FUNCTION can_view_team(target_organization_id uuid, target_team_id uuid); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.can_view_team(target_organization_id uuid, target_team_id uuid) IS 'Organization admins see every team; members see direct teams and team admins also see descendants.';


--
-- Name: can_write_booking_widget(uuid, uuid, uuid, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.can_write_booking_widget(target_organization_id uuid, target_facility_id uuid, target_fixed_expert_user_id uuid, target_created_by_user_id uuid, target_booking_mode text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(
    (select app.current_user_id()) is not null
      and (
        private.is_organization_admin(target_organization_id)
        or private.is_facility_admin(target_organization_id, target_facility_id)
        or (
          target_fixed_expert_user_id = (select app.current_user_id())
          and target_created_by_user_id = (select app.current_user_id())
          and target_booking_mode = 'expert'
          and exists (
            select 1
            from public.facility_memberships membership
            where membership.organization_id = target_organization_id
              and membership.facility_id = target_facility_id
              and membership.user_id = (select app.current_user_id())
              and membership.is_bookable
          )
        )
      ),
    false
  );
$$;


--
-- Name: cancel_future_delegated_task_appointments(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.cancel_future_delegated_task_appointments() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  cancellation_actor_user_id uuid;
  cancelled_appointment public.appointments;
  task_cancellation_reason text;
  cancellation_title text;
  is_reassignment boolean;
  is_terminal_transition boolean;
begin
  is_reassignment :=
    new.assignee_user_id is distinct from old.assignee_user_id;
  is_terminal_transition :=
    new.delegation_status is distinct from old.delegation_status
    and new.delegation_status in ('rejected', 'cancelled');

  if not is_reassignment and not is_terminal_transition then
    return new;
  end if;

  if is_reassignment then
    task_cancellation_reason := 'delegated_task_reassigned';
    cancellation_title := 'Anulowano spotkanie po zmianie wykonawcy zadania';
  elsif new.delegation_status = 'rejected' then
    task_cancellation_reason := 'delegated_task_rejected';
    cancellation_title := 'Anulowano spotkanie po odrzuceniu zadania';
  else
    task_cancellation_reason := 'delegated_task_cancelled';
    cancellation_title := 'Anulowano spotkanie powiązane z zadaniem';
  end if;

  cancellation_actor_user_id := coalesce(
    (select app.current_user_id()),
    case
      when new.delegation_status = 'rejected' and not is_reassignment
        then new.assignee_user_id
      else new.delegator_user_id
    end,
    new.delegator_user_id,
    new.assignee_user_id
  );

  for cancelled_appointment in
    update public.appointments appointment
    set
      status = 'cancelled',
      hold_expires_at = null,
      cancelled_at = now(),
      cancellation_reason = task_cancellation_reason,
      updated_at = now()
    where appointment.organization_id = new.organization_id
      and appointment.crm_task_id = new.id
      and appointment.status in ('hold', 'confirmed')
      and appointment.starts_at > now()
    returning appointment.*
  loop
    insert into public.crm_activities (
      organization_id,
      actor_user_id,
      client_id,
      case_id,
      case_item_id,
      task_id,
      activity_type,
      title,
      body,
      payload
    ) values (
      new.organization_id,
      cancellation_actor_user_id,
      new.client_id,
      new.case_id,
      new.case_item_id,
      new.id,
      'task_appointment_cancelled',
      cancellation_title,
      new.title,
      jsonb_build_object(
        'task_id', new.id,
        'appointment_id', cancelled_appointment.id,
        'appointment_starts_at', cancelled_appointment.starts_at,
        'appointment_ends_at', cancelled_appointment.ends_at,
        'previous_assignee_user_id', old.assignee_user_id,
        'assignee_user_id', new.assignee_user_id,
        'reason', task_cancellation_reason
      )
    );
  end loop;

  return new;
end;
$$;


--
-- Name: close_other_crm_case_bank_applications(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.close_other_crm_case_bank_applications() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  update public.crm_item_submissions submission
  set status_code = 'wycofane',
      decision_at = coalesce(submission.decision_at, now()),
      metadata = submission.metadata || jsonb_build_object(
        'closureReason', 'contract_signed_elsewhere',
        'selectedApplicationId', new.application_id
      )
  from public.crm_case_bank_applications application
  where application.organization_id = new.organization_id
    and application.case_id = new.case_id
    and application.submission_id <> new.application_id
    and submission.organization_id = application.organization_id
    and submission.id = application.submission_id
    and submission.status_code in ('draft', 'wyslane', 'w_analizie', 'braki', 'zaakceptowane');

  return new;
end;
$$;


--
-- Name: create_organization_with_admin(text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.create_organization_with_admin(organization_name text, requested_full_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_user_id uuid := (select app.current_user_id());
  current_auth_user identity.users;
  new_organization_id uuid := gen_random_uuid();
  normalized_name text := nullif(btrim(organization_name), '');
  normalized_full_name text := nullif(btrim(requested_full_name), '');
  new_slug text;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if normalized_name is null or length(normalized_name) > 160 then
    raise exception 'invalid_organization_name' using errcode = '22023';
  end if;

  if normalized_full_name is not null and length(normalized_full_name) > 200 then
    raise exception 'invalid_full_name' using errcode = '22023';
  end if;

  if exists (select 1 from public.users where id = current_user_id) then
    raise exception 'workforce_profile_already_exists' using errcode = '23505';
  end if;

  select *
  into current_auth_user
  from identity.users
  where id = current_user_id;

  if not found then
    raise exception 'auth_user_not_found' using errcode = 'P0002';
  end if;

  if nullif(btrim(current_auth_user.email), '') is null then
    raise exception 'workforce_email_required' using errcode = '22023';
  end if;

  new_slug := private.organization_slug(normalized_name, new_organization_id);

  insert into public.organizations (id, name, slug)
  values (new_organization_id, normalized_name, new_slug);

  -- The public.users table is the application workforce profile. Its
  -- membership FK is deferrable, so both rows are created atomically.
  insert into public.users (
    id,
    organization_id,
    email,
    role,
    full_name
  )
  values (
    current_user_id,
    new_organization_id,
    lower(coalesce(current_auth_user.email, '')),
    'admin',
    coalesce(
      normalized_full_name,
      nullif(btrim(current_auth_user.name), '')
    )
  );

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role
  )
  values (new_organization_id, current_user_id, 'admin');

  insert into public.profiles (id, display_name)
  values (
    current_user_id,
    coalesce(
      normalized_full_name,
      nullif(btrim(current_auth_user.name), '')
    )
  )
  on conflict (id) do update
  set display_name = coalesce(excluded.display_name, public.profiles.display_name);

  return jsonb_build_object(
    'id', new_organization_id,
    'name', normalized_name,
    'slug', new_slug,
    'role', 'admin'
  );
end;
$$;


--
-- Name: crm_case_search_projection(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.crm_case_search_projection(target_organization_id uuid, target_case_id uuid) RETURNS TABLE(search_text text, search_vector tsvector)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    private.crm_search_normalize(concat_ws(
      ' ',
      crm_case.title,
      crm_case.description,
      crm_case.status_code,
      clients.clients_text,
      items.items_text,
      properties.properties_text,
      offers.offers_text
    )),
    setweight(
      to_tsvector('simple', private.crm_search_normalize(crm_case.title)),
      'A'
    )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(clients.clients_text)),
        'B'
      )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(items.items_text)),
        'B'
      )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(properties.properties_text)),
        'B'
      )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(offers.offers_text)),
        'B'
      )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(concat_ws(
          ' ', crm_case.description, crm_case.status_code
        ))),
        'C'
      )
  from public.crm_cases crm_case
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      client.display_name,
      client.primary_email,
      client.primary_phone,
      client.primary_phone_normalized,
      nullif(regexp_replace(coalesce(client.primary_phone, ''), '[^0-9]+', '', 'g'), ''),
      client.metadata ->> 'tax_id',
      client.metadata ->> 'nip',
      client.metadata ->> 'regon',
      client.metadata ->> 'krs',
      client.metadata ->> 'registry_number',
      nullif(regexp_replace(coalesce(client.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), ''),
      (
        select string_agg(concat_ws(
          ' ',
          person.display_name,
          person.first_name,
          person.last_name,
          person.email,
          person.phone,
          person.phone_normalized,
          nullif(regexp_replace(coalesce(person.phone, ''), '[^0-9]+', '', 'g'), ''),
          person.pesel,
          nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
        ), ' ' order by person.created_at, person.id)
        from public.crm_client_people person
        where person.organization_id = client.organization_id
          and person.client_id = client.id
      )
    ), ' ' order by case_client.is_primary desc, client.display_name, client.id) as clients_text
    from public.crm_case_clients case_client
    join public.crm_clients client
      on client.organization_id = case_client.organization_id
     and client.id = case_client.client_id
    where case_client.organization_id = crm_case.organization_id
      and case_client.case_id = crm_case.id
  ) clients on true
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      item.title,
      item.status_code,
      product_type.name,
      product_type.code,
      product_type.domain
    ), ' ' order by item.created_at, item.id) as items_text
    from public.crm_case_items item
    join public.crm_product_types product_type
      on product_type.id = item.product_type_id
    where item.organization_id = crm_case.organization_id
      and item.case_id = crm_case.id
  ) items on true
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      property.listing_title,
      property.address,
      property.city,
      property.postal_code,
      property.property_type,
      property.market_type,
      property.description
    ), ' ' order by property.created_at, property.id) as properties_text
    from public.crm_properties property
    left join public.crm_case_items property_item
      on property_item.organization_id = property.organization_id
     and property_item.id = property.case_item_id
    where property.organization_id = crm_case.organization_id
      and coalesce(property.case_id, property_item.case_id) = crm_case.id
  ) properties on true
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      snapshot.bank_name,
      snapshot.product_name,
      snapshot.version_key,
      snapshot.catalog_snapshot -> 'version' ->> 'reference_rate_code'
    ), ' ' order by snapshot.saved_at, snapshot.id) as offers_text
    from public.crm_case_offer_snapshots snapshot
    where snapshot.organization_id = crm_case.organization_id
      and snapshot.case_id = crm_case.id
  ) offers on true
  where crm_case.organization_id = target_organization_id
    and crm_case.id = target_case_id;
$$;


--
-- Name: crm_client_search_projection(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.crm_client_search_projection(target_organization_id uuid, target_client_id uuid) RETURNS TABLE(search_text text, search_vector tsvector)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    private.crm_search_normalize(concat_ws(
      ' ',
      client.display_name,
      client.primary_email,
      client.primary_phone,
      client.primary_phone_normalized,
      client.lead_source,
      client.notes,
      array_to_string(client.tags, ' '),
      identifiers.identifiers_text,
      people.people_text
    )),
    setweight(to_tsvector('simple', private.crm_search_normalize(client.display_name)), 'A')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        client.primary_email,
        client.primary_phone,
        client.primary_phone_normalized,
        array_to_string(client.tags, ' ')
      ))), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(identifiers.identifiers_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(people.people_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ', client.lead_source, client.notes
      ))), 'C')
  from public.crm_clients client
  left join lateral (
    select concat_ws(
      ' ',
      client.metadata ->> 'tax_id',
      client.metadata ->> 'nip',
      client.metadata ->> 'regon',
      client.metadata ->> 'krs',
      client.metadata ->> 'registry_number',
      nullif(regexp_replace(coalesce(client.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), '')
    ) as identifiers_text
  ) identifiers on true
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      person.display_name,
      person.first_name,
      person.last_name,
      person.email,
      person.phone,
      person.phone_normalized,
      person.pesel,
      nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
    ), ' ' order by person.created_at, person.id) as people_text
    from public.crm_client_people person
    where person.organization_id = client.organization_id
      and person.client_id = client.id
  ) people on true
  where client.organization_id = target_organization_id
    and client.id = target_client_id;
$$;


--
-- Name: FUNCTION crm_client_search_projection(target_organization_id uuid, target_client_id uuid); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.crm_client_search_projection(target_organization_id uuid, target_client_id uuid) IS 'Builds client search text with readable and digit-normalized identity values.';


--
-- Name: crm_search_normalize(text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.crm_search_normalize(input text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    coalesce(input, '')
  ));
$$;


--
-- Name: current_organization_id(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_organization_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select organization_id
  from public.users
  where id = (select app.current_user_id())
  limit 1;
$$;


--
-- Name: enforce_crm_client_creation_consents(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.enforce_crm_client_creation_consents() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if exists (
    select 1
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = new.organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
      and not exists (
        select 1
        from public.crm_client_consent_events consent_event
        where consent_event.organization_id = new.organization_id
          and consent_event.client_id = new.id
          and consent_event.definition_id = definition.id
          and consent_event.definition_version_id = consent_version.id
          and consent_event.source in ('client_creation', 'booking_widget')
      )
  ) then
    raise exception 'client_consent_decisions_required' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = new.organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.is_required
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
      and not exists (
        select 1
        from public.crm_client_consent_events consent_event
        where consent_event.organization_id = new.organization_id
          and consent_event.client_id = new.id
          and consent_event.definition_id = definition.id
          and consent_event.definition_version_id = consent_version.id
          and consent_event.decision = 'granted'
          and consent_event.source in ('client_creation', 'booking_widget')
      )
  ) then
    raise exception 'required_consent_not_granted' using errcode = '23514';
  end if;

  return null;
end;
$$;


--
-- Name: enforce_facility_image_limit(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.enforce_facility_image_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: FUNCTION enforce_facility_image_limit(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.enforce_facility_image_limit() IS 'Serializes facility image inserts and enforces at most 12 metadata rows per facility.';


--
-- Name: enqueue_appointment_outbox(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.enqueue_appointment_outbox() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  event_topic text;
begin
  event_topic := case
    when new.status = 'cancelled' then 'appointment.cancelled'
    when new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed')
      then 'appointment.confirmed'
    when new.status = 'hold' and tg_op = 'INSERT' then 'appointment.hold.created'
    else 'appointment.updated'
  end;

  insert into public.booking_outbox (
    organization_id,
    topic,
    aggregate_type,
    aggregate_id,
    idempotency_key,
    payload
  ) values (
    new.organization_id,
    event_topic,
    'appointment',
    new.id,
    'appointment:' || new.id::text || ':' || event_topic || ':' || txid_current()::text,
    jsonb_build_object(
      'appointmentId', new.id,
      'clientId', new.client_id,
      'clientPersonId', new.client_person_id,
      'facilityId', new.facility_id,
      'serviceId', new.service_id,
      'expertUserId', new.expert_user_id,
      'status', new.status,
      'meetingMode', new.meeting_mode,
      'meetingUrl', new.meeting_url,
      'startsAt', new.starts_at,
      'endsAt', new.ends_at
    )
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;


--
-- Name: expert_slot_is_available(uuid, uuid, uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.expert_slot_is_available(target_organization_id uuid, target_facility_id uuid, target_service_id uuid, target_expert_user_id uuid, requested_start timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  facility_record record;
  service_record record;
  requested_end timestamptz;
  requested_busy_period tstzrange;
  local_start timestamp;
  local_busy_start timestamp;
  local_busy_end timestamp;
  local_day date;
  local_weekday integer;
  local_start_minute integer;
  local_busy_range int4range;
begin
  select facility.timezone
  into facility_record
  from public.facilities facility
  where facility.organization_id = target_organization_id
    and facility.id = target_facility_id
    and facility.is_active;

  if not found then
    return false;
  end if;

  select service.duration_minutes,
         service.buffer_before_minutes,
         service.buffer_after_minutes,
         service.slot_interval_minutes,
         service.min_notice_minutes,
         service.max_advance_days
  into service_record
  from public.booking_services service
  join public.facility_services facility_service
    on facility_service.organization_id = service.organization_id
   and facility_service.service_id = service.id
   and facility_service.facility_id = target_facility_id
   and facility_service.is_active
  join public.facility_service_experts expert
    on expert.organization_id = facility_service.organization_id
   and expert.facility_id = facility_service.facility_id
   and expert.service_id = facility_service.service_id
   and expert.user_id = target_expert_user_id
   and expert.is_active
  join public.facility_memberships membership
    on membership.organization_id = expert.organization_id
   and membership.facility_id = expert.facility_id
   and membership.user_id = expert.user_id
   and membership.is_bookable
  where service.organization_id = target_organization_id
    and service.id = target_service_id
    and service.is_active;

  if not found then
    return false;
  end if;

  if requested_start < now() + make_interval(mins => service_record.min_notice_minutes)
     or requested_start > now() + make_interval(days => service_record.max_advance_days) then
    return false;
  end if;

  requested_end := requested_start + make_interval(mins => service_record.duration_minutes);
  requested_busy_period := tstzrange(
    requested_start - make_interval(mins => service_record.buffer_before_minutes),
    requested_end + make_interval(mins => service_record.buffer_after_minutes),
    '[)'
  );
  local_start := requested_start at time zone facility_record.timezone;
  local_busy_start := lower(requested_busy_period) at time zone facility_record.timezone;
  local_busy_end := upper(requested_busy_period) at time zone facility_record.timezone;
  local_day := local_start::date;
  local_weekday := extract(isodow from local_day)::integer - 1;

  if extract(second from local_start) <> 0
     or local_busy_start::date <> (local_busy_end - interval '1 microsecond')::date then
    return false;
  end if;

  local_start_minute := extract(hour from local_start)::integer * 60
    + extract(minute from local_start)::integer;
  local_busy_range := int4range(
    extract(hour from local_busy_start)::integer * 60
      + extract(minute from local_busy_start)::integer,
    extract(hour from local_busy_end)::integer * 60
      + extract(minute from local_busy_end)::integer,
    '[)'
  );

  if exists (
    select 1
    from public.facility_opening_overrides override
    where override.organization_id = target_organization_id
      and override.facility_id = target_facility_id
      and override.local_date = local_day
  ) then
    if not exists (
      select 1
      from public.facility_opening_overrides override
      where override.organization_id = target_organization_id
        and override.facility_id = target_facility_id
        and override.local_date = local_day
        and not override.is_closed
        and local_busy_range <@ override.opening_range
        and mod(
          local_start_minute - lower(override.opening_range)
            - service_record.buffer_before_minutes,
          service_record.slot_interval_minutes
        ) = 0
    ) then
      return false;
    end if;
  elsif not exists (
    select 1
    from public.facility_opening_hours opening
    where opening.organization_id = target_organization_id
      and opening.facility_id = target_facility_id
      and opening.weekday = local_weekday
      and opening.is_active
      and local_busy_range <@ opening.opening_range
      and mod(
        local_start_minute - lower(opening.opening_range)
          - service_record.buffer_before_minutes,
        service_record.slot_interval_minutes
      ) = 0
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.expert_availability_overrides override
    where override.organization_id = target_organization_id
      and override.facility_id = target_facility_id
      and override.user_id = target_expert_user_id
      and override.local_date = local_day
  ) then
    if not exists (
      select 1
      from public.expert_availability_overrides override
      where override.organization_id = target_organization_id
        and override.facility_id = target_facility_id
        and override.user_id = target_expert_user_id
        and override.local_date = local_day
        and not override.is_unavailable
        and local_busy_range <@ override.availability_range
    ) then
      return false;
    end if;
  elsif not exists (
    select 1
    from public.expert_availability_rules rule
    where rule.organization_id = target_organization_id
      and rule.facility_id = target_facility_id
      and rule.user_id = target_expert_user_id
      and rule.weekday = local_weekday
      and rule.is_active
      and (rule.valid_from is null or rule.valid_from <= local_day)
      and (rule.valid_until is null or rule.valid_until >= local_day)
      and local_busy_range <@ rule.availability_range
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.appointment_resource_reservations reservation
    where reservation.resource_type = 'expert'
      and reservation.resource_id = target_expert_user_id
      and reservation.busy_period && requested_busy_period
      and (
        reservation.status = 'confirmed'
        or (reservation.status = 'hold' and reservation.hold_expires_at > now())
      )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.external_busy_blocks busy
    join public.calendar_connections connection
      on connection.organization_id = busy.organization_id
     and connection.id = busy.connection_id
     and connection.status in ('active', 'error')
    where busy.busy_period && requested_busy_period
      and (
        (connection.owner_kind = 'expert' and connection.owner_user_id = target_expert_user_id)
        or (
          busy.organization_id = target_organization_id
          and connection.owner_kind = 'facility'
          and connection.facility_id = target_facility_id
        )
      )
      and not exists (
        select 1
        from public.appointment_calendar_events mirrored_event
        join public.appointments mirrored_appointment
          on mirrored_appointment.organization_id = mirrored_event.organization_id
         and mirrored_appointment.id = mirrored_event.appointment_id
        where mirrored_event.organization_id = busy.organization_id
          and mirrored_event.connection_id = busy.connection_id
          and mirrored_event.sync_status <> 'deleted'
          and mirrored_appointment.appointment_period = busy.busy_period
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;


--
-- Name: finalize_legacy_mortgage_product_version_insert(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.finalize_legacy_mortgage_product_version_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  product_record public.mortgage_products%rowtype;
  prior_hash text;
begin
  -- The post-reset catalogue synchronizer still writes the legacy flat shape.
  -- V2 publications explicitly use schema 2 and are finalized only by the RPC.
  if new.calculator_schema_version <> 1
     or new.calculator_engine_version <> 'legacy-flat-v1' then
    return new;
  end if;

  select product.*
  into product_record
  from public.mortgage_products product
  where product.id = new.product_id
  for update;

  insert into public.mortgage_product_version_variants (
    product_version_id,
    code,
    name,
    sort_order,
    is_default,
    min_amount,
    max_amount,
    min_term_months,
    max_term_months,
    max_ltv_pct,
    interest_type,
    fixed_rate_pct,
    fixed_period_months,
    margin_pct,
    reference_rate_code,
    reference_rate_pct,
    reference_rate_as_of,
    representative_apr_pct,
    calculation_readiness,
    pricing_config,
    eligibility_config
  ) values (
    new.id,
    'standard',
    'Wariant standardowy',
    0,
    true,
    new.min_amount,
    new.max_amount,
    new.min_term_months,
    new.max_term_months,
    new.max_ltv_pct,
    new.interest_type,
    new.fixed_rate_pct,
    new.fixed_period_months,
    new.margin_pct,
    new.reference_rate_code,
    new.reference_rate_pct,
    new.reference_rate_as_of,
    new.representative_apr_pct,
    case when cardinality(new.unknown_fields) > 0 then 'partial' else 'complete' end,
    jsonb_build_object(
      'schemaVersion', 'openexpert.mortgage-offer/legacy',
      'legacyVersionId', new.id,
      'costRules', new.cost_rules,
      'assumptions', new.assumptions,
      'unknownFields', to_jsonb(new.unknown_fields)
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'minAmount', new.min_amount,
      'maxAmount', new.max_amount,
      'minTermMonths', new.min_term_months,
      'maxTermMonths', new.max_term_months,
      'maxLtvPct', new.max_ltv_pct
    ))
  )
  on conflict (product_version_id, code) do nothing;

  if new.source_document_id is not null then
    insert into public.mortgage_product_version_sources (
      product_version_id,
      source_document_id,
      source_role
    ) values (new.id, new.source_document_id, 'primary')
    on conflict do nothing;
  end if;

  if new.lifecycle_status = 'published' then
    if product_record.current_published_version_id is not null
       and product_record.current_published_version_id <> new.id then
      select version.content_sha256
      into prior_hash
      from public.mortgage_product_versions version
      where version.id = product_record.current_published_version_id;

      update public.mortgage_product_versions version
      set
        lifecycle_status = 'retired',
        retired_at = now(),
        retired_by_user_id = null
      where version.id = product_record.current_published_version_id
        and version.lifecycle_status = 'published';
    end if;

    update public.mortgage_products product
    set
      current_published_version_id = new.id,
      revision = product.revision + 1
    where product.id = new.product_id;

    insert into public.mortgage_catalog_events (
      bank_id,
      product_id,
      product_version_id,
      event_type,
      revision_before,
      revision_after,
      content_sha256_before,
      content_sha256_after,
      metadata
    ) values (
      product_record.bank_id,
      new.product_id,
      new.id,
      'product.legacy_imported',
      product_record.revision,
      product_record.revision + 1,
      prior_hash,
      new.content_sha256,
      jsonb_build_object(
        'versionNumber', new.version_number,
        'versionKey', new.version_key,
        'calculatorSchemaVersion', new.calculator_schema_version,
        'calculatorEngineVersion', new.calculator_engine_version
      )
    );
  end if;

  return new;
end;
$$;


--
-- Name: get_booking_widget_catalog_without_avatar(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.get_booking_widget_catalog_without_avatar(p_widget_token uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  widget_record record;
  result jsonb;
begin
  select widget.*,
         facility.name as facility_name,
         facility.timezone as facility_timezone,
         concat_ws(
           ', ',
           nullif(facility.address_line1, ''),
           nullif(facility.address_line2, ''),
           nullif(concat_ws(' ', facility.postal_code, facility.city), ''),
           facility.country_code
         ) as facility_address
  into widget_record
  from public.booking_widgets widget
  join public.facilities facility
    on facility.organization_id = widget.organization_id
   and facility.id = widget.facility_id
   and facility.is_active
  where widget.public_token = p_widget_token
    and widget.is_active;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'widget', jsonb_build_object(
      'key', widget_record.public_token::text,
      'title', widget_record.title,
      'subtitle', widget_record.subtitle,
      'theme', widget_record.theme,
      'accentColor', widget_record.accent_color,
      'bookingMode', widget_record.booking_mode,
      'widgetType', widget_record.widget_type,
      'fixedExpertUserId', widget_record.fixed_expert_user_id
    ),
    'facility', jsonb_build_object(
      'id', widget_record.facility_id,
      'name', widget_record.facility_name,
      'address', widget_record.facility_address,
      'timezone', widget_record.facility_timezone
    ),
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', service.id,
          'name', service.name,
          'description', service.description,
          'durationMinutes', service.duration_minutes
        ) order by service.name, service.id
      )
      from public.booking_widget_services allowed_service
      join public.facility_services facility_service
        on facility_service.organization_id = allowed_service.organization_id
       and facility_service.facility_id = allowed_service.facility_id
       and facility_service.service_id = allowed_service.service_id
       and facility_service.is_active
      join public.booking_services service
        on service.organization_id = allowed_service.organization_id
       and service.id = allowed_service.service_id
       and service.is_active
      where allowed_service.organization_id = widget_record.organization_id
        and allowed_service.facility_id = widget_record.facility_id
        and allowed_service.widget_id = widget_record.id
    ), '[]'::jsonb),
    'experts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'userId', expert.user_id,
          'name', expert.expert_name,
          'serviceIds', expert.service_ids
        ) order by expert.expert_name, expert.user_id
      )
      from (
        select service_expert.user_id,
               coalesce(app_user.full_name, 'Ekspert') as expert_name,
               jsonb_agg(
                 service_expert.service_id order by service_expert.service_id
               ) as service_ids
        from public.facility_service_experts service_expert
        join public.booking_widget_services allowed_service
          on allowed_service.organization_id = service_expert.organization_id
         and allowed_service.facility_id = service_expert.facility_id
         and allowed_service.service_id = service_expert.service_id
         and allowed_service.widget_id = widget_record.id
        join public.facility_memberships membership
          on membership.organization_id = service_expert.organization_id
         and membership.facility_id = service_expert.facility_id
         and membership.user_id = service_expert.user_id
         and membership.is_bookable
        join public.users app_user on app_user.id = service_expert.user_id
        where service_expert.organization_id = widget_record.organization_id
          and service_expert.facility_id = widget_record.facility_id
          and service_expert.is_active
          and (
            widget_record.fixed_expert_user_id is null
            or service_expert.user_id = widget_record.fixed_expert_user_id
          )
        group by service_expert.user_id, app_user.full_name
      ) expert
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'definitionId', definition.id,
          'versionId', consent_version.id,
          'code', definition.code,
          'displayTitle', consent_version.display_title,
          'content', consent_version.content,
          'purpose', consent_version.purpose,
          'channel', consent_version.channel,
          'legalBasis', consent_version.legal_basis,
          'isRequired', consent_version.is_required,
          'languageCode', consent_version.language_code,
          'contentSha256', consent_version.content_sha256
        ) order by consent_version.sort_order, consent_version.display_title, definition.id
      )
      from public.crm_consent_definitions definition
      join public.crm_consent_definition_versions consent_version
        on consent_version.organization_id = definition.organization_id
       and consent_version.definition_id = definition.id
       and consent_version.id = definition.current_version_id
      where definition.organization_id = widget_record.organization_id
        and definition.context = 'client_creation'
        and consent_version.status = 'published'
        and consent_version.effective_from <= now()
        and (consent_version.effective_to is null or consent_version.effective_to > now())
    ), '[]'::jsonb),
    'capacityPolicy', case
      when widget_record.widget_type = 'mortgage_capacity' then (
        select jsonb_build_object(
          'policyAsOf', settings.policy_as_of,
          'minimumSocialAsOf', settings.minimum_social_as_of,
          'nbpReferenceRateAsOf', settings.nbp_reference_rate_as_of,
          'dstiLimitPct', settings.dsti_limit_pct,
          'incomeBufferPct', settings.income_buffer_pct,
          'creditLimitMonthlyChargePct', settings.credit_limit_monthly_charge_pct,
          'maxLtvPct', settings.max_ltv_pct,
          'defaultInterestRatePct', settings.default_interest_rate_pct,
          'defaultInterestType', settings.default_interest_type,
          'defaultFixedRatePeriodMonths', settings.default_fixed_rate_period_months,
          'nbpReferenceRatePct', settings.nbp_reference_rate_pct,
          'variableRateVolatilityBufferPct', settings.variable_rate_volatility_buffer_pct,
          'minimumSocialMonthly', jsonb_build_array(
            settings.minimum_social_1_person,
            settings.minimum_social_2_people,
            settings.minimum_social_3_people,
            settings.minimum_social_4_people,
            settings.minimum_social_5_people
          ),
          'minimumSocialAdditionalPerson', settings.minimum_social_additional_person
        )
        from public.mortgage_capacity_settings settings
        where settings.organization_id = widget_record.organization_id
      )
      else null
    end,
    'capacityPolicyRevision', case
      when widget_record.widget_type = 'mortgage_capacity' then coalesce((
        select settings.revision
        from public.mortgage_capacity_settings settings
        where settings.organization_id = widget_record.organization_id
      ), 0)
      else null
    end,
    '_private', jsonb_build_object(
      'allowedOrigins', to_jsonb(widget_record.allowed_origins)
    )
  ) into result;

  return result;
end;
$$;


--
-- Name: guard_crm_bank_application_submission_delete(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_crm_bank_application_submission_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  mortgage_case_id uuid;
begin
  select application.case_id
  into mortgage_case_id
  from public.crm_case_bank_applications application
  where application.organization_id = old.organization_id
    and application.submission_id = old.id;

  if not found then
    return old;
  end if;

  if current_user not in ('openexpert_service', 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'Mortgage applications may only be deleted by the trusted server';
  end if;

  if old.status_code <> 'draft' then
    raise exception using
      errcode = '23514',
      message = 'Only a draft mortgage application may be deleted; submitted applications are retained';
  end if;

  if exists (
    select 1
    from public.crm_case_contract_selections contract
    where contract.organization_id = old.organization_id
      and contract.case_id = mortgage_case_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A mortgage application from a signed credit process cannot be deleted';
  end if;

  return old;
end;
$$;


--
-- Name: FUNCTION guard_crm_bank_application_submission_delete(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.guard_crm_bank_application_submission_delete() IS 'Retains submitted mortgage applications and permits deletion of drafts only through the trusted server.';


--
-- Name: guard_crm_case_bank_application_insert(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_crm_case_bank_application_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  saved_offer public.crm_case_offer_snapshots%rowtype;
  canonical_version public.mortgage_product_versions%rowtype;
  mutable_version_fields constant text[] := array[
    'updated_at',
    'lifecycle_status',
    'retired_at',
    'retired_by_user_id'
  ];
begin
  if current_user not in ('openexpert_service', 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'Mortgage applications may only be created by the trusted server or maintenance role';
  end if;

  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = new.organization_id
    and crm_case.id = new.case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CRM case not found';
  end if;

  if exists (
    select 1
    from public.crm_case_contract_selections contract
    where contract.organization_id = new.organization_id
      and contract.case_id = new.case_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A credit agreement has already been signed for this CRM case';
  end if;

  select snapshot.*
  into saved_offer
  from public.crm_case_offer_snapshots snapshot
  where snapshot.organization_id = new.organization_id
    and snapshot.case_id = new.case_id
    and snapshot.id = new.offer_id
    and snapshot.bank_id = new.bank_id;
  if not found
    or saved_offer.mortgage_product_id is null
    or saved_offer.mortgage_product_version_id is null
    or saved_offer.version_key is null then
    raise exception using
      errcode = '23503',
      message = 'Mortgage application offer provenance is incomplete';
  end if;

  select version.*
  into canonical_version
  from public.mortgage_products product
  join public.mortgage_product_versions version
    on version.product_id = product.id
  where product.id = saved_offer.mortgage_product_id
    and product.bank_id = saved_offer.bank_id
    and product.is_active
    and product.archived_at is null
    and version.id = saved_offer.mortgage_product_version_id;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'Mortgage application offer does not reference a canonical bank product version';
  end if;

  if saved_offer.version_key <> canonical_version.version_key
    or jsonb_typeof(saved_offer.catalog_snapshot -> 'baseVersion') is distinct from 'object'
    or jsonb_typeof(saved_offer.catalog_snapshot -> 'version') is distinct from 'object'
    or saved_offer.catalog_snapshot ->> 'id' is distinct from saved_offer.mortgage_product_id::text
    or saved_offer.catalog_snapshot #>> '{bank,id}' is distinct from saved_offer.bank_id::text
    or saved_offer.catalog_snapshot #>> '{baseVersion,id}' is distinct from canonical_version.id::text
    or saved_offer.catalog_snapshot #>> '{baseVersion,version_key}' is distinct from canonical_version.version_key
    or saved_offer.catalog_snapshot #>> '{baseVersion,content_sha256}' is distinct from canonical_version.content_sha256
    or saved_offer.catalog_snapshot #>> '{version,id}' is distinct from canonical_version.id::text
    or saved_offer.catalog_snapshot #>> '{version,version_key}' is distinct from canonical_version.version_key
    or saved_offer.catalog_snapshot #>> '{version,content_sha256}' is distinct from canonical_version.content_sha256
    or not (
      (to_jsonb(canonical_version) - mutable_version_fields)
      <@ ((saved_offer.catalog_snapshot -> 'baseVersion') - mutable_version_fields)
    ) then
    raise exception using
      errcode = '23514',
      message = 'Mortgage application offer payload does not match its canonical version';
  end if;

  return new;
end;
$$;


--
-- Name: guard_crm_case_contract_insert(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_crm_case_contract_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  target_status text;
begin
  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = new.organization_id
    and crm_case.id = new.case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CRM case not found';
  end if;

  select submission.status_code
  into target_status
  from public.crm_case_bank_applications application
  join public.crm_item_submissions submission
    on submission.organization_id = application.organization_id
   and submission.id = application.submission_id
  where application.organization_id = new.organization_id
    and application.case_id = new.case_id
    and application.submission_id = new.application_id
  for update of submission;

  if target_status is distinct from 'zaakceptowane' then
    raise exception using errcode = '23514', message = 'Only an accepted bank application can be signed';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.signed_by_user_id
  ) then
    raise exception using errcode = '23503', message = 'The signing user must belong to the CRM case organization';
  end if;

  return new;
end;
$$;


--
-- Name: guard_delegated_task_status_actor(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_delegated_task_status_actor() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  caller_user_id uuid := (select app.current_user_id());
  is_terminal_delegation_transition boolean;
begin
  if old.delegation_status = 'not_delegated'
    and new.delegation_status = 'not_delegated'
  then
    return new;
  end if;

  if caller_user_id is null
    or new.status_code is not distinct from old.status_code
    or caller_user_id = old.assignee_user_id
    or private.is_organization_admin(old.organization_id)
  then
    return new;
  end if;

  is_terminal_delegation_transition :=
    new.delegation_status is distinct from old.delegation_status
    and new.delegation_status in ('rejected', 'cancelled');

  if not is_terminal_delegation_transition then
    raise exception 'task_status_update_requires_assignee'
      using errcode = '42501';
  end if;

  return new;
end;
$$;


--
-- Name: guard_signed_crm_bank_application_status(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.guard_signed_crm_bank_application_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  final_application_id uuid;
begin
  select contract.application_id
  into final_application_id
  from public.crm_case_bank_applications application
  join public.crm_case_contract_selections contract
    on contract.organization_id = application.organization_id
   and contract.case_id = application.case_id
  where application.organization_id = new.organization_id
    and application.submission_id = new.id;

  if final_application_id is null then
    return new;
  end if;

  if new.id = final_application_id then
    if new.status_code <> 'zaakceptowane' then
      raise exception using errcode = '23514', message = 'The signed bank application must remain accepted';
    end if;
  elsif old.status_code = 'odrzucone' then
    if new.status_code <> 'odrzucone' then
      raise exception using errcode = '23514', message = 'A rejected bank application cannot be reopened after signing';
    end if;
  elsif new.status_code <> 'wycofane' then
    raise exception using errcode = '23514', message = 'A competing bank application must remain withdrawn after signing';
  end if;

  return new;
end;
$$;


--
-- Name: has_administrative_permission(uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.has_administrative_permission(target_organization_id uuid, target_permission_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.user_has_administrative_permission(
    target_organization_id,
    (select app.current_user_id()),
    target_permission_key
  );
$$;


--
-- Name: has_facility_admin_membership(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.has_facility_admin_membership(target_organization_id uuid, target_facility_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.facility_memberships membership
    where membership.organization_id = target_organization_id
      and membership.facility_id = target_facility_id
      and membership.user_id = (select app.current_user_id())
      and membership.role = 'admin'
  );
$$;


--
-- Name: FUNCTION has_facility_admin_membership(target_organization_id uuid, target_facility_id uuid); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.has_facility_admin_membership(target_organization_id uuid, target_facility_id uuid) IS 'Checks the direct facility membership role without broadening facility configuration policies.';


--
-- Name: initialize_organization_user_access_state(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.initialize_organization_user_access_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: is_facility_admin(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_facility_admin(target_organization_id uuid, target_facility_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select private.is_organization_admin(target_organization_id);
$$;


--
-- Name: FUNCTION is_facility_admin(target_organization_id uuid, target_facility_id uuid); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.is_facility_admin(target_organization_id uuid, target_facility_id uuid) IS 'Compatibility helper. Facility configuration may be managed only by an organization administrator.';


--
-- Name: is_facility_member(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_facility_member(target_organization_id uuid, target_facility_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.facility_memberships membership
    where membership.organization_id = target_organization_id
      and membership.facility_id = target_facility_id
      and membership.user_id = (select app.current_user_id())
  );
$$;


--
-- Name: is_organization_admin(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_organization_admin(target_organization_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select app.current_user_id())
      and membership.role = 'admin'
  );
$$;


--
-- Name: is_organization_member(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_organization_member(target_organization_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select app.current_user_id())
  );
$$;


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.platform_user_roles platform_role
    where platform_role.user_id = (select app.current_user_id())
      and platform_role.role = 'super_admin'
  );
$$;


--
-- Name: is_team_admin(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_team_admin(target_organization_id uuid, target_team_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.team_memberships membership
    where membership.organization_id = target_organization_id
      and membership.team_id = target_team_id
      and membership.user_id = (select app.current_user_id())
      and membership.role = 'admin'
  );
$$;


--
-- Name: FUNCTION is_team_admin(target_organization_id uuid, target_team_id uuid); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.is_team_admin(target_organization_id uuid, target_team_id uuid) IS 'True only for a direct admin membership in the requested team.';


--
-- Name: is_team_member(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_team_member(target_organization_id uuid, target_team_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from public.team_memberships membership
    where membership.organization_id = target_organization_id
      and membership.team_id = target_team_id
      and membership.user_id = (select app.current_user_id())
  );
$$;


--
-- Name: organization_slug(text, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.organization_slug(organization_name text, organization_id uuid) RETURNS text
    LANGUAGE sql IMMUTABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with normalized as (
    select trim(both '-' from regexp_replace(
      translate(lower(coalesce(organization_name, 'org')), 'ąćęłńóśźż', 'acelnoszz'),
      '[^a-z0-9]+',
      '-',
      'g'
    )) as value
  )
  select coalesce(nullif(value, ''), 'org') || '-' || left(organization_id::text, 8)
  from normalized;
$$;


--
-- Name: pin_mortgage_product_version_document_templates(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.pin_mortgage_product_version_document_templates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: prepare_mortgage_bank_override(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prepare_mortgage_bank_override() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_id uuid := (select app.current_user_id());
begin
  if tg_op = 'INSERT' then
    actor_id := coalesce(actor_id, new.updated_by, new.created_by);
    if actor_id is null then
      raise exception 'authenticated_user_required' using errcode = '42501';
    end if;
    new.created_by := actor_id;
    new.updated_by := actor_id;
    new.revision := 1;
    new.created_at := now();
  else
    actor_id := coalesce(actor_id, old.updated_by);
    new.organization_id := old.organization_id;
    new.bank_id := old.bank_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := actor_id;
    new.revision := old.revision + 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: prepare_mortgage_capacity_settings(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prepare_mortgage_capacity_settings() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_id uuid := (select app.current_user_id());
begin
  if actor_id is null then
    raise exception 'authenticated_user_required' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := actor_id;
    new.updated_by := actor_id;
    new.revision := coalesce((
      select max(history.revision)
      from public.mortgage_capacity_setting_revisions as history
      where history.organization_id = new.organization_id
    ), 0) + 1;
    new.created_at := now();
  else
    new.organization_id := old.organization_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := actor_id;
    new.revision := old.revision + 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: prepare_mortgage_product_override(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prepare_mortgage_product_override() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_id uuid := (select app.current_user_id());
begin
  if tg_op = 'INSERT' then
    actor_id := coalesce(actor_id, new.updated_by, new.created_by);
    if actor_id is null then
      raise exception 'authenticated_user_required' using errcode = '42501';
    end if;
    new.created_by := actor_id;
    new.updated_by := actor_id;
    new.revision := 1;
    new.created_at := now();
  else
    actor_id := coalesce(actor_id, old.updated_by);
    new.organization_id := old.organization_id;
    new.product_id := old.product_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := actor_id;
    new.revision := old.revision + 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: prepare_mortgage_product_version_insert(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prepare_mortgage_product_version_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.version_number is null then
    -- Existing catalogue importers do not yet know about version_number.
    -- Locking the owning product makes the per-product allocation safe.
    perform 1
    from public.mortgage_products product
    where product.id = new.product_id
    for update;

    select coalesce(max(version.version_number), 0) + 1
    into new.version_number
    from public.mortgage_product_versions version
    where version.product_id = new.product_id;
  end if;

  if new.lifecycle_status = 'published' and new.published_at is null then
    new.published_at := coalesce(new.created_at, new.retrieved_at, now());
  elsif new.lifecycle_status = 'retired' and new.retired_at is null then
    new.retired_at := now();
  end if;

  if new.content_sha256 is null then
    new.content_sha256 := encode(
      extensions.digest(
        convert_to(
          (to_jsonb(new) - array[
            'content_sha256',
            'updated_at',
            'lifecycle_status',
            'retired_at',
            'retired_by_user_id'
          ])::text,
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    );
  end if;

  return new;
end;
$$;


--
-- Name: protect_crm_client_anonymization_request_event(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_crm_client_anonymization_request_event() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'crm_client_anonymization_request_events_are_append_only'
    using errcode = '55000';
end;
$$;


--
-- Name: protect_crm_client_anonymization_request_identity(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_crm_client_anonymization_request_identity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if row(
    new.organization_id,
    new.client_id,
    new.subject_person_id,
    new.idempotency_key,
    new.request_number,
    new.requested_at,
    new.created_by_user_id,
    new.created_at
  ) is distinct from row(
    old.organization_id,
    old.client_id,
    old.subject_person_id,
    old.idempotency_key,
    old.request_number,
    old.requested_at,
    old.created_by_user_id,
    old.created_at
  ) then
    raise exception 'crm_client_anonymization_request_identity_is_immutable'
      using errcode = '55000';
  end if;

  return new;
end;
$$;


--
-- Name: protect_last_team_admin(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_last_team_admin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
  admin_count integer;
begin
  if old.role <> 'admin'
    or (tg_op = 'UPDATE' and new.role = 'admin')
    or actor_user_id is null
    or private.is_organization_admin(old.organization_id)
  then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert-team-admin:' || old.organization_id::text || ':' || old.team_id::text,
      0
    )
  );

  select count(*)
  into admin_count
  from public.team_memberships membership
  where membership.organization_id = old.organization_id
    and membership.team_id = old.team_id
    and membership.role = 'admin';

  if admin_count <= 1 then
    raise exception 'team_requires_direct_admin'
      using errcode = '23514', constraint = 'team_memberships_require_admin';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: protect_mortgage_catalog_event(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_mortgage_catalog_event() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'mortgage_catalog_events_are_append_only'
    using errcode = '55000';
end;
$$;


--
-- Name: protect_mortgage_document_template_revision(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_mortgage_document_template_revision() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'mortgage_document_template_revisions_are_append_only'
    using errcode = '55000';
end;
$$;


--
-- Name: FUNCTION protect_mortgage_document_template_revision(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.protect_mortgage_document_template_revision() IS 'Rejects mutation of append-only PDF template audit snapshots.';


--
-- Name: protect_mortgage_product_version(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_mortgage_product_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception 'published_mortgage_version_is_immutable'
      using errcode = '55000';
  end if;

  if old.lifecycle_status = 'retired'
     and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'retired_mortgage_version_is_immutable'
      using errcode = '55000';
  end if;

  if old.lifecycle_status = 'published' then
    if new.lifecycle_status not in ('published', 'retired') then
      raise exception 'invalid_mortgage_version_lifecycle_transition'
        using errcode = '23514';
    end if;

    if (to_jsonb(new) - array[
          'lifecycle_status',
          'retired_at',
          'retired_by_user_id',
          'updated_at'
        ]) is distinct from
       (to_jsonb(old) - array[
          'lifecycle_status',
          'retired_at',
          'retired_by_user_id',
          'updated_at'
        ]) then
      raise exception 'published_mortgage_version_content_is_immutable'
        using errcode = '55000';
    end if;

    if new.lifecycle_status = 'published'
       and (new.retired_at is not null or new.retired_by_user_id is not null) then
      raise exception 'published_mortgage_version_cannot_have_retirement_metadata'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: protect_organization_user_audit_event(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_organization_user_audit_event() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'organization_user_audit_events_are_append_only'
    using errcode = '55000';
end;
$$;


--
-- Name: protect_published_mortgage_source_document(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_published_mortgage_source_document() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if exists (
    select 1
    from public.mortgage_product_version_sources link
    join public.mortgage_product_versions version on version.id = link.product_version_id
    join public.mortgage_products product on product.id = version.product_id
    where link.source_document_id = old.id
      and version.calculator_schema_version >= 2
      and (
        version.lifecycle_status = 'retired'
        or product.current_published_version_id = version.id
      )
  ) then
    raise exception 'published_mortgage_source_document_is_immutable'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


--
-- Name: protect_published_mortgage_version_child(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.protect_published_mortgage_version_child() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  target_version_ids uuid[];
  version_is_locked boolean;
begin
  target_version_ids := case tg_op
    when 'INSERT' then array[new.product_version_id]
    when 'DELETE' then array[old.product_version_id]
    else array[old.product_version_id, new.product_version_id]
  end;

  select exists (
    select 1
    from public.mortgage_product_versions version
    join public.mortgage_products product on product.id = version.product_id
    where version.id = any(target_version_ids)
      and (
        version.lifecycle_status = 'retired'
        or product.current_published_version_id = version.id
      )
  )
  into version_is_locked;

  if version_is_locked then
    raise exception 'published_mortgage_version_children_are_immutable'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


--
-- Name: provision_auth_user(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.provision_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(new.name), '')
  )
  on conflict (id) do update
  set display_name = coalesce(
    public.profiles.display_name,
    excluded.display_name
  );

  return new;
end;
$$;


--
-- Name: provision_default_crm_consents(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.provision_default_crm_consents(target_organization_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  organization_name text;
  seed_record record;
  new_definition_id uuid;
  new_version_id uuid;
begin
  select organization.name
  into organization_name
  from public.organizations organization
  where organization.id = target_organization_id;

  if organization_name is null then
    return;
  end if;

  for seed_record in
    select *
    from (values
      (
        'marketing_email',
        'Marketing bezpośredni — e-mail',
        'Marketing e-mail',
        'Zgadzam się na przesyłanie przez ' || organization_name
          || ' informacji handlowych, w tym marketingu bezpośredniego dotyczącego produktów i usług oferowanych przez '
          || organization_name
          || ', na podany adres e-mail, zgodnie z art. 398 ustawy – Prawo komunikacji elektronicznej. Zgoda jest dobrowolna i mogę ją w każdej chwili wycofać.',
        'Przesyłanie informacji handlowych i marketingu bezpośredniego produktów i usług oferowanych przez ' || organization_name || '.',
        'email',
        10
      ),
      (
        'marketing_sms',
        'Marketing bezpośredni — SMS/MMS',
        'Marketing SMS/MMS',
        'Zgadzam się na przesyłanie przez ' || organization_name
          || ' informacji handlowych, w tym marketingu bezpośredniego dotyczącego produktów i usług oferowanych przez '
          || organization_name
          || ', na podany numer telefonu za pomocą wiadomości SMS/MMS, zgodnie z art. 398 ustawy – Prawo komunikacji elektronicznej. Zgoda jest dobrowolna i mogę ją w każdej chwili wycofać.',
        'Przesyłanie informacji handlowych i marketingu bezpośredniego produktów i usług oferowanych przez ' || organization_name || ' przez SMS/MMS.',
        'sms',
        20
      ),
      (
        'marketing_phone',
        'Marketing bezpośredni — telefon',
        'Marketing telefoniczny',
        'Zgadzam się na używanie przez ' || organization_name
          || ' podanego numeru telefonu do połączeń głosowych w celu przekazywania informacji handlowych i marketingu bezpośredniego dotyczącego produktów i usług oferowanych przez '
          || organization_name
          || ', zgodnie z art. 398 ustawy – Prawo komunikacji elektronicznej. Zgoda jest dobrowolna i mogę ją w każdej chwili wycofać.',
        'Prowadzenie marketingu bezpośredniego produktów i usług oferowanych przez ' || organization_name || ' podczas połączeń głosowych.',
        'phone',
        30
      )
    ) as seeds(code, internal_name, display_title, content, purpose, channel, sort_order)
  loop
    if not exists (
      select 1
      from public.crm_consent_definitions definition
      where definition.organization_id = target_organization_id
        and definition.code = seed_record.code
    ) then
      new_definition_id := gen_random_uuid();
      new_version_id := gen_random_uuid();

      insert into public.crm_consent_definitions (
        id,
        organization_id,
        code,
        context,
        current_version_id
      ) values (
        new_definition_id,
        target_organization_id,
        seed_record.code,
        'client_creation',
        new_version_id
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
        status,
        sort_order,
        language_code,
        change_note
      ) values (
        new_version_id,
        target_organization_id,
        new_definition_id,
        1,
        seed_record.internal_name,
        seed_record.display_title,
        seed_record.content,
        seed_record.purpose,
        seed_record.channel,
        'art. 398 PKE w zw. z art. 6 ust. 1 lit. a RODO',
        'published',
        seed_record.sort_order,
        'pl',
        'Podstawowy zestaw startowy — treść wymaga zatwierdzenia przez prawników lub IOD przed użyciem produkcyjnym.'
      );
    end if;
  end loop;
end;
$$;


--
-- Name: provision_default_crm_consents_on_organization_insert(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.provision_default_crm_consents_on_organization_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.provision_default_crm_consents(new.id);
  return new;
end;
$$;


--
-- Name: prune_booking_widget_events(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prune_booking_widget_events() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- The existing trigger samples inserts, but every sampled cleanup is global.
  -- This also removes stale events for widgets that no longer receive traffic.
  if random() < 0.01 then
    delete from public.booking_widget_events event
    where event.occurred_at < now() - interval '120 days';
  end if;
  return new;
end;
$$;


--
-- Name: record_crm_task_audit(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.record_crm_task_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  audit_actor_user_id uuid;
  audit_payload jsonb;
begin
  audit_actor_user_id := coalesce(
    (select app.current_user_id()),
    new.delegator_user_id,
    new.assignee_user_id
  );
  audit_payload := jsonb_build_object(
    'task_id', new.id,
    'delegator_user_id', new.delegator_user_id,
    'assignee_user_id', new.assignee_user_id,
    'delegation_status', new.delegation_status,
    'status_code', new.status_code,
    'due_at', new.due_at,
    'data_access_scope', to_jsonb(new.data_access_scope)
  );

  if tg_op = 'INSERT' and new.delegation_status <> 'not_delegated' then
    insert into public.crm_activities (
      organization_id,
      actor_user_id,
      client_id,
      case_id,
      case_item_id,
      task_id,
      activity_type,
      title,
      body,
      payload,
      created_at
    )
    values (
      new.organization_id,
      audit_actor_user_id,
      new.client_id,
      new.case_id,
      new.case_item_id,
      new.id,
      'task_delegated',
      'Delegowano zadanie',
      new.title,
      audit_payload,
      new.delegated_at
    );

    if new.delegation_status = 'accepted' then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload, created_at
      )
      values (
        new.organization_id, new.assignee_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_delegation_accepted',
        'Przyjęto delegowane zadanie', new.title, audit_payload, new.accepted_at
      );
    elsif new.delegation_status = 'rejected' then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload, created_at
      )
      values (
        new.organization_id, new.assignee_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_delegation_rejected',
        'Odrzucono delegowane zadanie', new.rejection_reason,
        audit_payload || jsonb_build_object('reason', new.rejection_reason),
        new.rejected_at
      );
    elsif new.delegation_status = 'cancelled' then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload, created_at
      )
      values (
        new.organization_id, audit_actor_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_delegation_cancelled',
        'Anulowano delegowane zadanie', new.title, audit_payload, new.cancelled_at
      );
    end if;

    if new.status_code = 'done' then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload, created_at
      )
      values (
        new.organization_id, new.assignee_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_completed',
        'Zakończono delegowane zadanie', new.title, audit_payload, new.completed_at
      );
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.assignee_user_id is distinct from old.assignee_user_id then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload
      )
      values (
        new.organization_id, audit_actor_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_reassigned',
        'Przekazano zadanie innej osobie', new.title,
        audit_payload || jsonb_build_object(
          'previous_assignee_user_id', old.assignee_user_id
        )
      );
    end if;

    if new.delegation_status is distinct from old.delegation_status then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload
      )
      values (
        new.organization_id,
        audit_actor_user_id,
        new.client_id,
        new.case_id,
        new.case_item_id,
        new.id,
        case new.delegation_status
          when 'accepted' then 'task_delegation_accepted'
          when 'rejected' then 'task_delegation_rejected'
          when 'cancelled' then 'task_delegation_cancelled'
          else 'task_delegation_changed'
        end,
        case new.delegation_status
          when 'accepted' then 'Przyjęto delegowane zadanie'
          when 'rejected' then 'Odrzucono delegowane zadanie'
          when 'cancelled' then 'Anulowano delegowane zadanie'
          else 'Zmieniono delegację zadania'
        end,
        case
          when new.delegation_status = 'rejected' then new.rejection_reason
          else new.title
        end,
        audit_payload || jsonb_build_object(
          'previous_delegation_status', old.delegation_status,
          'reason', new.rejection_reason
        )
      );
    end if;

    if new.status_code is distinct from old.status_code then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload
      )
      values (
        new.organization_id,
        audit_actor_user_id,
        new.client_id,
        new.case_id,
        new.case_item_id,
        new.id,
        case when new.status_code = 'done'
          then 'task_completed'
          else 'task_status_changed'
        end,
        case when new.status_code = 'done'
          then 'Zakończono delegowane zadanie'
          else 'Zmieniono status delegowanego zadania'
        end,
        new.title,
        audit_payload || jsonb_build_object(
          'previous_status_code', old.status_code
        )
      );
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: refresh_appointment_omnisearch(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_appointment_omnisearch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  new.omnisearch_text := private.crm_search_normalize(concat_ws(
    ' ',
    new.customer_name,
    new.customer_email,
    new.customer_phone,
    nullif(regexp_replace(coalesce(new.customer_phone, ''), '[^0-9]+', '', 'g'), ''),
    new.notes,
    new.status,
    new.meeting_mode,
    new.source
  ));
  new.omnisearch_vector :=
    setweight(
      to_tsvector('simple', private.crm_search_normalize(new.customer_name)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        new.customer_email,
        new.customer_phone,
        nullif(regexp_replace(coalesce(new.customer_phone, ''), '[^0-9]+', '', 'g'), '')
      ))),
      'B'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        new.notes,
        new.status,
        new.meeting_mode,
        new.source
      ))),
      'C'
    );
  return new;
end;
$$;


--
-- Name: refresh_crm_bank_application_omnisearch(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_bank_application_omnisearch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  snapshot_bank_name text;
  snapshot_product_name text;
  snapshot_version_key text;
begin
  select
    snapshot.bank_name,
    snapshot.product_name,
    snapshot.version_key
  into
    snapshot_bank_name,
    snapshot_product_name,
    snapshot_version_key
  from public.crm_case_offer_snapshots snapshot
  where snapshot.organization_id = new.organization_id
    and snapshot.case_id = new.case_id
    and snapshot.id = new.offer_id;

  new.omnisearch_text := private.crm_search_normalize(concat_ws(
    ' ',
    snapshot_bank_name,
    snapshot_product_name,
    snapshot_version_key
  ));
  new.omnisearch_vector :=
    setweight(
      to_tsvector('simple', private.crm_search_normalize(snapshot_bank_name)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        snapshot_product_name,
        snapshot_version_key
      ))),
      'B'
    );
  return new;
end;
$$;


--
-- Name: refresh_crm_case_search_from_case(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_case_search_from_case() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  perform private.refresh_crm_case_search_projection(new.organization_id, new.id);
  return new;
end;
$$;


--
-- Name: refresh_crm_case_search_from_client(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_case_search_from_client() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  target record;
begin
  for target in
    select distinct case_client.organization_id, case_client.case_id
    from public.crm_case_clients case_client
    where (
      tg_op in ('UPDATE', 'DELETE')
      and case_client.organization_id = old.organization_id
      and case_client.client_id = old.id
    ) or (
      tg_op in ('INSERT', 'UPDATE')
      and case_client.organization_id = new.organization_id
      and case_client.client_id = new.id
    )
  loop
    perform private.refresh_crm_case_search_projection(
      target.organization_id,
      target.case_id
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: refresh_crm_case_search_from_product_type(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_case_search_from_product_type() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  target record;
begin
  for target in
    select distinct item.organization_id, item.case_id
    from public.crm_case_items item
    where item.product_type_id = new.id
  loop
    perform private.refresh_crm_case_search_projection(
      target.organization_id,
      target.case_id
    );
  end loop;

  return new;
end;
$$;


--
-- Name: refresh_crm_case_search_from_property(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_case_search_from_property() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  old_case_id uuid;
  new_case_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_case_id := old.case_id;
    if old_case_id is null and old.case_item_id is not null then
      select item.case_id
      into old_case_id
      from public.crm_case_items item
      where item.organization_id = old.organization_id
        and item.id = old.case_item_id;
    end if;
    if old_case_id is not null then
      perform private.refresh_crm_case_search_projection(old.organization_id, old_case_id);
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    new_case_id := new.case_id;
    if new_case_id is null and new.case_item_id is not null then
      select item.case_id
      into new_case_id
      from public.crm_case_items item
      where item.organization_id = new.organization_id
        and item.id = new.case_item_id;
    end if;
    if new_case_id is not null
       and (
         tg_op = 'INSERT'
         or (new.organization_id, new_case_id)
           is distinct from (old.organization_id, old_case_id)
       ) then
      perform private.refresh_crm_case_search_projection(new.organization_id, new_case_id);
    elsif tg_op = 'UPDATE' and new_case_id is not null then
      perform private.refresh_crm_case_search_projection(new.organization_id, new_case_id);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: refresh_crm_case_search_from_relation(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_case_search_from_relation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.refresh_crm_case_search_projection(old.organization_id, old.case_id);
  end if;

  if tg_op = 'INSERT'
     or (
       tg_op = 'UPDATE'
       and (new.organization_id, new.case_id)
         is distinct from (old.organization_id, old.case_id)
     ) then
    perform private.refresh_crm_case_search_projection(new.organization_id, new.case_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: refresh_crm_case_search_projection(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_case_search_projection(target_organization_id uuid, target_case_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  update public.crm_cases crm_case
  set (search_text, search_vector) = (
    select projection.search_text, projection.search_vector
    from private.crm_case_search_projection(
      target_organization_id,
      target_case_id
    ) projection
  )
  where crm_case.organization_id = target_organization_id
    and crm_case.id = target_case_id;
$$;


--
-- Name: refresh_crm_client_search_projection(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_client_search_projection() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.crm_clients client
    set (search_text, search_vector) = (
      select projection.search_text, projection.search_vector
      from private.crm_client_search_projection(
        old.organization_id,
        old.client_id
      ) projection
    )
    where client.organization_id = old.organization_id
      and client.id = old.client_id;
  end if;

  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and new.client_id is distinct from old.client_id) then
    update public.crm_clients client
    set (search_text, search_vector) = (
      select projection.search_text, projection.search_vector
      from private.crm_client_search_projection(
        new.organization_id,
        new.client_id
      ) projection
    )
    where client.organization_id = new.organization_id
      and client.id = new.client_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: refresh_crm_document_omnisearch(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_document_omnisearch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  new.omnisearch_text := private.crm_search_normalize(concat_ws(
    ' ',
    new.name,
    new.document_type,
    new.status_code
  ));
  new.omnisearch_vector :=
    setweight(
      to_tsvector('simple', private.crm_search_normalize(new.name)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        new.document_type,
        new.status_code
      ))),
      'B'
    );
  return new;
end;
$$;


--
-- Name: refresh_crm_submission_omnisearch(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_submission_omnisearch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  new.omnisearch_text := private.crm_search_normalize(concat_ws(
    ' ',
    new.external_reference,
    new.status_code,
    new.notes
  ));
  new.omnisearch_vector :=
    setweight(
      to_tsvector('simple', private.crm_search_normalize(new.external_reference)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        new.status_code,
        new.notes
      ))),
      'B'
    );
  return new;
end;
$$;


--
-- Name: refresh_crm_task_omnisearch(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.refresh_crm_task_omnisearch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  new.omnisearch_text := private.crm_search_normalize(concat_ws(
    ' ',
    new.title,
    new.description,
    new.status_code,
    new.priority,
    new.delegation_status
  ));
  new.omnisearch_vector :=
    setweight(
      to_tsvector('simple', private.crm_search_normalize(new.title)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        new.description,
        new.status_code,
        new.priority,
        new.delegation_status
      ))),
      'B'
    );
  return new;
end;
$$;


--
-- Name: reject_mortgage_bank_file_event_mutation(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.reject_mortgage_bank_file_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception using
    errcode = '55000',
    message = 'mortgage_bank_file_events_are_append_only';
end;
$$;


--
-- Name: reject_team_edge_cycle(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.reject_team_edge_cycle() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if private.team_edge_would_create_cycle(
    new.organization_id,
    new.parent_team_id,
    new.child_team_id
  ) then
    raise exception 'team_edge_would_create_cycle'
      using errcode = '23514', constraint = 'team_edges_acyclic';
  end if;

  return new;
end;
$$;


--
-- Name: release_expired_booking_holds(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.release_expired_booking_holds(target_facility_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  released_count integer;
begin
  update public.appointments appointment
  set status = 'cancelled',
      hold_expires_at = null,
      cancelled_at = now(),
      cancellation_reason = 'hold_expired'
  where appointment.status = 'hold'
    and appointment.hold_expires_at <= now()
    and (target_facility_id is null or appointment.facility_id = target_facility_id);

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;


--
-- Name: require_crm_bank_application_snapshot_to_start(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_crm_bank_application_snapshot_to_start() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  application_snapshot_status text;
begin
  if old.status_code = 'draft' and new.status_code <> 'draft' then
    select application.snapshot_status
    into application_snapshot_status
    from public.crm_case_bank_applications application
    where application.organization_id = new.organization_id
      and application.submission_id = new.id;

    if found and application_snapshot_status <> 'complete' then
      raise exception using
        errcode = '23514',
        message = 'A complete property calculation is required before starting the bank application';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: reset_calendar_connection_dependents(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.reset_calendar_connection_dependents() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if old.account_id is distinct from new.account_id
     or old.selected_calendar_id is distinct from new.selected_calendar_id then
    delete from public.external_busy_blocks busy
    where busy.organization_id = old.organization_id
      and busy.connection_id = old.id;
    delete from public.appointment_calendar_events calendar_event
    where calendar_event.organization_id = old.organization_id
      and calendar_event.connection_id = old.id;
  end if;
  return new;
end;
$$;


--
-- Name: resolve_widget_crm_client(uuid, uuid, uuid, text, text, text, jsonb, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.resolve_widget_crm_client(target_organization_id uuid, target_owner_user_id uuid, target_widget_id uuid, customer_name text, customer_email text, customer_phone text, consent_decisions jsonb, evidence_reference text) RETURNS TABLE(client_id uuid, client_person_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  submitted_email text := nullif(btrim(customer_email), '');
  submitted_phone text := nullif(btrim(customer_phone), '');
  normalized_email text := lower(submitted_email);
  normalized_phone text := nullif(regexp_replace(
    coalesce(submitted_phone, ''), '[^0-9]+', '', 'g'
  ), '');
  target_widget_type text;
  identity_key text;
  matched_client_ids uuid[] := '{}'::uuid[];
  possible_duplicate_exists boolean := false;
  resolved_client public.crm_clients;
  resolved_person public.crm_client_people;
  consent_record record;
  supplied_decision jsonb;
  decision_granted boolean;
  decision_contact_value text;
begin
  if normalized_email is null then
    raise exception 'customer_email_is_required' using errcode = '23514';
  end if;

  select widget.widget_type
  into target_widget_type
  from public.booking_widgets widget
  where widget.organization_id = target_organization_id
    and widget.id = target_widget_id;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  if normalized_phone is null then
    raise exception 'customer_phone_is_required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_owner_user_id
  ) then
    raise exception 'client_owner_not_organization_member' using errcode = '23503';
  end if;

  perform private.validate_widget_consent_decisions(
    target_organization_id,
    consent_decisions
  );

  -- Serialize requests that carry either identity. The exact-pair match below
  -- deliberately never joins an e-mail from one contact with another person's
  -- phone number.
  for identity_key in
    select identity.value
    from unnest(array[
      'email:' || normalized_email,
      case when normalized_phone is null then null else 'phone:' || normalized_phone end
    ]) identity(value)
    where identity.value is not null
    order by identity.value
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'openexpert-crm-client:' || target_organization_id::text || ':' || identity_key,
      0
    ));
  end loop;

  if normalized_phone is not null then
    select coalesce(
      array_agg(distinct candidate.client_id order by candidate.client_id),
      '{}'::uuid[]
    )
    into matched_client_ids
    from (
      select client.id as client_id
      from public.crm_clients client
      where client.organization_id = target_organization_id
        and client.primary_email_normalized = normalized_email
        and client.primary_phone_normalized = normalized_phone

      union all

      select person.client_id
      from public.crm_client_people person
      where person.organization_id = target_organization_id
        and person.email_normalized = normalized_email
        and person.phone_normalized = normalized_phone
    ) candidate;
  end if;

  if cardinality(matched_client_ids) > 1 then
    raise exception 'customer_contact_matches_multiple_clients'
      using errcode = 'P0001';
  end if;

  if cardinality(matched_client_ids) = 1 then
    select client.*
    into strict resolved_client
    from public.crm_clients client
    where client.organization_id = target_organization_id
      and client.id = matched_client_ids[1]
    for update;
  else
    select exists (
      select 1
      from public.crm_clients client
      where client.organization_id = target_organization_id
        and (
          client.primary_email_normalized = normalized_email
          or (
            normalized_phone is not null
            and client.primary_phone_normalized = normalized_phone
          )
        )
      union all
      select 1
      from public.crm_client_people person
      where person.organization_id = target_organization_id
        and (
          person.email_normalized = normalized_email
          or (
            normalized_phone is not null
            and person.phone_normalized = normalized_phone
          )
        )
    ) into possible_duplicate_exists;

    insert into public.crm_clients (
      organization_id,
      owner_user_id,
      display_name,
      status_code,
      lead_source,
      primary_email,
      primary_phone,
      tags,
      metadata
    ) values (
      target_organization_id,
      target_owner_user_id,
      btrim(customer_name),
      'lead',
      'booking_widget',
      submitted_email,
      submitted_phone,
      case
        when possible_duplicate_exists then array['possible-duplicate']::text[]
        else '{}'::text[]
      end,
      jsonb_build_object(
        'createdFromBookingWidget', true,
        'bookingWidgetId', target_widget_id,
        'identityVerification', 'self_declared',
        'possibleDuplicate', possible_duplicate_exists
      )
    )
    returning * into resolved_client;
  end if;

  select person.*
  into resolved_person
  from public.crm_client_people person
  where person.organization_id = target_organization_id
    and person.client_id = resolved_client.id
    and person.email_normalized = normalized_email
    and person.phone_normalized is not distinct from normalized_phone
  order by (person.role = 'primary') desc, person.created_at, person.id
  limit 1
  for update;

  if resolved_person.id is null then
    insert into public.crm_client_people (
      organization_id,
      client_id,
      role,
      display_name,
      email,
      phone,
      metadata
    ) values (
      target_organization_id,
      resolved_client.id,
      case
        when exists (
          select 1
          from public.crm_client_people person
          where person.organization_id = target_organization_id
            and person.client_id = resolved_client.id
        ) then 'booking_contact'
        else 'primary'
      end,
      btrim(customer_name),
      submitted_email,
      submitted_phone,
      jsonb_build_object(
        'createdFromBookingWidget', true,
        'bookingWidgetId', target_widget_id,
        'identityVerification', 'self_declared'
      )
    )
    returning * into resolved_person;
  end if;

  for consent_record in
    select definition.id as definition_id, consent_version.*
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = target_organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
    order by consent_version.sort_order, consent_version.display_title
  loop
    select decision
    into strict supplied_decision
    from jsonb_array_elements(consent_decisions) decision
    where decision ->> 'definition_id' = consent_record.definition_id::text
      and decision ->> 'version_id' = consent_record.id::text;

    decision_granted := (supplied_decision ->> 'granted')::boolean;
    decision_contact_value := case consent_record.channel
      when 'email' then submitted_email
      when 'sms' then submitted_phone
      when 'phone' then submitted_phone
      when 'messaging' then submitted_phone
      else coalesce(submitted_email, submitted_phone)
    end;

    if decision_granted and decision_contact_value is null then
      raise exception 'consent_contact_value_is_required' using errcode = '23514';
    end if;

    insert into public.crm_client_consent_events (
      organization_id,
      client_id,
      subject_person_id,
      definition_id,
      definition_version_id,
      decision,
      contact_value,
      source,
      recorded_by_user_id,
      evidence_reference,
      metadata
    ) values (
      target_organization_id,
      resolved_client.id,
      resolved_person.id,
      consent_record.definition_id,
      consent_record.id,
      case when decision_granted then 'granted' else 'declined' end,
      case when decision_granted then decision_contact_value else null end,
      'booking_widget',
      null,
      evidence_reference,
      jsonb_build_object(
        'form', 'booking_widget_v1',
        'bookingWidgetId', target_widget_id,
        'identityVerification', 'self_declared',
        'contactValueSource', 'booking_submission'
      )
    );
  end loop;

  return query select resolved_client.id, resolved_person.id;
end;
$$;


--
-- Name: set_crm_client_search_projection(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_crm_client_search_projection() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  people_text text;
  identifiers_text text;
  primary_phone_digits text;
begin
  select string_agg(concat_ws(
    ' ',
    person.display_name,
    person.first_name,
    person.last_name,
    person.email,
    person.phone,
    person.phone_normalized,
    person.pesel,
    nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
  ), ' ' order by person.created_at, person.id)
  into people_text
  from public.crm_client_people person
  where person.organization_id = new.organization_id
    and person.client_id = new.id;

  primary_phone_digits := nullif(
    regexp_replace(coalesce(new.primary_phone, ''), '[^0-9]+', '', 'g'),
    ''
  );
  identifiers_text := concat_ws(
    ' ',
    new.metadata ->> 'tax_id',
    new.metadata ->> 'nip',
    new.metadata ->> 'regon',
    new.metadata ->> 'krs',
    new.metadata ->> 'registry_number',
    nullif(regexp_replace(coalesce(new.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), '')
  );

  new.search_text := private.crm_search_normalize(concat_ws(
    ' ',
    new.display_name,
    new.primary_email,
    new.primary_phone,
    primary_phone_digits,
    new.lead_source,
    new.notes,
    array_to_string(new.tags, ' '),
    identifiers_text,
    people_text
  ));
  new.search_vector :=
    setweight(to_tsvector('simple', private.crm_search_normalize(new.display_name)), 'A')
    || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
      ' ',
      new.primary_email,
      new.primary_phone,
      primary_phone_digits,
      array_to_string(new.tags, ' ')
    ))), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(identifiers_text)), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(people_text)), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
      ' ', new.lead_source, new.notes
    ))), 'C');

  return new;
end;
$$;


--
-- Name: shares_organization(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.shares_organization(target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select target_user_id = (select app.current_user_id())
    or exists (
      select 1
      from public.organization_memberships mine
      join public.organization_memberships theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = (select app.current_user_id())
        and theirs.user_id = target_user_id
    );
$$;


--
-- Name: staff_booking_result(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.staff_booking_result(target_appointment_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', appointment.id,
      'organizationId', appointment.organization_id,
      'facilityId', appointment.facility_id,
      'serviceId', appointment.service_id,
      'expertUserId', appointment.expert_user_id,
      'clientId', appointment.client_id,
      'clientPersonId', appointment.client_person_id,
      'startsAt', appointment.starts_at,
      'endsAt', appointment.ends_at,
      'timezone', appointment.timezone,
      'status', appointment.status,
      'source', appointment.source,
      'meetingMode', appointment.meeting_mode,
      'meetingUrl', appointment.meeting_url,
      'customerName', appointment.customer_name,
      'customerEmail', appointment.customer_email,
      'customerPhone', appointment.customer_phone,
      'notes', appointment.notes,
      'createdByUserId', appointment.created_by_user_id,
      'createdAt', appointment.created_at
    )
  )
  from public.appointments appointment
  where appointment.id = target_appointment_id;
$$;


--
-- Name: sync_appointment_reservation(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.sync_appointment_reservation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  service_record record;
  reservation_period tstzrange;
begin
  select service.buffer_before_minutes, service.buffer_after_minutes
  into strict service_record
  from public.booking_services service
  where service.organization_id = new.organization_id
    and service.id = new.service_id;

  reservation_period := tstzrange(
    new.starts_at - make_interval(mins => service_record.buffer_before_minutes),
    new.ends_at + make_interval(mins => service_record.buffer_after_minutes),
    '[)'
  );

  if tg_op = 'UPDATE' and old.expert_user_id <> new.expert_user_id then
    delete from public.appointment_resource_reservations reservation
    where reservation.organization_id = old.organization_id
      and reservation.appointment_id = old.id
      and reservation.resource_type = 'expert'
      and reservation.resource_id = old.expert_user_id;
  end if;

  insert into public.appointment_resource_reservations (
    organization_id,
    appointment_id,
    resource_type,
    resource_id,
    busy_period,
    status,
    hold_expires_at
  ) values (
    new.organization_id,
    new.id,
    'expert',
    new.expert_user_id,
    reservation_period,
    new.status,
    new.hold_expires_at
  )
  on conflict (organization_id, appointment_id, resource_type, resource_id)
  do update set
    busy_period = excluded.busy_period,
    status = excluded.status,
    hold_expires_at = excluded.hold_expires_at,
    updated_at = now();

  return new;
end;
$$;


--
-- Name: sync_expert_time_off_reservation(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.sync_expert_time_off_reservation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status = 'active' then
    perform private.release_expired_booking_holds();
  end if;

  if tg_op = 'UPDATE'
     and old.expert_user_id is distinct from new.expert_user_id then
    delete from public.appointment_resource_reservations reservation
    where reservation.organization_id = old.organization_id
      and reservation.time_off_id = old.id
      and reservation.resource_type = 'expert'
      and reservation.resource_id = old.expert_user_id;
  end if;

  insert into public.appointment_resource_reservations (
    organization_id,
    appointment_id,
    time_off_id,
    resource_type,
    resource_id,
    busy_period,
    status,
    hold_expires_at
  ) values (
    new.organization_id,
    null,
    new.id,
    'expert',
    new.expert_user_id,
    new.time_off_period,
    case when new.status = 'active' then 'confirmed' else 'cancelled' end,
    null
  )
  on conflict (
    organization_id,
    time_off_id,
    resource_type,
    resource_id
  ) where time_off_id is not null
  do update set
    busy_period = excluded.busy_period,
    status = excluded.status,
    hold_expires_at = null,
    updated_at = now();

  return new;
end;
$$;


--
-- Name: team_edge_would_create_cycle(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.team_edge_would_create_cycle(target_organization_id uuid, target_parent_team_id uuid, target_child_team_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with recursive descendants(team_id) as (
    select edge.child_team_id
    from public.team_edges edge
    where edge.organization_id = target_organization_id
      and edge.parent_team_id = target_child_team_id

    union

    select edge.child_team_id
    from public.team_edges edge
    join descendants current_path
      on current_path.team_id = edge.parent_team_id
    where edge.organization_id = target_organization_id
  )
  select target_parent_team_id = target_child_team_id
    or exists (
      select 1
      from descendants
      where team_id = target_parent_team_id
    );
$$;


--
-- Name: user_can_view_client_privacy(uuid, uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.user_can_view_client_privacy(target_organization_id uuid, target_client_id uuid, target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select target_user_id is not null
    and (
      private.user_has_administrative_permission(
        target_organization_id,
        target_user_id,
        'privacy.requests.read'
      )
      or private.user_has_administrative_permission(
        target_organization_id,
        target_user_id,
        'privacy.requests.create'
      )
      or exists (
        select 1
        from public.crm_clients client
        where client.organization_id = target_organization_id
          and client.id = target_client_id
          and client.owner_user_id = target_user_id
      )
    );
$$;


--
-- Name: user_has_administrative_permission(uuid, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.user_has_administrative_permission(target_organization_id uuid, target_user_id uuid, target_permission_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: user_has_administrative_role(uuid, uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.user_has_administrative_role(target_organization_id uuid, target_user_id uuid, target_role_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: validate_crm_case_bank_application_snapshot(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.validate_crm_case_bank_application_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'UPDATE' and old.snapshot_status = 'complete' and new is distinct from old then
    raise exception using errcode = '23514', message = 'A complete mortgage application calculation snapshot is immutable';
  end if;

  if tg_op = 'UPDATE'
    and old.snapshot_status <> 'complete'
    and new.snapshot_status = 'complete'
    and current_user <> 'openexpert_service' then
    raise exception using errcode = '42501', message = 'Only the trusted server may finalize a mortgage application calculation snapshot';
  end if;

  return new;
end;
$$;


--
-- Name: validate_crm_case_offer_snapshot_insert(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.validate_crm_case_offer_snapshot_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  canonical_version public.mortgage_product_versions%rowtype;
begin
  if current_user not in ('openexpert_service', 'postgres') then
    raise exception using
      errcode = '42501',
      message = 'Saved mortgage offers may only be created by the trusted server';
  end if;

  if new.offer_type <> 'mortgage'
    or new.mortgage_product_id is null
    or new.mortgage_product_version_id is null
    or new.bank_id is null
    or new.saved_by_user_id is null
    or new.version_key is null
    or btrim(new.version_key) = '' then
    raise exception using
      errcode = '23514',
      message = 'Saved mortgage offer provenance is incomplete';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.saved_by_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'The user saving a mortgage offer must belong to its organization';
  end if;

  select version.*
  into canonical_version
  from public.mortgage_products product
  join public.mortgage_product_versions version
    on version.product_id = product.id
   and version.id = product.current_published_version_id
  where product.id = new.mortgage_product_id
    and product.bank_id = new.bank_id
    and product.is_active
    and product.archived_at is null
    and version.id = new.mortgage_product_version_id
    and version.lifecycle_status = 'published';

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Saved mortgage offer does not reference the current published bank product version';
  end if;

  if new.version_key <> canonical_version.version_key
    or jsonb_typeof(new.catalog_snapshot -> 'baseVersion') is distinct from 'object'
    or jsonb_typeof(new.catalog_snapshot -> 'version') is distinct from 'object'
    or new.catalog_snapshot ->> 'id' is distinct from new.mortgage_product_id::text
    or new.catalog_snapshot #>> '{bank,id}' is distinct from new.bank_id::text
    or new.catalog_snapshot #>> '{baseVersion,id}' is distinct from canonical_version.id::text
    or new.catalog_snapshot #>> '{baseVersion,version_key}' is distinct from canonical_version.version_key
    or new.catalog_snapshot #>> '{baseVersion,content_sha256}' is distinct from canonical_version.content_sha256
    or new.catalog_snapshot #>> '{version,id}' is distinct from canonical_version.id::text
    or new.catalog_snapshot #>> '{version,version_key}' is distinct from canonical_version.version_key
    or new.catalog_snapshot #>> '{version,content_sha256}' is distinct from canonical_version.content_sha256
    or not (
      to_jsonb(canonical_version)
      <@ (new.catalog_snapshot -> 'baseVersion')
    ) then
    raise exception using
      errcode = '23514',
      message = 'Saved mortgage offer catalogue payload does not match its published version';
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION validate_crm_case_offer_snapshot_insert(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.validate_crm_case_offer_snapshot_insert() IS 'Accepts only trusted-server snapshots of the exact current published mortgage version and an organization member as actor.';


--
-- Name: validate_crm_client_owner_assignment(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.validate_crm_client_owner_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_id uuid := (select app.current_user_id());
begin
  if new.owner_user_id is null then
    raise exception 'client_owner_is_required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.owner_user_id
  ) then
    raise exception 'client_owner_not_organization_member' using errcode = '23503';
  end if;

  -- Direct database/service-role maintenance has no auth subject and remains
  -- protected by the same-organization foreign key above.
  if actor_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
    and new.owner_user_id <> actor_id
    and not private.is_organization_admin(new.organization_id)
  then
    raise exception 'client_owner_assignment_admin_required' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
    and new.owner_user_id is distinct from old.owner_user_id
    and not private.is_organization_admin(new.organization_id)
  then
    raise exception 'client_owner_assignment_admin_required' using errcode = '42501';
  end if;

  return new;
end;
$$;


--
-- Name: validate_crm_product_type_scope(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.validate_crm_product_type_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.crm_product_types product_type
    where product_type.id = new.product_type_id
      and (
        product_type.organization_id is null
        or product_type.organization_id = new.organization_id
      )
  ) then
    raise exception 'crm_product_type_outside_organization'
      using errcode = '23503', constraint = 'crm_case_items_product_type_organization';
  end if;

  return new;
end;
$$;


--
-- Name: validate_crm_task_delegation(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.validate_crm_task_delegation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  caller_user_id uuid := (select app.current_user_id());
begin
  if new.delegation_status = 'not_delegated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if caller_user_id is not null
      and new.delegation_status <> 'pending'
    then
      raise exception 'delegated_task_must_start_pending'
        using errcode = '23514',
              constraint = 'crm_tasks_delegation_initial_status';
    end if;
    new.delegated_at := case
      when caller_user_id is null then coalesce(new.delegated_at, now())
      else now()
    end;
  else
    if old.delegation_status <> 'not_delegated' and (
      new.organization_id is distinct from old.organization_id
      or new.client_id is distinct from old.client_id
      or new.case_id is distinct from old.case_id
      or new.delegator_user_id is distinct from old.delegator_user_id
      or new.idempotency_key is distinct from old.idempotency_key
      or new.idempotency_fingerprint is distinct from old.idempotency_fingerprint
    ) then
      raise exception 'delegated_task_identity_is_immutable'
        using errcode = '23514',
              constraint = 'crm_tasks_delegated_identity_immutable';
    end if;

    if new.assignee_user_id is distinct from old.assignee_user_id
      and caller_user_id is not null
      and caller_user_id <> old.delegator_user_id
      and not private.is_organization_admin(old.organization_id)
    then
      raise exception 'task_reassignment_requires_delegator'
        using errcode = '42501';
    end if;

    if new.assignee_user_id is distinct from old.assignee_user_id then
      if old.delegation_status in ('rejected', 'cancelled') then
        raise exception 'resolved_task_cannot_be_reassigned'
          using errcode = '23514',
                constraint = 'crm_tasks_resolved_reassignment';
      end if;
      if old.delegation_status = 'accepted' then
        new.delegation_status := 'pending';
      end if;
      new.delegated_at := case
        when caller_user_id is null then coalesce(new.delegated_at, now())
        else now()
      end;
    end if;

    if caller_user_id is not null
      and caller_user_id = old.assignee_user_id
      and caller_user_id <> old.delegator_user_id
      and not private.is_organization_admin(old.organization_id)
      and (
        new.assignee_user_id is distinct from old.assignee_user_id
        or new.case_item_id is distinct from old.case_item_id
        or new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.priority is distinct from old.priority
        or new.due_at is distinct from old.due_at
        or new.data_access_scope is distinct from old.data_access_scope
        or new.metadata is distinct from old.metadata
        or new.delegated_at is distinct from old.delegated_at
        or new.responded_at is distinct from old.responded_at
        or new.accepted_at is distinct from old.accepted_at
        or new.rejected_at is distinct from old.rejected_at
        or new.cancelled_at is distinct from old.cancelled_at
        or new.completed_at is distinct from old.completed_at
        or (
          old.delegation_status = 'rejected'
          and new.rejection_reason is distinct from old.rejection_reason
        )
      )
    then
      raise exception 'assignee_cannot_change_task_definition'
        using errcode = '42501';
    end if;

    if new.delegation_status is distinct from old.delegation_status then
      if not (
        (old.delegation_status = 'not_delegated' and new.delegation_status = 'pending')
        or (old.delegation_status = 'pending' and new.delegation_status in ('accepted', 'rejected', 'cancelled'))
        or (old.delegation_status = 'accepted' and new.delegation_status = 'cancelled')
        or (
          old.delegation_status = 'accepted'
          and new.delegation_status = 'pending'
          and new.assignee_user_id is distinct from old.assignee_user_id
        )
      ) then
        raise exception 'invalid_task_delegation_transition'
          using errcode = '23514',
                constraint = 'crm_tasks_delegation_transition';
      end if;

      if new.delegation_status in ('accepted', 'rejected')
        and caller_user_id is not null
        and caller_user_id <> old.assignee_user_id
        and not private.is_organization_admin(old.organization_id)
      then
        raise exception 'task_response_requires_assignee'
          using errcode = '42501';
      end if;

      if new.delegation_status = 'cancelled'
        and caller_user_id is not null
        and caller_user_id <> old.delegator_user_id
        and not private.is_organization_admin(old.organization_id)
      then
        raise exception 'task_cancellation_requires_delegator'
          using errcode = '42501';
      end if;
    end if;
  end if;

  case new.delegation_status
    when 'pending' then
      new.responded_at := null;
      new.accepted_at := null;
      new.rejected_at := null;
      new.cancelled_at := null;
      new.rejection_reason := null;
      new.status_code := 'open';
    when 'accepted' then
      if tg_op = 'INSERT'
        or old.delegation_status is distinct from new.delegation_status
      then
        new.accepted_at := case
          when caller_user_id is null
            then coalesce(new.accepted_at, new.responded_at, now())
          else now()
        end;
      end if;
      new.responded_at := new.accepted_at;
      new.rejected_at := null;
      new.cancelled_at := null;
      new.rejection_reason := null;
    when 'rejected' then
      if nullif(btrim(new.rejection_reason), '') is null then
        raise exception 'task_rejection_reason_required'
          using errcode = '23514',
                constraint = 'crm_tasks_rejection_reason_required';
      end if;
      if tg_op = 'INSERT'
        or old.delegation_status is distinct from new.delegation_status
      then
        new.rejected_at := case
          when caller_user_id is null
            then coalesce(new.rejected_at, new.responded_at, now())
          else now()
        end;
      end if;
      new.responded_at := new.rejected_at;
      new.accepted_at := null;
      new.cancelled_at := null;
      new.status_code := 'cancelled';
      new.completed_at := null;
    when 'cancelled' then
      if tg_op = 'INSERT'
        or old.delegation_status is distinct from new.delegation_status
      then
        new.cancelled_at := case
          when caller_user_id is null then coalesce(new.cancelled_at, now())
          else now()
        end;
      end if;
      new.responded_at := case
        when new.accepted_at is not null then new.accepted_at
        else null
      end;
      new.rejected_at := null;
      new.rejection_reason := null;
      new.status_code := 'cancelled';
      new.completed_at := null;
    else
      null;
  end case;

  if new.status_code = 'done' then
    if new.delegation_status <> 'accepted' then
      raise exception 'only_accepted_task_can_be_completed'
        using errcode = '23514',
              constraint = 'crm_tasks_completion_requires_acceptance';
    end if;
    new.completed_at := coalesce(new.completed_at, now());
  elsif tg_op = 'UPDATE' and old.status_code = 'done' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;


--
-- Name: validate_facility_timezone(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.validate_facility_timezone() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = new.timezone
  ) then
    raise exception 'invalid_iana_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;


--
-- Name: validate_mortgage_document_template_active_state(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.validate_mortgage_document_template_active_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: FUNCTION validate_mortgage_document_template_active_state(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.validate_mortgage_document_template_active_state() IS 'Requires active PDF template state to equal its immutable published revision.';


--
-- Name: validate_mortgage_product_version_document_template(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.validate_mortgage_product_version_document_template() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: FUNCTION validate_mortgage_product_version_document_template(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.validate_mortgage_product_version_document_template() IS 'Requires product versions to pin a published template revision for the same bank.';


--
-- Name: validate_widget_consent_decisions(uuid, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.validate_widget_consent_decisions(target_organization_id uuid, consent_decisions jsonb) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  active_consent_count integer;
begin
  if jsonb_typeof(coalesce(consent_decisions, '[]'::jsonb)) <> 'array' then
    raise exception 'consent_decisions_must_be_an_array' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(consent_decisions, '[]'::jsonb)) decision
    where jsonb_typeof(decision) <> 'object'
      or jsonb_typeof(decision -> 'granted') is distinct from 'boolean'
      or nullif(decision ->> 'definition_id', '') is null
      or nullif(decision ->> 'version_id', '') is null
  ) then
    raise exception 'consent_decision_is_invalid' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(consent_decisions, '[]'::jsonb)) decision
    group by decision ->> 'definition_id'
    having count(*) > 1
  ) then
    raise exception 'duplicate_consent_decision' using errcode = '23514';
  end if;

  select count(*)
  into active_consent_count
  from public.crm_consent_definitions definition
  join public.crm_consent_definition_versions consent_version
    on consent_version.organization_id = definition.organization_id
   and consent_version.definition_id = definition.id
   and consent_version.id = definition.current_version_id
  where definition.organization_id = target_organization_id
    and definition.context = 'client_creation'
    and consent_version.status = 'published'
    and consent_version.effective_from <= now()
    and (consent_version.effective_to is null or consent_version.effective_to > now());

  if jsonb_array_length(coalesce(consent_decisions, '[]'::jsonb)) <> active_consent_count then
    raise exception 'consent_catalogue_is_stale' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(consent_decisions, '[]'::jsonb)) decision
    where not exists (
      select 1
      from public.crm_consent_definitions definition
      join public.crm_consent_definition_versions consent_version
        on consent_version.organization_id = definition.organization_id
       and consent_version.definition_id = definition.id
       and consent_version.id = definition.current_version_id
      where definition.organization_id = target_organization_id
        and definition.context = 'client_creation'
        and definition.id::text = decision ->> 'definition_id'
        and consent_version.id::text = decision ->> 'version_id'
        and consent_version.status = 'published'
        and consent_version.effective_from <= now()
        and (consent_version.effective_to is null or consent_version.effective_to > now())
    )
  ) then
    raise exception 'consent_catalogue_is_stale' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = target_organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.is_required
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(consent_decisions, '[]'::jsonb)) decision
        where decision ->> 'definition_id' = definition.id::text
          and decision ->> 'version_id' = consent_version.id::text
          and (decision ->> 'granted')::boolean is true
      )
  ) then
    raise exception 'required_consent_not_granted' using errcode = '23514';
  end if;
end;
$$;


--
-- Name: widget_booking_result(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.widget_booking_result(target_appointment_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', appointment.id,
      'status', appointment.status,
      'startsAt', appointment.starts_at,
      'endsAt', appointment.ends_at,
      'facilityId', appointment.facility_id,
      'facilityName', facility.name,
      'serviceId', appointment.service_id,
      'serviceName', service.name,
      'clientId', appointment.client_id,
      'clientPersonId', appointment.client_person_id,
      'expert', jsonb_build_object(
        'userId', appointment.expert_user_id,
        'name', coalesce(app_user.full_name, 'Ekspert')
      )
    ),
    'managementToken', appointment.manage_token
  )
  from public.appointments appointment
  join public.facilities facility
    on facility.organization_id = appointment.organization_id
   and facility.id = appointment.facility_id
  join public.booking_services service
    on service.organization_id = appointment.organization_id
   and service.id = appointment.service_id
  join public.users app_user on app_user.id = appointment.expert_user_id
  where appointment.id = target_appointment_id;
$$;


--
-- Name: add_organization_member_by_email(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_organization_member_by_email(organization_id uuid, email text, role text DEFAULT 'expert'::text) RETURNS SETOF public.organization_memberships
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select inserted_membership.*
  from private.add_organization_member_by_email(organization_id, email, role) as inserted_membership;
$$;


--
-- Name: add_team_edge(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_team_edge(organization_id uuid, parent_team_id uuid, child_team_id uuid) RETURNS SETOF public.team_edges
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select inserted_edge.*
  from private.add_team_edge(organization_id, parent_team_id, child_team_id) as inserted_edge;
$$;


--
-- Name: consume_booking_rate_limit(uuid, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_booking_rate_limit(p_widget_token uuid, p_scope text, p_client_key text, p_limit integer, p_window_seconds integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  target_widget_id uuid;
  window_start timestamptz;
  current_count bigint;
  retry_after integer;
begin
  if p_scope not in ('catalog', 'slots', 'booking', 'analytics')
     or nullif(btrim(p_client_key), '') is null
     or length(p_client_key) > 128
     or p_limit not between 1 and 10000
     or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_booking_rate_limit_request' using errcode = '22023';
  end if;

  select widget.id
  into target_widget_id
  from public.booking_widgets widget
  where widget.public_token = p_widget_token
    and (widget.is_active or p_scope = 'booking');

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.booking_rate_limits (
    widget_id,
    rate_scope,
    client_key,
    window_started_at,
    request_count
  ) values (
    target_widget_id,
    p_scope,
    p_client_key,
    window_start,
    1
  )
  on conflict (widget_id, rate_scope, client_key, window_started_at)
  do update set request_count = public.booking_rate_limits.request_count + 1
  returning request_count into current_count;

  delete from public.booking_rate_limits rate_limit
  where rate_limit.window_started_at < clock_timestamp() - interval '1 day';

  if current_count <= p_limit then
    return 0;
  end if;

  retry_after := ceil(extract(epoch from (
    window_start + make_interval(secs => p_window_seconds) - clock_timestamp()
  )))::integer;
  return greatest(1, retry_after);
end;
$$;


--
-- Name: crm_case_bank_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_bank_applications (
    submission_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    case_item_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    bank_id uuid NOT NULL,
    property_id uuid,
    slot smallint NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot_status text DEFAULT 'legacy_missing'::text NOT NULL,
    snapshot_schema_version text,
    calculator_version text,
    comparison_baseline_offer_id uuid,
    scenario_snapshot jsonb,
    calculation_snapshot jsonb,
    purchase_price_amount numeric(14,2),
    appraisal_value_amount numeric(14,2),
    net_loan_amount numeric(14,2),
    gross_loan_amount numeric(14,2),
    financed_costs numeric(14,2),
    ltv_debt_basis text,
    collateral_value_basis text,
    ltv_debt_amount numeric(14,2),
    collateral_value_amount numeric(14,2),
    ltv_pct numeric(9,5),
    first_installment numeric(14,2),
    first_monthly_outflow numeric(14,2),
    cost_first_five_years numeric(14,2),
    total_cost numeric(14,2),
    calculated_at timestamp with time zone,
    omnisearch_text text DEFAULT ''::text NOT NULL,
    omnisearch_vector tsvector DEFAULT ''::tsvector NOT NULL,
    CONSTRAINT crm_case_bank_applications_complete_snapshot_check CHECK (((snapshot_status <> 'complete'::text) OR ((property_id IS NOT NULL) AND (snapshot_schema_version = '1.0'::text) AND (calculator_version IS NOT NULL) AND (comparison_baseline_offer_id IS NOT NULL) AND (scenario_snapshot IS NOT NULL) AND (calculation_snapshot IS NOT NULL) AND (NOT ((scenario_snapshot ->> 'sourceOfferId'::text) IS DISTINCT FROM (offer_id)::text)) AND (purchase_price_amount IS NOT NULL) AND (net_loan_amount IS NOT NULL) AND (gross_loan_amount IS NOT NULL) AND (financed_costs IS NOT NULL) AND (ltv_debt_basis IS NOT NULL) AND (collateral_value_basis IS NOT NULL) AND (ltv_debt_amount IS NOT NULL) AND (collateral_value_amount IS NOT NULL) AND (ltv_pct IS NOT NULL) AND (first_installment IS NOT NULL) AND (first_monthly_outflow IS NOT NULL) AND (cost_first_five_years IS NOT NULL) AND (total_cost IS NOT NULL) AND (calculated_at IS NOT NULL)))),
    CONSTRAINT crm_case_bank_applications_ltv_consistency_check CHECK (((snapshot_status <> 'complete'::text) OR ((((ltv_debt_basis = 'net_loan'::text) AND (abs((ltv_debt_amount - net_loan_amount)) <= 0.01)) OR ((ltv_debt_basis = ANY (ARRAY['gross_loan'::text, 'facility_limit'::text])) AND (abs((ltv_debt_amount - gross_loan_amount)) <= 0.01))) AND (((collateral_value_basis = 'purchase_price'::text) AND (abs((collateral_value_amount - purchase_price_amount)) <= 0.01)) OR ((collateral_value_basis = 'appraisal_value'::text) AND (appraisal_value_amount IS NOT NULL) AND (abs((collateral_value_amount - appraisal_value_amount)) <= 0.01)) OR ((collateral_value_basis = 'lower_of_purchase_and_appraisal'::text) AND (appraisal_value_amount IS NOT NULL) AND (abs((collateral_value_amount - LEAST(purchase_price_amount, appraisal_value_amount))) <= 0.01))) AND (abs((ltv_pct - ((ltv_debt_amount / NULLIF(collateral_value_amount, (0)::numeric)) * (100)::numeric))) <= 0.00501)))),
    CONSTRAINT crm_case_bank_applications_pending_property_check CHECK (((snapshot_status <> 'pending_property'::text) OR (property_id IS NULL))),
    CONSTRAINT crm_case_bank_applications_slot_check CHECK (((slot >= 1) AND (slot <= 3))),
    CONSTRAINT crm_case_bank_applications_snapshot_amounts_check CHECK ((((purchase_price_amount IS NULL) OR (purchase_price_amount > (0)::numeric)) AND ((appraisal_value_amount IS NULL) OR (appraisal_value_amount > (0)::numeric)) AND ((net_loan_amount IS NULL) OR (net_loan_amount > (0)::numeric)) AND ((gross_loan_amount IS NULL) OR (gross_loan_amount > (0)::numeric)) AND ((financed_costs IS NULL) OR (financed_costs >= (0)::numeric)) AND ((ltv_debt_amount IS NULL) OR (ltv_debt_amount > (0)::numeric)) AND ((collateral_value_amount IS NULL) OR (collateral_value_amount > (0)::numeric)) AND ((ltv_pct IS NULL) OR (ltv_pct >= (0)::numeric)) AND ((first_installment IS NULL) OR (first_installment >= (0)::numeric)) AND ((first_monthly_outflow IS NULL) OR (first_monthly_outflow >= (0)::numeric)) AND ((cost_first_five_years IS NULL) OR (cost_first_five_years >= (0)::numeric)) AND ((total_cost IS NULL) OR (total_cost >= (0)::numeric)) AND ((gross_loan_amount IS NULL) OR (net_loan_amount IS NULL) OR (gross_loan_amount >= net_loan_amount)))),
    CONSTRAINT crm_case_bank_applications_snapshot_json_check CHECK ((((scenario_snapshot IS NULL) OR (jsonb_typeof(scenario_snapshot) = 'object'::text)) AND ((calculation_snapshot IS NULL) OR (jsonb_typeof(calculation_snapshot) = 'object'::text)))),
    CONSTRAINT crm_case_bank_applications_snapshot_status_check CHECK ((snapshot_status = ANY (ARRAY['legacy_missing'::text, 'pending_property'::text, 'complete'::text])))
);


--
-- Name: TABLE crm_case_bank_applications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_case_bank_applications IS 'Mortgage-specific extension of up to three generic CRM submissions, one per bank.';


--
-- Name: COLUMN crm_case_bank_applications.calculation_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_case_bank_applications.calculation_snapshot IS 'Immutable server-calculated property x frozen-offer result used for this bank application.';


--
-- Name: create_crm_case_bank_application(uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_crm_case_bank_application(target_organization_id uuid, target_case_id uuid, target_offer_id uuid, target_property_id uuid DEFAULT NULL::uuid) RETURNS public.crm_case_bank_applications
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  target_bank_id uuid;
  target_bank_name text;
  target_currency char(3);
  target_product_type_id uuid;
  target_case_item_id uuid;
  target_submission_id uuid;
  target_slot smallint;
  actor_user_id uuid := (select app.current_user_id());
  result public.crm_case_bank_applications;
begin
  if current_user <> 'openexpert_service'
    and not private.is_organization_member(target_organization_id) then
    raise exception using errcode = '42501', message = 'Organization membership is required';
  end if;

  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = target_organization_id
    and crm_case.id = target_case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CRM case not found';
  end if;

  if exists (
    select 1
    from public.crm_case_contract_selections contract
    where contract.organization_id = target_organization_id
      and contract.case_id = target_case_id
  ) then
    raise exception using errcode = '23514', message = 'A credit agreement has already been signed for this CRM case';
  end if;

  select snapshot.bank_id, snapshot.bank_name, snapshot.currency
  into target_bank_id, target_bank_name, target_currency
  from public.crm_case_offer_snapshots snapshot
  where snapshot.organization_id = target_organization_id
    and snapshot.case_id = target_case_id
    and snapshot.id = target_offer_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Saved mortgage offer not found';
  end if;
  if target_bank_id is null then
    raise exception using errcode = '23514', message = 'Saved offer is not linked to an active mortgage bank';
  end if;

  if target_property_id is not null and not exists (
    select 1
    from public.crm_properties property
    where property.organization_id = target_organization_id
      and property.case_id = target_case_id
      and property.id = target_property_id
  ) then
    raise exception using errcode = '23503', message = 'Property does not belong to the CRM case';
  end if;

  if exists (
    select 1
    from public.crm_case_bank_applications application
    where application.organization_id = target_organization_id
      and application.case_id = target_case_id
      and application.bank_id = target_bank_id
  ) then
    raise exception using errcode = '23505', message = 'This bank already has an application in the CRM case';
  end if;

  select available_slot.slot
  into target_slot
  from generate_series(1, 3) available_slot(slot)
  where not exists (
    select 1
    from public.crm_case_bank_applications application
    where application.organization_id = target_organization_id
      and application.case_id = target_case_id
      and application.slot = available_slot.slot
  )
  order by available_slot.slot
  limit 1;
  if target_slot is null then
    raise exception using errcode = '23514', message = 'A CRM case can have at most three parallel bank applications';
  end if;

  select item.id
  into target_case_item_id
  from public.crm_case_items item
  join public.crm_product_types product_type on product_type.id = item.product_type_id
  where item.organization_id = target_organization_id
    and item.case_id = target_case_id
    and product_type.code = 'credit_mortgage'
  order by item.created_at, item.id
  limit 1;

  if target_case_item_id is null then
    select product_type.id
    into target_product_type_id
    from public.crm_product_types product_type
    where product_type.code = 'credit_mortgage'
      and product_type.is_active = true
      and (product_type.organization_id is null or product_type.organization_id = target_organization_id)
    order by (product_type.organization_id is not null) desc, product_type.id
    limit 1;
    if target_product_type_id is null then
      raise exception using errcode = 'P0002', message = 'Mortgage product type is not configured';
    end if;

    insert into public.crm_case_items (
      organization_id,
      case_id,
      product_type_id,
      owner_user_id,
      title,
      status_code,
      currency,
      metadata
    ) values (
      target_organization_id,
      target_case_id,
      target_product_type_id,
      actor_user_id,
      'Kredyt hipoteczny',
      'wniosek',
      target_currency,
      jsonb_build_object('managedBy', 'mortgage_applications')
    )
    returning id into target_case_item_id;
  end if;

  insert into public.crm_item_submissions (
    organization_id,
    case_item_id,
    status_code,
    currency,
    metadata
  ) values (
    target_organization_id,
    target_case_item_id,
    'draft',
    target_currency,
    jsonb_build_object(
      'mortgageOfferId', target_offer_id,
      'mortgageBankId', target_bank_id,
      'mortgageBankName', target_bank_name
    )
  )
  returning id into target_submission_id;

  insert into public.crm_case_bank_applications (
    submission_id,
    organization_id,
    case_id,
    case_item_id,
    offer_id,
    bank_id,
    property_id,
    slot,
    created_by_user_id
  ) values (
    target_submission_id,
    target_organization_id,
    target_case_id,
    target_case_item_id,
    target_offer_id,
    target_bank_id,
    target_property_id,
    target_slot,
    actor_user_id
  )
  returning * into result;

  insert into public.crm_case_offer_selections (
    organization_id,
    case_id,
    offer_id,
    selected_by_user_id,
    selected_at
  ) values (
    target_organization_id,
    target_case_id,
    target_offer_id,
    actor_user_id,
    now()
  )
  on conflict (organization_id, case_id) do nothing;

  return result;
end;
$$;


--
-- Name: create_crm_case_bank_application_snapshot(uuid, uuid, uuid, uuid, uuid, timestamp with time zone, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_crm_case_bank_application_snapshot(target_organization_id uuid, target_case_id uuid, target_offer_id uuid, target_property_id uuid, target_actor_user_id uuid, expected_property_updated_at timestamp with time zone, target_scenario_snapshot jsonb, target_calculation_snapshot jsonb) RETURNS public.crm_case_bank_applications
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  result public.crm_case_bank_applications;
  current_property record;
  baseline_offer_id uuid;
  snapshot_property_id uuid;
  snapshot_purchase_price numeric(14,2);
  snapshot_appraisal_value numeric(14,2);
  snapshot_net_amount numeric(14,2);
  snapshot_gross_amount numeric(14,2);
  snapshot_financed_costs numeric(14,2);
  snapshot_ltv_debt_basis text;
  snapshot_collateral_basis text;
  snapshot_ltv_debt_amount numeric(14,2);
  snapshot_collateral_amount numeric(14,2);
  snapshot_ltv_pct numeric(9,5);
  snapshot_first_installment numeric(14,2);
  snapshot_first_outflow numeric(14,2);
  snapshot_cost_five_years numeric(14,2);
  snapshot_total_cost numeric(14,2);
  snapshot_calculator_version text;
  expected_ltv_debt_amount numeric;
  expected_collateral_amount numeric;
begin
  if current_user <> 'openexpert_service' then
    raise exception using errcode = '42501', message = 'Mortgage application snapshots may only be created by the trusted server';
  end if;
  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'The actor is not an organization member';
  end if;
  if target_scenario_snapshot is null
    or target_calculation_snapshot is null
    or jsonb_typeof(target_scenario_snapshot) <> 'object'
    or jsonb_typeof(target_calculation_snapshot) <> 'object' then
    raise exception using errcode = '22023', message = 'Application scenario and calculation snapshots must be JSON objects';
  end if;
  if target_scenario_snapshot ->> 'schemaVersion' <> 'openexpert.mortgage-application-scenario/1.0'
    or target_calculation_snapshot ->> 'schemaVersion' <> 'openexpert.mortgage-application-calculation/1.0'
    or target_calculation_snapshot ->> 'status' <> 'complete' then
    raise exception using errcode = '22023', message = 'Unsupported or incomplete mortgage application snapshot';
  end if;

  if nullif(target_scenario_snapshot ->> 'sourceOfferId', '')::uuid
    is distinct from target_offer_id then
    raise exception using errcode = '23514', message = 'The scenario source offer does not match the requested offer';
  end if;

  baseline_offer_id := (target_scenario_snapshot ->> 'comparisonBaselineOfferId')::uuid;
  snapshot_property_id := (target_scenario_snapshot -> 'property' ->> 'propertyId')::uuid;
  if snapshot_property_id <> target_property_id then
    raise exception using errcode = '23514', message = 'The property snapshot does not match the requested property';
  end if;
  if not exists (
    select 1
    from public.crm_case_offer_snapshots baseline
    where baseline.organization_id = target_organization_id
      and baseline.case_id = target_case_id
      and baseline.id = baseline_offer_id
  ) then
    raise exception using errcode = '23503', message = 'The comparison baseline offer does not belong to the CRM case';
  end if;

  select property.price_amount, property.appraisal_value_amount, property.updated_at
  into current_property
  from public.crm_properties property
  where property.organization_id = target_organization_id
    and property.case_id = target_case_id
    and property.id = target_property_id
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'Property does not belong to the CRM case';
  end if;
  if current_property.updated_at is distinct from expected_property_updated_at then
    raise exception using errcode = '40001', message = 'Property changed while its mortgage application was being calculated';
  end if;

  snapshot_purchase_price := (target_scenario_snapshot -> 'property' ->> 'purchasePrice')::numeric;
  snapshot_appraisal_value := nullif(target_scenario_snapshot -> 'property' ->> 'appraisalValue', '')::numeric;
  if snapshot_purchase_price is distinct from current_property.price_amount
    or snapshot_appraisal_value is distinct from current_property.appraisal_value_amount then
    raise exception using errcode = '40001', message = 'Property values changed while its mortgage application was being calculated';
  end if;

  snapshot_calculator_version := target_calculation_snapshot ->> 'engineVersion';
  snapshot_net_amount := (target_calculation_snapshot -> 'summary' ->> 'netLoanAmount')::numeric;
  snapshot_gross_amount := (target_calculation_snapshot -> 'summary' ->> 'grossLoanAmount')::numeric;
  snapshot_financed_costs := (target_calculation_snapshot -> 'summary' ->> 'financedCosts')::numeric;
  snapshot_ltv_debt_basis := target_calculation_snapshot -> 'summary' ->> 'ltvDebtBasis';
  snapshot_collateral_basis := target_calculation_snapshot -> 'summary' ->> 'collateralValueBasis';
  snapshot_ltv_debt_amount := (target_calculation_snapshot -> 'summary' ->> 'ltvDebtAmount')::numeric;
  snapshot_collateral_amount := (target_calculation_snapshot -> 'summary' ->> 'collateralValueAmount')::numeric;
  snapshot_ltv_pct := (target_calculation_snapshot -> 'summary' ->> 'ltvPct')::numeric;
  snapshot_first_installment := (target_calculation_snapshot -> 'summary' ->> 'firstInstallment')::numeric;
  snapshot_first_outflow := (target_calculation_snapshot -> 'summary' ->> 'firstMonthlyOutflow')::numeric;
  snapshot_cost_five_years := (target_calculation_snapshot -> 'summary' ->> 'costFirstFiveYears')::numeric;
  snapshot_total_cost := (target_calculation_snapshot -> 'summary' ->> 'totalCost')::numeric;
  if snapshot_calculator_version is null
    or snapshot_purchase_price is null
    or snapshot_net_amount is null
    or snapshot_gross_amount is null
    or snapshot_financed_costs is null
    or snapshot_ltv_debt_basis is null
    or snapshot_collateral_basis is null
    or snapshot_ltv_debt_amount is null
    or snapshot_collateral_amount is null
    or snapshot_ltv_pct is null
    or snapshot_first_installment is null
    or snapshot_first_outflow is null
    or snapshot_cost_five_years is null
    or snapshot_total_cost is null then
    raise exception using errcode = '22023', message = 'The complete mortgage application snapshot is missing required summary values';
  end if;
  if snapshot_gross_amount < snapshot_net_amount
    or abs((snapshot_gross_amount - snapshot_net_amount) - snapshot_financed_costs) > 0.01 then
    raise exception using errcode = '23514', message = 'Application gross, net and financed amounts are inconsistent';
  end if;

  if snapshot_ltv_debt_basis = 'net_loan' then
    expected_ltv_debt_amount := snapshot_net_amount;
  elsif snapshot_ltv_debt_basis in ('gross_loan', 'facility_limit') then
    expected_ltv_debt_amount := snapshot_gross_amount;
  else
    raise exception using errcode = '22023', message = 'Unsupported LTV debt basis in the application snapshot';
  end if;
  if abs(snapshot_ltv_debt_amount - expected_ltv_debt_amount) > 0.01 then
    raise exception using errcode = '23514', message = 'The LTV debt amount does not match its declared basis';
  end if;

  if snapshot_collateral_basis = 'purchase_price' then
    expected_collateral_amount := snapshot_purchase_price;
  elsif snapshot_collateral_basis = 'appraisal_value' then
    if snapshot_appraisal_value is null then
      raise exception using errcode = '23514', message = 'An appraisal is required by the collateral value basis';
    end if;
    expected_collateral_amount := snapshot_appraisal_value;
  elsif snapshot_collateral_basis = 'lower_of_purchase_and_appraisal' then
    if snapshot_appraisal_value is null then
      raise exception using errcode = '23514', message = 'An appraisal is required by the collateral value basis';
    end if;
    expected_collateral_amount := least(snapshot_purchase_price, snapshot_appraisal_value);
  else
    raise exception using errcode = '22023', message = 'Unsupported collateral value basis in the application snapshot';
  end if;
  if abs(snapshot_collateral_amount - expected_collateral_amount) > 0.01 then
    raise exception using errcode = '23514', message = 'The collateral amount does not match its declared basis';
  end if;
  if snapshot_collateral_amount <= 0
    or abs(
      snapshot_ltv_pct
      - (snapshot_ltv_debt_amount / snapshot_collateral_amount * 100)
    ) > 0.00501 then
    raise exception using errcode = '23514', message = 'The LTV percentage is inconsistent with debt and collateral amounts';
  end if;

  select * into result
  from public.create_crm_case_bank_application(
    target_organization_id,
    target_case_id,
    target_offer_id,
    target_property_id
  );

  update public.crm_case_bank_applications application
  set
    created_by_user_id = target_actor_user_id,
    snapshot_status = 'complete',
    snapshot_schema_version = '1.0',
    calculator_version = snapshot_calculator_version,
    comparison_baseline_offer_id = baseline_offer_id,
    scenario_snapshot = target_scenario_snapshot,
    calculation_snapshot = target_calculation_snapshot,
    purchase_price_amount = snapshot_purchase_price,
    appraisal_value_amount = snapshot_appraisal_value,
    net_loan_amount = snapshot_net_amount,
    gross_loan_amount = snapshot_gross_amount,
    financed_costs = snapshot_financed_costs,
    ltv_debt_basis = snapshot_ltv_debt_basis,
    collateral_value_basis = snapshot_collateral_basis,
    ltv_debt_amount = snapshot_ltv_debt_amount,
    collateral_value_amount = snapshot_collateral_amount,
    ltv_pct = snapshot_ltv_pct,
    first_installment = snapshot_first_installment,
    first_monthly_outflow = snapshot_first_outflow,
    cost_first_five_years = snapshot_cost_five_years,
    total_cost = snapshot_total_cost,
    calculated_at = now()
  where application.organization_id = target_organization_id
    and application.case_id = target_case_id
    and application.submission_id = result.submission_id
  returning * into result;

  update public.crm_case_items item
  set owner_user_id = coalesce(item.owner_user_id, target_actor_user_id)
  where item.organization_id = target_organization_id
    and item.id = result.case_item_id;
  update public.crm_case_offer_selections selection
  set selected_by_user_id = coalesce(selection.selected_by_user_id, target_actor_user_id)
  where selection.organization_id = target_organization_id
    and selection.case_id = target_case_id;

  return result;
end;
$$;


--
-- Name: create_crm_case_simple(uuid, text, uuid[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_crm_case_simple(p_organization_id uuid, p_title text, p_client_ids uuid[], p_owner_user_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  normalized_title text := btrim(coalesce(p_title, ''));
  first_client_id uuid;
  inserted_case public.crm_cases;
begin
  if current_user <> 'openexpert_service' then
    if not private.is_organization_member(p_organization_id) then
      raise exception 'organization_membership_required' using errcode = '42501';
    end if;
  end if;

  if normalized_title = '' or length(normalized_title) > 200 then
    raise exception 'case_title_must_contain_between_1_and_200_characters'
      using errcode = '22023';
  end if;
  if cardinality(coalesce(p_client_ids, '{}'::uuid[])) = 0 then
    raise exception 'case_requires_at_least_one_client' using errcode = '22023';
  end if;

  first_client_id := p_client_ids[1];
  if not exists (
    select 1
    from public.crm_clients client
    where client.organization_id = p_organization_id
      and client.id = first_client_id
  ) then
    raise exception 'case_client_not_found' using errcode = '23503';
  end if;

  if p_owner_user_id is not null and not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_owner_user_id
  ) then
    raise exception 'case_owner_must_be_an_organization_member' using errcode = '23503';
  end if;

  insert into public.crm_cases (
    organization_id,
    client_id,
    owner_user_id,
    title
  ) values (
    p_organization_id,
    first_client_id,
    p_owner_user_id,
    normalized_title
  )
  returning * into inserted_case;

  perform public.set_crm_case_clients(
    p_organization_id,
    inserted_case.id,
    p_client_ids
  );

  return to_jsonb(inserted_case) - 'search_text' - 'search_vector';
end;
$$;


--
-- Name: create_crm_client_anonymization_request(uuid, uuid, uuid, text, timestamp with time zone, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_crm_client_anonymization_request(p_organization_id uuid, p_client_id uuid, p_subject_person_id uuid, p_request_channel text, p_requested_at timestamp with time zone, p_justification text, p_idempotency_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
  client_row public.crm_clients%rowtype;
  request_row public.crm_client_anonymization_requests%rowtype;
  normalized_justification text := pg_catalog.btrim(p_justification);
  request_id uuid;
  request_number text;
  response_payload jsonb;
begin
  if actor_user_id is null then
    raise exception 'authentication_required'
      using errcode = '42501';
  end if;

  if p_organization_id is null
    or p_client_id is null
    or p_subject_person_id is null
    or p_requested_at is null
    or p_idempotency_key is null
  then
    raise exception 'anonymization_request_required_fields_missing'
      using errcode = '22023';
  end if;

  if p_request_channel is null
    or p_request_channel not in (
      'email',
      'phone',
      'in_person',
      'letter',
      'other'
    )
  then
    raise exception 'anonymization_request_channel_invalid'
      using errcode = '22023';
  end if;

  if normalized_justification is null
    or pg_catalog.char_length(normalized_justification) < 20
    or pg_catalog.char_length(normalized_justification) > 2000
  then
    raise exception 'anonymization_request_justification_invalid'
      using errcode = '22023';
  end if;

  if p_requested_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'anonymization_request_requested_at_in_future'
      using errcode = '22023';
  end if;

  select client.*
  into client_row
  from public.crm_clients client
  where client.organization_id = p_organization_id
    and client.id = p_client_id
  for update;

  if not found then
    raise exception 'anonymization_request_client_not_found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = actor_user_id
  ) then
    raise exception 'anonymization_request_forbidden'
      using errcode = '42501';
  end if;

  if client_row.owner_user_id is distinct from actor_user_id
    and not private.user_has_administrative_permission(
      p_organization_id,
      actor_user_id,
      'privacy.requests.create'
    )
  then
    raise exception 'anonymization_request_forbidden'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert-client-anonymization-request:'
        || p_organization_id::text
        || ':'
        || p_idempotency_key::text,
      0
    )
  );

  select anonymization_request.*
  into request_row
  from public.crm_client_anonymization_requests anonymization_request
  where anonymization_request.organization_id = p_organization_id
    and anonymization_request.idempotency_key = p_idempotency_key;

  if found then
    if request_row.client_id <> p_client_id
      or request_row.subject_person_id <> p_subject_person_id
      or request_row.request_channel <> p_request_channel
      or request_row.requested_at <> p_requested_at
      or request_row.justification <> normalized_justification
      or request_row.created_by_user_id <> actor_user_id
    then
      raise exception 'anonymization_request_idempotency_conflict'
        using errcode = '23505';
    end if;

    return pg_catalog.jsonb_build_object(
      'data',
      pg_catalog.jsonb_build_object(
        'id', request_row.id,
        'clientId', request_row.client_id,
        'subjectPersonId', request_row.subject_person_id,
        'requestNumber', request_row.request_number,
        'status', request_row.status,
        'requestedAt', request_row.requested_at,
        'dueAt', request_row.due_at,
        'replayed', true
      )
    );
  end if;

  if client_row.status_code = 'anonymized' then
    raise exception 'anonymization_request_client_already_anonymized'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.crm_client_people person
    where person.organization_id = p_organization_id
      and person.client_id = p_client_id
      and person.id = p_subject_person_id
  ) then
    raise exception 'anonymization_request_subject_not_found'
      using errcode = '22023';
  end if;

  select anonymization_request.*
  into request_row
  from public.crm_client_anonymization_requests anonymization_request
  where anonymization_request.organization_id = p_organization_id
    and anonymization_request.client_id = p_client_id
    and anonymization_request.status in (
      'received',
      'identity_verification',
      'legal_review',
      'approved',
      'in_progress'
    )
  limit 1;

  if found then
    raise exception 'anonymization_request_active_request_exists'
      using errcode = '23505';
  end if;

  request_id := gen_random_uuid();
  request_number :=
    'ANO-'
    || pg_catalog.to_char(p_requested_at at time zone 'UTC', 'YYYY')
    || '-'
    || pg_catalog.upper(
      pg_catalog.substr(
        pg_catalog.replace(request_id::text, '-', ''),
        1,
        12
      )
    );

  insert into public.crm_client_anonymization_requests (
    id,
    organization_id,
    client_id,
    subject_person_id,
    idempotency_key,
    request_number,
    status,
    request_channel,
    legal_basis,
    requested_at,
    due_at,
    justification,
    created_by_user_id,
    metadata
  )
  values (
    request_id,
    p_organization_id,
    p_client_id,
    p_subject_person_id,
    p_idempotency_key,
    request_number,
    'received',
    p_request_channel,
    'RODO art. 17',
    p_requested_at,
    p_requested_at + interval '1 month',
    normalized_justification,
    actor_user_id,
    pg_catalog.jsonb_build_object(
      'submissionSource', 'client_card',
      'submittedByClientOwner',
      client_row.owner_user_id = actor_user_id
    )
  )
  returning * into request_row;

  insert into public.crm_client_anonymization_request_events (
    organization_id,
    request_id,
    event_type,
    from_status,
    to_status,
    actor_user_id,
    reason_code
  )
  values (
    p_organization_id,
    request_row.id,
    'request_received',
    null,
    'received',
    actor_user_id,
    'client_request_received'
  );

  response_payload := pg_catalog.jsonb_build_object(
    'data',
    pg_catalog.jsonb_build_object(
      'id', request_row.id,
      'clientId', request_row.client_id,
      'subjectPersonId', request_row.subject_person_id,
      'requestNumber', request_row.request_number,
      'status', request_row.status,
      'requestedAt', request_row.requested_at,
      'dueAt', request_row.due_at,
      'replayed', false
    )
  );

  return response_payload;
end;
$$;


--
-- Name: FUNCTION create_crm_client_anonymization_request(p_organization_id uuid, p_client_id uuid, p_subject_person_id uuid, p_request_channel text, p_requested_at timestamp with time zone, p_justification text, p_idempotency_key uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_crm_client_anonymization_request(p_organization_id uuid, p_client_id uuid, p_subject_person_id uuid, p_request_channel text, p_requested_at timestamp with time zone, p_justification text, p_idempotency_key uuid) IS 'Registers one client erasure request for the assigned client owner or a member with privacy.requests.create. It does not approve or execute anonymization.';


--
-- Name: create_crm_client_with_consents(uuid, uuid, text, text, text, text, text, text[], text, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_crm_client_with_consents(p_organization_id uuid, p_owner_user_id uuid, p_display_name text, p_status_code text, p_lead_source text, p_primary_email text, p_primary_phone text, p_tags text[], p_notes text, p_metadata jsonb, p_primary_person jsonb, p_consent_decisions jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  inserted_client public.crm_clients;
  inserted_person public.crm_client_people;
  consent_record record;
  supplied_decision jsonb;
  decision_granted boolean;
  decision_contact_value text;
  inserted_consent_events jsonb := '[]'::jsonb;
  active_consent_count integer;
  effective_owner_user_id uuid := coalesce(p_owner_user_id, (select app.current_user_id()));
begin
  if not private.is_organization_member(p_organization_id) then
    raise exception 'organization_membership_required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = effective_owner_user_id
  ) then
    raise exception 'client_owner_not_organization_member' using errcode = '23503';
  end if;

  if effective_owner_user_id <> (select app.current_user_id())
    and not private.is_organization_admin(p_organization_id)
  then
    raise exception 'client_owner_assignment_admin_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_display_name), '') is null then
    raise exception 'display_name_is_required' using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(p_consent_decisions, '[]'::jsonb)) <> 'array' then
    raise exception 'consent_decisions_must_be_an_array' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
    where jsonb_typeof(decision) <> 'object'
      or jsonb_typeof(decision -> 'granted') is distinct from 'boolean'
      or nullif(decision ->> 'definition_id', '') is null
      or nullif(decision ->> 'version_id', '') is null
  ) then
    raise exception 'consent_decision_is_invalid' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
    group by decision ->> 'definition_id'
    having count(*) > 1
  ) then
    raise exception 'duplicate_consent_decision' using errcode = '23514';
  end if;

  select count(*)
  into active_consent_count
  from public.crm_consent_definitions definition
  join public.crm_consent_definition_versions consent_version
    on consent_version.organization_id = definition.organization_id
   and consent_version.definition_id = definition.id
   and consent_version.id = definition.current_version_id
  where definition.organization_id = p_organization_id
    and definition.context = 'client_creation'
    and consent_version.status = 'published'
    and consent_version.effective_from <= now()
    and (consent_version.effective_to is null or consent_version.effective_to > now());

  if jsonb_array_length(coalesce(p_consent_decisions, '[]'::jsonb)) <> active_consent_count then
    raise exception 'consent_catalogue_is_stale' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
    where not exists (
      select 1
      from public.crm_consent_definitions definition
      join public.crm_consent_definition_versions consent_version
        on consent_version.organization_id = definition.organization_id
       and consent_version.definition_id = definition.id
       and consent_version.id = definition.current_version_id
      where definition.organization_id = p_organization_id
        and definition.context = 'client_creation'
        and definition.id::text = decision ->> 'definition_id'
        and consent_version.id::text = decision ->> 'version_id'
        and consent_version.status = 'published'
        and consent_version.effective_from <= now()
        and (consent_version.effective_to is null or consent_version.effective_to > now())
    )
  ) then
    raise exception 'consent_catalogue_is_stale' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = p_organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.is_required
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
        where decision ->> 'definition_id' = definition.id::text
          and decision ->> 'version_id' = consent_version.id::text
          and (decision ->> 'granted')::boolean is true
      )
  ) then
    raise exception 'required_consent_not_granted' using errcode = '23514';
  end if;

  insert into public.crm_clients (
    organization_id,
    owner_user_id,
    display_name,
    status_code,
    lead_source,
    primary_email,
    primary_phone,
    tags,
    notes,
    metadata
  ) values (
    p_organization_id,
    effective_owner_user_id,
    btrim(p_display_name),
    coalesce(nullif(btrim(p_status_code), ''), 'lead'),
    nullif(btrim(p_lead_source), ''),
    nullif(btrim(p_primary_email), ''),
    nullif(btrim(p_primary_phone), ''),
    coalesce(p_tags, '{}'::text[]),
    nullif(btrim(p_notes), ''),
    coalesce(p_metadata, '{}'::jsonb)
  ) returning * into inserted_client;

  insert into public.crm_client_people (
    organization_id,
    client_id,
    role,
    first_name,
    last_name,
    display_name,
    email,
    phone,
    pesel,
    date_of_birth,
    metadata
  ) values (
    p_organization_id,
    inserted_client.id,
    coalesce(nullif(btrim(p_primary_person ->> 'role'), ''), 'primary'),
    nullif(btrim(p_primary_person ->> 'first_name'), ''),
    nullif(btrim(p_primary_person ->> 'last_name'), ''),
    coalesce(nullif(btrim(p_primary_person ->> 'display_name'), ''), inserted_client.display_name),
    coalesce(nullif(btrim(p_primary_person ->> 'email'), ''), inserted_client.primary_email),
    coalesce(nullif(btrim(p_primary_person ->> 'phone'), ''), inserted_client.primary_phone),
    nullif(btrim(p_primary_person ->> 'pesel'), ''),
    case
      when nullif(btrim(p_primary_person ->> 'date_of_birth'), '') is null then null
      else (p_primary_person ->> 'date_of_birth')::date
    end,
    case
      when jsonb_typeof(p_primary_person -> 'metadata') = 'object'
        then p_primary_person -> 'metadata'
      else '{}'::jsonb
    end
  ) returning * into inserted_person;

  for consent_record in
    select definition.id as definition_id, consent_version.*
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = p_organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
    order by consent_version.sort_order, consent_version.display_title
  loop
    select decision
    into supplied_decision
    from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
    where decision ->> 'definition_id' = consent_record.definition_id::text
    limit 1;

    decision_granted := (supplied_decision ->> 'granted')::boolean;
    decision_contact_value := case consent_record.channel
      when 'email' then inserted_person.email
      when 'sms' then inserted_person.phone
      when 'phone' then inserted_person.phone
      when 'messaging' then inserted_person.phone
      else coalesce(inserted_person.email, inserted_person.phone)
    end;

    if decision_granted and decision_contact_value is null then
      raise exception 'consent_contact_value_is_required' using errcode = '23514';
    end if;

    insert into public.crm_client_consent_events (
      organization_id,
      client_id,
      subject_person_id,
      definition_id,
      definition_version_id,
      decision,
      contact_value,
      source,
      recorded_by_user_id,
      metadata
    ) values (
      p_organization_id,
      inserted_client.id,
      inserted_person.id,
      consent_record.definition_id,
      consent_record.id,
      case when decision_granted then 'granted' else 'declined' end,
      case when decision_granted then decision_contact_value else null end,
      'client_creation',
      (select app.current_user_id()),
      jsonb_build_object('form', 'crm_client_creation_v2')
    )
    returning inserted_consent_events || jsonb_build_array(to_jsonb(crm_client_consent_events.*))
    into inserted_consent_events;
  end loop;

  insert into public.crm_activities (
    organization_id,
    actor_user_id,
    client_id,
    activity_type,
    title,
    body,
    payload
  ) values (
    p_organization_id,
    (select app.current_user_id()),
    inserted_client.id,
    'client_created',
    'Dodano klienta',
    inserted_client.display_name,
    jsonb_build_object(
      'owner_user_id', inserted_client.owner_user_id,
      'consent_events_recorded', jsonb_array_length(inserted_consent_events),
      'consents_granted', (
        select count(*)
        from jsonb_array_elements(inserted_consent_events) event
        where event ->> 'decision' = 'granted'
      )
    )
  );

  return jsonb_build_object(
    'data', to_jsonb(inserted_client),
    'people', jsonb_build_array(to_jsonb(inserted_person)),
    'consents', inserted_consent_events
  );
end;
$$;


--
-- Name: create_crm_consent_definition(uuid, text, text, text, text, text, text, text, boolean, text, integer, text, timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_crm_consent_definition(p_organization_id uuid, p_code text, p_internal_name text, p_display_title text, p_content text, p_purpose text, p_channel text, p_legal_basis text, p_is_required boolean, p_status text, p_sort_order integer, p_language_code text, p_effective_from timestamp with time zone, p_effective_to timestamp with time zone, p_change_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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
    (select app.current_user_id()),
    (select app.current_user_id())
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
    (select app.current_user_id())
  );

  return new_definition_id;
end;
$$;


--
-- Name: create_delegated_crm_task(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_delegated_crm_task(p_request jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  request_organization_id uuid;
  request_case_id uuid;
  request_case_item_id uuid;
  request_delegator_user_id uuid;
  request_assignee_user_id uuid;
  request_title text;
  request_description text;
  request_due_at timestamptz;
  request_priority text;
  request_data_access_scope text[];
  request_idempotency_key uuid;
  request_fingerprint text;
  request_appointment jsonb;
  request_has_appointment boolean;
  request_facility_id uuid;
  request_service_id uuid;
  request_client_person_id uuid;
  request_starts_at timestamptz;
  request_meeting_mode text;
  request_meeting_url text;
  request_appointment_notes text;
  target_client_id uuid;
  target_task public.crm_tasks;
  target_appointment_id uuid;
  booking_result jsonb;
  appointment_idempotency_key text;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'invalid_delegated_task_request' using errcode = '22023';
  end if;

  begin
    request_organization_id := nullif(p_request ->> 'organization_id', '')::uuid;
    request_case_id := nullif(p_request ->> 'case_id', '')::uuid;
    request_case_item_id := nullif(p_request ->> 'case_item_id', '')::uuid;
    request_delegator_user_id := nullif(p_request ->> 'delegator_user_id', '')::uuid;
    request_assignee_user_id := nullif(p_request ->> 'assignee_user_id', '')::uuid;
    request_title := nullif(btrim(p_request ->> 'title'), '');
    request_description := nullif(btrim(p_request ->> 'description'), '');
    request_due_at := nullif(p_request ->> 'due_at', '')::timestamptz;
    request_priority := coalesce(nullif(p_request ->> 'priority', ''), 'normal');
    request_idempotency_key := nullif(p_request ->> 'idempotency_key', '')::uuid;
    request_fingerprint := lower(nullif(p_request ->> 'idempotency_fingerprint', ''));

    if jsonb_typeof(p_request -> 'data_access_scope') <> 'array' then
      raise exception 'invalid_delegated_task_request' using errcode = '22023';
    end if;
    select coalesce(array_agg(scope.value order by scope.value), array[]::text[])
    into request_data_access_scope
    from jsonb_array_elements_text(p_request -> 'data_access_scope') scope(value);
  exception
    when invalid_text_representation
      or datetime_field_overflow
      or invalid_datetime_format
      or data_exception
    then
      raise exception 'invalid_delegated_task_request' using errcode = '22023';
  end;

  if request_organization_id is null
     or request_case_id is null
     or request_delegator_user_id is null
     or request_assignee_user_id is null
     or request_assignee_user_id = request_delegator_user_id
     or request_title is null
     or length(request_title) > 180
     or (request_description is not null and length(request_description) > 4000)
     or request_due_at is null
     or request_priority not in ('low', 'normal', 'high', 'urgent')
     or cardinality(request_data_access_scope) not between 1 and 7
     or not (
       request_data_access_scope <@ array[
         'case_summary',
         'client_contact',
         'client_identity',
         'documents',
         'offers',
         'financial_data',
         'activities'
       ]::text[]
     )
     or cardinality(request_data_access_scope)
       <> cardinality(array(select distinct unnest(request_data_access_scope)))
     or request_idempotency_key is null
     or request_fingerprint is null
     or request_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_delegated_task_request' using errcode = '22023';
  end if;

  request_appointment := p_request -> 'appointment';
  request_has_appointment := request_appointment is not null
    and request_appointment <> 'null'::jsonb;

  if request_has_appointment then
    if jsonb_typeof(request_appointment) <> 'object' then
      raise exception 'invalid_delegated_task_appointment' using errcode = '22023';
    end if;

    begin
      request_facility_id :=
        nullif(request_appointment ->> 'facility_id', '')::uuid;
      request_service_id :=
        nullif(request_appointment ->> 'service_id', '')::uuid;
      request_client_person_id :=
        nullif(request_appointment ->> 'client_person_id', '')::uuid;
      request_starts_at :=
        nullif(request_appointment ->> 'starts_at', '')::timestamptz;
      request_meeting_mode := coalesce(
        nullif(request_appointment ->> 'meeting_mode', ''),
        'office'
      );
      request_meeting_url :=
        nullif(btrim(request_appointment ->> 'meeting_url'), '');
      request_appointment_notes :=
        nullif(btrim(request_appointment ->> 'notes'), '');
    exception
      when invalid_text_representation
        or datetime_field_overflow
        or invalid_datetime_format
        or data_exception
      then
        raise exception 'invalid_delegated_task_appointment' using errcode = '22023';
    end;

    if request_facility_id is null
       or request_service_id is null
       or request_starts_at is null
       or request_meeting_mode not in ('office', 'online')
    then
      raise exception 'invalid_delegated_task_appointment' using errcode = '22023';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'openexpert-delegated-task:' || request_organization_id::text || ':'
      || request_delegator_user_id::text || ':'
      || request_idempotency_key::text,
    0
  ));

  select task.*
  into target_task
  from public.crm_tasks task
  where task.organization_id = request_organization_id
    and task.delegator_user_id = request_delegator_user_id
    and task.idempotency_key = request_idempotency_key;

  if found then
    if target_task.idempotency_fingerprint is distinct from request_fingerprint then
      raise exception 'delegated_task_idempotency_key_reused'
        using errcode = '23505';
    end if;

    if request_has_appointment then
      appointment_idempotency_key :=
        'delegated-task:' || request_idempotency_key::text;
      select appointment.id
      into target_appointment_id
      from public.appointments appointment
      where appointment.organization_id = request_organization_id
        and appointment.crm_task_id = target_task.id
        and appointment.created_by_user_id = request_delegator_user_id
        and appointment.idempotency_key = appointment_idempotency_key;

      if not found then
        raise exception 'invalid_delegated_task_replay_request'
          using errcode = '23514';
      end if;
    end if;

    return jsonb_build_object(
      'taskId', target_task.id,
      'appointmentId', target_appointment_id,
      'created', false
    );
  end if;

  -- Appointment rows copy the selected client's contact and identity data.
  -- Both scopes are therefore mandatory for the first creation.
  if request_has_appointment and not (
    'client_contact' = any(request_data_access_scope)
    and 'client_identity' = any(request_data_access_scope)
  ) then
    raise exception 'delegated_task_appointment_scope_required'
      using errcode = '23514';
  end if;

  select crm_case.client_id
  into target_client_id
  from public.crm_cases crm_case
  where crm_case.organization_id = request_organization_id
    and crm_case.id = request_case_id;

  if not found then
    raise exception 'crm_case_not_found' using errcode = 'P0002';
  end if;
  if request_has_appointment and target_client_id is null then
    raise exception 'delegated_task_case_client_required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = request_organization_id
      and membership.user_id = request_delegator_user_id
  ) or not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = request_organization_id
      and membership.user_id = request_assignee_user_id
  ) then
    raise exception 'delegated_task_organization_membership_required'
      using errcode = '23503';
  end if;

  if request_case_item_id is not null and not exists (
    select 1
    from public.crm_case_items case_item
    where case_item.organization_id = request_organization_id
      and case_item.case_id = request_case_id
      and case_item.id = request_case_item_id
  ) then
    raise exception 'delegated_task_case_item_not_found' using errcode = '23503';
  end if;

  if request_has_appointment and not exists (
    select 1
    from public.booking_services service
    join public.facility_services facility_service
      on facility_service.organization_id = service.organization_id
     and facility_service.service_id = service.id
     and facility_service.facility_id = request_facility_id
     and facility_service.is_active
    join public.facility_service_experts service_expert
      on service_expert.organization_id = facility_service.organization_id
     and service_expert.facility_id = facility_service.facility_id
     and service_expert.service_id = facility_service.service_id
     and service_expert.user_id = request_assignee_user_id
     and service_expert.is_active
    where service.organization_id = request_organization_id
      and service.id = request_service_id
      and service.slug = 'spotkanie'
      and service.is_active
  ) then
    raise exception 'delegated_task_meeting_service_not_configured'
      using errcode = '23503';
  end if;

  insert into public.crm_tasks (
    organization_id,
    delegator_user_id,
    assignee_user_id,
    client_id,
    case_id,
    case_item_id,
    title,
    description,
    status_code,
    delegation_status,
    priority,
    due_at,
    data_access_scope,
    idempotency_key,
    idempotency_fingerprint,
    metadata
  ) values (
    request_organization_id,
    request_delegator_user_id,
    request_assignee_user_id,
    target_client_id,
    request_case_id,
    request_case_item_id,
    request_title,
    request_description,
    'open',
    'pending',
    request_priority,
    request_due_at,
    request_data_access_scope,
    request_idempotency_key,
    request_fingerprint,
    jsonb_build_object(
      'source', 'manual_delegation',
      'appointment_created_with_task', request_has_appointment
    )
  )
  returning * into target_task;

  if request_has_appointment then
    appointment_idempotency_key :=
      'delegated-task:' || request_idempotency_key::text;
    booking_result := public.create_staff_appointment(
      request_organization_id,
      request_facility_id,
      request_service_id,
      request_assignee_user_id,
      target_client_id,
      request_client_person_id,
      request_starts_at,
      request_appointment_notes,
      request_delegator_user_id,
      appointment_idempotency_key,
      request_meeting_mode,
      request_meeting_url
    );
    target_appointment_id :=
      nullif(booking_result #>> '{appointment,id}', '')::uuid;

    if target_appointment_id is null then
      raise exception 'delegated_task_appointment_was_not_created'
        using errcode = 'P0001';
    end if;

    update public.appointments appointment
    set crm_task_id = target_task.id
    where appointment.organization_id = request_organization_id
      and appointment.id = target_appointment_id
      and appointment.expert_user_id = request_assignee_user_id
      and appointment.client_id = target_client_id;

    if not found then
      raise exception 'delegated_task_appointment_link_failed'
        using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'taskId', target_task.id,
    'appointmentId', target_appointment_id,
    'created', true
  );
end;
$_$;


--
-- Name: FUNCTION create_delegated_crm_task(p_request jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_delegated_crm_task(p_request jsonb) IS 'Atomically creates an idempotent delegated CRM task and optional staff appointment.';


--
-- Name: create_mortgage_product_draft_v2(uuid, text, text, text, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_mortgage_product_draft_v2(p_bank_id uuid, p_slug text, p_name text, p_category text, p_distribution_channel text, p_draft_data jsonb, p_actor_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


--
-- Name: FUNCTION create_mortgage_product_draft_v2(p_bank_id uuid, p_slug text, p_name text, p_category text, p_distribution_channel text, p_draft_data jsonb, p_actor_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_mortgage_product_draft_v2(p_bank_id uuid, p_slug text, p_name text, p_category text, p_distribution_channel text, p_draft_data jsonb, p_actor_user_id uuid) IS 'Service-role-only atomic creation of a mortgage/home-equity offer, its initial V2 draft and audit event. Legacy category aliases are normalized into product_kind and category.';


--
-- Name: create_organization_with_admin(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_organization_with_admin(organization_name text, full_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select private.create_organization_with_admin(organization_name, full_name);
$$;


--
-- Name: create_staff_appointment(uuid, uuid, uuid, uuid, uuid, uuid, timestamp with time zone, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_staff_appointment(p_organization_id uuid, p_facility_id uuid, p_service_id uuid, p_expert_user_id uuid, p_client_id uuid, p_client_person_id uuid, p_starts_at timestamp with time zone, p_notes text, p_created_by_user_id uuid, p_idempotency_key text) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.create_staff_appointment(
    p_organization_id,
    p_facility_id,
    p_service_id,
    p_expert_user_id,
    p_client_id,
    p_client_person_id,
    p_starts_at,
    p_notes,
    p_created_by_user_id,
    p_idempotency_key,
    'office',
    null
  );
$$;


--
-- Name: create_staff_appointment(uuid, uuid, uuid, uuid, uuid, uuid, timestamp with time zone, text, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_staff_appointment(p_organization_id uuid, p_facility_id uuid, p_service_id uuid, p_expert_user_id uuid, p_client_id uuid, p_client_person_id uuid, p_starts_at timestamp with time zone, p_notes text, p_created_by_user_id uuid, p_idempotency_key text, p_meeting_mode text, p_meeting_url text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  facility_timezone text;
  service_duration_minutes integer;
  normalized_meeting_url text;
  client_record public.crm_clients;
  person_record public.crm_client_people;
  inserted_appointment public.appointments;
  existing_appointment public.appointments;
begin
  normalized_meeting_url := nullif(btrim(p_meeting_url), '');

  if p_starts_at is null
     or p_client_id is null
     or p_created_by_user_id is null
     or nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200
     or (p_notes is not null and length(btrim(p_notes)) > 2000)
     or p_meeting_mode is null
     or p_meeting_mode not in ('office', 'online')
     or (
       p_meeting_mode = 'office'
       and normalized_meeting_url is not null
     )
     or (
       p_meeting_mode = 'online'
       and normalized_meeting_url is not null
       and (
         length(normalized_meeting_url) > 2048
         or normalized_meeting_url !~* '^https?://[^[:space:]]+$'
       )
     ) then
    raise exception 'invalid_staff_booking_request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_created_by_user_id
      and (
        membership.role = 'admin'
        or exists (
          select 1
          from public.facility_memberships facility_membership
          where facility_membership.organization_id = p_organization_id
            and facility_membership.facility_id = p_facility_id
            and facility_membership.user_id = p_created_by_user_id
        )
        or exists (
          select 1
          from public.team_facilities team_facility
          join public.team_memberships team_membership
            on team_membership.organization_id = team_facility.organization_id
           and team_membership.team_id = team_facility.team_id
           and team_membership.user_id = p_created_by_user_id
          where team_facility.organization_id = p_organization_id
            and team_facility.facility_id = p_facility_id
        )
      )
  ) then
    raise exception 'facility_membership_required' using errcode = '42501';
  end if;

  select facility.timezone, service.duration_minutes
  into facility_timezone, service_duration_minutes
  from public.facilities facility
  join public.facility_services facility_service
    on facility_service.organization_id = facility.organization_id
   and facility_service.facility_id = facility.id
   and facility_service.service_id = p_service_id
   and facility_service.is_active
  join public.booking_services service
    on service.organization_id = facility_service.organization_id
   and service.id = facility_service.service_id
   and service.is_active
  join public.facility_service_experts service_expert
    on service_expert.organization_id = facility_service.organization_id
   and service_expert.facility_id = facility_service.facility_id
   and service_expert.service_id = facility_service.service_id
   and service_expert.user_id = p_expert_user_id
   and service_expert.is_active
  join public.facility_memberships expert_membership
    on expert_membership.organization_id = service_expert.organization_id
   and expert_membership.facility_id = service_expert.facility_id
   and expert_membership.user_id = service_expert.user_id
   and expert_membership.is_bookable
  where facility.organization_id = p_organization_id
    and facility.id = p_facility_id
    and facility.is_active;

  if not found then
    raise exception 'expert_not_bookable_for_service' using errcode = '23503';
  end if;

  select client.*
  into client_record
  from public.crm_clients client
  where client.organization_id = p_organization_id
    and client.id = p_client_id;

  if not found then
    raise exception 'crm_client_not_found' using errcode = 'P0002';
  end if;

  if p_client_person_id is not null then
    select person.*
    into person_record
    from public.crm_client_people person
    where person.organization_id = p_organization_id
      and person.client_id = p_client_id
      and person.id = p_client_person_id;

    if not found then
      raise exception 'crm_client_person_not_found' using errcode = '23503';
    end if;
  else
    select person.*
    into person_record
    from public.crm_client_people person
    where person.organization_id = p_organization_id
      and person.client_id = p_client_id
    order by (person.role = 'primary') desc, person.created_at, person.id
    limit 1;
  end if;

  if person_record.id is null then
    raise exception 'crm_client_person_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'openexpert-staff-booking:' || p_organization_id::text || ':'
      || p_created_by_user_id::text || ':' || btrim(p_idempotency_key),
    0
  ));

  select appointment.*
  into existing_appointment
  from public.appointments appointment
  where appointment.organization_id = p_organization_id
    and appointment.created_by_user_id = p_created_by_user_id
    and appointment.source = 'staff'
    and appointment.idempotency_key = btrim(p_idempotency_key);

  if found then
    if existing_appointment.facility_id = p_facility_id
       and existing_appointment.service_id = p_service_id
       and existing_appointment.expert_user_id = p_expert_user_id
       and existing_appointment.client_id = p_client_id
       and (
         p_client_person_id is null
         or existing_appointment.client_person_id = p_client_person_id
       )
       and existing_appointment.starts_at = p_starts_at
       and existing_appointment.notes is not distinct from nullif(btrim(p_notes), '')
       and existing_appointment.meeting_mode = p_meeting_mode
       and existing_appointment.meeting_url is not distinct from normalized_meeting_url then
      return private.staff_booking_result(existing_appointment.id);
    end if;

    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;

  perform private.release_expired_booking_holds();

  if not private.expert_slot_is_available(
    p_organization_id,
    p_facility_id,
    p_service_id,
    p_expert_user_id,
    p_starts_at
  ) then
    raise exception 'booking_slot_conflict'
      using errcode = '23P01',
            constraint = 'appointment_expert_reservations_no_overlap';
  end if;

  insert into public.appointments (
    organization_id,
    facility_id,
    service_id,
    expert_user_id,
    client_id,
    client_person_id,
    starts_at,
    ends_at,
    timezone,
    status,
    confirmed_at,
    customer_name,
    customer_email,
    customer_phone,
    notes,
    source,
    idempotency_key,
    created_by_user_id,
    meeting_mode,
    meeting_url
  ) values (
    p_organization_id,
    p_facility_id,
    p_service_id,
    p_expert_user_id,
    p_client_id,
    person_record.id,
    p_starts_at,
    p_starts_at + make_interval(mins => service_duration_minutes),
    facility_timezone,
    'confirmed',
    now(),
    coalesce(person_record.display_name, client_record.display_name),
    lower(nullif(btrim(coalesce(person_record.email, client_record.primary_email)), '')),
    nullif(btrim(coalesce(person_record.phone, client_record.primary_phone)), ''),
    nullif(btrim(p_notes), ''),
    'staff',
    btrim(p_idempotency_key),
    p_created_by_user_id,
    p_meeting_mode,
    normalized_meeting_url
  )
  returning * into inserted_appointment;

  return private.staff_booking_result(inserted_appointment.id);
end;
$_$;


--
-- Name: create_widget_booking(uuid, uuid, timestamp with time zone, text, text, text, text, uuid, text, jsonb, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_widget_booking(p_widget_token uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_customer_name text, p_customer_email text, p_idempotency_key text, p_customer_phone text, p_expert_user_id uuid, p_notes text, p_consent_decisions jsonb, p_booking_context jsonb, p_request_fingerprint text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  widget_record record;
  service_record record;
  candidate record;
  resolved_client record;
  inserted_appointment public.appointments;
  existing_appointment_id uuid;
  existing_request_fingerprint text;
  effective_expert_user_id uuid;
  normalized_customer_phone text := nullif(regexp_replace(
    coalesce(p_customer_phone, ''), '[^0-9]+', '', 'g'
  ), '');
  normalized_booking_context jsonb := coalesce(p_booking_context, '{}'::jsonb);
  normalized_consent_decisions jsonb := coalesce(p_consent_decisions, '[]'::jsonb);
  booking_request_fingerprint text := lower(p_request_fingerprint);
begin
  if p_starts_at is null
     or nullif(btrim(p_customer_name), '') is null
     or length(btrim(p_customer_name)) > 200
     or nullif(btrim(p_customer_email), '') is null
     or length(btrim(p_customer_email)) > 320
     or p_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or (p_customer_phone is not null and length(btrim(p_customer_phone)) > 50)
     or (
       nullif(btrim(p_customer_phone), '') is not null
       and (
         normalized_customer_phone is null
         or length(normalized_customer_phone) < 7
         or length(normalized_customer_phone) > 15
       )
     )
     or nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or (p_notes is not null and length(btrim(p_notes)) > 2000) then
    raise exception 'invalid_booking_request' using errcode = '22023';
  end if;

  if jsonb_typeof(normalized_booking_context) <> 'object'
     or octet_length(normalized_booking_context::text) > 16384 then
    raise exception 'invalid_booking_context' using errcode = '22023';
  end if;

  if jsonb_typeof(normalized_consent_decisions) <> 'array' then
    raise exception 'consent_decisions_must_be_an_array' using errcode = '23514';
  end if;

  select widget.id,
         widget.organization_id,
         widget.facility_id,
         widget.booking_mode,
         widget.widget_type,
         widget.fixed_expert_user_id,
         facility.timezone
  into widget_record
  from public.booking_widgets widget
  join public.facilities facility
    on facility.organization_id = widget.organization_id
   and facility.id = widget.facility_id
   and facility.is_active
  where widget.public_token = p_widget_token
    and widget.is_active;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  perform private.assert_widget_origin_allowed(widget_record.id);

  perform pg_advisory_xact_lock(hashtextextended(
    'openexpert-widget-booking:' || widget_record.id::text || ':'
      || btrim(p_idempotency_key),
    0
  ));

  select appointment.id, appointment.request_fingerprint
  into existing_appointment_id, existing_request_fingerprint
  from public.appointments appointment
  where appointment.widget_id = widget_record.id
    and appointment.idempotency_key = btrim(p_idempotency_key);

  if found then
    if existing_request_fingerprint = booking_request_fingerprint then
      return private.widget_booking_result(existing_appointment_id);
    end if;
    raise exception 'idempotency_key_reused' using errcode = 'P0001';
  end if;

  if normalized_customer_phone is null then
    raise exception 'customer_phone_is_required' using errcode = '23514';
  end if;

  if normalized_booking_context ->> 'widgetType' is distinct from widget_record.widget_type
     or normalized_booking_context ->> 'version' is distinct from '1' then
    raise exception 'invalid_booking_context' using errcode = '22023';
  end if;

  if widget_record.fixed_expert_user_id is not null then
    if p_expert_user_id is not null
       and p_expert_user_id <> widget_record.fixed_expert_user_id then
      raise exception 'booking_widget_is_fixed_to_another_expert'
        using errcode = '22023';
    end if;
    effective_expert_user_id := widget_record.fixed_expert_user_id;
  else
    effective_expert_user_id := p_expert_user_id;
    if widget_record.booking_mode = 'expert' and p_expert_user_id is null then
      raise exception 'booking_widget_requires_expert' using errcode = '22023';
    elsif widget_record.booking_mode = 'facility' and p_expert_user_id is not null then
      raise exception 'booking_widget_does_not_allow_expert_selection'
        using errcode = '22023';
    end if;
  end if;

  perform private.validate_widget_consent_decisions(
    widget_record.organization_id,
    normalized_consent_decisions
  );

  select service.duration_minutes
  into service_record
  from public.booking_widget_services allowed_service
  join public.facility_services facility_service
    on facility_service.organization_id = allowed_service.organization_id
   and facility_service.facility_id = allowed_service.facility_id
   and facility_service.service_id = allowed_service.service_id
   and facility_service.is_active
  join public.booking_services service
    on service.organization_id = allowed_service.organization_id
   and service.id = allowed_service.service_id
   and service.is_active
  where allowed_service.organization_id = widget_record.organization_id
    and allowed_service.facility_id = widget_record.facility_id
    and allowed_service.widget_id = widget_record.id
    and allowed_service.service_id = p_service_id;

  if not found then
    raise exception 'booking_service_not_available_in_widget' using errcode = '23503';
  end if;

  perform private.release_expired_booking_holds();

  for candidate in
    select service_expert.user_id
    from public.facility_service_experts service_expert
    join public.facility_memberships membership
      on membership.organization_id = service_expert.organization_id
     and membership.facility_id = service_expert.facility_id
     and membership.user_id = service_expert.user_id
     and membership.is_bookable
    where service_expert.organization_id = widget_record.organization_id
      and service_expert.facility_id = widget_record.facility_id
      and service_expert.service_id = p_service_id
      and service_expert.is_active
      and (
        effective_expert_user_id is null
        or service_expert.user_id = effective_expert_user_id
      )
    order by membership.booking_priority,
             membership.last_assigned_at asc nulls first,
             service_expert.user_id
  loop
    if private.expert_slot_is_available(
      widget_record.organization_id,
      widget_record.facility_id,
      p_service_id,
      candidate.user_id,
      p_starts_at
    ) then
      begin
        select resolved.client_id, resolved.client_person_id
        into strict resolved_client
        from private.resolve_widget_crm_client(
          widget_record.organization_id,
          candidate.user_id,
          widget_record.id,
          btrim(p_customer_name),
          btrim(p_customer_email),
          nullif(btrim(p_customer_phone), ''),
          normalized_consent_decisions,
          'widget:' || widget_record.id::text || ':booking:'
            || btrim(p_idempotency_key)
        ) resolved;

        insert into public.appointments (
          organization_id,
          facility_id,
          service_id,
          expert_user_id,
          widget_id,
          client_id,
          client_person_id,
          starts_at,
          ends_at,
          timezone,
          status,
          confirmed_at,
          customer_name,
          customer_email,
          customer_phone,
          notes,
          source,
          idempotency_key,
          booking_context,
          request_fingerprint
        ) values (
          widget_record.organization_id,
          widget_record.facility_id,
          p_service_id,
          candidate.user_id,
          widget_record.id,
          resolved_client.client_id,
          resolved_client.client_person_id,
          p_starts_at,
          p_starts_at + make_interval(mins => service_record.duration_minutes),
          widget_record.timezone,
          'confirmed',
          now(),
          btrim(p_customer_name),
          lower(btrim(p_customer_email)),
          nullif(btrim(p_customer_phone), ''),
          nullif(btrim(p_notes), ''),
          'widget',
          btrim(p_idempotency_key),
          normalized_booking_context,
          booking_request_fingerprint
        )
        returning * into inserted_appointment;

        update public.facility_memberships membership
        set last_assigned_at = now()
        where membership.organization_id = widget_record.organization_id
          and membership.facility_id = widget_record.facility_id
          and membership.user_id = candidate.user_id;

        return private.widget_booking_result(inserted_appointment.id);
      exception
        when exclusion_violation then
          continue;
      end;
    end if;
  end loop;

  raise exception 'booking_slot_conflict'
    using errcode = '23P01',
          constraint = 'appointment_expert_reservations_no_overlap';
end;
$_$;


--
-- Name: crm_omnisearch_normalize(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_omnisearch_normalize(input text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    coalesce(input, '')
  ));
$$;


--
-- Name: execute_crm_client_anonymization_request(uuid, uuid, uuid, bigint, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.execute_crm_client_anonymization_request(p_organization_id uuid, p_request_id uuid, p_grant_id uuid, p_expected_revision bigint, p_idempotency_key uuid, p_confirmation text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
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

  -- Delegated-task validation treats app.current_user_id() = NULL as a trusted
  -- internal maintenance path. Blank both JWT settings only around this update,
  -- then restore them before writing the compliance events as the real actor.
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


--
-- Name: FUNCTION execute_crm_client_anonymization_request(p_organization_id uuid, p_request_id uuid, p_grant_id uuid, p_expected_revision bigint, p_idempotency_key uuid, p_confirmation text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.execute_crm_client_anonymization_request(p_organization_id uuid, p_request_id uuid, p_grant_id uuid, p_expected_revision bigint, p_idempotency_key uuid, p_confirmation text) IS 'Atomically executes one approved client anonymization request using an active, unexpired, single-use grant held by the authenticated grantee.';


--
-- Name: get_booking_widget_analytics(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_booking_widget_analytics(p_organization_id uuid, p_widget_id uuid, p_from date, p_to date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  widget_record record;
  period_start timestamptz;
  period_end timestamptz;
  effective_start timestamptz;
  last_booking_at timestamptz;
  result jsonb;
begin
  if p_from is null
     or p_to is null
     or p_to < p_from
     or (p_to - p_from) > 89 then
    raise exception 'invalid_booking_widget_analytics_range' using errcode = '22023';
  end if;

  select
    widget.organization_id,
    widget.facility_id,
    widget.id,
    widget.fixed_expert_user_id,
    widget.analytics_started_at,
    facility.timezone
  into widget_record
  from public.booking_widgets widget
  join public.facilities facility
    on facility.organization_id = widget.organization_id
   and facility.id = widget.facility_id
  where widget.organization_id = p_organization_id
    and widget.id = p_widget_id
    and (
      select private.can_manage_booking_widget(
        widget.organization_id,
        widget.facility_id,
        widget.fixed_expert_user_id
      )
    );

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  period_start := p_from::timestamp at time zone widget_record.timezone;
  period_end := (p_to + 1)::timestamp at time zone widget_record.timezone;
  effective_start := greatest(period_start, widget_record.analytics_started_at);

  select max(appointment.created_at)
  into last_booking_at
  from public.appointments appointment
  where appointment.organization_id = widget_record.organization_id
    and appointment.widget_id = widget_record.id
    and appointment.created_at >= effective_start
    and appointment.created_at < period_end;

  with
  filtered_events as materialized (
    select
      event.visit_id,
      event.event_type,
      event.service_id,
      event.is_embedded,
      (event.occurred_at at time zone widget_record.timezone)::date as day
    from public.booking_widget_events event
    where event.organization_id = widget_record.organization_id
      and event.widget_id = widget_record.id
      and event.occurred_at >= effective_start
      and event.occurred_at < period_end
  ),
  filtered_appointments as materialized (
    select
      appointment.id,
      appointment.service_id,
      appointment.status,
      (appointment.created_at at time zone widget_record.timezone)::date as day
    from public.appointments appointment
    where appointment.organization_id = widget_record.organization_id
      and appointment.widget_id = widget_record.id
      and appointment.created_at >= effective_start
      and appointment.created_at < period_end
  ),
  event_totals as (
    select
      count(distinct visit_id) filter (
        where event_type = 'widget_view'
      ) as views,
      count(distinct visit_id) filter (
        where event_type = 'widget_view' and is_embedded
      ) as embedded_views,
      count(distinct visit_id) filter (
        where event_type = 'widget_engaged'
      ) as engaged_visits,
      count(distinct visit_id) filter (
        where event_type = 'calculator_started'
      ) as calculator_starts,
      count(distinct visit_id) filter (
        where event_type = 'calculator_completed'
      ) as calculator_completions,
      count(distinct visit_id) filter (
        where event_type = 'service_selected'
      ) as service_selections,
      count(distinct visit_id) filter (
        where event_type = 'availability_search'
      ) as availability_searches,
      count(distinct visit_id) filter (
        where event_type = 'availability_found'
      ) as availability_found,
      count(distinct visit_id) filter (
        where event_type = 'slot_selected'
      ) as slot_selections,
      count(distinct visit_id) filter (
        where event_type = 'contact_started'
      ) as contact_starts,
      count(distinct visit_id) filter (
        where event_type = 'booking_attempt'
      ) as booking_attempts,
      count(distinct visit_id) filter (
        where event_type = 'booking_completed'
      ) as booking_completions
    from filtered_events
  ),
  appointment_totals as (
    select
      count(*) as bookings,
      count(*) filter (where status = 'confirmed') as confirmed_bookings,
      count(*) filter (where status = 'cancelled') as cancelled_bookings
    from filtered_appointments
  ),
  days as (
    select day::date as day
    from generate_series(
      p_from::timestamp,
      p_to::timestamp,
      interval '1 day'
    ) day
  ),
  event_daily as (
    select
      day,
      count(distinct visit_id) filter (
        where event_type = 'widget_view'
      ) as views,
      count(distinct visit_id) filter (
        where event_type = 'widget_engaged'
      ) as engaged_visits,
      count(distinct visit_id) filter (
        where event_type = 'calculator_completed'
      ) as calculator_completions,
      count(distinct visit_id) filter (
        where event_type = 'availability_search'
      ) as availability_searches,
      count(distinct visit_id) filter (
        where event_type = 'availability_found'
      ) as availability_found,
      count(distinct visit_id) filter (
        where event_type = 'slot_selected'
      ) as slot_selections,
      count(distinct visit_id) filter (
        where event_type = 'contact_started'
      ) as contact_starts,
      count(distinct visit_id) filter (
        where event_type = 'booking_attempt'
      ) as booking_attempts,
      count(distinct visit_id) filter (
        where event_type = 'booking_completed'
      ) as booking_completions
    from filtered_events
    group by day
  ),
  appointment_daily as (
    select
      day,
      count(*) as bookings
    from filtered_appointments
    group by day
  ),
  daily_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', days.day,
          'views', coalesce(event_daily.views, 0),
          'engagedVisits', coalesce(event_daily.engaged_visits, 0),
          'calculatorCompletions', coalesce(event_daily.calculator_completions, 0),
          'availabilitySearches', coalesce(event_daily.availability_searches, 0),
          'availabilityFound', coalesce(event_daily.availability_found, 0),
          'slotSelections', coalesce(event_daily.slot_selections, 0),
          'contactStarts', coalesce(event_daily.contact_starts, 0),
          'bookingAttempts', coalesce(event_daily.booking_attempts, 0),
          'bookingCompletions', coalesce(event_daily.booking_completions, 0),
          'bookings', coalesce(appointment_daily.bookings, 0)
        )
        order by days.day
      ),
      '[]'::jsonb
    ) as value
    from days
    left join event_daily on event_daily.day = days.day
    left join appointment_daily on appointment_daily.day = days.day
  ),
  interest_by_service as (
    select
      service_id,
      count(distinct visit_id) as interest
    from filtered_events
    where service_id is not null
      and event_type in (
        'service_selected',
        'availability_search',
        'availability_found',
        'slot_selected',
        'contact_started',
        'booking_attempt',
        'booking_completed'
      )
    group by service_id
  ),
  bookings_by_service as (
    select
      service_id,
      count(*) as bookings
    from filtered_appointments
    group by service_id
  ),
  service_metrics as (
    select
      coalesce(interest.service_id, booking.service_id) as service_id,
      coalesce(interest.interest, 0) as interest,
      coalesce(booking.bookings, 0) as bookings
    from interest_by_service interest
    full outer join bookings_by_service booking
      on booking.service_id = interest.service_id
  ),
  top_service_rows as (
    select
      service.id as service_id,
      service.name as service_name,
      metric.interest,
      metric.bookings
    from service_metrics metric
    join public.booking_services service
      on service.organization_id = widget_record.organization_id
     and service.id = metric.service_id
    order by metric.interest desc, metric.bookings desc, service.name
    limit 5
  ),
  top_services_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'serviceId', service_id,
          'name', service_name,
          'interest', interest,
          'bookings', bookings
        )
        order by interest desc, bookings desc, service_name
      ),
      '[]'::jsonb
    ) as value
    from top_service_rows
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'timeZone', widget_record.timezone,
      'trackingStartedAt', widget_record.analytics_started_at
    ),
    'summary', jsonb_build_object(
      'views', event_totals.views,
      'embeddedViews', event_totals.embedded_views,
      'engagedVisits', event_totals.engaged_visits,
      'calculatorStarts', event_totals.calculator_starts,
      'calculatorCompletions', event_totals.calculator_completions,
      'serviceSelections', event_totals.service_selections,
      'availabilitySearches', event_totals.availability_searches,
      'availabilityFound', event_totals.availability_found,
      'slotSelections', event_totals.slot_selections,
      'contactStarts', event_totals.contact_starts,
      'bookingAttempts', event_totals.booking_attempts,
      'bookingCompletions', event_totals.booking_completions,
      'bookings', appointment_totals.bookings,
      'confirmedBookings', appointment_totals.confirmed_bookings,
      'cancelledBookings', appointment_totals.cancelled_bookings,
      'lastBookingAt', last_booking_at
    ),
    'daily', daily_json.value,
    'topServices', top_services_json.value
  )
  into result
  from event_totals
  cross join appointment_totals
  cross join daily_json
  cross join top_services_json;

  return result;
end;
$$;


--
-- Name: get_booking_widget_catalog(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_booking_widget_catalog(p_widget_token uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  result jsonb;
begin
  result := private.get_booking_widget_catalog_without_avatar(p_widget_token);

  return jsonb_set(
    result,
    '{experts}',
    coalesce((
      select jsonb_agg(
        expert.value
          || jsonb_build_object('avatarUrl', app_user.avatar_url)
        order by expert.ordinality
      )
      from jsonb_array_elements(result -> 'experts')
        with ordinality as expert(value, ordinality)
      left join public.users app_user
        on app_user.id = (expert.value ->> 'userId')::uuid
    ), '[]'::jsonb)
  );
end;
$$;


--
-- Name: get_booking_widget_slots(uuid, uuid, date, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_booking_widget_slots(p_widget_token uuid, p_service_id uuid, p_starts_on date, p_ends_on date, p_expert_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone, expert_user_id uuid, expert_name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  widget_record record;
  service_record record;
  effective_expert_user_id uuid;
begin
  if p_starts_on is null or p_ends_on is null
     or p_ends_on < p_starts_on
     or p_ends_on - p_starts_on > 31 then
    raise exception 'booking_slot_range_must_be_between_1_and_32_days'
      using errcode = '22023';
  end if;

  select widget.id,
         widget.organization_id,
         widget.facility_id,
         widget.booking_mode,
         widget.fixed_expert_user_id,
         facility.timezone
  into widget_record
  from public.booking_widgets widget
  join public.facilities facility
    on facility.organization_id = widget.organization_id
   and facility.id = widget.facility_id
   and facility.is_active
  where widget.public_token = p_widget_token
    and widget.is_active;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  perform private.assert_widget_origin_allowed(widget_record.id);

  if widget_record.fixed_expert_user_id is not null then
    if p_expert_user_id is not null
       and p_expert_user_id <> widget_record.fixed_expert_user_id then
      raise exception 'booking_widget_is_fixed_to_another_expert'
        using errcode = '22023';
    end if;
    effective_expert_user_id := widget_record.fixed_expert_user_id;
  else
    effective_expert_user_id := p_expert_user_id;
    if widget_record.booking_mode = 'expert' and p_expert_user_id is null then
      raise exception 'booking_widget_requires_expert' using errcode = '22023';
    elsif widget_record.booking_mode = 'facility' and p_expert_user_id is not null then
      raise exception 'booking_widget_does_not_allow_expert_selection'
        using errcode = '22023';
    end if;
  end if;

  select service.duration_minutes,
         service.buffer_before_minutes,
         service.buffer_after_minutes,
         service.slot_interval_minutes
  into service_record
  from public.booking_widget_services allowed_service
  join public.facility_services facility_service
    on facility_service.organization_id = allowed_service.organization_id
   and facility_service.facility_id = allowed_service.facility_id
   and facility_service.service_id = allowed_service.service_id
   and facility_service.is_active
  join public.booking_services service
    on service.organization_id = allowed_service.organization_id
   and service.id = allowed_service.service_id
   and service.is_active
  where allowed_service.organization_id = widget_record.organization_id
    and allowed_service.facility_id = widget_record.facility_id
    and allowed_service.widget_id = widget_record.id
    and allowed_service.service_id = p_service_id;

  if not found then
    raise exception 'booking_service_not_available_in_widget' using errcode = '23503';
  end if;

  return query
  with local_dates as (
    select day_value::date as local_date
    from generate_series(
      p_starts_on::timestamp,
      p_ends_on::timestamp,
      interval '1 day'
    ) day_value
  ),
  facility_periods as (
    select local_date.local_date,
           override.opens_at,
           override.closes_at
    from local_dates local_date
    join public.facility_opening_overrides override
      on override.organization_id = widget_record.organization_id
     and override.facility_id = widget_record.facility_id
     and override.local_date = local_date.local_date
     and not override.is_closed

    union all

    select local_date.local_date,
           opening.opens_at,
           opening.closes_at
    from local_dates local_date
    join public.facility_opening_hours opening
      on opening.organization_id = widget_record.organization_id
     and opening.facility_id = widget_record.facility_id
     and opening.weekday = extract(isodow from local_date.local_date)::integer - 1
     and opening.is_active
    where not exists (
      select 1
      from public.facility_opening_overrides override
      where override.organization_id = widget_record.organization_id
        and override.facility_id = widget_record.facility_id
        and override.local_date = local_date.local_date
    )
  ),
  experts as (
    select service_expert.user_id,
           coalesce(app_user.full_name, 'Ekspert') as display_name
    from public.facility_service_experts service_expert
    join public.facility_memberships membership
      on membership.organization_id = service_expert.organization_id
     and membership.facility_id = service_expert.facility_id
     and membership.user_id = service_expert.user_id
     and membership.is_bookable
    join public.users app_user on app_user.id = service_expert.user_id
    where service_expert.organization_id = widget_record.organization_id
      and service_expert.facility_id = widget_record.facility_id
      and service_expert.service_id = p_service_id
      and service_expert.is_active
      and (
        effective_expert_user_id is null
        or service_expert.user_id = effective_expert_user_id
      )
  ),
  candidate_slots as (
    select (
             slot_local.slot_value at time zone widget_record.timezone
           ) as slot_starts_at,
           expert.user_id,
           expert.display_name
    from facility_periods period
    cross join experts expert
    cross join lateral generate_series(
      period.local_date + period.opens_at
        + make_interval(mins => service_record.buffer_before_minutes),
      period.local_date + period.closes_at
        - make_interval(
            mins => service_record.duration_minutes
              + service_record.buffer_after_minutes
          ),
      make_interval(mins => service_record.slot_interval_minutes)
    ) slot_local(slot_value)
  )
  select distinct
         candidate.slot_starts_at,
         candidate.slot_starts_at
           + make_interval(mins => service_record.duration_minutes),
         candidate.user_id,
         candidate.display_name
  from candidate_slots candidate
  where private.expert_slot_is_available(
    widget_record.organization_id,
    widget_record.facility_id,
    p_service_id,
    candidate.user_id,
    candidate.slot_starts_at
  )
  order by 1, 4, 3;
end;
$$;


--
-- Name: get_organization_user_admin_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organization_user_admin_access(p_organization_id uuid, p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
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


--
-- Name: get_personal_booking_widget_counts(uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_personal_booking_widget_counts(p_organization_id uuid, p_expert_user_id uuid, p_since timestamp with time zone) RETURNS TABLE(widget_id uuid, bookings bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    widget.id as widget_id,
    count(appointment.id)::bigint as bookings
  from public.booking_widgets widget
  left join public.appointments appointment
    on appointment.organization_id = widget.organization_id
   and appointment.widget_id = widget.id
   and appointment.expert_user_id = p_expert_user_id
   and appointment.created_at >= coalesce(p_since, '-infinity'::timestamptz)
  where widget.organization_id = p_organization_id
    and widget.fixed_expert_user_id = p_expert_user_id
    and (
      select private.can_manage_booking_widget(
        widget.organization_id,
        widget.facility_id,
        widget.fixed_expert_user_id
      )
    )
  group by widget.id;
$$;


--
-- Name: get_staff_booking_slots(uuid, uuid, uuid, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_staff_booking_slots(p_organization_id uuid, p_facility_id uuid, p_service_id uuid, p_local_date date, p_expert_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone, expert_user_id uuid, expert_name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  facility_record record;
  service_record record;
begin
  if p_local_date is null then
    raise exception 'booking_date_is_required' using errcode = '22023';
  end if;

  select facility.timezone
  into facility_record
  from public.facilities facility
  where facility.organization_id = p_organization_id
    and facility.id = p_facility_id
    and facility.is_active;

  if not found then
    raise exception 'facility_not_found' using errcode = 'P0002';
  end if;

  select service.duration_minutes,
         service.buffer_before_minutes,
         service.buffer_after_minutes,
         service.slot_interval_minutes
  into service_record
  from public.booking_services service
  join public.facility_services facility_service
    on facility_service.organization_id = service.organization_id
   and facility_service.service_id = service.id
   and facility_service.facility_id = p_facility_id
   and facility_service.is_active
  where service.organization_id = p_organization_id
    and service.id = p_service_id
    and service.is_active;

  if not found then
    raise exception 'facility_service_not_found' using errcode = 'P0002';
  end if;

  if p_expert_user_id is not null and not exists (
    select 1
    from public.facility_service_experts service_expert
    join public.facility_memberships membership
      on membership.organization_id = service_expert.organization_id
     and membership.facility_id = service_expert.facility_id
     and membership.user_id = service_expert.user_id
     and membership.is_bookable
    where service_expert.organization_id = p_organization_id
      and service_expert.facility_id = p_facility_id
      and service_expert.service_id = p_service_id
      and service_expert.user_id = p_expert_user_id
      and service_expert.is_active
  ) then
    raise exception 'expert_not_bookable_for_service' using errcode = '23503';
  end if;

  return query
  with facility_periods as (
    select override.opens_at, override.closes_at
    from public.facility_opening_overrides override
    where override.organization_id = p_organization_id
      and override.facility_id = p_facility_id
      and override.local_date = p_local_date
      and not override.is_closed

    union all

    select opening.opens_at, opening.closes_at
    from public.facility_opening_hours opening
    where opening.organization_id = p_organization_id
      and opening.facility_id = p_facility_id
      and opening.weekday = extract(isodow from p_local_date)::integer - 1
      and opening.is_active
      and not exists (
        select 1
        from public.facility_opening_overrides override
        where override.organization_id = p_organization_id
          and override.facility_id = p_facility_id
          and override.local_date = p_local_date
      )
  ),
  experts as (
    select service_expert.user_id,
           coalesce(app_user.full_name, 'Ekspert') as display_name
    from public.facility_service_experts service_expert
    join public.facility_memberships membership
      on membership.organization_id = service_expert.organization_id
     and membership.facility_id = service_expert.facility_id
     and membership.user_id = service_expert.user_id
     and membership.is_bookable
    join public.users app_user on app_user.id = service_expert.user_id
    where service_expert.organization_id = p_organization_id
      and service_expert.facility_id = p_facility_id
      and service_expert.service_id = p_service_id
      and service_expert.is_active
      and (p_expert_user_id is null or service_expert.user_id = p_expert_user_id)
  ),
  candidate_slots as (
    select (
             slot_local.slot_value at time zone facility_record.timezone
           ) as slot_starts_at,
           expert.user_id,
           expert.display_name
    from facility_periods period
    cross join experts expert
    cross join lateral generate_series(
      p_local_date + period.opens_at
        + make_interval(mins => service_record.buffer_before_minutes),
      p_local_date + period.closes_at
        - make_interval(
            mins => service_record.duration_minutes
              + service_record.buffer_after_minutes
          ),
      make_interval(mins => service_record.slot_interval_minutes)
    ) slot_local(slot_value)
  )
  select distinct
         candidate.slot_starts_at,
         candidate.slot_starts_at
           + make_interval(mins => service_record.duration_minutes),
         candidate.user_id,
         candidate.display_name
  from candidate_slots candidate
  where private.expert_slot_is_available(
    p_organization_id,
    p_facility_id,
    p_service_id,
    candidate.user_id,
    candidate.slot_starts_at
  )
  order by 1, 4, 3;
end;
$$;


--
-- Name: publish_mortgage_document_template_draft(uuid, text, bigint, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_mortgage_document_template_draft(p_bank_id uuid, p_template_key text, p_expected_revision bigint, p_actor_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: publish_mortgage_product_draft(uuid, bigint, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_mortgage_product_draft(p_product_id uuid, p_expected_revision bigint, p_actor_user_id uuid) RETURNS TABLE(version_id uuid, version_number integer)
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  product_record public.mortgage_products%rowtype;
  draft_record public.mortgage_product_drafts%rowtype;
  first_phase jsonb;
  first_formula jsonb;
  formula_kind text;
  flat_interest_type text;
  variant_interest_type text;
  next_version_number integer;
  published_version_id uuid;
  draft_hash text;
  prior_hash text;
  primary_source_id uuid;
  min_amount_value numeric(14, 2);
  max_amount_value numeric(14, 2);
  min_term_value integer;
  max_term_value integer;
  max_ltv_value numeric(7, 4);
  fixed_rate_value numeric(8, 5);
  fixed_months_value integer;
  margin_value numeric(8, 5);
  reference_rate_value numeric(8, 5);
  reference_rate_code_value text;
  reference_rate_as_of_value date;
  requirements_value jsonb;
  sources_value jsonb;
begin
  if not exists (
    select 1
    from public.platform_user_roles platform_role
    where platform_role.user_id = p_actor_user_id
      and platform_role.role = 'super_admin'
  ) then
    raise exception 'super_admin_actor_required'
      using errcode = '42501';
  end if;

  -- Lock the product first. This serializes version-number allocation and gives
  -- all callers a stable lock order before the draft row is acquired.
  select product.*
  into product_record
  from public.mortgage_products product
  where product.id = p_product_id
  for update;

  if not found then
    raise exception 'mortgage_product_not_found'
      using errcode = 'P0002';
  end if;

  if product_record.archived_at is not null then
    raise exception 'archived_mortgage_product_cannot_be_published'
      using errcode = '55000';
  end if;

  select draft.*
  into draft_record
  from public.mortgage_product_drafts draft
  where draft.product_id = p_product_id
  for update;

  if not found then
    raise exception 'mortgage_product_draft_not_found'
      using errcode = 'P0002';
  end if;

  if draft_record.revision <> p_expected_revision then
    raise exception 'mortgage_product_draft_revision_conflict'
      using
        errcode = '40001',
        detail = format(
          'Expected revision %s, current revision is %s.',
          p_expected_revision,
          draft_record.revision
        );
  end if;

  if draft_record.draft_data ->> 'schemaVersion'
       <> 'openexpert.mortgage-offer/2.0'
     or draft_record.draft_data ->> 'currency' <> 'PLN'
     or jsonb_typeof(draft_record.draft_data -> 'validity') <> 'object'
     or jsonb_typeof(draft_record.draft_data -> 'calculationPolicy') <> 'object'
     or jsonb_typeof(draft_record.draft_data -> 'eligibility') <> 'object'
     or jsonb_typeof(draft_record.draft_data #> '{eligibility,allowedInstallmentTypes}') <> 'array'
     or jsonb_typeof(draft_record.draft_data #> '{ratePlan,phases}') <> 'array'
     or jsonb_array_length(draft_record.draft_data #> '{ratePlan,phases}') = 0
     or jsonb_typeof(draft_record.draft_data #> '{ratePlan,modifiers}') <> 'array'
     or jsonb_typeof(draft_record.draft_data -> 'features') <> 'array'
     or jsonb_typeof(draft_record.draft_data -> 'presets') <> 'array'
     or jsonb_typeof(draft_record.draft_data -> 'costs') <> 'array'
     or jsonb_typeof(draft_record.draft_data -> 'disbursementPolicy') <> 'object'
     or draft_record.draft_data #>> '{calculationPolicy,accrual}' <> 'nominal_monthly_12'
     or jsonb_typeof(draft_record.draft_data #> '{documentation,sources}') <> 'array'
     or jsonb_array_length(draft_record.draft_data #> '{documentation,sources}') = 0
     or draft_record.draft_data #>> '{validity,effectiveFrom}' > current_date::text
     or coalesce(
       nullif(draft_record.draft_data #>> '{validity,effectiveTo}', ''),
       '9999-12-31'
     ) < current_date::text then
    raise exception 'invalid_mortgage_offer_v2_draft'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_record.draft_data -> 'costs') cost
    where cost ->> 'state' = 'unknown'
  ) then
    raise exception 'unknown_mortgage_offer_costs_cannot_be_published'
      using errcode = '23514';
  end if;

  first_phase := draft_record.draft_data #> '{ratePlan,phases,0}';
  first_formula := first_phase -> 'formula';
  formula_kind := first_formula ->> 'kind';

  if formula_kind not in ('fixed', 'index_plus_margin') then
    raise exception 'unsupported_mortgage_rate_formula'
      using errcode = '23514';
  end if;

  begin
    min_amount_value := (draft_record.draft_data #>> '{eligibility,minAmount}')::numeric;
    max_amount_value := nullif(draft_record.draft_data #>> '{eligibility,maxAmount}', '')::numeric;
    min_term_value := (draft_record.draft_data #>> '{eligibility,minTermMonths}')::integer;
    max_term_value := (draft_record.draft_data #>> '{eligibility,maxTermMonths}')::integer;
    max_ltv_value := (draft_record.draft_data #>> '{eligibility,maxLtvPct}')::numeric;

    if formula_kind = 'fixed' then
      fixed_rate_value := (first_formula ->> 'ratePct')::numeric;
      fixed_months_value := greatest(
        1,
        case
          when first_phase #>> '{period,from,kind}' = 'month'
            and first_phase #>> '{period,endExclusive,kind}' = 'month'
          then
            (first_phase #>> '{period,endExclusive,month}')::integer
            - (first_phase #>> '{period,from,month}')::integer
          else max_term_value
        end
      );
    else
      margin_value := (first_formula ->> 'marginPct')::numeric;
      reference_rate_value := (first_formula ->> 'indexValuePct')::numeric;
      reference_rate_code_value := nullif(btrim(first_formula ->> 'indexCode'), '');
      reference_rate_as_of_value := nullif(
        coalesce(
          first_formula ->> 'indexAsOf',
          draft_record.draft_data #>> '{validity,pricingAsOf}'
        ),
        ''
      )::date;
    end if;
  exception
    when invalid_text_representation
      or invalid_datetime_format
      or numeric_value_out_of_range
      or datetime_field_overflow then
      raise exception 'invalid_mortgage_offer_v2_numeric_or_date_value'
        using errcode = '23514';
  end;

  if min_amount_value < 0
     or (max_amount_value is not null and max_amount_value < min_amount_value)
     or min_term_value <= 0
     or max_term_value < min_term_value
     or max_ltv_value < 0
     or max_ltv_value > 200
     or (formula_kind = 'fixed' and fixed_rate_value is null)
     or (
       formula_kind = 'index_plus_margin'
       and (
         margin_value is null
         or reference_rate_value is null
         or reference_rate_code_value is null
         or reference_rate_as_of_value is null
       )
     ) then
    raise exception 'invalid_mortgage_offer_v2_ranges'
      using errcode = '23514';
  end if;

  requirements_value := coalesce(
    draft_record.draft_data #> '{documentation,requirements}',
    '[]'::jsonb
  );
  sources_value := coalesce(
    draft_record.draft_data #> '{documentation,sources}',
    '[]'::jsonb
  );

  if jsonb_typeof(requirements_value) <> 'array'
     or jsonb_typeof(sources_value) <> 'array' then
    raise exception 'invalid_mortgage_offer_documentation'
      using errcode = '23514';
  end if;

  select source.id
  into primary_source_id
  from jsonb_array_elements(sources_value) with ordinality as item(value, position)
  join public.mortgage_source_documents source
    on source.id::text = coalesce(
      item.value ->> 'sourceId',
      item.value ->> 'sourceDocumentId',
      item.value ->> 'source_document_id'
    )
   and source.bank_id = product_record.bank_id
   and (source.product_id is null or source.product_id = p_product_id)
  order by
    case when coalesce(item.value ->> 'role', 'primary') = 'primary' then 0 else 1 end,
    item.position
  limit 1;

  select coalesce(max(version.version_number), 0) + 1
  into next_version_number
  from public.mortgage_product_versions version
  where version.product_id = p_product_id;

  if product_record.current_published_version_id is not null then
    select version.content_sha256
    into prior_hash
    from public.mortgage_product_versions version
    where version.id = product_record.current_published_version_id;

    update public.mortgage_product_versions version
    set
      lifecycle_status = 'retired',
      retired_at = now(),
      retired_by_user_id = p_actor_user_id
    where version.id = product_record.current_published_version_id
      and version.lifecycle_status = 'published';
  end if;

  draft_hash := encode(
    extensions.digest(
      convert_to(draft_record.draft_data::text, 'utf8'),
      'sha256'
    ),
    'hex'
  );

  flat_interest_type := case
    when formula_kind = 'fixed' then 'fixed_periodic'
    else 'variable'
  end;
  variant_interest_type := case
    when exists (
      select 1
      from jsonb_array_elements(draft_record.draft_data #> '{ratePlan,phases}') phase
      where phase #>> '{formula,kind}' = 'fixed'
    ) and exists (
      select 1
      from jsonb_array_elements(draft_record.draft_data #> '{ratePlan,phases}') phase
      where phase #>> '{formula,kind}' = 'index_plus_margin'
    ) then 'mixed'
    else flat_interest_type
  end;

  insert into public.mortgage_product_versions (
    version_key,
    product_id,
    source_document_id,
    effective_from,
    effective_to,
    retrieved_at,
    calculation_date,
    data_status,
    completeness_score,
    interest_type,
    fixed_rate_pct,
    fixed_period_months,
    margin_pct,
    reference_rate_code,
    reference_rate_pct,
    reference_rate_as_of,
    min_amount,
    max_amount,
    min_term_months,
    max_term_months,
    max_ltv_pct,
    cost_rules,
    requirements,
    representative_example,
    assumptions,
    unknown_fields,
    document_requirements,
    multiform_template_ids,
    version_number,
    lifecycle_status,
    calculator_schema_version,
    calculator_engine_version,
    content_sha256,
    validation_report,
    published_at,
    published_by_user_id
  ) values (
    product_record.id::text || '-v' || next_version_number::text,
    p_product_id,
    primary_source_id,
    nullif(draft_record.draft_data #>> '{validity,effectiveFrom}', '')::date,
    nullif(draft_record.draft_data #>> '{validity,effectiveTo}', '')::date,
    now(),
    nullif(draft_record.draft_data #>> '{validity,pricingAsOf}', '')::date,
    'confirmed',
    100,
    flat_interest_type,
    fixed_rate_value,
    fixed_months_value,
    margin_value,
    reference_rate_code_value,
    reference_rate_value,
    reference_rate_as_of_value,
    min_amount_value,
    max_amount_value,
    min_term_value,
    max_term_value,
    max_ltv_value,
    jsonb_build_object(
      'schemaVersion', draft_record.draft_data ->> 'schemaVersion',
      'costs', draft_record.draft_data -> 'costs'
    ),
    '[]'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '{}'::text[],
    requirements_value,
    '{}'::text[],
    next_version_number,
    'published',
    2,
    'openexpert-mortgage-v2',
    draft_hash,
    jsonb_build_object('valid', true, 'issues', '[]'::jsonb),
    now(),
    p_actor_user_id
  )
  returning id into published_version_id;

  insert into public.mortgage_product_version_variants (
    product_version_id,
    code,
    name,
    sort_order,
    is_default,
    min_amount,
    max_amount,
    min_term_months,
    max_term_months,
    max_ltv_pct,
    interest_type,
    fixed_rate_pct,
    fixed_period_months,
    margin_pct,
    reference_rate_code,
    reference_rate_pct,
    reference_rate_as_of,
    calculation_readiness,
    pricing_config,
    eligibility_config
  ) values (
    published_version_id,
    'standard',
    'Wariant standardowy',
    0,
    true,
    min_amount_value,
    max_amount_value,
    min_term_value,
    max_term_value,
    max_ltv_value,
    variant_interest_type,
    fixed_rate_value,
    fixed_months_value,
    margin_value,
    reference_rate_code_value,
    reference_rate_value,
    reference_rate_as_of_value,
    'complete',
    draft_record.draft_data,
    draft_record.draft_data -> 'eligibility'
  );

  insert into public.mortgage_product_version_sources (
    product_version_id,
    source_document_id,
    source_role
  )
  select
    published_version_id,
    source.id,
    case
      when coalesce(item.value ->> 'role', 'primary') in (
        'primary',
        'pricing',
        'eligibility',
        'costs',
        'documents',
        'legal',
        'general',
        'representative_example',
        'other'
      ) then coalesce(item.value ->> 'role', 'primary')
      else 'other'
    end
  from jsonb_array_elements(sources_value) item(value)
  join public.mortgage_source_documents source
    on source.id::text = coalesce(
      item.value ->> 'sourceId',
      item.value ->> 'sourceDocumentId',
      item.value ->> 'source_document_id'
    )
   and source.bank_id = product_record.bank_id
   and (source.product_id is null or source.product_id = p_product_id)
  on conflict do nothing;

  update public.mortgage_products product
  set
    current_published_version_id = published_version_id,
    revision = product.revision + 1,
    is_active = true,
    updated_by_user_id = p_actor_user_id
  where product.id = p_product_id;

  insert into public.mortgage_catalog_events (
    bank_id,
    product_id,
    draft_id,
    product_version_id,
    event_type,
    actor_user_id,
    revision_before,
    revision_after,
    content_sha256_before,
    content_sha256_after,
    metadata
  ) values (
    product_record.bank_id,
    p_product_id,
    draft_record.id,
    published_version_id,
    'product.published',
    p_actor_user_id,
    product_record.revision,
    product_record.revision + 1,
    prior_hash,
    draft_hash,
    jsonb_build_object(
      'draftRevision', draft_record.revision,
      'versionNumber', next_version_number,
      'calculatorSchemaVersion', 2,
      'calculatorEngineVersion', 'openexpert-mortgage-v2'
    )
  );

  delete from public.mortgage_product_drafts draft
  where draft.id = draft_record.id;

  return query select published_version_id, next_version_number;
end;
$$;


--
-- Name: FUNCTION publish_mortgage_product_draft(p_product_id uuid, p_expected_revision bigint, p_actor_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.publish_mortgage_product_draft(p_product_id uuid, p_expected_revision bigint, p_actor_user_id uuid) IS 'Service-role-only atomic publication of one optimistic mortgage V2 draft as an immutable version and standard variant.';


--
-- Name: record_booking_widget_event(uuid, uuid, text, uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_booking_widget_event(p_widget_token uuid, p_visit_id uuid, p_event_type text, p_service_id uuid DEFAULT NULL::uuid, p_event_id text DEFAULT NULL::text, p_is_embedded boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  widget_record record;
  service_scoped_event boolean;
begin
  if p_visit_id is null then
    raise exception 'invalid_booking_widget_visit' using errcode = '22023';
  end if;

  if p_event_type is null
     or p_event_type not in (
       'widget_view',
       'widget_engaged',
       'calculator_started',
       'calculator_completed',
       'service_selected',
       'availability_search',
       'availability_found',
       'slot_selected',
       'contact_started',
       'booking_attempt',
       'booking_completed'
     ) then
    raise exception 'invalid_booking_widget_event_type' using errcode = '22023';
  end if;

  service_scoped_event := p_event_type in (
    'service_selected',
    'availability_search',
    'availability_found',
    'slot_selected',
    'contact_started',
    'booking_attempt',
    'booking_completed'
  );

  if (service_scoped_event and p_service_id is null)
     or (not service_scoped_event and p_service_id is not null) then
    raise exception 'invalid_booking_widget_event_service' using errcode = '22023';
  end if;

  if (
    p_event_type in ('booking_attempt', 'booking_completed')
    and (
      p_event_id is null
      or p_event_id !~ '^[0-9a-f]{64}$'
    )
  ) or (
    p_event_type not in ('booking_attempt', 'booking_completed')
    and p_event_id is not null
  ) then
    raise exception 'invalid_booking_widget_event_id' using errcode = '22023';
  end if;

  select
    widget.id,
    widget.organization_id,
    widget.facility_id
  into widget_record
  from public.booking_widgets widget
  join public.facilities facility
    on facility.organization_id = widget.organization_id
   and facility.id = widget.facility_id
   and facility.is_active
  where widget.public_token = p_widget_token
    and widget.is_active;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  if p_service_id is not null
     and p_event_type <> 'booking_completed'
     and not exists (
       select 1
       from public.booking_widget_services widget_service
       join public.facility_services facility_service
         on facility_service.organization_id = widget_service.organization_id
        and facility_service.facility_id = widget_service.facility_id
        and facility_service.service_id = widget_service.service_id
        and facility_service.is_active
       join public.booking_services service
         on service.organization_id = widget_service.organization_id
        and service.id = widget_service.service_id
        and service.is_active
       where widget_service.organization_id = widget_record.organization_id
         and widget_service.facility_id = widget_record.facility_id
         and widget_service.widget_id = widget_record.id
         and widget_service.service_id = p_service_id
     ) then
    raise exception 'booking_service_not_available_in_widget' using errcode = '23503';
  end if;

  if p_service_id is not null
     and p_event_type = 'booking_completed'
     and not exists (
       select 1
       from public.booking_services service
       where service.organization_id = widget_record.organization_id
         and service.id = p_service_id
     ) then
    raise exception 'booking_service_not_found' using errcode = '23503';
  end if;

  insert into public.booking_widget_events (
    organization_id,
    facility_id,
    widget_id,
    visit_id,
    event_type,
    service_id,
    event_id,
    is_embedded
  ) values (
    widget_record.organization_id,
    widget_record.facility_id,
    widget_record.id,
    p_visit_id,
    p_event_type,
    p_service_id,
    p_event_id,
    coalesce(p_is_embedded, false)
  )
  on conflict do nothing;
end;
$_$;


--
-- Name: replace_calendar_busy_blocks(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_calendar_busy_blocks(p_organization_id uuid, p_connection_id uuid, p_blocks jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  inserted_count integer;
begin
  if jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then
    raise exception 'calendar_busy_blocks_must_be_an_array' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.calendar_connections connection
    where connection.organization_id = p_organization_id
      and connection.id = p_connection_id
  ) then
    raise exception 'calendar_connection_not_found' using errcode = 'P0002';
  end if;

  delete from public.external_busy_blocks busy
  where busy.organization_id = p_organization_id
    and busy.connection_id = p_connection_id;

  insert into public.external_busy_blocks (
    organization_id, connection_id, calendar_id, external_event_id, busy_period
  )
  select p_organization_id,
         p_connection_id,
         item ->> 'calendarId',
         item ->> 'externalEventId',
         tstzrange(
           (item ->> 'startsAt')::timestamptz,
           (item ->> 'endsAt')::timestamptz,
           '[)'
         )
  from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) item;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;


--
-- Name: replace_expert_availability(uuid, uuid, uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_expert_availability(p_organization_id uuid, p_facility_id uuid, p_user_id uuid, p_rules jsonb, p_overrides jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not (
    private.is_organization_admin(p_organization_id)
    or private.is_facility_admin(p_organization_id, p_facility_id)
    or (
      p_user_id = (select app.current_user_id())
      and exists (
        select 1
        from public.facility_memberships membership
        where membership.organization_id = p_organization_id
          and membership.facility_id = p_facility_id
          and membership.user_id = p_user_id
      )
    )
  ) then
    raise exception 'expert_or_facility_admin_required' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' then
    raise exception 'schedule_payload_must_be_arrays' using errcode = '22023';
  end if;

  delete from public.expert_availability_rules rule
  where rule.organization_id = p_organization_id
    and rule.facility_id = p_facility_id
    and rule.user_id = p_user_id;

  insert into public.expert_availability_rules (
    organization_id,
    facility_id,
    user_id,
    weekday,
    starts_at,
    ends_at,
    valid_from,
    valid_until,
    is_active
  )
  select p_organization_id,
         p_facility_id,
         p_user_id,
         (item ->> 'weekday')::smallint,
         coalesce(item ->> 'startsAt', item ->> 'starts_at')::time,
         coalesce(item ->> 'endsAt', item ->> 'ends_at')::time,
         nullif(coalesce(item ->> 'validFrom', item ->> 'valid_from'), '')::date,
         nullif(coalesce(item ->> 'validUntil', item ->> 'valid_until'), '')::date,
         coalesce((item ->> 'isActive')::boolean, (item ->> 'is_active')::boolean, true)
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) item;

  delete from public.expert_availability_overrides override
  where override.organization_id = p_organization_id
    and override.facility_id = p_facility_id
    and override.user_id = p_user_id;

  insert into public.expert_availability_overrides (
    organization_id,
    facility_id,
    user_id,
    local_date,
    is_unavailable,
    starts_at,
    ends_at
  )
  select p_organization_id,
         p_facility_id,
         p_user_id,
         coalesce(item ->> 'localDate', item ->> 'local_date')::date,
         coalesce(
           (item ->> 'isUnavailable')::boolean,
           (item ->> 'is_unavailable')::boolean,
           false
         ),
         case
           when coalesce(
             (item ->> 'isUnavailable')::boolean,
             (item ->> 'is_unavailable')::boolean,
             false
           ) then null
           else coalesce(item ->> 'startsAt', item ->> 'starts_at')::time
         end,
         case
           when coalesce(
             (item ->> 'isUnavailable')::boolean,
             (item ->> 'is_unavailable')::boolean,
             false
           ) then null
           else coalesce(item ->> 'endsAt', item ->> 'ends_at')::time
         end
  from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) item;
end;
$$;


--
-- Name: replace_facility_opening_hours(uuid, uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_facility_opening_hours(p_organization_id uuid, p_facility_id uuid, p_hours jsonb, p_overrides jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not (
    private.is_organization_admin(p_organization_id)
    or private.is_facility_admin(p_organization_id, p_facility_id)
  ) then
    raise exception 'facility_admin_required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.facilities facility
    where facility.organization_id = p_organization_id
      and facility.id = p_facility_id
  ) then
    raise exception 'facility_not_found' using errcode = '23503';
  end if;

  if jsonb_typeof(coalesce(p_hours, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' then
    raise exception 'schedule_payload_must_be_arrays' using errcode = '22023';
  end if;

  delete from public.facility_opening_hours opening
  where opening.organization_id = p_organization_id
    and opening.facility_id = p_facility_id;

  insert into public.facility_opening_hours (
    organization_id, facility_id, weekday, opens_at, closes_at, is_active
  )
  select p_organization_id,
         p_facility_id,
         (item ->> 'weekday')::smallint,
         coalesce(item ->> 'opensAt', item ->> 'opens_at')::time,
         coalesce(item ->> 'closesAt', item ->> 'closes_at')::time,
         coalesce((item ->> 'isActive')::boolean, (item ->> 'is_active')::boolean, true)
  from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) item;

  delete from public.facility_opening_overrides override
  where override.organization_id = p_organization_id
    and override.facility_id = p_facility_id;

  insert into public.facility_opening_overrides (
    organization_id, facility_id, local_date, is_closed, opens_at, closes_at
  )
  select p_organization_id,
         p_facility_id,
         coalesce(item ->> 'localDate', item ->> 'local_date')::date,
         coalesce((item ->> 'isClosed')::boolean, (item ->> 'is_closed')::boolean, false),
         case
           when coalesce((item ->> 'isClosed')::boolean, (item ->> 'is_closed')::boolean, false)
             then null
           else coalesce(item ->> 'opensAt', item ->> 'opens_at')::time
         end,
         case
           when coalesce((item ->> 'isClosed')::boolean, (item ->> 'is_closed')::boolean, false)
             then null
           else coalesce(item ->> 'closesAt', item ->> 'closes_at')::time
         end
  from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) item;
end;
$$;


--
-- Name: replay_widget_booking(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replay_widget_booking(p_widget_token uuid, p_idempotency_key text, p_request_fingerprint text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  target_widget_id uuid;
  existing_appointment_id uuid;
  existing_request_fingerprint text;
begin
  if nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_booking_replay_request' using errcode = '22023';
  end if;

  select widget.id
  into target_widget_id
  from public.booking_widgets widget
  where widget.public_token = p_widget_token;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  perform private.assert_widget_origin_allowed(target_widget_id);
  perform pg_advisory_xact_lock(hashtextextended(
    'openexpert-widget-booking:' || target_widget_id::text || ':'
      || btrim(p_idempotency_key),
    0
  ));

  select appointment.id, appointment.request_fingerprint
  into existing_appointment_id, existing_request_fingerprint
  from public.appointments appointment
  where appointment.widget_id = target_widget_id
    and appointment.idempotency_key = btrim(p_idempotency_key);

  if not found then
    return null;
  end if;

  if existing_request_fingerprint = p_request_fingerprint then
    return private.widget_booking_result(existing_appointment_id);
  end if;

  raise exception 'idempotency_key_reused' using errcode = 'P0001';
end;
$_$;


--
-- Name: request_crm_client_anonymization_execution_grant(uuid, uuid, uuid, uuid, text, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_crm_client_anonymization_execution_grant(p_organization_id uuid, p_request_id uuid, p_grantee_user_id uuid, p_approver_user_id uuid, p_justification text, p_expires_at timestamp with time zone, p_idempotency_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
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


--
-- Name: respond_crm_client_anonymization_execution_grant(uuid, uuid, bigint, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.respond_crm_client_anonymization_execution_grant(p_organization_id uuid, p_grant_id uuid, p_expected_revision bigint, p_action text, p_reason text, p_idempotency_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
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


--
-- Name: revoke_crm_client_anonymization_execution_grant(uuid, uuid, bigint, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_crm_client_anonymization_execution_grant(p_organization_id uuid, p_grant_id uuid, p_expected_revision bigint, p_reason text, p_idempotency_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
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


--
-- Name: save_mortgage_document_template_draft(uuid, text, text, text, text, integer, jsonb, jsonb, bigint, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_mortgage_document_template_draft(p_bank_id uuid, p_template_key text, p_label text, p_source_file_name text, p_source_sha256 text, p_registry_version integer, p_template_json jsonb, p_validation_report jsonb, p_expected_revision bigint, p_actor_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: save_mortgage_product_draft_v2(uuid, bigint, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_mortgage_product_draft_v2(p_product_id uuid, p_expected_revision bigint, p_draft_data jsonb, p_actor_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  product_record public.mortgage_products%rowtype;
  draft_record public.mortgage_product_drafts%rowtype;
  draft_exists boolean := false;
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

  select product.*
  into product_record
  from public.mortgage_products product
  where product.id = p_product_id
  for update;

  if not found then
    raise exception 'mortgage_product_not_found' using errcode = 'P0002';
  end if;
  if product_record.archived_at is not null then
    raise exception 'archived_mortgage_product_cannot_be_edited' using errcode = '55000';
  end if;

  select draft.*
  into draft_record
  from public.mortgage_product_drafts draft
  where draft.product_id = p_product_id
  for update;
  draft_exists := found;

  if draft_exists then
    if draft_record.revision <> p_expected_revision then
      raise exception 'mortgage_draft_revision_conflict' using errcode = '40001';
    end if;
    update public.mortgage_product_drafts draft
    set
      revision = draft.revision + 1,
      draft_data = p_draft_data,
      validation_report = '{}'::jsonb,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
    where draft.id = draft_record.id
    returning * into draft_record;
  else
    if p_expected_revision <> 0 then
      raise exception 'mortgage_draft_revision_conflict' using errcode = '40001';
    end if;
    insert into public.mortgage_product_drafts (
      product_id,
      base_version_id,
      revision,
      draft_data,
      validation_report,
      created_by_user_id,
      updated_by_user_id
    ) values (
      p_product_id,
      product_record.current_published_version_id,
      1,
      p_draft_data,
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    )
    returning * into draft_record;
  end if;

  update public.mortgage_products product
  set updated_by_user_id = p_actor_user_id, updated_at = now()
  where product.id = p_product_id;

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
    product_record.bank_id,
    p_product_id,
    draft_record.id,
    'draft_saved',
    p_actor_user_id,
    p_expected_revision,
    draft_record.revision,
    jsonb_build_object('schemaVersion', p_draft_data ->> 'schemaVersion')
  );

  return jsonb_build_object(
    'draftId', draft_record.id,
    'draftRevision', draft_record.revision,
    'draftData', draft_record.draft_data,
    'draftUpdatedAt', draft_record.updated_at,
    'draftUpdatedBy', draft_record.updated_by_user_id
  );
end;
$$;


--
-- Name: FUNCTION save_mortgage_product_draft_v2(p_product_id uuid, p_expected_revision bigint, p_draft_data jsonb, p_actor_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.save_mortgage_product_draft_v2(p_product_id uuid, p_expected_revision bigint, p_draft_data jsonb, p_actor_user_id uuid) IS 'Service-role-only optimistic and atomic save of a mortgage V2 draft with its audit event.';


--
-- Name: search_crm_cases(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_crm_cases(p_organization_id uuid, p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare
  filters jsonb := coalesce(p_filters, '{}'::jsonb);
  search_term text;
  search_query tsquery;
  client_ids uuid[];
  client_match text;
  bank_ids uuid[];
  offer_mode text;
  created_from timestamptz;
  created_to timestamptz;
  updated_from timestamptz;
  updated_to timestamptz;
  target_sort text;
  target_limit integer;
  target_offset integer;
  include_facets boolean;
  result jsonb;
begin
  if jsonb_typeof(filters) <> 'object' then
    raise exception 'case_filters_must_be_an_object' using errcode = '22023';
  end if;
  if current_user <> 'openexpert_service' then
    if not private.is_organization_member(p_organization_id) then
      raise exception 'organization_membership_required' using errcode = '42501';
    end if;
  end if;
  if jsonb_typeof(coalesce(filters -> 'clientIds', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'bankIds', '[]'::jsonb)) <> 'array' then
    raise exception 'case_filter_arrays_are_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(
      coalesce(filters -> 'clientIds', '[]'::jsonb)
      || coalesce(filters -> 'bankIds', '[]'::jsonb)
    ) value
    where value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'case_filter_ids_are_invalid' using errcode = '22023';
  end if;

  search_term := nullif(btrim(filters ->> 'q'), '');
  if length(coalesce(search_term, '')) > 200 then
    raise exception 'case_search_query_is_too_long' using errcode = '22023';
  end if;
  if search_term is not null then
    search_term := lower(extensions.unaccent(
      'extensions.unaccent'::regdictionary,
      search_term
    ));
    search_query := websearch_to_tsquery('simple', search_term);
  end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into client_ids
  from jsonb_array_elements_text(coalesce(filters -> 'clientIds', '[]'::jsonb)) value;
  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into bank_ids
  from jsonb_array_elements_text(coalesce(filters -> 'bankIds', '[]'::jsonb)) value;

  client_match := coalesce(nullif(filters ->> 'clientMatch', ''), 'any');
  if client_match not in ('any', 'all') then
    raise exception 'case_client_match_is_invalid' using errcode = '22023';
  end if;
  offer_mode := coalesce(nullif(filters ->> 'offerMode', ''), 'all');
  if offer_mode not in ('all', 'with', 'without') then
    raise exception 'case_offer_mode_is_invalid' using errcode = '22023';
  end if;

  created_from := nullif(filters ->> 'createdFrom', '')::timestamptz;
  created_to := nullif(filters ->> 'createdTo', '')::timestamptz;
  updated_from := nullif(filters ->> 'updatedFrom', '')::timestamptz;
  updated_to := nullif(filters ->> 'updatedTo', '')::timestamptz;

  target_sort := coalesce(
    nullif(filters ->> 'sort', ''),
    case when search_term is null then 'updated_desc' else 'relevance' end
  );
  if target_sort not in (
    'relevance', 'updated_desc', 'updated_asc', 'created_desc', 'created_asc',
    'title_asc', 'title_desc', 'offers_desc'
  ) then
    raise exception 'case_sort_is_invalid' using errcode = '22023';
  end if;

  target_limit := least(greatest(coalesce((filters ->> 'limit')::integer, 25), 1), 100);
  target_offset := coalesce((filters ->> 'offset')::integer, 0);
  if target_offset < 0 or target_offset > 100000 then
    raise exception 'case_offset_is_invalid' using errcode = '22023';
  end if;
  include_facets := coalesce((filters ->> 'includeFacets')::boolean, false);

  with filtered as materialized (
    select
      crm_case.id,
      crm_case.title,
      crm_case.created_at,
      crm_case.updated_at,
      coalesce(clients.clients_json, '[]'::jsonb) as clients_json,
      coalesce(offers.offer_count, 0) as offer_count,
      coalesce(offers.banks_json, '[]'::jsonb) as banks_json,
      case when search_term is null then 0::real else (
        ts_rank_cd(crm_case.search_vector, search_query, 32)
        + extensions.similarity(crm_case.search_text, search_term) * 0.2
      )::real end as relevance,
      jsonb_build_object(
        'id', crm_case.id,
        'title', crm_case.title,
        'created_at', crm_case.created_at,
        'updated_at', crm_case.updated_at,
        'clients', coalesce(clients.clients_json, '[]'::jsonb),
        'offer_count', coalesce(offers.offer_count, 0),
        'banks', coalesce(offers.banks_json, '[]'::jsonb)
      ) as row_json
    from public.crm_cases crm_case
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', client.id,
        'display_name', client.display_name,
        'primary_email', client.primary_email,
        'primary_phone', client.primary_phone,
        'is_primary', case_client.is_primary
      ) order by case_client.is_primary desc, client.display_name, client.id) as clients_json
      from public.crm_case_clients case_client
      join public.crm_clients client
        on client.organization_id = case_client.organization_id
       and client.id = case_client.client_id
      where case_client.organization_id = crm_case.organization_id
        and case_client.case_id = crm_case.id
    ) clients on true
    left join lateral (
      select
        count(*)::integer as offer_count,
        coalesce(jsonb_agg(distinct jsonb_build_object(
          'id', snapshot.bank_id,
          'name', snapshot.bank_name
        )), '[]'::jsonb) as banks_json
      from public.crm_case_offer_snapshots snapshot
      where snapshot.organization_id = crm_case.organization_id
        and snapshot.case_id = crm_case.id
    ) offers on true
    where crm_case.organization_id = p_organization_id
      and (
        search_term is null
        or crm_case.search_vector @@ search_query
        or crm_case.search_text ilike '%' || search_term || '%'
      )
      and (
        cardinality(client_ids) = 0
        or (
          client_match = 'any'
          and exists (
            select 1
            from public.crm_case_clients case_client_filter
            where case_client_filter.organization_id = crm_case.organization_id
              and case_client_filter.case_id = crm_case.id
              and case_client_filter.client_id = any(client_ids)
          )
        )
        or (
          client_match = 'all'
          and (
            select count(distinct case_client_filter.client_id)
            from public.crm_case_clients case_client_filter
            where case_client_filter.organization_id = crm_case.organization_id
              and case_client_filter.case_id = crm_case.id
              and case_client_filter.client_id = any(client_ids)
          ) = cardinality(client_ids)
        )
      )
      and (
        cardinality(bank_ids) = 0
        or exists (
          select 1
          from public.crm_case_offer_snapshots snapshot_filter
          where snapshot_filter.organization_id = crm_case.organization_id
            and snapshot_filter.case_id = crm_case.id
            and snapshot_filter.bank_id = any(bank_ids)
        )
      )
      and (
        offer_mode = 'all'
        or (offer_mode = 'with' and coalesce(offers.offer_count, 0) > 0)
        or (offer_mode = 'without' and coalesce(offers.offer_count, 0) = 0)
      )
      and (created_from is null or crm_case.created_at >= created_from)
      and (created_to is null or crm_case.created_at <= created_to)
      and (updated_from is null or crm_case.updated_at >= updated_from)
      and (updated_to is null or crm_case.updated_at <= updated_to)
  ),
  page_rows as materialized (
    select filtered.*
    from filtered
    order by
      case when target_sort = 'relevance' then relevance end desc,
      case when target_sort = 'updated_desc' then updated_at end desc,
      case when target_sort = 'updated_asc' then updated_at end asc,
      case when target_sort = 'created_desc' then created_at end desc,
      case when target_sort = 'created_asc' then created_at end asc,
      case when target_sort = 'title_asc' then lower(title) end asc,
      case when target_sort = 'title_desc' then lower(title) end desc,
      case when target_sort = 'offers_desc' then offer_count end desc,
      case when target_sort in ('relevance', 'updated_desc', 'offers_desc') then updated_at end desc,
      case when target_sort in ('updated_asc', 'created_asc', 'title_asc') then id end asc,
      id desc
    limit target_limit
    offset target_offset
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(page_rows.row_json order by
        case when target_sort = 'relevance' then page_rows.relevance end desc,
        case when target_sort = 'updated_desc' then page_rows.updated_at end desc,
        case when target_sort = 'updated_asc' then page_rows.updated_at end asc,
        case when target_sort = 'created_desc' then page_rows.created_at end desc,
        case when target_sort = 'created_asc' then page_rows.created_at end asc,
        case when target_sort = 'title_asc' then lower(page_rows.title) end asc,
        case when target_sort = 'title_desc' then lower(page_rows.title) end desc,
        case when target_sort = 'offers_desc' then page_rows.offer_count end desc,
        page_rows.id desc
      )
      from page_rows
    ), '[]'::jsonb),
    'count', (select count(*) from filtered),
    'pageInfo', jsonb_build_object(
      'offset', target_offset,
      'limit', target_limit,
      'hasMore', target_offset + target_limit < (select count(*) from filtered)
    ),
    'facets', case when include_facets then jsonb_build_object(
      'banks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', bank.bank_id,
          'label', bank.bank_name,
          'count', bank.case_count
        ) order by bank.bank_name, bank.bank_id)
        from (
          select
            snapshot.bank_id,
            snapshot.bank_name,
            count(distinct snapshot.case_id) as case_count
          from public.crm_case_offer_snapshots snapshot
          join filtered on filtered.id = snapshot.case_id
          where snapshot.organization_id = p_organization_id
            and snapshot.bank_id is not null
          group by snapshot.bank_id, snapshot.bank_name
        ) bank
      ), '[]'::jsonb),
      'offerCounts', jsonb_build_object(
        'with', (select count(*) from filtered where offer_count > 0),
        'without', (select count(*) from filtered where offer_count = 0)
      ),
      'dateBounds', jsonb_build_object(
        'createdMin', (select min(created_at) from filtered),
        'createdMax', (select max(created_at) from filtered),
        'updatedMin', (select min(updated_at) from filtered),
        'updatedMax', (select max(updated_at) from filtered)
      )
    ) else null end
  )
  into result;

  return result;
end;
$_$;


--
-- Name: FUNCTION search_crm_cases(p_organization_id uuid, p_filters jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_crm_cases(p_organization_id uuid, p_filters jsonb) IS 'Tenant-scoped full-text CRM case search with filters, exact count, pagination and optional facets.';


--
-- Name: search_crm_cases_with_context(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_crm_cases_with_context(p_organization_id uuid, p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare
  filters jsonb := coalesce(p_filters, '{}'::jsonb);
  search_term text;
  search_query tsquery;
  result jsonb;
begin
  search_term := nullif(btrim(filters ->> 'q'), '');
  if search_term is not null
     and search_term ~ '^[+0-9[:space:]()./-]+$'
     and length(regexp_replace(search_term, '[^0-9]+', '', 'g')) >= 3 then
    search_term := regexp_replace(search_term, '[^0-9]+', '', 'g');
    filters := jsonb_set(filters, '{q}', to_jsonb(search_term));
  end if;

  result := public.search_crm_cases(p_organization_id, filters);
  if search_term is null then
    return result;
  end if;

  search_term := lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    search_term
  ));
  search_query := websearch_to_tsquery('simple', search_term);

  return jsonb_set(
    result,
    '{data}',
    coalesce((
      select jsonb_agg(
        rows.case_row || jsonb_build_object('match_context', context.match_context)
        order by rows.position
      )
      from jsonb_array_elements(coalesce(result -> 'data', '[]'::jsonb))
        with ordinality as rows(case_row, position)
      left join lateral (
        select jsonb_build_object(
          'type', candidate.match_type,
          'label', candidate.label
        ) as match_context
        from (
          select
            1 as priority,
            'person'::text as match_type,
            person.display_name as label
          from public.crm_case_clients case_client
          join public.crm_client_people person
            on person.organization_id = case_client.organization_id
           and person.client_id = case_client.client_id
          where case_client.organization_id = p_organization_id
            and case_client.case_id = (rows.case_row ->> 'id')::uuid
            and (
              lower(extensions.unaccent(
                'extensions.unaccent'::regdictionary,
                concat_ws(
                  ' ',
                  person.display_name,
                  person.first_name,
                  person.last_name,
                  person.email,
                  person.phone,
                  person.phone_normalized,
                  nullif(regexp_replace(coalesce(person.phone, ''), '[^0-9]+', '', 'g'), ''),
                  person.pesel,
                  nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
                )
              )) ilike '%' || search_term || '%'
              or to_tsvector(
                'simple',
                lower(extensions.unaccent(
                  'extensions.unaccent'::regdictionary,
                  concat_ws(
                    ' ',
                    person.display_name,
                    person.first_name,
                    person.last_name,
                    person.email,
                    person.phone,
                    person.phone_normalized,
                    person.pesel
                  )
                ))
              ) @@ search_query
            )

          union all

          select
            2,
            'client'::text,
            client.display_name
          from public.crm_case_clients case_client
          join public.crm_clients client
            on client.organization_id = case_client.organization_id
           and client.id = case_client.client_id
          where case_client.organization_id = p_organization_id
            and case_client.case_id = (rows.case_row ->> 'id')::uuid
            and lower(extensions.unaccent(
              'extensions.unaccent'::regdictionary,
              concat_ws(
                ' ',
                client.display_name,
                client.primary_email,
                client.primary_phone,
                client.primary_phone_normalized,
                nullif(regexp_replace(coalesce(client.primary_phone, ''), '[^0-9]+', '', 'g'), ''),
                client.metadata ->> 'tax_id',
                client.metadata ->> 'nip',
                client.metadata ->> 'regon',
                client.metadata ->> 'krs',
                client.metadata ->> 'registry_number',
                nullif(regexp_replace(coalesce(client.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
                nullif(regexp_replace(coalesce(client.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
                nullif(regexp_replace(coalesce(client.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
                nullif(regexp_replace(coalesce(client.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
                nullif(regexp_replace(coalesce(client.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), '')
              )
            )) ilike '%' || search_term || '%'

          union all

          select
            3,
            'product'::text,
            coalesce(nullif(item.title, ''), product_type.name)
          from public.crm_case_items item
          join public.crm_product_types product_type
            on product_type.id = item.product_type_id
          where item.organization_id = p_organization_id
            and item.case_id = (rows.case_row ->> 'id')::uuid
            and lower(extensions.unaccent(
              'extensions.unaccent'::regdictionary,
              concat_ws(
                ' ',
                item.title,
                item.status_code,
                product_type.name,
                product_type.code,
                product_type.domain
              )
            )) ilike '%' || search_term || '%'

          union all

          select
            4,
            'property'::text,
            coalesce(
              nullif(property.listing_title, ''),
              nullif(property.address, ''),
              property.city
            )
          from public.crm_properties property
          left join public.crm_case_items property_item
            on property_item.organization_id = property.organization_id
           and property_item.id = property.case_item_id
          where property.organization_id = p_organization_id
            and coalesce(property.case_id, property_item.case_id)
              = (rows.case_row ->> 'id')::uuid
            and lower(extensions.unaccent(
              'extensions.unaccent'::regdictionary,
              concat_ws(
                ' ',
                property.listing_title,
                property.address,
                property.city,
                property.postal_code,
                property.property_type,
                property.market_type,
                property.description
              )
            )) ilike '%' || search_term || '%'
        ) candidate
        where candidate.label is not null
        order by candidate.priority, candidate.label
        limit 1
      ) context on true
    ), '[]'::jsonb),
    true
  );
end;
$_$;


--
-- Name: FUNCTION search_crm_cases_with_context(p_organization_id uuid, p_filters jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_crm_cases_with_context(p_organization_id uuid, p_filters jsonb) IS 'Tenant-scoped CRM case search that adds a non-sensitive explanation of the matched relation.';


--
-- Name: search_crm_clients(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_crm_clients(p_organization_id uuid, p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare
  filters jsonb := coalesce(p_filters, '{}'::jsonb);
  search_term text;
  search_query tsquery;
  status_codes text[];
  owner_user_ids uuid[];
  owner_mode text;
  tags_any text[];
  tags_all text[];
  lead_sources text[];
  created_from timestamptz;
  created_to timestamptz;
  updated_from timestamptz;
  updated_to timestamptz;
  has_email boolean;
  has_phone boolean;
  consent_definition_id uuid;
  consent_decision text;
  target_sort text;
  target_limit integer;
  target_offset integer;
  target_cursor jsonb;
  cursor_id uuid;
  cursor_timestamp timestamptz;
  cursor_name text;
  include_facets boolean;
  result jsonb;
begin
  if jsonb_typeof(filters) <> 'object' then
    raise exception 'client_filters_must_be_an_object' using errcode = '22023';
  end if;

  if current_user <> 'openexpert_service' then
    if not private.is_organization_member(p_organization_id) then
      raise exception 'organization_membership_required' using errcode = '42501';
    end if;
  end if;

  if jsonb_typeof(coalesce(filters -> 'statusCodes', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'ownerUserIds', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'tagsAny', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'tagsAll', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'leadSources', '[]'::jsonb)) <> 'array' then
    raise exception 'client_filter_arrays_are_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(coalesce(filters -> 'ownerUserIds', '[]'::jsonb)) value
    where value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'owner_user_ids_are_invalid' using errcode = '22023';
  end if;

  search_term := nullif(btrim(filters ->> 'q'), '');
  if length(coalesce(search_term, '')) > 200 then
    raise exception 'client_search_query_is_too_long' using errcode = '22023';
  end if;
  if search_term is not null then
    search_term := lower(extensions.unaccent(
      'extensions.unaccent'::regdictionary,
      search_term
    ));
    search_query := websearch_to_tsquery('simple', search_term);
  end if;

  select coalesce(array_agg(value), '{}'::text[])
  into status_codes
  from jsonb_array_elements_text(coalesce(filters -> 'statusCodes', '[]'::jsonb)) value;

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into owner_user_ids
  from jsonb_array_elements_text(coalesce(filters -> 'ownerUserIds', '[]'::jsonb)) value;

  select coalesce(array_agg(value), '{}'::text[])
  into tags_any
  from jsonb_array_elements_text(coalesce(filters -> 'tagsAny', '[]'::jsonb)) value;

  select coalesce(array_agg(value), '{}'::text[])
  into tags_all
  from jsonb_array_elements_text(coalesce(filters -> 'tagsAll', '[]'::jsonb)) value;

  select coalesce(array_agg(value), '{}'::text[])
  into lead_sources
  from jsonb_array_elements_text(coalesce(filters -> 'leadSources', '[]'::jsonb)) value;

  owner_mode := coalesce(nullif(filters ->> 'ownerMode', ''), 'all');
  if owner_mode not in ('all', 'assigned', 'unassigned') then
    raise exception 'owner_mode_is_invalid' using errcode = '22023';
  end if;

  created_from := nullif(filters ->> 'createdFrom', '')::timestamptz;
  created_to := nullif(filters ->> 'createdTo', '')::timestamptz;
  updated_from := nullif(filters ->> 'updatedFrom', '')::timestamptz;
  updated_to := nullif(filters ->> 'updatedTo', '')::timestamptz;
  has_email := nullif(filters ->> 'hasEmail', '')::boolean;
  has_phone := nullif(filters ->> 'hasPhone', '')::boolean;

  if nullif(filters ->> 'consentDefinitionId', '') is not null then
    if (filters ->> 'consentDefinitionId') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'consent_definition_id_is_invalid' using errcode = '22023';
    end if;
    consent_definition_id := (filters ->> 'consentDefinitionId')::uuid;
  end if;

  consent_decision := nullif(filters ->> 'consentDecision', '');
  if consent_decision is not null
     and consent_decision not in ('granted', 'declined', 'withdrawn', 'unknown') then
    raise exception 'consent_decision_is_invalid' using errcode = '22023';
  end if;
  if consent_decision is not null and consent_definition_id is null then
    raise exception 'consent_definition_is_required_for_decision_filter'
      using errcode = '22023';
  end if;

  target_sort := coalesce(nullif(filters ->> 'sort', ''), 'updated_desc');
  if target_sort not in (
    'updated_desc', 'updated_asc', 'created_desc', 'created_asc',
    'name_asc', 'name_desc'
  ) then
    raise exception 'client_sort_is_invalid' using errcode = '22023';
  end if;

  target_limit := least(greatest(coalesce((filters ->> 'limit')::integer, 50), 1), 100);
  target_offset := coalesce((filters ->> 'offset')::integer, 0);
  if target_offset < 0 or target_offset > 100000 then
    raise exception 'client_offset_is_invalid' using errcode = '22023';
  end if;

  target_cursor := filters -> 'cursor';
  if target_cursor is not null and jsonb_typeof(target_cursor) <> 'object' then
    raise exception 'client_cursor_is_invalid' using errcode = '22023';
  end if;
  if target_cursor is not null and target_offset > 0 then
    raise exception 'client_cursor_and_offset_are_mutually_exclusive'
      using errcode = '22023';
  end if;

  if target_cursor is not null then
    if coalesce(target_cursor ->> 'id', '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or nullif(target_cursor ->> 'value', '') is null then
      raise exception 'client_cursor_is_invalid' using errcode = '22023';
    end if;

    cursor_id := (target_cursor ->> 'id')::uuid;
    if target_sort in ('updated_desc', 'updated_asc', 'created_desc', 'created_asc') then
      cursor_timestamp := (target_cursor ->> 'value')::timestamptz;
    else
      cursor_name := lower(target_cursor ->> 'value');
    end if;
  end if;

  include_facets := coalesce((filters ->> 'includeFacets')::boolean, false);

  with filtered as materialized (
    select
      client.id,
      client.organization_id,
      client.owner_user_id,
      client.status_code,
      client.lead_source,
      client.tags,
      client.primary_email_normalized,
      client.primary_phone_normalized,
      client.display_name,
      client.created_at,
      client.updated_at,
      (
        to_jsonb(client)
          - 'search_text'
          - 'search_vector'
          - 'primary_email_normalized'
          - 'primary_phone_normalized'
      ) || jsonb_build_object(
        'owner', case
          when owner.id is null then null
          else jsonb_build_object(
            'id', owner.id,
            'name', coalesce(owner.full_name, owner.email),
            'email', owner.email
          )
        end,
        'primaryPerson', primary_person.person_json
      ) as row_json
    from public.crm_clients client
    left join public.users owner on owner.id = client.owner_user_id
    left join lateral (
      select to_jsonb(person)
        - 'email_normalized'
        - 'phone_normalized' as person_json
      from public.crm_client_people person
      where person.organization_id = client.organization_id
        and person.client_id = client.id
      order by (person.role = 'primary') desc, person.created_at, person.id
      limit 1
    ) primary_person on true
    where client.organization_id = p_organization_id
      and (
        search_term is null
        or client.search_vector @@ search_query
        or client.search_text ilike '%' || search_term || '%'
      )
      and (cardinality(status_codes) = 0 or client.status_code = any(status_codes))
      and (
        owner_mode = 'all'
        or (owner_mode = 'assigned' and client.owner_user_id is not null)
        or (owner_mode = 'unassigned' and client.owner_user_id is null)
      )
      and (
        cardinality(owner_user_ids) = 0
        or client.owner_user_id = any(owner_user_ids)
      )
      and (cardinality(tags_any) = 0 or client.tags && tags_any)
      and (cardinality(tags_all) = 0 or client.tags @> tags_all)
      and (
        cardinality(lead_sources) = 0
        or client.lead_source = any(lead_sources)
      )
      and (created_from is null or client.created_at >= created_from)
      and (created_to is null or client.created_at <= created_to)
      and (updated_from is null or client.updated_at >= updated_from)
      and (updated_to is null or client.updated_at <= updated_to)
      and (
        has_email is null
        or (client.primary_email_normalized is not null) = has_email
      )
      and (
        has_phone is null
        or (client.primary_phone_normalized is not null) = has_phone
      )
      and (
        consent_definition_id is null
        or (
          consent_decision is null
          and exists (
            select 1
            from public.crm_client_consent_events consent_event
            where consent_event.organization_id = client.organization_id
              and consent_event.client_id = client.id
              and consent_event.definition_id = consent_definition_id
          )
        )
        or (
          consent_decision = 'unknown'
          and not exists (
            select 1
            from public.crm_client_consent_events consent_event
            where consent_event.organization_id = client.organization_id
              and consent_event.client_id = client.id
              and consent_event.definition_id = consent_definition_id
          )
        )
        or (
          consent_decision in ('granted', 'declined', 'withdrawn')
          and consent_decision = (
            select consent_event.decision
            from public.crm_client_consent_events consent_event
            where consent_event.organization_id = client.organization_id
              and consent_event.client_id = client.id
              and consent_event.definition_id = consent_definition_id
            order by consent_event.occurred_at desc, consent_event.id desc
            limit 1
          )
        )
      )
  ),
  cursor_filtered as (
    select filtered.*
    from filtered
    where target_cursor is null
      or (
        target_sort = 'updated_desc'
        and (
          filtered.updated_at < cursor_timestamp
          or (filtered.updated_at = cursor_timestamp and filtered.id < cursor_id)
        )
      )
      or (
        target_sort = 'updated_asc'
        and (
          filtered.updated_at > cursor_timestamp
          or (filtered.updated_at = cursor_timestamp and filtered.id > cursor_id)
        )
      )
      or (
        target_sort = 'created_desc'
        and (
          filtered.created_at < cursor_timestamp
          or (filtered.created_at = cursor_timestamp and filtered.id < cursor_id)
        )
      )
      or (
        target_sort = 'created_asc'
        and (
          filtered.created_at > cursor_timestamp
          or (filtered.created_at = cursor_timestamp and filtered.id > cursor_id)
        )
      )
      or (
        target_sort = 'name_asc'
        and (
          lower(filtered.display_name) > cursor_name
          or (lower(filtered.display_name) = cursor_name and filtered.id > cursor_id)
        )
      )
      or (
        target_sort = 'name_desc'
        and (
          lower(filtered.display_name) < cursor_name
          or (lower(filtered.display_name) = cursor_name and filtered.id < cursor_id)
        )
      )
  ),
  paged as materialized (
    select cursor_filtered.*
    from cursor_filtered
    order by
      case when target_sort = 'updated_desc' then updated_at end desc,
      case when target_sort = 'updated_asc' then updated_at end asc,
      case when target_sort = 'created_desc' then created_at end desc,
      case when target_sort = 'created_asc' then created_at end asc,
      case when target_sort = 'name_asc' then lower(display_name) end asc,
      case when target_sort = 'name_desc' then lower(display_name) end desc,
      case when target_sort in ('updated_desc', 'created_desc', 'name_desc') then id end desc,
      case when target_sort in ('updated_asc', 'created_asc', 'name_asc') then id end asc
    limit target_limit + 1
    offset target_offset
  ),
  page_rows as materialized (
    select paged.*
    from paged
    order by
      case when target_sort = 'updated_desc' then updated_at end desc,
      case when target_sort = 'updated_asc' then updated_at end asc,
      case when target_sort = 'created_desc' then created_at end desc,
      case when target_sort = 'created_asc' then created_at end asc,
      case when target_sort = 'name_asc' then lower(display_name) end asc,
      case when target_sort = 'name_desc' then lower(display_name) end desc,
      case when target_sort in ('updated_desc', 'created_desc', 'name_desc') then id end desc,
      case when target_sort in ('updated_asc', 'created_asc', 'name_asc') then id end asc
    limit target_limit
  ),
  last_row as (
    select page_rows.*
    from page_rows
    order by
      case when target_sort = 'updated_desc' then updated_at end asc,
      case when target_sort = 'updated_asc' then updated_at end desc,
      case when target_sort = 'created_desc' then created_at end asc,
      case when target_sort = 'created_asc' then created_at end desc,
      case when target_sort = 'name_asc' then lower(display_name) end desc,
      case when target_sort = 'name_desc' then lower(display_name) end asc,
      case when target_sort in ('updated_desc', 'created_desc', 'name_desc') then id end asc,
      case when target_sort in ('updated_asc', 'created_asc', 'name_asc') then id end desc
    limit 1
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(page_rows.row_json order by
        case when target_sort = 'updated_desc' then page_rows.updated_at end desc,
        case when target_sort = 'updated_asc' then page_rows.updated_at end asc,
        case when target_sort = 'created_desc' then page_rows.created_at end desc,
        case when target_sort = 'created_asc' then page_rows.created_at end asc,
        case when target_sort = 'name_asc' then lower(page_rows.display_name) end asc,
        case when target_sort = 'name_desc' then lower(page_rows.display_name) end desc,
        case when target_sort in ('updated_desc', 'created_desc', 'name_desc') then page_rows.id end desc,
        case when target_sort in ('updated_asc', 'created_asc', 'name_asc') then page_rows.id end asc
      )
      from page_rows
    ), '[]'::jsonb),
    'count', (select count(*) from filtered),
    'pageInfo', jsonb_build_object(
      'hasMore', (select count(*) > target_limit from paged),
      'nextCursor', case
        when (select count(*) > target_limit from paged) then (
          select jsonb_build_object(
            'value', case
              when target_sort in ('updated_desc', 'updated_asc') then last_row.updated_at::text
              when target_sort in ('created_desc', 'created_asc') then last_row.created_at::text
              else lower(last_row.display_name)
            end,
            'id', last_row.id
          )
          from last_row
        )
        else null
      end,
      'offset', target_offset,
      'limit', target_limit
    ),
    'facets', case when include_facets then jsonb_build_object(
      'statuses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', status.status_code,
          'label', status.status_code,
          'count', status.client_count
        ) order by status.status_code)
        from (
          select filtered.status_code, count(*) as client_count
          from filtered
          group by filtered.status_code
        ) status
      ), '[]'::jsonb),
      'sources', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', source.lead_source,
          'label', source.lead_source,
          'count', source.client_count
        ) order by source.lead_source)
        from (
          select filtered.lead_source, count(*) as client_count
          from filtered
          where filtered.lead_source is not null
          group by filtered.lead_source
        ) source
      ), '[]'::jsonb),
      'tags', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', tag.tag_value,
          'label', tag.tag_value,
          'count', tag.client_count
        ) order by tag.tag_value)
        from (
          select tag_value, count(*) as client_count
          from filtered
          cross join lateral unnest(filtered.tags) tag_value
          group by tag_value
        ) tag
      ), '[]'::jsonb),
      'owners', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', owner_facet.owner_value,
          'label', owner_facet.owner_label,
          'count', owner_facet.client_count
        ) order by owner_facet.owner_label, owner_facet.owner_value)
        from (
          select
            coalesce(filtered.owner_user_id::text, 'unassigned') as owner_value,
            coalesce(app_user.full_name, app_user.email, 'Nieprzypisany') as owner_label,
            count(*) as client_count
          from filtered
          left join public.users app_user on app_user.id = filtered.owner_user_id
          group by filtered.owner_user_id, app_user.full_name, app_user.email
        ) owner_facet
      ), '[]'::jsonb),
      'consentDefinitions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', definition.id,
          'code', definition.code,
          'currentVersionId', consent_version.id,
          'currentVersion', jsonb_build_object(
            'id', consent_version.id,
            'version', consent_version.version,
            'displayTitle', consent_version.display_title,
            'content', consent_version.content,
            'purpose', consent_version.purpose,
            'channel', consent_version.channel,
            'legalBasis', consent_version.legal_basis,
            'isRequired', consent_version.is_required
          ),
          'counts', jsonb_build_object(
            'granted', (
              select count(*) from filtered
              where (
                select event.decision
                from public.crm_client_consent_events event
                where event.organization_id = p_organization_id
                  and event.client_id = filtered.id
                  and event.definition_id = definition.id
                order by event.occurred_at desc, event.id desc
                limit 1
              ) = 'granted'
            ),
            'declined', (
              select count(*) from filtered
              where (
                select event.decision
                from public.crm_client_consent_events event
                where event.organization_id = p_organization_id
                  and event.client_id = filtered.id
                  and event.definition_id = definition.id
                order by event.occurred_at desc, event.id desc
                limit 1
              ) = 'declined'
            ),
            'withdrawn', (
              select count(*) from filtered
              where (
                select event.decision
                from public.crm_client_consent_events event
                where event.organization_id = p_organization_id
                  and event.client_id = filtered.id
                  and event.definition_id = definition.id
                order by event.occurred_at desc, event.id desc
                limit 1
              ) = 'withdrawn'
            ),
            'unknown', (
              select count(*) from filtered
              where not exists (
                select 1
                from public.crm_client_consent_events event
                where event.organization_id = p_organization_id
                  and event.client_id = filtered.id
                  and event.definition_id = definition.id
              )
            )
          )
        ) order by consent_version.sort_order, consent_version.display_title)
        from public.crm_consent_definitions definition
        join public.crm_consent_definition_versions consent_version
          on consent_version.organization_id = definition.organization_id
         and consent_version.definition_id = definition.id
         and consent_version.id = definition.current_version_id
        where definition.organization_id = p_organization_id
          and definition.context = 'client_creation'
          and consent_version.status = 'published'
          and consent_version.effective_from <= now()
          and (consent_version.effective_to is null or consent_version.effective_to > now())
      ), '[]'::jsonb),
      'dateBounds', jsonb_build_object(
        'createdMin', (select min(filtered.created_at) from filtered),
        'createdMax', (select max(filtered.created_at) from filtered),
        'updatedMin', (select min(filtered.updated_at) from filtered),
        'updatedMax', (select max(filtered.updated_at) from filtered)
      ),
      'contactCounts', jsonb_build_object(
        'email', (select count(*) from filtered where primary_email_normalized is not null),
        'phone', (select count(*) from filtered where primary_phone_normalized is not null),
        'both', (select count(*) from filtered where primary_email_normalized is not null and primary_phone_normalized is not null),
        'none', (select count(*) from filtered where primary_email_normalized is null and primary_phone_normalized is null)
      )
    ) else null end
  )
  into result;

  return result;
end;
$_$;


--
-- Name: FUNCTION search_crm_clients(p_organization_id uuid, p_filters jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_crm_clients(p_organization_id uuid, p_filters jsonb) IS 'Advanced tenant-scoped CRM search with exact count, cursor/offset pagination and optional facets.';


--
-- Name: search_crm_clients_ranked(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_crm_clients_ranked(p_organization_id uuid, p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare
  filters jsonb := coalesce(p_filters, '{}'::jsonb);
  search_term text;
  search_query tsquery;
  status_codes text[];
  owner_user_ids uuid[];
  owner_mode text;
  tags_any text[];
  tags_all text[];
  lead_sources text[];
  created_from timestamptz;
  created_to timestamptz;
  updated_from timestamptz;
  updated_to timestamptz;
  has_email boolean;
  has_phone boolean;
  consent_definition_id uuid;
  consent_decision text;
  target_limit integer;
  target_offset integer;
  result jsonb;
begin
  if jsonb_typeof(filters) <> 'object' then
    raise exception 'client_filters_must_be_an_object' using errcode = '22023';
  end if;
  if current_user <> 'openexpert_service' then
    if not private.is_organization_member(p_organization_id) then
      raise exception 'organization_membership_required' using errcode = '42501';
    end if;
  end if;
  if jsonb_typeof(coalesce(filters -> 'statusCodes', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'ownerUserIds', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'tagsAny', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'tagsAll', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'leadSources', '[]'::jsonb)) <> 'array' then
    raise exception 'client_filter_arrays_are_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(coalesce(filters -> 'ownerUserIds', '[]'::jsonb)) value
    where value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'owner_user_ids_are_invalid' using errcode = '22023';
  end if;

  search_term := nullif(btrim(filters ->> 'q'), '');
  if search_term is null then
    raise exception 'client_search_query_is_required' using errcode = '22023';
  end if;
  if length(search_term) > 200 then
    raise exception 'client_search_query_is_too_long' using errcode = '22023';
  end if;
  if search_term ~ '^[+0-9[:space:]()./-]+$'
     and length(regexp_replace(search_term, '[^0-9]+', '', 'g')) >= 3 then
    search_term := regexp_replace(search_term, '[^0-9]+', '', 'g');
  end if;
  search_term := lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    search_term
  ));
  search_query := websearch_to_tsquery('simple', search_term);

  select coalesce(array_agg(value), '{}'::text[])
  into status_codes
  from jsonb_array_elements_text(coalesce(filters -> 'statusCodes', '[]'::jsonb)) value;
  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into owner_user_ids
  from jsonb_array_elements_text(coalesce(filters -> 'ownerUserIds', '[]'::jsonb)) value;
  select coalesce(array_agg(value), '{}'::text[])
  into tags_any
  from jsonb_array_elements_text(coalesce(filters -> 'tagsAny', '[]'::jsonb)) value;
  select coalesce(array_agg(value), '{}'::text[])
  into tags_all
  from jsonb_array_elements_text(coalesce(filters -> 'tagsAll', '[]'::jsonb)) value;
  select coalesce(array_agg(value), '{}'::text[])
  into lead_sources
  from jsonb_array_elements_text(coalesce(filters -> 'leadSources', '[]'::jsonb)) value;

  owner_mode := coalesce(nullif(filters ->> 'ownerMode', ''), 'all');
  if owner_mode not in ('all', 'assigned', 'unassigned') then
    raise exception 'owner_mode_is_invalid' using errcode = '22023';
  end if;
  created_from := nullif(filters ->> 'createdFrom', '')::timestamptz;
  created_to := nullif(filters ->> 'createdTo', '')::timestamptz;
  updated_from := nullif(filters ->> 'updatedFrom', '')::timestamptz;
  updated_to := nullif(filters ->> 'updatedTo', '')::timestamptz;
  has_email := nullif(filters ->> 'hasEmail', '')::boolean;
  has_phone := nullif(filters ->> 'hasPhone', '')::boolean;

  if nullif(filters ->> 'consentDefinitionId', '') is not null then
    if (filters ->> 'consentDefinitionId') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'consent_definition_id_is_invalid' using errcode = '22023';
    end if;
    consent_definition_id := (filters ->> 'consentDefinitionId')::uuid;
  end if;
  consent_decision := nullif(filters ->> 'consentDecision', '');
  if consent_decision is not null
     and consent_decision not in ('granted', 'declined', 'withdrawn', 'unknown') then
    raise exception 'consent_decision_is_invalid' using errcode = '22023';
  end if;
  if consent_decision is not null and consent_definition_id is null then
    raise exception 'consent_definition_is_required_for_decision_filter'
      using errcode = '22023';
  end if;

  target_limit := least(greatest(coalesce((filters ->> 'limit')::integer, 50), 1), 100);
  target_offset := coalesce((filters ->> 'offset')::integer, 0);
  if target_offset < 0 or target_offset > 100000 then
    raise exception 'client_offset_is_invalid' using errcode = '22023';
  end if;

  with filtered as materialized (
    select
      client.id,
      client.display_name,
      client.created_at,
      client.updated_at,
      (
        case
          when lower(extensions.unaccent(
            'extensions.unaccent'::regdictionary,
            client.display_name
          )) = search_term then 4
          when lower(extensions.unaccent(
            'extensions.unaccent'::regdictionary,
            client.display_name
          )) like search_term || '%' then 2
          else 0
        end
        + ts_rank_cd(client.search_vector, search_query, 32) * 3
        + extensions.similarity(
          lower(extensions.unaccent(
            'extensions.unaccent'::regdictionary,
            client.display_name
          )),
          search_term
        )
        + extensions.similarity(client.search_text, search_term) * 0.15
      )::real as relevance,
      (
        to_jsonb(client)
          - 'search_text'
          - 'search_vector'
          - 'primary_email_normalized'
          - 'primary_phone_normalized'
      ) || jsonb_build_object(
        'owner', case
          when owner.id is null then null
          else jsonb_build_object(
            'id', owner.id,
            'name', coalesce(owner.full_name, owner.email),
            'email', owner.email
          )
        end,
        'primaryPerson', primary_person.person_json,
        'matchedPerson', matched_person.person_json
      ) as row_json
    from public.crm_clients client
    left join public.users owner on owner.id = client.owner_user_id
    left join lateral (
      select jsonb_build_object(
        'id', person.id,
        'display_name', person.display_name,
        'first_name', person.first_name,
        'last_name', person.last_name,
        'email', person.email,
        'phone', person.phone,
        'pesel_last4', nullif(right(
          regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'),
          4
        ), '')
      ) as person_json
      from public.crm_client_people person
      where person.organization_id = client.organization_id
        and person.client_id = client.id
      order by (person.role = 'primary') desc, person.created_at, person.id
      limit 1
    ) primary_person on true
    left join lateral (
      select jsonb_build_object(
        'id', person.id,
        'display_name', person.display_name,
        'first_name', person.first_name,
        'last_name', person.last_name,
        'email', person.email,
        'phone', person.phone,
        'pesel_last4', nullif(right(
          regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'),
          4
        ), '')
      ) as person_json
      from public.crm_client_people person
      where person.organization_id = client.organization_id
        and person.client_id = client.id
        and (
          lower(extensions.unaccent(
            'extensions.unaccent'::regdictionary,
            concat_ws(
              ' ',
              person.display_name,
              person.first_name,
              person.last_name,
              person.email,
              person.phone,
              person.phone_normalized,
              person.pesel,
              nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
            )
          )) ilike '%' || search_term || '%'
          or to_tsvector(
            'simple',
            lower(extensions.unaccent(
              'extensions.unaccent'::regdictionary,
              concat_ws(
                ' ',
                person.display_name,
                person.first_name,
                person.last_name,
                person.email,
                person.phone,
                person.phone_normalized,
                person.pesel
              )
            ))
          ) @@ search_query
        )
      order by (person.role = 'primary') desc, person.created_at, person.id
      limit 1
    ) matched_person on true
    where client.organization_id = p_organization_id
      and (
        client.search_vector @@ search_query
        or client.search_text ilike '%' || search_term || '%'
      )
      and (cardinality(status_codes) = 0 or client.status_code = any(status_codes))
      and (
        owner_mode = 'all'
        or (owner_mode = 'assigned' and client.owner_user_id is not null)
        or (owner_mode = 'unassigned' and client.owner_user_id is null)
      )
      and (
        cardinality(owner_user_ids) = 0
        or client.owner_user_id = any(owner_user_ids)
      )
      and (cardinality(tags_any) = 0 or client.tags && tags_any)
      and (cardinality(tags_all) = 0 or client.tags @> tags_all)
      and (
        cardinality(lead_sources) = 0
        or client.lead_source = any(lead_sources)
      )
      and (created_from is null or client.created_at >= created_from)
      and (created_to is null or client.created_at <= created_to)
      and (updated_from is null or client.updated_at >= updated_from)
      and (updated_to is null or client.updated_at <= updated_to)
      and (
        has_email is null
        or (client.primary_email_normalized is not null) = has_email
      )
      and (
        has_phone is null
        or (client.primary_phone_normalized is not null) = has_phone
      )
      and (
        consent_definition_id is null
        or (
          consent_decision is null
          and exists (
            select 1
            from public.crm_client_consent_events consent_event
            where consent_event.organization_id = client.organization_id
              and consent_event.client_id = client.id
              and consent_event.definition_id = consent_definition_id
          )
        )
        or (
          consent_decision = 'unknown'
          and not exists (
            select 1
            from public.crm_client_consent_events consent_event
            where consent_event.organization_id = client.organization_id
              and consent_event.client_id = client.id
              and consent_event.definition_id = consent_definition_id
          )
        )
        or (
          consent_decision in ('granted', 'declined', 'withdrawn')
          and consent_decision = (
            select consent_event.decision
            from public.crm_client_consent_events consent_event
            where consent_event.organization_id = client.organization_id
              and consent_event.client_id = client.id
              and consent_event.definition_id = consent_definition_id
            order by consent_event.occurred_at desc, consent_event.id desc
            limit 1
          )
        )
      )
  ),
  page_rows as materialized (
    select filtered.*
    from filtered
    order by relevance desc, updated_at desc, id
    limit target_limit
    offset target_offset
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(page_rows.row_json order by
        page_rows.relevance desc,
        page_rows.updated_at desc,
        page_rows.id
      )
      from page_rows
    ), '[]'::jsonb),
    'count', (select count(*) from filtered),
    'pageInfo', jsonb_build_object(
      'hasMore', target_offset + target_limit < (select count(*) from filtered),
      'nextCursor', null,
      'offset', target_offset,
      'limit', target_limit
    ),
    'facets', null
  )
  into result;

  return result;
end;
$_$;


--
-- Name: FUNCTION search_crm_clients_ranked(p_organization_id uuid, p_filters jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_crm_clients_ranked(p_organization_id uuid, p_filters jsonb) IS 'Tenant-scoped ranked CRM client search used for user-entered text queries.';


--
-- Name: search_crm_omnisearch(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_crm_omnisearch(p_organization_id uuid, p_query text, p_limit integer DEFAULT 5) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
  raw_query text := btrim(coalesce(p_query, ''));
  normalized_query text;
  digit_query text;
  search_query tsquery;
  like_pattern text;
  target_limit integer := coalesce(p_limit, 5);
  case_hits jsonb := '[]'::jsonb;
  client_hits jsonb := '[]'::jsonb;
  appointment_hits jsonb := '[]'::jsonb;
  task_hits jsonb := '[]'::jsonb;
  document_hits jsonb := '[]'::jsonb;
begin
  if actor_user_id is null or not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = actor_user_id
      and membership.role in ('expert', 'admin')
  ) then
    raise exception using
      errcode = '42501',
      message = 'CRM organization membership is required';
  end if;

  if char_length(raw_query) < 3 or char_length(raw_query) > 200 then
    raise exception using
      errcode = '22023',
      message = 'Omnisearch query must contain between 3 and 200 characters';
  end if;

  if target_limit < 1 or target_limit > 8 then
    raise exception using
      errcode = '22023',
      message = 'Omnisearch limit must be between 1 and 8';
  end if;

  normalized_query := public.crm_omnisearch_normalize(raw_query);
  digit_query := nullif(regexp_replace(raw_query, '[^0-9]+', '', 'g'), '');
  if char_length(coalesce(digit_query, '')) < 3 then
    digit_query := null;
  end if;
  search_query := websearch_to_tsquery('simple', normalized_query);
  like_pattern := '%'
    || replace(
      replace(
        replace(normalized_query, E'\\', E'\\\\'),
        '%',
        E'\\%'
      ),
      '_',
      E'\\_'
    )
    || '%';

  select coalesce(
    jsonb_agg(to_jsonb(hit) - 'score' order by hit.score desc, hit.updated_at desc, hit.id),
    '[]'::jsonb
  )
  into case_hits
  from (
    select
      crm_case.id,
      crm_case.title,
      crm_case.status_code,
      related_clients.client_names,
      crm_case.updated_at,
      (
        case
          when public.crm_omnisearch_normalize(crm_case.title) = normalized_query then 6.0
          when public.crm_omnisearch_normalize(crm_case.title) like normalized_query || '%' then 3.0
          else 0.0
        end
        + ts_rank_cd(crm_case.search_vector, search_query) * 3.0
        + extensions.similarity(crm_case.title, raw_query)
        + extensions.similarity(crm_case.search_text, normalized_query) * 0.2
      )::double precision as score
    from public.crm_cases crm_case
    left join lateral (
      select string_agg(
        client.display_name,
        ', '
        order by case_client.is_primary desc, client.display_name, client.id
      ) as client_names
      from public.crm_case_clients case_client
      join public.crm_clients client
        on client.organization_id = case_client.organization_id
       and client.id = case_client.client_id
      where case_client.organization_id = crm_case.organization_id
        and case_client.case_id = crm_case.id
    ) related_clients on true
    where crm_case.organization_id = p_organization_id
      and (
        crm_case.search_vector @@ search_query
        or crm_case.search_text ilike like_pattern escape '\'
        or crm_case.title operator(extensions.%) raw_query
        or (
          digit_query is not null
          and crm_case.search_text ilike '%' || digit_query || '%'
        )
      )
    order by score desc, crm_case.updated_at desc, crm_case.id
    limit target_limit
  ) hit;

  select coalesce(
    jsonb_agg(to_jsonb(hit) - 'score' order by hit.score desc, hit.updated_at desc, hit.id),
    '[]'::jsonb
  )
  into client_hits
  from (
    select
      client.id,
      client.display_name,
      client.status_code,
      client.primary_email,
      client.primary_phone,
      client.updated_at,
      (
        case
          when public.crm_omnisearch_normalize(client.display_name) = normalized_query then 6.0
          when public.crm_omnisearch_normalize(client.display_name) like normalized_query || '%' then 3.0
          else 0.0
        end
        + ts_rank_cd(client.search_vector, search_query) * 3.0
        + extensions.similarity(client.display_name, raw_query)
        + extensions.similarity(client.search_text, normalized_query) * 0.15
      )::double precision as score
    from public.crm_clients client
    where client.organization_id = p_organization_id
      and (
        client.search_vector @@ search_query
        or client.search_text ilike like_pattern escape '\'
        or client.display_name operator(extensions.%) raw_query
        or (
          digit_query is not null
          and client.search_text ilike '%' || digit_query || '%'
        )
      )
    order by score desc, client.updated_at desc, client.id
    limit target_limit
  ) hit;

  select coalesce(
    jsonb_agg(
      to_jsonb(hit) - 'score' - 'is_future' - 'distance_seconds'
      order by hit.score desc, hit.is_future desc, hit.distance_seconds, hit.id
    ),
    '[]'::jsonb
  )
  into appointment_hits
  from (
    select
      appointment.id,
      appointment.client_id,
      appointment.customer_name,
      appointment.starts_at,
      appointment.ends_at,
      appointment.timezone,
      appointment.status,
      appointment.meeting_mode,
      appointment.expert_user_id,
      facility.name as facility_name,
      service.name as service_name,
      coalesce(expert.full_name, expert.email) as expert_name,
      (appointment.starts_at >= now()) as is_future,
      abs(extract(epoch from appointment.starts_at - now())) as distance_seconds,
      (
        case
          when public.crm_omnisearch_normalize(appointment.customer_name) = normalized_query then 6.0
          when public.crm_omnisearch_normalize(appointment.customer_name) like normalized_query || '%' then 3.0
          else 0.0
        end
        + ts_rank_cd(appointment.omnisearch_vector, search_query) * 3.0
        + extensions.similarity(appointment.customer_name, raw_query)
        + extensions.similarity(appointment.omnisearch_text, normalized_query) * 0.2
        + case when appointment.starts_at >= now() then 0.25 else 0.0 end
      )::double precision as score
    from public.appointments appointment
    join public.facilities facility
      on facility.organization_id = appointment.organization_id
     and facility.id = appointment.facility_id
    join public.booking_services service
      on service.organization_id = appointment.organization_id
     and service.id = appointment.service_id
    join public.users expert
      on expert.id = appointment.expert_user_id
    left join public.crm_clients client
      on client.organization_id = appointment.organization_id
     and client.id = appointment.client_id
    where appointment.organization_id = p_organization_id
      and appointment.status = 'confirmed'
      and (
        appointment.omnisearch_vector @@ search_query
        or appointment.omnisearch_text ilike like_pattern escape '\'
        or appointment.customer_name operator(extensions.%) raw_query
        or (
          digit_query is not null
          and appointment.omnisearch_text ilike '%' || digit_query || '%'
        )
      )
    order by score desc, is_future desc, distance_seconds, appointment.id
    limit target_limit
  ) hit;

  select coalesce(
    jsonb_agg(to_jsonb(hit) - 'score' order by hit.score desc, hit.updated_at desc, hit.id),
    '[]'::jsonb
  )
  into task_hits
  from (
    select
      task.id,
      task.title,
      task.status_code,
      task.priority,
      task.delegation_status,
      task.due_at,
      task.case_id,
      crm_case.title as case_title,
      task.client_id,
      client.display_name as client_name,
      task.updated_at,
      (
        case
          when public.crm_omnisearch_normalize(task.title) = normalized_query then 6.0
          when public.crm_omnisearch_normalize(task.title) like normalized_query || '%' then 3.0
          else 0.0
        end
        + ts_rank_cd(task.omnisearch_vector, search_query) * 3.0
        + extensions.similarity(task.title, raw_query)
        + extensions.similarity(task.omnisearch_text, normalized_query) * 0.2
      )::double precision as score
    from public.crm_tasks task
    left join public.crm_cases crm_case
      on crm_case.organization_id = task.organization_id
     and crm_case.id = task.case_id
    left join public.crm_clients client
      on client.organization_id = task.organization_id
     and client.id = task.client_id
    where task.organization_id = p_organization_id
      and task.case_id is not null
      and (
        task.delegation_status <> 'not_delegated'
        or task.status_code <> 'done'
      )
      and (
        task.omnisearch_vector @@ search_query
        or task.omnisearch_text ilike like_pattern escape '\'
        or task.title operator(extensions.%) raw_query
      )
    order by score desc, task.updated_at desc, task.id
    limit target_limit
  ) hit;

  with application_matches as (
    select
      application.submission_id as id,
      (
        case
          when public.crm_omnisearch_normalize(snapshot.bank_name) = normalized_query then 6.0
          when public.crm_omnisearch_normalize(snapshot.bank_name) like normalized_query || '%' then 3.0
          else 0.0
        end
        + ts_rank_cd(application.omnisearch_vector, search_query) * 3.0
        + extensions.similarity(coalesce(snapshot.bank_name, ''), raw_query)
        + extensions.similarity(application.omnisearch_text, normalized_query) * 0.2
      )::double precision as score
    from public.crm_case_bank_applications application
    left join public.crm_case_offer_snapshots snapshot
      on snapshot.organization_id = application.organization_id
     and snapshot.case_id = application.case_id
     and snapshot.id = application.offer_id
    where application.organization_id = p_organization_id
      and (
        application.omnisearch_vector @@ search_query
        or application.omnisearch_text ilike like_pattern escape '\'
        or application.omnisearch_text operator(extensions.%) normalized_query
      )

    union all

    select
      submission.id,
      (
        case
          when public.crm_omnisearch_normalize(submission.external_reference) = normalized_query then 6.0
          when public.crm_omnisearch_normalize(submission.external_reference) like normalized_query || '%' then 3.0
          else 0.0
        end
        + ts_rank_cd(submission.omnisearch_vector, search_query) * 3.0
        + extensions.similarity(coalesce(submission.external_reference, ''), raw_query)
        + extensions.similarity(submission.omnisearch_text, normalized_query) * 0.2
      )::double precision as score
    from public.crm_item_submissions submission
    join public.crm_case_bank_applications application
      on application.organization_id = submission.organization_id
     and application.submission_id = submission.id
    where submission.organization_id = p_organization_id
      and (
        submission.omnisearch_vector @@ search_query
        or submission.omnisearch_text ilike like_pattern escape '\'
        or submission.external_reference operator(extensions.%) raw_query
      )
  ),
  ranked_application_matches as (
    select match.id, max(match.score) as score
    from application_matches match
    group by match.id
    order by max(match.score) desc, match.id
    limit target_limit
  ),
  application_rows as (
    select
      'application'::text as record_type,
      submission.id,
      concat('Wniosek · ', coalesce(snapshot.bank_name, 'Bank')) as label,
      concat_ws(' · ', snapshot.product_name, submission.external_reference) as detail,
      submission.status_code,
      application.case_id,
      crm_case.title as case_title,
      null::uuid as client_id,
      null::text as client_name,
      coalesce(submission.submitted_at, submission.updated_at) as occurred_at,
      match.score
    from ranked_application_matches match
    join public.crm_item_submissions submission
      on submission.organization_id = p_organization_id
     and submission.id = match.id
    join public.crm_case_bank_applications application
      on application.organization_id = submission.organization_id
     and application.submission_id = submission.id
    join public.crm_cases crm_case
      on crm_case.organization_id = application.organization_id
     and crm_case.id = application.case_id
    left join public.crm_case_offer_snapshots snapshot
      on snapshot.organization_id = application.organization_id
     and snapshot.case_id = application.case_id
     and snapshot.id = application.offer_id
  )
  select coalesce(
    jsonb_agg(
      to_jsonb(hit) - 'score'
      order by hit.score desc, hit.occurred_at desc, hit.id
    ),
    '[]'::jsonb
  )
  into document_hits
  from (
    select *
    from (
      select
        'document'::text as record_type,
        document.id,
        document.name as label,
        document.document_type as detail,
        document.status_code,
        coalesce(document.case_id, case_item.case_id) as case_id,
        crm_case.title as case_title,
        document.client_id,
        client.display_name as client_name,
        coalesce(document.received_at, document.updated_at) as occurred_at,
        (
          case
            when public.crm_omnisearch_normalize(document.name) = normalized_query then 6.0
            when public.crm_omnisearch_normalize(document.name) like normalized_query || '%' then 3.0
            else 0.0
          end
          + ts_rank_cd(document.omnisearch_vector, search_query) * 3.0
          + extensions.similarity(document.name, raw_query)
          + extensions.similarity(document.omnisearch_text, normalized_query) * 0.2
        )::double precision as score
      from public.crm_documents document
      left join public.crm_item_submissions submission
        on submission.organization_id = document.organization_id
       and submission.id = document.submission_id
      left join public.crm_case_items case_item
        on case_item.organization_id = document.organization_id
       and case_item.id = coalesce(document.case_item_id, submission.case_item_id)
      left join public.crm_cases crm_case
        on crm_case.organization_id = document.organization_id
       and crm_case.id = coalesce(document.case_id, case_item.case_id)
      left join public.crm_clients client
        on client.organization_id = document.organization_id
       and client.id = document.client_id
      where document.organization_id = p_organization_id
        and document.case_id is not null
        and (
          document.omnisearch_vector @@ search_query
          or document.omnisearch_text ilike like_pattern escape '\'
          or document.name operator(extensions.%) raw_query
        )

      union all

      select *
      from application_rows
    ) candidate
    order by candidate.score desc, candidate.occurred_at desc, candidate.id
    limit target_limit
  ) hit;

  return jsonb_build_object(
    'cases', case_hits,
    'clients', client_hits,
    'appointments', appointment_hits,
    'tasks', task_hits,
    'documents', document_hits
  );
end;
$$;


--
-- Name: FUNCTION search_crm_omnisearch(p_organization_id uuid, p_query text, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_crm_omnisearch(p_organization_id uuid, p_query text, p_limit integer) IS 'Minimal, ranked, RLS-scoped search payload for the CRM command palette.';


--
-- Name: search_mortgage_bank_file_chunks(text, extensions.vector, uuid, text, text, uuid, text, integer, double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_mortgage_bank_file_chunks(query_text text, query_embedding extensions.vector DEFAULT NULL::extensions.vector, filter_bank_id uuid DEFAULT NULL::uuid, filter_category_key text DEFAULT NULL::text, filter_mime_group text DEFAULT NULL::text, filter_product_id uuid DEFAULT NULL::uuid, filter_status text DEFAULT NULL::text, match_count integer DEFAULT 30, full_text_weight double precision DEFAULT 1.0, semantic_weight double precision DEFAULT 1.0, rrf_k integer DEFAULT 50) RETURNS TABLE(chunk_id bigint, file_id uuid, version_id uuid, page_number integer, locator text, snippet text, score double precision)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with query_terms as (
    select distinct term.lexeme
    from unnest(
      tsvector_to_array(
        to_tsvector('simple'::regconfig, coalesce(query_text, ''))
      )
    ) as term(lexeme)
    where term.lexeme <> ''
  ),
  search_query as (
    select case
      when count(*) = 0 then null::tsquery
      else to_tsquery(
        'simple'::regconfig,
        string_agg(quote_literal(query_terms.lexeme) || ':*', ' & ' order by query_terms.lexeme)
      )
    end as value
    from query_terms
  ),
  eligible as (
    select
      chunk.id as chunk_id,
      file.id as file_id,
      version.id as version_id,
      chunk.page_start as page_number,
      chunk.locator,
      chunk.content,
      chunk.search_vector,
      latest_embedding.embedding
    from public.mortgage_bank_file_chunks as chunk
    join public.mortgage_bank_file_versions as version
      on version.id = chunk.version_id
    join public.mortgage_bank_files as file
      on file.current_version_id = version.id
    left join public.mortgage_bank_file_categories as category
      on category.id = file.category_id
    left join lateral (
      select stored.embedding
      from public.mortgage_bank_file_embeddings as stored
      where stored.chunk_id = chunk.id
        and stored.embedding_kind = 'content'
        and stored.model = 'gemini-embedding-2'
        and stored.dimensions = 768
      order by stored.created_at desc
      limit 1
    ) as latest_embedding on true
    where file.archived_at is null
      and (filter_bank_id is null or file.bank_id = filter_bank_id)
      and (filter_category_key is null or category.category_key = filter_category_key)
      and (filter_mime_group is null or version.mime_group = filter_mime_group)
      and (filter_status is null or version.status = filter_status)
      and (
        filter_product_id is null
        or exists (
          select 1
          from public.mortgage_bank_file_products as link
          where link.file_id = file.id
            and link.product_id = filter_product_id
        )
      )
  ),
  full_text as (
    select
      eligible.chunk_id,
      row_number() over (
        order by ts_rank_cd(eligible.search_vector, search_query.value) desc
      ) as rank_ix
    from eligible
    cross join search_query
    where search_query.value is not null
      and eligible.search_vector @@ search_query.value
    order by ts_rank_cd(eligible.search_vector, search_query.value) desc
    limit least(greatest(match_count, 1), 100) * 2
  ),
  semantic as (
    select
      eligible.chunk_id,
      row_number() over (
        order by eligible.embedding operator(extensions.<=>) query_embedding
      ) as rank_ix
    from eligible
    where query_embedding is not null
      and eligible.embedding is not null
    order by eligible.embedding operator(extensions.<=>) query_embedding
    limit least(greatest(match_count, 1), 100) * 2
  ),
  ranked as (
    select
      coalesce(full_text.chunk_id, semantic.chunk_id) as chunk_id,
      coalesce(
        full_text_weight / (rrf_k + full_text.rank_ix),
        0.0
      ) + coalesce(
        semantic_weight / (rrf_k + semantic.rank_ix),
        0.0
      ) as score
    from full_text
    full join semantic using (chunk_id)
  )
  select
    eligible.chunk_id,
    eligible.file_id,
    eligible.version_id,
    eligible.page_number,
    eligible.locator,
    regexp_replace(
      replace(
        replace(
          ts_headline(
            'simple'::regconfig,
            eligible.content,
            search_query.value,
            'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=26,MinWords=8,FragmentDelimiter= … '
          ),
          '<mark>',
          ''
        ),
        '</mark>',
        ''
      ),
      '\s+',
      ' ',
      'g'
    ) as snippet,
    ranked.score
  from ranked
  join eligible using (chunk_id)
  cross join search_query
  order by ranked.score desc, eligible.chunk_id
  limit least(greatest(match_count, 1), 100);
$$;


--
-- Name: set_crm_case_clients(uuid, uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_crm_case_clients(p_organization_id uuid, p_case_id uuid, p_client_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  client_ids uuid[];
  client_count integer;
  result jsonb;
begin
  if current_user <> 'openexpert_service' then
    if not private.is_organization_member(p_organization_id) then
      raise exception 'organization_membership_required' using errcode = '42501';
    end if;
  end if;

  select coalesce(array_agg(unique_client.client_id order by unique_client.first_position), '{}'::uuid[])
  into client_ids
  from (
    select input.client_id, min(input.position) as first_position
    from unnest(coalesce(p_client_ids, '{}'::uuid[]))
      with ordinality as input(client_id, position)
    group by input.client_id
  ) unique_client;

  if cardinality(client_ids) = 0 or cardinality(client_ids) > 100 then
    raise exception 'case_clients_must_contain_between_1_and_100_clients'
      using errcode = '22023';
  end if;

  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = p_organization_id
    and crm_case.id = p_case_id;
  if not found then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;

  select count(*)
  into client_count
  from public.crm_clients client
  where client.organization_id = p_organization_id
    and client.id = any(client_ids);
  if client_count <> cardinality(client_ids) then
    raise exception 'case_client_not_found' using errcode = '23503';
  end if;

  update public.crm_case_clients case_client
  set is_primary = false
  where case_client.organization_id = p_organization_id
    and case_client.case_id = p_case_id
    and case_client.is_primary;

  delete from public.crm_case_clients case_client
  where case_client.organization_id = p_organization_id
    and case_client.case_id = p_case_id
    and not (case_client.client_id = any(client_ids));

  insert into public.crm_case_clients (
    organization_id,
    case_id,
    client_id,
    is_primary
  )
  select
    p_organization_id,
    p_case_id,
    input.client_id,
    input.position = 1
  from unnest(client_ids) with ordinality as input(client_id, position)
  on conflict (case_id, client_id) do update
  set is_primary = excluded.is_primary,
      updated_at = now();

  update public.crm_cases crm_case
  set client_id = client_ids[1]
  where crm_case.organization_id = p_organization_id
    and crm_case.id = p_case_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', client.id,
      'display_name', client.display_name,
      'primary_email', client.primary_email,
      'primary_phone', client.primary_phone,
      'is_primary', case_client.is_primary
    )
    order by case_client.is_primary desc, client.display_name, client.id
  ), '[]'::jsonb)
  into result
  from public.crm_case_clients case_client
  join public.crm_clients client
    on client.organization_id = case_client.organization_id
   and client.id = case_client.client_id
  where case_client.organization_id = p_organization_id
    and case_client.case_id = p_case_id;

  return result;
end;
$$;


--
-- Name: set_facility_cover_image(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_facility_cover_image(p_organization_id uuid, p_facility_id uuid, p_image_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert-facility-cover:'
        || p_organization_id::text
        || ':'
        || p_facility_id::text,
      0
    )
  );

  if not exists (
    select 1
    from public.facility_images image
    where image.organization_id = p_organization_id
      and image.facility_id = p_facility_id
      and image.id = p_image_id
  ) then
    raise exception 'facility_image_not_found'
      using errcode = 'P0002';
  end if;

  with ranked_images as (
    select
      image.id,
      (
        pg_catalog.row_number() over (
          order by
            (image.id = p_image_id) desc,
            image.sort_order,
            image.created_at,
            image.id
        ) - 1
      )::integer as next_sort_order
    from public.facility_images image
    where image.organization_id = p_organization_id
      and image.facility_id = p_facility_id
  )
  update public.facility_images image
  set sort_order = ranked.next_sort_order
  from ranked_images ranked
  where image.organization_id = p_organization_id
    and image.facility_id = p_facility_id
    and image.id = ranked.id
    and image.sort_order is distinct from ranked.next_sort_order;
end;
$$;


--
-- Name: FUNCTION set_facility_cover_image(p_organization_id uuid, p_facility_id uuid, p_image_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_facility_cover_image(p_organization_id uuid, p_facility_id uuid, p_image_id uuid) IS 'Atomically moves one facility image to cover position and normalizes gallery ordering.';


--
-- Name: set_organization_user_admin_access(uuid, uuid, bigint, uuid, text[], boolean, text, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_organization_user_admin_access(p_organization_id uuid, p_user_id uuid, p_expected_revision bigint, p_idempotency_key uuid, p_role_keys text[], p_consent_publish boolean, p_consent_justification text, p_consent_expires_at timestamp with time zone, p_change_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_user_id uuid := (select app.current_user_id());
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


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: crm_case_contract_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_contract_selections (
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    application_id uuid NOT NULL,
    signed_by_user_id uuid NOT NULL,
    signed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE crm_case_contract_selections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_case_contract_selections IS 'The one immutable, signed credit agreement selected from a CRM case bank application.';


--
-- Name: sign_crm_case_contract(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sign_crm_case_contract(target_organization_id uuid, target_case_id uuid, target_application_id uuid) RETURNS public.crm_case_contract_selections
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  target_status text;
  actor_user_id uuid := (select app.current_user_id());
  result public.crm_case_contract_selections;
begin
  if current_user <> 'openexpert_service'
    and not private.is_organization_member(target_organization_id) then
    raise exception using errcode = '42501', message = 'Organization membership is required';
  end if;

  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = target_organization_id
    and crm_case.id = target_case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CRM case not found';
  end if;

  if exists (
    select 1
    from public.crm_case_contract_selections contract
    where contract.organization_id = target_organization_id
      and contract.case_id = target_case_id
  ) then
    raise exception using errcode = '23505', message = 'A credit agreement has already been signed for this CRM case';
  end if;

  select submission.status_code
  into target_status
  from public.crm_case_bank_applications application
  join public.crm_item_submissions submission
    on submission.organization_id = application.organization_id
   and submission.id = application.submission_id
  where application.organization_id = target_organization_id
    and application.case_id = target_case_id
    and application.submission_id = target_application_id
  for update of submission;
  if target_status is null then
    raise exception using errcode = 'P0002', message = 'Bank application not found';
  end if;
  if target_status <> 'zaakceptowane' then
    raise exception using errcode = '23514', message = 'Only an accepted bank application can be signed';
  end if;

  insert into public.crm_case_contract_selections (
    organization_id,
    case_id,
    application_id,
    signed_by_user_id,
    signed_at
  ) values (
    target_organization_id,
    target_case_id,
    target_application_id,
    actor_user_id,
    now()
  )
  returning * into result;

  return result;
end;
$$;


--
-- Name: update_booking_widget_configuration(uuid, uuid, uuid, jsonb, boolean, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_booking_widget_configuration(p_organization_id uuid, p_facility_id uuid, p_widget_id uuid, p_widget_patch jsonb, p_update_services boolean, p_service_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  widget_record public.booking_widgets;
  normalized_patch jsonb := coalesce(p_widget_patch, '{}'::jsonb);
begin
  select widget.*
  into widget_record
  from public.booking_widgets widget
  where widget.organization_id = p_organization_id
    and widget.facility_id = p_facility_id
    and widget.id = p_widget_id
  for update;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  if not private.can_manage_booking_widget(
    widget_record.organization_id,
    widget_record.facility_id,
    widget_record.fixed_expert_user_id
  ) then
    raise exception 'booking_widget_manager_required' using errcode = '42501';
  end if;

  if jsonb_typeof(normalized_patch) <> 'object' then
    raise exception 'widget_patch_must_be_an_object' using errcode = '22023';
  end if;

  if normalized_patch ? 'fixed_expert_user_id'
     or normalized_patch ? 'created_by_user_id' then
    raise exception 'widget_owner_fields_cannot_be_patched' using errcode = '22023';
  end if;

  if widget_record.fixed_expert_user_id is not null
     and normalized_patch ? 'booking_mode'
     and normalized_patch ->> 'booking_mode' <> 'expert' then
    raise exception 'fixed_expert_widget_requires_expert_mode' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(normalized_patch) patch_key
    where patch_key not in (
      'name',
      'slug',
      'title',
      'subtitle',
      'theme',
      'accent_color',
      'allowed_origins',
      'booking_mode',
      'widget_type',
      'locale',
      'is_active'
    )
  ) then
    raise exception 'unsupported_booking_widget_patch_field' using errcode = '22023';
  end if;

  if normalized_patch ? 'allowed_origins'
     and jsonb_typeof(normalized_patch -> 'allowed_origins') <> 'array' then
    raise exception 'allowed_origins_must_be_an_array' using errcode = '22023';
  end if;

  if normalized_patch <> '{}'::jsonb then
    update public.booking_widgets widget
    set name = case
          when normalized_patch ? 'name' then normalized_patch ->> 'name'
          else widget.name
        end,
        slug = case
          when normalized_patch ? 'slug' then normalized_patch ->> 'slug'
          else widget.slug
        end,
        title = case
          when normalized_patch ? 'title' then normalized_patch ->> 'title'
          else widget.title
        end,
        subtitle = case
          when normalized_patch ? 'subtitle' then normalized_patch ->> 'subtitle'
          else widget.subtitle
        end,
        theme = case
          when normalized_patch ? 'theme' then normalized_patch ->> 'theme'
          else widget.theme
        end,
        accent_color = case
          when normalized_patch ? 'accent_color' then normalized_patch ->> 'accent_color'
          else widget.accent_color
        end,
        allowed_origins = case
          when normalized_patch ? 'allowed_origins' then array(
            select jsonb_array_elements_text(normalized_patch -> 'allowed_origins')
          )
          else widget.allowed_origins
        end,
        booking_mode = case
          when normalized_patch ? 'booking_mode' then normalized_patch ->> 'booking_mode'
          else widget.booking_mode
        end,
        widget_type = case
          when normalized_patch ? 'widget_type' then normalized_patch ->> 'widget_type'
          else widget.widget_type
        end,
        locale = case
          when normalized_patch ? 'locale' then normalized_patch ->> 'locale'
          else widget.locale
        end,
        is_active = case
          when normalized_patch ? 'is_active'
            then (normalized_patch ->> 'is_active')::boolean
          else widget.is_active
        end
    where widget.organization_id = p_organization_id
      and widget.facility_id = p_facility_id
      and widget.id = p_widget_id;
  end if;

  if coalesce(p_update_services, false) then
    if exists (
      select 1
      from unnest(coalesce(p_service_ids, '{}'::uuid[])) selected_service_id
      where not exists (
        select 1
        from public.facility_services facility_service
        where facility_service.organization_id = p_organization_id
          and facility_service.facility_id = p_facility_id
          and facility_service.service_id = selected_service_id
          and facility_service.is_active
      )
    ) then
      raise exception 'service_not_active_at_facility' using errcode = '23503';
    end if;

    if widget_record.fixed_expert_user_id is not null
       and exists (
         select 1
         from unnest(coalesce(p_service_ids, '{}'::uuid[])) selected_service_id
         where not exists (
           select 1
           from public.facility_service_experts service_expert
           where service_expert.organization_id = p_organization_id
             and service_expert.facility_id = p_facility_id
             and service_expert.service_id = selected_service_id
             and service_expert.user_id = widget_record.fixed_expert_user_id
             and service_expert.is_active
         )
       ) then
      raise exception 'service_not_assigned_to_fixed_expert' using errcode = '23503';
    end if;

    delete from public.booking_widget_services allowed_service
    where allowed_service.organization_id = p_organization_id
      and allowed_service.facility_id = p_facility_id
      and allowed_service.widget_id = p_widget_id;

    insert into public.booking_widget_services (
      organization_id,
      facility_id,
      widget_id,
      service_id
    )
    select p_organization_id,
           p_facility_id,
           p_widget_id,
           selected_service_id
    from (
      select distinct selected_service_id
      from unnest(coalesce(p_service_ids, '{}'::uuid[])) selected_service_id
    ) selected_services;
  end if;
end;
$$;


--
-- Name: update_crm_consent_definition(uuid, uuid, text, text, text, text, text, text, boolean, text, integer, text, timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_crm_consent_definition(p_definition_id uuid, p_organization_id uuid, p_internal_name text, p_display_title text, p_content text, p_purpose text, p_channel text, p_legal_basis text, p_is_required boolean, p_status text, p_sort_order integer, p_language_code text, p_effective_from timestamp with time zone, p_effective_to timestamp with time zone, p_change_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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
    (select app.current_user_id())
  );

  update public.crm_consent_definitions
  set current_version_id = new_version_id,
      updated_by_user_id = (select app.current_user_id())
  where organization_id = p_organization_id
    and id = p_definition_id;

  return new_version_id;
end;
$$;


--
-- Name: update_facility_service_configuration(uuid, uuid, uuid, jsonb, boolean, boolean, boolean, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_facility_service_configuration(p_organization_id uuid, p_facility_id uuid, p_service_id uuid, p_service_patch jsonb, p_update_availability boolean, p_is_available boolean, p_update_experts boolean, p_expert_user_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not (
    private.is_organization_admin(p_organization_id)
    or private.is_facility_admin(p_organization_id, p_facility_id)
  ) then
    raise exception 'facility_admin_required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.facility_services facility_service
    where facility_service.organization_id = p_organization_id
      and facility_service.facility_id = p_facility_id
      and facility_service.service_id = p_service_id
  ) then
    raise exception 'facility_service_not_found' using errcode = 'P0002';
  end if;

  if coalesce(p_service_patch, '{}'::jsonb) <> '{}'::jsonb then
    if not private.is_organization_admin(p_organization_id) then
      raise exception 'organization_admin_required' using errcode = '42501';
    end if;

    update public.booking_services service
    set name = case when p_service_patch ? 'name' then p_service_patch ->> 'name' else service.name end,
        slug = case when p_service_patch ? 'slug' then p_service_patch ->> 'slug' else service.slug end,
        description = case when p_service_patch ? 'description' then p_service_patch ->> 'description' else service.description end,
        duration_minutes = case when p_service_patch ? 'duration_minutes' then (p_service_patch ->> 'duration_minutes')::integer else service.duration_minutes end,
        buffer_before_minutes = case when p_service_patch ? 'buffer_before_minutes' then (p_service_patch ->> 'buffer_before_minutes')::integer else service.buffer_before_minutes end,
        buffer_after_minutes = case when p_service_patch ? 'buffer_after_minutes' then (p_service_patch ->> 'buffer_after_minutes')::integer else service.buffer_after_minutes end,
        slot_interval_minutes = case when p_service_patch ? 'slot_interval_minutes' then (p_service_patch ->> 'slot_interval_minutes')::integer else service.slot_interval_minutes end,
        min_notice_minutes = case when p_service_patch ? 'min_notice_minutes' then (p_service_patch ->> 'min_notice_minutes')::integer else service.min_notice_minutes end,
        max_advance_days = case when p_service_patch ? 'max_advance_days' then (p_service_patch ->> 'max_advance_days')::integer else service.max_advance_days end,
        is_active = case when p_service_patch ? 'is_active' then (p_service_patch ->> 'is_active')::boolean else service.is_active end
    where service.organization_id = p_organization_id
      and service.id = p_service_id;

    if p_service_patch ? 'buffer_before_minutes'
       or p_service_patch ? 'buffer_after_minutes' then
      update public.appointments appointment
      set service_id = appointment.service_id
      where appointment.organization_id = p_organization_id
        and appointment.service_id = p_service_id
        and appointment.status in ('hold', 'confirmed');
    end if;
  end if;

  if p_update_availability then
    update public.facility_services facility_service
    set is_active = p_is_available
    where facility_service.organization_id = p_organization_id
      and facility_service.facility_id = p_facility_id
      and facility_service.service_id = p_service_id;
  end if;

  if p_update_experts then
    if exists (
      select 1
      from unnest(coalesce(p_expert_user_ids, '{}'::uuid[])) selected_user_id
      where not exists (
        select 1 from public.facility_memberships membership
        where membership.organization_id = p_organization_id
          and membership.facility_id = p_facility_id
          and membership.user_id = selected_user_id
          and membership.is_bookable
      )
    ) then
      raise exception 'expert_not_bookable_at_facility' using errcode = '23503';
    end if;

    update public.facility_service_experts service_expert
    set is_active = false
    where service_expert.organization_id = p_organization_id
      and service_expert.facility_id = p_facility_id
      and service_expert.service_id = p_service_id;

    insert into public.facility_service_experts (
      organization_id, facility_id, service_id, user_id, is_active
    )
    select p_organization_id, p_facility_id, p_service_id, selected_user_id, true
    from unnest(coalesce(p_expert_user_ids, '{}'::uuid[])) selected_user_id
    on conflict (organization_id, facility_id, service_id, user_id)
    do update set is_active = true, updated_at = now();
  end if;
end;
$$;


--
-- Name: organization_admin_access_commands; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.organization_admin_access_commands (
    organization_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    command_type text NOT NULL,
    request_fingerprint text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_graph_revisions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.team_graph_revisions (
    organization_id uuid NOT NULL,
    revision bigint DEFAULT 0 NOT NULL
);


--
-- Name: administrative_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.administrative_role_permissions (
    role_key text NOT NULL,
    permission_key text NOT NULL,
    CONSTRAINT administrative_role_permissions_key_not_blank CHECK (((permission_key = btrim(permission_key)) AND ((char_length(permission_key) >= 3) AND (char_length(permission_key) <= 120))))
);


--
-- Name: administrative_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.administrative_roles (
    role_key text NOT NULL,
    label text NOT NULL,
    description text NOT NULL,
    risk_level text DEFAULT 'standard'::text NOT NULL,
    sort_order smallint NOT NULL,
    CONSTRAINT administrative_roles_risk_level_valid CHECK ((risk_level = ANY (ARRAY['standard'::text, 'sensitive'::text]))),
    CONSTRAINT administrative_roles_role_key_not_blank CHECK (((role_key = btrim(role_key)) AND ((char_length(role_key) >= 3) AND (char_length(role_key) <= 80))))
);


--
-- Name: appointment_calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    appointment_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    calendar_id text NOT NULL,
    external_event_id text NOT NULL,
    provider_etag text,
    source_fingerprint text,
    sync_status text DEFAULT 'pending'::text NOT NULL,
    last_synced_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_calendar_events_calendar_id_check CHECK ((btrim(calendar_id) <> ''::text)),
    CONSTRAINT appointment_calendar_events_external_event_id_check CHECK ((btrim(external_event_id) <> ''::text)),
    CONSTRAINT appointment_calendar_events_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'error'::text, 'deleted'::text])))
);


--
-- Name: appointment_resource_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_resource_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    appointment_id uuid,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    busy_period tstzrange NOT NULL,
    status text NOT NULL,
    hold_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    time_off_id uuid,
    CONSTRAINT appointment_resource_reservations_hold_shape CHECK ((((status = 'hold'::text) AND (hold_expires_at IS NOT NULL)) OR ((status <> 'hold'::text) AND (hold_expires_at IS NULL)))),
    CONSTRAINT appointment_resource_reservations_parent_check CHECK ((num_nonnulls(appointment_id, time_off_id) = 1)),
    CONSTRAINT appointment_resource_reservations_resource_type_check CHECK ((resource_type = ANY (ARRAY['expert'::text, 'facility'::text, 'room'::text, 'equipment'::text]))),
    CONSTRAINT appointment_resource_reservations_status_check CHECK ((status = ANY (ARRAY['hold'::text, 'confirmed'::text, 'cancelled'::text]))),
    CONSTRAINT appointment_resource_reservations_valid_period CHECK (((NOT isempty(busy_period)) AND (lower(busy_period) IS NOT NULL) AND (upper(busy_period) IS NOT NULL) AND lower_inc(busy_period) AND (NOT upper_inc(busy_period))))
);


--
-- Name: TABLE appointment_resource_reservations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.appointment_resource_reservations IS 'Concrete expert/room/equipment holds protected by a GiST overlap exclusion constraint.';


--
-- Name: COLUMN appointment_resource_reservations.appointment_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointment_resource_reservations.appointment_id IS 'Appointment parent. Exactly one of appointment_id and time_off_id must be present.';


--
-- Name: COLUMN appointment_resource_reservations.time_off_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointment_resource_reservations.time_off_id IS 'Native time-off parent. Exactly one of appointment_id and time_off_id must be present.';


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    service_id uuid NOT NULL,
    expert_user_id uuid NOT NULL,
    widget_id uuid,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    appointment_period tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)'::text)) STORED,
    timezone text NOT NULL,
    status text DEFAULT 'hold'::text NOT NULL,
    hold_expires_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    customer_name text NOT NULL,
    customer_email text,
    customer_phone text,
    notes text,
    source text DEFAULT 'widget'::text NOT NULL,
    idempotency_key text,
    manage_token uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid NOT NULL,
    client_person_id uuid,
    booking_context jsonb DEFAULT '{}'::jsonb NOT NULL,
    request_fingerprint text,
    meeting_mode text DEFAULT 'office'::text NOT NULL,
    meeting_url text,
    crm_task_id uuid,
    omnisearch_text text DEFAULT ''::text NOT NULL,
    omnisearch_vector tsvector DEFAULT ''::tsvector NOT NULL,
    CONSTRAINT appointments_booking_context_check CHECK (((jsonb_typeof(booking_context) = 'object'::text) AND (octet_length((booking_context)::text) <= 16384))),
    CONSTRAINT appointments_cancellation_shape CHECK ((((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL)) OR (status <> 'cancelled'::text))),
    CONSTRAINT appointments_confirmation_shape CHECK ((((status = 'confirmed'::text) AND (confirmed_at IS NOT NULL)) OR (status <> 'confirmed'::text))),
    CONSTRAINT appointments_customer_email_check CHECK ((customer_email = lower(btrim(customer_email)))),
    CONSTRAINT appointments_customer_name_check CHECK ((btrim(customer_name) <> ''::text)),
    CONSTRAINT appointments_hold_shape CHECK ((((status = 'hold'::text) AND (hold_expires_at IS NOT NULL)) OR ((status <> 'hold'::text) AND (hold_expires_at IS NULL)))),
    CONSTRAINT appointments_idempotency_key_check CHECK (((idempotency_key IS NULL) OR ((btrim(idempotency_key) <> ''::text) AND (length(idempotency_key) <= 200)))),
    CONSTRAINT appointments_meeting_mode_check CHECK ((meeting_mode = ANY (ARRAY['office'::text, 'online'::text]))),
    CONSTRAINT appointments_meeting_shape_check CHECK ((((meeting_mode = 'office'::text) AND (meeting_url IS NULL)) OR (meeting_mode = 'online'::text))),
    CONSTRAINT appointments_meeting_url_check CHECK (((meeting_url IS NULL) OR ((meeting_url = btrim(meeting_url)) AND ((length(meeting_url) >= 8) AND (length(meeting_url) <= 2048)) AND (meeting_url ~* '^https?://[^[:space:]]+$'::text)))),
    CONSTRAINT appointments_request_fingerprint_check CHECK (((request_fingerprint IS NULL) OR (request_fingerprint ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT appointments_source_check CHECK ((source = ANY (ARRAY['widget'::text, 'staff'::text, 'import'::text, 'api'::text]))),
    CONSTRAINT appointments_status_check CHECK ((status = ANY (ARRAY['hold'::text, 'confirmed'::text, 'cancelled'::text]))),
    CONSTRAINT appointments_valid_period CHECK ((starts_at < ends_at))
);


--
-- Name: COLUMN appointments.client_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.client_id IS 'Required tenant-scoped CRM client for the appointment; customer_* columns are immutable contact snapshots.';


--
-- Name: COLUMN appointments.client_person_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.client_person_id IS 'Optional tenant-scoped person subject. When set, it must belong to appointments.client_id.';


--
-- Name: COLUMN appointments.booking_context; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.booking_context IS 'Validated, data-minimized calculator result submitted before booking; limited to 16 KiB.';


--
-- Name: COLUMN appointments.request_fingerprint; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.request_fingerprint IS 'Sha-256 fingerprint of the complete public booking request for idempotency.';


--
-- Name: COLUMN appointments.meeting_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.meeting_mode IS 'Client meeting delivery mode. Facility remains the scheduling, authorization and reporting context for both modes.';


--
-- Name: COLUMN appointments.meeting_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.meeting_url IS 'Optional HTTP(S) join URL for online meetings. Access tokens and provider secrets must not be stored here.';


--
-- Name: COLUMN appointments.crm_task_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.crm_task_id IS 'Optional delegated task context for meetings shown in the task history.';


--
-- Name: booking_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_outbox (
    id bigint NOT NULL,
    organization_id uuid NOT NULL,
    topic text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT booking_outbox_aggregate_type_check CHECK ((btrim(aggregate_type) <> ''::text)),
    CONSTRAINT booking_outbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT booking_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT booking_outbox_topic_check CHECK ((btrim(topic) <> ''::text))
);


--
-- Name: booking_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.booking_outbox ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.booking_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: booking_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_rate_limits (
    widget_id uuid NOT NULL,
    rate_scope text NOT NULL,
    client_key text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    request_count bigint DEFAULT 1 NOT NULL,
    CONSTRAINT booking_rate_limits_client_key_check CHECK (((btrim(client_key) <> ''::text) AND (length(client_key) <= 128))),
    CONSTRAINT booking_rate_limits_rate_scope_check CHECK ((rate_scope = ANY (ARRAY['catalog'::text, 'slots'::text, 'booking'::text, 'analytics'::text]))),
    CONSTRAINT booking_rate_limits_request_count_check CHECK ((request_count > 0))
);


--
-- Name: booking_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    duration_minutes integer NOT NULL,
    buffer_before_minutes integer DEFAULT 0 NOT NULL,
    buffer_after_minutes integer DEFAULT 0 NOT NULL,
    slot_interval_minutes integer DEFAULT 15 NOT NULL,
    min_notice_minutes integer DEFAULT 60 NOT NULL,
    max_advance_days integer DEFAULT 90 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT booking_services_buffer_after_minutes_check CHECK (((buffer_after_minutes >= 0) AND (buffer_after_minutes <= 1440))),
    CONSTRAINT booking_services_buffer_before_minutes_check CHECK (((buffer_before_minutes >= 0) AND (buffer_before_minutes <= 1440))),
    CONSTRAINT booking_services_duration_minutes_check CHECK (((duration_minutes >= 5) AND (duration_minutes <= 1440))),
    CONSTRAINT booking_services_max_advance_days_check CHECK (((max_advance_days >= 1) AND (max_advance_days <= 730))),
    CONSTRAINT booking_services_min_notice_minutes_check CHECK (((min_notice_minutes >= 0) AND (min_notice_minutes <= 525600))),
    CONSTRAINT booking_services_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT booking_services_slot_interval_minutes_check CHECK (((slot_interval_minutes >= 5) AND (slot_interval_minutes <= 1440))),
    CONSTRAINT booking_services_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


--
-- Name: booking_widget_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_widget_events (
    id bigint NOT NULL,
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    widget_id uuid NOT NULL,
    event_type text NOT NULL,
    service_id uuid,
    is_embedded boolean DEFAULT false NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    visit_id uuid NOT NULL,
    event_id text,
    CONSTRAINT booking_widget_events_event_type_check CHECK ((event_type = ANY (ARRAY['widget_view'::text, 'widget_engaged'::text, 'calculator_started'::text, 'calculator_completed'::text, 'service_selected'::text, 'availability_search'::text, 'availability_found'::text, 'slot_selected'::text, 'contact_started'::text, 'booking_attempt'::text, 'booking_completed'::text])))
);


--
-- Name: TABLE booking_widget_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_widget_events IS 'PII-free funnel events for booking widgets. Successful bookings are read from appointments.';


--
-- Name: COLUMN booking_widget_events.visit_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_widget_events.visit_id IS 'Ephemeral, per-widget-page-load UUID used only to deduplicate funnel stages. Not persisted in a browser cookie.';


--
-- Name: COLUMN booking_widget_events.event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_widget_events.event_id IS 'SHA-256 digest of the random booking idempotency key. Contains no booking or customer data.';


--
-- Name: booking_widget_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.booking_widget_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.booking_widget_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: booking_widget_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_widget_services (
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    widget_id uuid NOT NULL,
    service_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: booking_widgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_widgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    public_token uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    subtitle text,
    theme text DEFAULT 'auto'::text NOT NULL,
    accent_color text DEFAULT '#2563EB'::text NOT NULL,
    allowed_origins text[] DEFAULT '{}'::text[] NOT NULL,
    booking_mode text DEFAULT 'both'::text NOT NULL,
    locale text DEFAULT 'pl-PL'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    widget_type text DEFAULT 'calendar'::text NOT NULL,
    fixed_expert_user_id uuid,
    created_by_user_id uuid DEFAULT app.current_user_id(),
    analytics_started_at timestamp with time zone DEFAULT now() NOT NULL,
    is_directory_listed boolean DEFAULT false NOT NULL,
    CONSTRAINT booking_widgets_accent_color_check CHECK ((accent_color ~ '^#[0-9A-Fa-f]{6}$'::text)),
    CONSTRAINT booking_widgets_allowed_origins_shape CHECK ((array_position(allowed_origins, NULL::text) IS NULL)),
    CONSTRAINT booking_widgets_booking_mode_check CHECK ((booking_mode = ANY (ARRAY['facility'::text, 'expert'::text, 'both'::text]))),
    CONSTRAINT booking_widgets_directory_calendar_only CHECK (((NOT is_directory_listed) OR (widget_type = 'calendar'::text))),
    CONSTRAINT booking_widgets_fixed_expert_creator_check CHECK (((fixed_expert_user_id IS NULL) OR (created_by_user_id IS NOT NULL))),
    CONSTRAINT booking_widgets_fixed_expert_mode_check CHECK (((fixed_expert_user_id IS NULL) OR (booking_mode = 'expert'::text))),
    CONSTRAINT booking_widgets_locale_check CHECK ((btrim(locale) <> ''::text)),
    CONSTRAINT booking_widgets_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT booking_widgets_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT booking_widgets_theme_check CHECK ((theme = ANY (ARRAY['light'::text, 'dark'::text, 'auto'::text]))),
    CONSTRAINT booking_widgets_title_check CHECK ((btrim(title) <> ''::text)),
    CONSTRAINT booking_widgets_widget_type_check CHECK ((widget_type = ANY (ARRAY['calendar'::text, 'mortgage_capacity'::text, 'mortgage_payment'::text])))
);


--
-- Name: COLUMN booking_widgets.public_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_widgets.public_token IS 'Public, high-entropy widget identifier; it is not an authorization secret.';


--
-- Name: COLUMN booking_widgets.allowed_origins; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_widgets.allowed_origins IS 'Embedding allowlist enforced by the server API and defensively checked by booking RPCs.';


--
-- Name: COLUMN booking_widgets.widget_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_widgets.widget_type IS 'calendar opens booking directly; mortgage widgets show a calculator before booking.';


--
-- Name: COLUMN booking_widgets.fixed_expert_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_widgets.fixed_expert_user_id IS 'Optional facility member that every slot and booking for this widget must use.';


--
-- Name: COLUMN booking_widgets.analytics_started_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_widgets.analytics_started_at IS 'Earliest timestamp included in widget funnel analytics. Prevents pre-tracking bookings from distorting conversion.';


--
-- Name: COLUMN booking_widgets.is_directory_listed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_widgets.is_directory_listed IS 'Explicit opt-in for the public OpenExpert experts and facilities directory.';


--
-- Name: calendar_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    owner_kind text NOT NULL,
    owner_user_id uuid,
    facility_id uuid,
    provider text NOT NULL,
    account_id text NOT NULL,
    account_email text,
    encrypted_access_token text,
    encrypted_refresh_token text,
    token_expires_at timestamp with time zone,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    selected_calendar_id text,
    selected_calendar_name text,
    read_calendar_ids text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sync_cursor text,
    webhook_channel_id text,
    webhook_resource_id text,
    webhook_client_state_encrypted text,
    webhook_expires_at timestamp with time zone,
    last_synced_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_connections_account_email_check CHECK (((account_email IS NULL) OR (account_email = lower(btrim(account_email))))),
    CONSTRAINT calendar_connections_account_id_check CHECK ((btrim(account_id) <> ''::text)),
    CONSTRAINT calendar_connections_owner_kind_check CHECK ((owner_kind = ANY (ARRAY['expert'::text, 'facility'::text]))),
    CONSTRAINT calendar_connections_owner_shape CHECK ((((owner_kind = 'expert'::text) AND (owner_user_id IS NOT NULL) AND (facility_id IS NULL)) OR ((owner_kind = 'facility'::text) AND (owner_user_id IS NULL) AND (facility_id IS NOT NULL)))),
    CONSTRAINT calendar_connections_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'microsoft'::text]))),
    CONSTRAINT calendar_connections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'error'::text, 'revoked'::text])))
);


--
-- Name: TABLE calendar_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.calendar_connections IS 'Server-only OAuth connection metadata; encrypted_* values must be application-encrypted.';


--
-- Name: client_account_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_account_links (
    auth_user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid NOT NULL,
    client_person_id uuid NOT NULL,
    source_appointment_id uuid,
    verification_method text NOT NULL,
    verified_contact_normalized text NOT NULL,
    verified_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_account_links_verification_method_check CHECK ((verification_method = ANY (ARRAY['email'::text, 'phone'::text]))),
    CONSTRAINT client_account_links_verified_contact_normalized_check CHECK (((btrim(verified_contact_normalized) <> ''::text) AND (verified_contact_normalized = lower(btrim(verified_contact_normalized))) AND (length(verified_contact_normalized) <= 320)))
);


--
-- Name: TABLE client_account_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.client_account_links IS 'Verified client-portal access for one Auth identity and one CRM person.';


--
-- Name: crm_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    actor_user_id uuid,
    client_id uuid,
    case_id uuid,
    case_item_id uuid,
    submission_id uuid,
    activity_type text NOT NULL,
    title text NOT NULL,
    body text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    task_id uuid,
    CONSTRAINT crm_activities_has_context_check CHECK ((num_nonnulls(client_id, case_id, case_item_id, submission_id, task_id) >= 1))
);


--
-- Name: COLUMN crm_activities.task_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_activities.task_id IS 'Direct link to a delegated task for the complete case/task audit timeline.';


--
-- Name: crm_case_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    client_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE crm_case_clients; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_case_clients IS 'Tenant-safe many-to-many client list for a CRM case. crm_cases.client_id mirrors the primary row for compatibility.';


--
-- Name: crm_case_item_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_item_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    case_item_id uuid NOT NULL,
    payer_provider_id uuid,
    status_code text DEFAULT 'szacowane'::text NOT NULL,
    expected_amount numeric(14,2) DEFAULT 0 NOT NULL,
    due_amount numeric(14,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(14,2) DEFAULT 0 NOT NULL,
    currency character(3) DEFAULT 'PLN'::bpchar NOT NULL,
    due_date date,
    paid_at timestamp with time zone,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_case_item_settlements_due_amount_check CHECK ((due_amount >= (0)::numeric)),
    CONSTRAINT crm_case_item_settlements_expected_amount_check CHECK ((expected_amount >= (0)::numeric)),
    CONSTRAINT crm_case_item_settlements_paid_amount_check CHECK ((paid_amount >= (0)::numeric))
);


--
-- Name: crm_case_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    product_type_id uuid NOT NULL,
    owner_user_id uuid,
    title text NOT NULL,
    status_code text DEFAULT 'kwalifikacja'::text NOT NULL,
    amount_value numeric(14,2),
    currency character(3) DEFAULT 'PLN'::bpchar NOT NULL,
    expected_close_date date,
    won_at timestamp with time zone,
    lost_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_case_items_amount_value_check CHECK (((amount_value IS NULL) OR (amount_value >= (0)::numeric)))
);


--
-- Name: crm_case_multiform_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_multiform_drafts (
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    selection_fingerprint text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    active_step integer DEFAULT 1 NOT NULL,
    intake_answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    form_values jsonb DEFAULT '{}'::jsonb NOT NULL,
    collection_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    selected_document_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_case_multiform_drafts_active_step_check CHECK (((active_step >= 1) AND (active_step <= 5))),
    CONSTRAINT crm_case_multiform_drafts_collection_counts_check CHECK (((jsonb_typeof(collection_counts) = 'object'::text) AND (pg_column_size(collection_counts) <= 98304))),
    CONSTRAINT crm_case_multiform_drafts_form_values_check CHECK (((jsonb_typeof(form_values) = 'object'::text) AND (pg_column_size(form_values) <= 1310720))),
    CONSTRAINT crm_case_multiform_drafts_intake_answers_check CHECK (((jsonb_typeof(intake_answers) = 'object'::text) AND (pg_column_size(intake_answers) <= 196608))),
    CONSTRAINT crm_case_multiform_drafts_revision_check CHECK ((revision > 0)),
    CONSTRAINT crm_case_multiform_drafts_selected_document_ids_check CHECK (((cardinality(selected_document_ids) <= 250) AND (array_position(selected_document_ids, NULL::uuid) IS NULL))),
    CONSTRAINT crm_case_multiform_drafts_selection_fingerprint_check CHECK ((selection_fingerprint ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: TABLE crm_case_multiform_drafts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_case_multiform_drafts IS 'Autosaved state of the five-step CRM Multiwniosek flow, scoped to one organization and case.';


--
-- Name: crm_case_offer_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_offer_selections (
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    selected_by_user_id uuid,
    selected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE crm_case_offer_selections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_case_offer_selections IS 'The bank application currently open in the CRM UI; never the final contract choice.';


--
-- Name: crm_case_offer_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_offer_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    bank_id uuid,
    mortgage_product_id uuid,
    mortgage_product_version_id uuid,
    saved_by_user_id uuid,
    offer_type text DEFAULT 'mortgage'::text NOT NULL,
    bank_name text NOT NULL,
    product_name text NOT NULL,
    version_key text,
    calculator_version text NOT NULL,
    currency character(3) DEFAULT 'PLN'::bpchar NOT NULL,
    loan_amount numeric(14,2),
    first_installment numeric(14,2),
    first_monthly_outflow numeric(14,2),
    cost_first_five_years numeric(14,2),
    total_cost numeric(14,2),
    representative_apr_pct numeric(8,5),
    scenario_snapshot jsonb NOT NULL,
    catalog_snapshot jsonb NOT NULL,
    calculation_snapshot jsonb NOT NULL,
    stress_snapshot jsonb,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_case_offer_snapshots_bank_name_check CHECK ((btrim(bank_name) <> ''::text)),
    CONSTRAINT crm_case_offer_snapshots_calculation_snapshot_check CHECK ((jsonb_typeof(calculation_snapshot) = 'object'::text)),
    CONSTRAINT crm_case_offer_snapshots_catalog_snapshot_check CHECK ((jsonb_typeof(catalog_snapshot) = 'object'::text)),
    CONSTRAINT crm_case_offer_snapshots_cost_first_five_years_check CHECK (((cost_first_five_years IS NULL) OR (cost_first_five_years >= (0)::numeric))),
    CONSTRAINT crm_case_offer_snapshots_first_installment_check CHECK (((first_installment IS NULL) OR (first_installment >= (0)::numeric))),
    CONSTRAINT crm_case_offer_snapshots_first_monthly_outflow_check CHECK (((first_monthly_outflow IS NULL) OR (first_monthly_outflow >= (0)::numeric))),
    CONSTRAINT crm_case_offer_snapshots_loan_amount_check CHECK (((loan_amount IS NULL) OR (loan_amount > (0)::numeric))),
    CONSTRAINT crm_case_offer_snapshots_offer_type_check CHECK ((btrim(offer_type) <> ''::text)),
    CONSTRAINT crm_case_offer_snapshots_product_name_check CHECK ((btrim(product_name) <> ''::text)),
    CONSTRAINT crm_case_offer_snapshots_representative_apr_pct_check CHECK (((representative_apr_pct IS NULL) OR ((representative_apr_pct >= (0)::numeric) AND (representative_apr_pct <= (100)::numeric)))),
    CONSTRAINT crm_case_offer_snapshots_scenario_snapshot_check CHECK ((jsonb_typeof(scenario_snapshot) = 'object'::text)),
    CONSTRAINT crm_case_offer_snapshots_stress_snapshot_check CHECK (((stress_snapshot IS NULL) OR (jsonb_typeof(stress_snapshot) = 'object'::text))),
    CONSTRAINT crm_case_offer_snapshots_total_cost_check CHECK (((total_cost IS NULL) OR (total_cost >= (0)::numeric)))
);


--
-- Name: TABLE crm_case_offer_snapshots; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_case_offer_snapshots IS 'Immutable offer and calculator snapshots saved to a CRM case.';


--
-- Name: crm_case_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    person_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_case_property_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_case_property_selections (
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    property_id uuid NOT NULL,
    selected_by_user_id uuid,
    selected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE crm_case_property_selections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_case_property_selections IS 'The real-estate listing selected from the candidate properties attached to a CRM case.';


--
-- Name: crm_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid NOT NULL,
    owner_user_id uuid,
    title text NOT NULL,
    description text,
    status_code text DEFAULT 'nowa'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    progress_percent integer DEFAULT 0 NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_text text DEFAULT ''::text NOT NULL,
    search_vector tsvector DEFAULT ''::tsvector NOT NULL,
    CONSTRAINT crm_cases_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT crm_cases_progress_percent_check CHECK (((progress_percent >= 0) AND (progress_percent <= 100)))
);


--
-- Name: crm_client_anonymization_execution_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_client_anonymization_execution_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    request_id uuid NOT NULL,
    grantee_user_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    approver_user_id uuid NOT NULL,
    permission_key text DEFAULT 'clients.anonymization.execute'::text NOT NULL,
    status text DEFAULT 'pending_approval'::text NOT NULL,
    justification text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    decision_reason text,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by_user_id uuid,
    consumed_at timestamp with time zone,
    consumed_by_user_id uuid,
    revision bigint DEFAULT 1 NOT NULL,
    request_idempotency_key uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_client_anonymization_execution_grants_expiry_valid CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '24:00:00'::interval)))),
    CONSTRAINT crm_client_anonymization_execution_grants_four_eyes CHECK (((approver_user_id <> grantee_user_id) AND (approver_user_id <> requested_by_user_id))),
    CONSTRAINT crm_client_anonymization_execution_grants_justification_valid CHECK (((char_length(btrim(justification)) >= 20) AND (char_length(btrim(justification)) <= 2000))),
    CONSTRAINT crm_client_anonymization_execution_grants_lifecycle_valid CHECK ((((status = 'pending_approval'::text) AND (approved_at IS NULL) AND (rejected_at IS NULL) AND (revoked_at IS NULL) AND (consumed_at IS NULL)) OR ((status = 'active'::text) AND (approved_at IS NOT NULL) AND (rejected_at IS NULL) AND (revoked_at IS NULL) AND (consumed_at IS NULL)) OR ((status = 'rejected'::text) AND (approved_at IS NULL) AND (rejected_at IS NOT NULL) AND (revoked_at IS NULL) AND (consumed_at IS NULL) AND ((char_length(btrim(decision_reason)) >= 10) AND (char_length(btrim(decision_reason)) <= 2000))) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by_user_id IS NOT NULL) AND (consumed_at IS NULL) AND ((char_length(btrim(decision_reason)) >= 10) AND (char_length(btrim(decision_reason)) <= 2000))) OR ((status = 'consumed'::text) AND (approved_at IS NOT NULL) AND (consumed_at IS NOT NULL) AND (consumed_by_user_id = grantee_user_id) AND (revoked_at IS NULL)))),
    CONSTRAINT crm_client_anonymization_execution_grants_permission_valid CHECK ((permission_key = 'clients.anonymization.execute'::text)),
    CONSTRAINT crm_client_anonymization_execution_grants_revision_valid CHECK ((revision >= 1)),
    CONSTRAINT crm_client_anonymization_execution_grants_status_valid CHECK ((status = ANY (ARRAY['pending_approval'::text, 'active'::text, 'rejected'::text, 'revoked'::text, 'consumed'::text])))
);


--
-- Name: TABLE crm_client_anonymization_execution_grants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_client_anonymization_execution_grants IS 'Four-eyes, single-use execution grants bound to one approved client anonymization request.';


--
-- Name: crm_client_anonymization_request_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_client_anonymization_request_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    request_id uuid NOT NULL,
    event_type text NOT NULL,
    from_status text,
    to_status text,
    actor_user_id uuid NOT NULL,
    reason_code text,
    evidence_reference text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_client_anonymization_request_events_statuses_valid CHECK ((((from_status IS NULL) OR (from_status = ANY (ARRAY['received'::text, 'identity_verification'::text, 'legal_review'::text, 'approved'::text, 'in_progress'::text, 'completed'::text, 'rejected'::text, 'cancelled'::text]))) AND ((to_status IS NULL) OR (to_status = ANY (ARRAY['received'::text, 'identity_verification'::text, 'legal_review'::text, 'approved'::text, 'in_progress'::text, 'completed'::text, 'rejected'::text, 'cancelled'::text]))))),
    CONSTRAINT crm_client_anonymization_request_events_type_valid CHECK ((event_type = ANY (ARRAY['request_received'::text, 'identity_verified'::text, 'legal_review_started'::text, 'approved'::text, 'execution_started'::text, 'completed'::text, 'rejected'::text, 'cancelled'::text])))
);


--
-- Name: TABLE crm_client_anonymization_request_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_client_anonymization_request_events IS 'Append-only compliance history for client anonymization requests.';


--
-- Name: COLUMN crm_client_anonymization_request_events.evidence_reference; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_client_anonymization_request_events.evidence_reference IS 'Non-PII technical pointer to evidence stored under an approved retention policy.';


--
-- Name: crm_client_anonymization_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_client_anonymization_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid NOT NULL,
    subject_person_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    request_number text NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    request_channel text NOT NULL,
    legal_basis text DEFAULT 'RODO art. 17'::text NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    identity_verified_at timestamp with time zone,
    identity_verified_by_user_id uuid,
    approved_at timestamp with time zone,
    approved_by_user_id uuid,
    due_at timestamp with time zone NOT NULL,
    justification text NOT NULL,
    review_note text,
    completed_at timestamp with time zone,
    completed_by_user_id uuid,
    created_by_user_id uuid NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_client_anonymization_requests_channel_valid CHECK ((request_channel = ANY (ARRAY['email'::text, 'phone'::text, 'in_person'::text, 'letter'::text, 'other'::text]))),
    CONSTRAINT crm_client_anonymization_requests_metadata_object CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT crm_client_anonymization_requests_number_not_blank CHECK (((char_length(btrim(request_number)) >= 5) AND (char_length(btrim(request_number)) <= 80))),
    CONSTRAINT crm_client_anonymization_requests_status_valid CHECK ((status = ANY (ARRAY['received'::text, 'identity_verification'::text, 'legal_review'::text, 'approved'::text, 'in_progress'::text, 'completed'::text, 'rejected'::text, 'cancelled'::text]))),
    CONSTRAINT crm_client_anonymization_requests_timeline_valid CHECK (((due_at >= requested_at) AND ((identity_verified_at IS NULL) = (identity_verified_by_user_id IS NULL)) AND ((approved_at IS NULL) = (approved_by_user_id IS NULL)) AND ((completed_at IS NULL) = (completed_by_user_id IS NULL)) AND ((status <> ALL (ARRAY['approved'::text, 'in_progress'::text, 'completed'::text])) OR ((identity_verified_at IS NOT NULL) AND (approved_at IS NOT NULL))) AND ((status <> 'completed'::text) OR (completed_at IS NOT NULL))))
);


--
-- Name: TABLE crm_client_anonymization_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_client_anonymization_requests IS 'Compliance workflow for client data-erasure requests. Actual anonymization requires a separately authorized execution path.';


--
-- Name: COLUMN crm_client_anonymization_requests.request_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_client_anonymization_requests.request_number IS 'Organization-scoped technical reference; it must not contain client PII.';


--
-- Name: COLUMN crm_client_anonymization_requests.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_client_anonymization_requests.metadata IS 'Technical workflow metadata only. Do not duplicate client PII in this field.';


--
-- Name: crm_client_consent_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_client_consent_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid NOT NULL,
    subject_person_id uuid NOT NULL,
    definition_id uuid NOT NULL,
    definition_version_id uuid NOT NULL,
    decision text NOT NULL,
    contact_value text,
    source text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    recorded_by_user_id uuid,
    evidence_reference text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_client_consent_events_actor_shape CHECK ((((source = 'booking_widget'::text) AND (recorded_by_user_id IS NULL)) OR ((source <> 'booking_widget'::text) AND (recorded_by_user_id IS NOT NULL)))),
    CONSTRAINT crm_client_consent_events_decision_check CHECK ((decision = ANY (ARRAY['granted'::text, 'declined'::text, 'withdrawn'::text]))),
    CONSTRAINT crm_client_consent_events_source_check CHECK ((source = ANY (ARRAY['client_creation'::text, 'client_card'::text, 'import'::text, 'api'::text, 'booking_widget'::text])))
);


--
-- Name: crm_client_people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_client_people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid NOT NULL,
    role text DEFAULT 'primary'::text NOT NULL,
    first_name text,
    last_name text,
    display_name text NOT NULL,
    email text,
    phone text,
    pesel text,
    date_of_birth date,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email_normalized text GENERATED ALWAYS AS (lower(NULLIF(btrim(email), ''::text))) STORED,
    phone_normalized text GENERATED ALWAYS AS (NULLIF(regexp_replace(COALESCE(phone, ''::text), '[^0-9]+'::text, ''::text, 'g'::text), ''::text)) STORED
);


--
-- Name: crm_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    owner_user_id uuid,
    display_name text NOT NULL,
    status_code text DEFAULT 'lead'::text NOT NULL,
    lead_source text,
    primary_email text,
    primary_phone text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    primary_email_normalized text GENERATED ALWAYS AS (lower(NULLIF(btrim(primary_email), ''::text))) STORED,
    primary_phone_normalized text GENERATED ALWAYS AS (NULLIF(regexp_replace(COALESCE(primary_phone, ''::text), '[^0-9]+'::text, ''::text, 'g'::text), ''::text)) STORED,
    search_text text DEFAULT ''::text NOT NULL,
    search_vector tsvector DEFAULT ''::tsvector NOT NULL
);


--
-- Name: crm_consent_definition_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_consent_definition_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    definition_id uuid NOT NULL,
    version integer NOT NULL,
    internal_name text NOT NULL,
    display_title text NOT NULL,
    content text NOT NULL,
    purpose text NOT NULL,
    channel text NOT NULL,
    legal_basis text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    language_code text DEFAULT 'pl'::text NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    change_note text,
    content_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(((((((((((display_title || chr(31)) || content) || chr(31)) || purpose) || chr(31)) || channel) || chr(31)) || legal_basis) || chr(31)) || language_code), 'sha256'::text), 'hex'::text)) STORED,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_required boolean DEFAULT false NOT NULL,
    CONSTRAINT crm_consent_definition_versions_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text, 'phone'::text, 'messaging'::text, 'other'::text]))),
    CONSTRAINT crm_consent_definition_versions_content_check CHECK ((btrim(content) <> ''::text)),
    CONSTRAINT crm_consent_definition_versions_display_title_check CHECK ((btrim(display_title) <> ''::text)),
    CONSTRAINT crm_consent_definition_versions_internal_name_check CHECK ((btrim(internal_name) <> ''::text)),
    CONSTRAINT crm_consent_definition_versions_language_code_check CHECK ((language_code ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)),
    CONSTRAINT crm_consent_definition_versions_legal_basis_check CHECK ((btrim(legal_basis) <> ''::text)),
    CONSTRAINT crm_consent_definition_versions_purpose_check CHECK ((btrim(purpose) <> ''::text)),
    CONSTRAINT crm_consent_definition_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))),
    CONSTRAINT crm_consent_definition_versions_version_check CHECK ((version > 0)),
    CONSTRAINT crm_consent_versions_effective_range_check CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))
);


--
-- Name: crm_consent_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_consent_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code text NOT NULL,
    context text DEFAULT 'client_creation'::text NOT NULL,
    current_version_id uuid NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_consent_definitions_code_check CHECK ((code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'::text)),
    CONSTRAINT crm_consent_definitions_context_check CHECK ((context = 'client_creation'::text))
);


--
-- Name: crm_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    client_id uuid,
    case_id uuid,
    case_item_id uuid,
    submission_id uuid,
    document_type text DEFAULT 'other'::text NOT NULL,
    name text NOT NULL,
    status_code text DEFAULT 'missing'::text NOT NULL,
    storage_bucket text,
    storage_path text,
    received_at timestamp with time zone,
    verified_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    uploaded_by_user_id uuid,
    mime_type text,
    size_bytes bigint,
    sha256 text,
    omnisearch_text text DEFAULT ''::text NOT NULL,
    omnisearch_vector tsvector DEFAULT ''::tsvector NOT NULL,
    CONSTRAINT crm_documents_case_file_integrity_check CHECK (((storage_bucket <> 'crm-case-documents'::text) OR ((case_id IS NOT NULL) AND (uploaded_by_user_id IS NOT NULL) AND (mime_type IS NOT NULL) AND (size_bytes IS NOT NULL) AND (sha256 IS NOT NULL) AND (storage_path ~~ ((((organization_id)::text || '/'::text) || (case_id)::text) || '/%'::text))))),
    CONSTRAINT crm_documents_check CHECK ((num_nonnulls(client_id, case_id, case_item_id, submission_id) >= 1)),
    CONSTRAINT crm_documents_mime_type_check CHECK (((mime_type IS NULL) OR (mime_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text])))),
    CONSTRAINT crm_documents_sha256_check CHECK (((sha256 IS NULL) OR (sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT crm_documents_size_bytes_check CHECK (((size_bytes IS NULL) OR ((size_bytes >= 1) AND (size_bytes <= 26214400)))),
    CONSTRAINT crm_documents_storage_pair_check CHECK (((storage_bucket IS NULL) = (storage_path IS NULL)))
);


--
-- Name: COLUMN crm_documents.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_documents.metadata IS 'Non-authoritative upload context; uploadedForOfferId may record the offer used to validate document_type.';


--
-- Name: crm_eve_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_eve_sessions (
    session_id text NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_eve_sessions_session_id_check CHECK (((btrim(session_id) <> ''::text) AND (length(session_id) <= 256)))
);


--
-- Name: TABLE crm_eve_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_eve_sessions IS 'Ownership registry for durable Eve sessions used by the authenticated CRM assistant.';


--
-- Name: crm_item_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_item_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    case_item_id uuid NOT NULL,
    provider_id uuid,
    status_code text DEFAULT 'draft'::text NOT NULL,
    external_reference text,
    submitted_at timestamp with time zone,
    decision_at timestamp with time zone,
    offered_amount numeric(14,2),
    premium_amount numeric(14,2),
    currency character(3) DEFAULT 'PLN'::bpchar NOT NULL,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    omnisearch_text text DEFAULT ''::text NOT NULL,
    omnisearch_vector tsvector DEFAULT ''::tsvector NOT NULL,
    CONSTRAINT crm_item_submissions_offered_amount_check CHECK (((offered_amount IS NULL) OR (offered_amount >= (0)::numeric))),
    CONSTRAINT crm_item_submissions_premium_amount_check CHECK (((premium_amount IS NULL) OR (premium_amount >= (0)::numeric)))
);


--
-- Name: crm_product_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_product_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    domain text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_product_types_check CHECK (((is_system AND (organization_id IS NULL)) OR ((NOT is_system) AND (organization_id IS NOT NULL)))),
    CONSTRAINT crm_product_types_domain_check CHECK ((domain = ANY (ARRAY['credit'::text, 'insurance'::text, 'real_estate'::text, 'other'::text])))
);


--
-- Name: crm_properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_properties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    case_id uuid,
    case_item_id uuid,
    address text NOT NULL,
    city text,
    postal_code text,
    property_type text,
    market_type text,
    price_amount numeric(14,2),
    currency character(3) DEFAULT 'PLN'::bpchar NOT NULL,
    area_m2 numeric(10,2),
    rooms numeric(4,1),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    listing_title text,
    description text,
    source_url text,
    source_published_at timestamp with time zone,
    imported_at timestamp with time zone,
    appraisal_value_amount numeric(14,2),
    CONSTRAINT crm_properties_appraisal_value_amount_check CHECK (((appraisal_value_amount IS NULL) OR (appraisal_value_amount > (0)::numeric))),
    CONSTRAINT crm_properties_area_m2_check CHECK (((area_m2 IS NULL) OR (area_m2 >= (0)::numeric))),
    CONSTRAINT crm_properties_check CHECK ((num_nonnulls(case_id, case_item_id) >= 1)),
    CONSTRAINT crm_properties_description_length_check CHECK (((description IS NULL) OR (char_length(description) <= 50000))),
    CONSTRAINT crm_properties_import_source_check CHECK (((imported_at IS NULL) OR (source_url IS NOT NULL))),
    CONSTRAINT crm_properties_listing_title_length_check CHECK (((listing_title IS NULL) OR (char_length(listing_title) <= 500))),
    CONSTRAINT crm_properties_market_type_check CHECK (((market_type IS NULL) OR (market_type = ANY (ARRAY['primary'::text, 'secondary'::text, 'rental'::text, 'other'::text])))),
    CONSTRAINT crm_properties_price_amount_check CHECK (((price_amount IS NULL) OR (price_amount >= (0)::numeric))),
    CONSTRAINT crm_properties_rooms_check CHECK (((rooms IS NULL) OR (rooms >= (0)::numeric))),
    CONSTRAINT crm_properties_source_url_check CHECK (((source_url IS NULL) OR ((char_length(source_url) <= 4096) AND (source_url ~* '^https?://'::text))))
);


--
-- Name: COLUMN crm_properties.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_properties.metadata IS 'Versioned, non-authoritative import provenance and additional listing attributes.';


--
-- Name: COLUMN crm_properties.appraisal_value_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_properties.appraisal_value_amount IS 'Independent appraised collateral value. Never inferred from the purchase price.';


--
-- Name: crm_property_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_property_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    property_id uuid NOT NULL,
    storage_bucket text DEFAULT 'crm-property-images'::text NOT NULL,
    storage_path text NOT NULL,
    source_url text,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    width_px integer,
    height_px integer,
    sort_order integer DEFAULT 0 NOT NULL,
    alt_text text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_property_images_alt_text_length_check CHECK (((alt_text IS NULL) OR (char_length(alt_text) <= 500))),
    CONSTRAINT crm_property_images_bucket_check CHECK ((storage_bucket = 'crm-property-images'::text)),
    CONSTRAINT crm_property_images_dimensions_check CHECK ((((width_px IS NULL) OR ((width_px >= 1) AND (width_px <= 20000))) AND ((height_px IS NULL) OR ((height_px >= 1) AND (height_px <= 20000))))),
    CONSTRAINT crm_property_images_metadata_object_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT crm_property_images_mime_type_check CHECK ((mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]))),
    CONSTRAINT crm_property_images_path_check CHECK ((storage_path ~~ ((((((organization_id)::text || '/'::text) || (case_id)::text) || '/'::text) || (property_id)::text) || '/%'::text))),
    CONSTRAINT crm_property_images_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT crm_property_images_size_check CHECK (((size_bytes >= 1) AND (size_bytes <= 8388608))),
    CONSTRAINT crm_property_images_sort_order_check CHECK ((sort_order >= 0)),
    CONSTRAINT crm_property_images_source_url_check CHECK (((source_url IS NULL) OR ((char_length(source_url) <= 4096) AND (source_url ~* '^https?://'::text))))
);


--
-- Name: TABLE crm_property_images; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_property_images IS 'Private, immutable image assets imported for a CRM property.';


--
-- Name: crm_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    kind text DEFAULT 'other'::text NOT NULL,
    name text NOT NULL,
    tax_id text,
    contact_email text,
    contact_phone text,
    website text,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_providers_kind_check CHECK ((kind = ANY (ARRAY['bank'::text, 'insurer'::text, 'agency'::text, 'developer'::text, 'broker'::text, 'other'::text])))
);


--
-- Name: crm_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    assignee_user_id uuid,
    client_id uuid,
    case_id uuid,
    case_item_id uuid,
    title text NOT NULL,
    description text,
    status_code text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    due_at timestamp with time zone,
    completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    delegator_user_id uuid,
    delegation_status text DEFAULT 'not_delegated'::text NOT NULL,
    data_access_scope text[] DEFAULT ARRAY['case_summary'::text] NOT NULL,
    delegated_at timestamp with time zone,
    responded_at timestamp with time zone,
    accepted_at timestamp with time zone,
    rejected_at timestamp with time zone,
    rejection_reason text,
    cancelled_at timestamp with time zone,
    idempotency_key uuid,
    idempotency_fingerprint text,
    omnisearch_text text DEFAULT ''::text NOT NULL,
    omnisearch_vector tsvector DEFAULT ''::tsvector NOT NULL,
    CONSTRAINT crm_tasks_data_access_scope_check CHECK ((((cardinality(data_access_scope) >= 1) AND (cardinality(data_access_scope) <= 7)) AND (data_access_scope <@ ARRAY['case_summary'::text, 'client_contact'::text, 'client_identity'::text, 'documents'::text, 'offers'::text, 'financial_data'::text, 'activities'::text]))),
    CONSTRAINT crm_tasks_delegated_completion_check CHECK (((delegation_status = 'not_delegated'::text) OR ((status_code = 'done'::text) AND (completed_at IS NOT NULL)) OR ((status_code <> 'done'::text) AND (completed_at IS NULL)))),
    CONSTRAINT crm_tasks_delegated_status_code_check CHECK (((delegation_status = 'not_delegated'::text) OR ((delegation_status = 'pending'::text) AND (status_code = 'open'::text)) OR ((delegation_status = 'accepted'::text) AND (status_code = ANY (ARRAY['open'::text, 'in_progress'::text, 'done'::text]))) OR ((delegation_status = ANY (ARRAY['rejected'::text, 'cancelled'::text])) AND (status_code = 'cancelled'::text)))),
    CONSTRAINT crm_tasks_delegation_response_check CHECK ((((delegation_status = ANY (ARRAY['not_delegated'::text, 'pending'::text])) AND (responded_at IS NULL) AND (accepted_at IS NULL) AND (rejected_at IS NULL) AND (cancelled_at IS NULL) AND (rejection_reason IS NULL)) OR ((delegation_status = 'accepted'::text) AND (responded_at IS NOT NULL) AND (accepted_at IS NOT NULL) AND (rejected_at IS NULL) AND (cancelled_at IS NULL) AND (rejection_reason IS NULL)) OR ((delegation_status = 'rejected'::text) AND (responded_at IS NOT NULL) AND (accepted_at IS NULL) AND (rejected_at IS NOT NULL) AND (cancelled_at IS NULL) AND (NULLIF(btrim(rejection_reason), ''::text) IS NOT NULL)) OR ((delegation_status = 'cancelled'::text) AND (rejected_at IS NULL) AND (cancelled_at IS NOT NULL) AND (rejection_reason IS NULL) AND (((accepted_at IS NULL) AND (responded_at IS NULL)) OR ((accepted_at IS NOT NULL) AND (responded_at = accepted_at)))))),
    CONSTRAINT crm_tasks_delegation_shape_check CHECK ((((delegation_status = 'not_delegated'::text) AND (delegator_user_id IS NULL) AND (delegated_at IS NULL) AND (responded_at IS NULL) AND (accepted_at IS NULL) AND (rejected_at IS NULL) AND (cancelled_at IS NULL) AND (rejection_reason IS NULL) AND (idempotency_key IS NULL) AND (idempotency_fingerprint IS NULL)) OR ((delegation_status <> 'not_delegated'::text) AND (delegator_user_id IS NOT NULL) AND (assignee_user_id IS NOT NULL) AND (assignee_user_id <> delegator_user_id) AND (case_id IS NOT NULL) AND (due_at IS NOT NULL) AND (delegated_at IS NOT NULL) AND (idempotency_key IS NOT NULL) AND (idempotency_fingerprint IS NOT NULL) AND (idempotency_fingerprint ~ '^[0-9a-f]{64}$'::text)))),
    CONSTRAINT crm_tasks_delegation_status_check CHECK ((delegation_status = ANY (ARRAY['not_delegated'::text, 'pending'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text]))),
    CONSTRAINT crm_tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])))
);


--
-- Name: COLUMN crm_tasks.delegation_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_tasks.delegation_status IS 'Acceptance lifecycle independent from task execution status_code.';


--
-- Name: COLUMN crm_tasks.data_access_scope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_tasks.data_access_scope IS 'Explicit categories of case data shared for this delegated task.';


--
-- Name: COLUMN crm_tasks.idempotency_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_tasks.idempotency_key IS 'Client-generated UUID used to safely retry task creation.';


--
-- Name: crm_workflow_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_workflow_statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    workflow_id uuid NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    color text DEFAULT 'neutral'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_initial boolean DEFAULT false NOT NULL,
    is_terminal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    scope text NOT NULL,
    domain text,
    code text NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_workflows_check CHECK (((is_system AND (organization_id IS NULL)) OR ((NOT is_system) AND (organization_id IS NOT NULL)))),
    CONSTRAINT crm_workflows_domain_check CHECK ((domain = ANY (ARRAY['credit'::text, 'insurance'::text, 'real_estate'::text, 'other'::text]))),
    CONSTRAINT crm_workflows_scope_check CHECK ((scope = ANY (ARRAY['case'::text, 'case_item'::text, 'submission'::text, 'settlement'::text])))
);


--
-- Name: expert_availability_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expert_availability_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    user_id uuid NOT NULL,
    local_date date NOT NULL,
    is_unavailable boolean DEFAULT false NOT NULL,
    starts_at time without time zone,
    ends_at time without time zone,
    availability_range int4range GENERATED ALWAYS AS (
CASE
    WHEN is_unavailable THEN int4range(0, 1440, '[)'::text)
    ELSE int4range(((EXTRACT(epoch FROM starts_at))::integer / 60), ((EXTRACT(epoch FROM ends_at))::integer / 60), '[)'::text)
END) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expert_availability_overrides_shape CHECK (((is_unavailable AND (starts_at IS NULL) AND (ends_at IS NULL)) OR ((NOT is_unavailable) AND (starts_at IS NOT NULL) AND (ends_at IS NOT NULL) AND (starts_at < ends_at) AND (EXTRACT(second FROM starts_at) = (0)::numeric) AND (EXTRACT(second FROM ends_at) = (0)::numeric))))
);


--
-- Name: expert_availability_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expert_availability_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    user_id uuid NOT NULL,
    weekday smallint NOT NULL,
    starts_at time without time zone NOT NULL,
    ends_at time without time zone NOT NULL,
    valid_from date,
    valid_until date,
    is_active boolean DEFAULT true NOT NULL,
    availability_range int4range GENERATED ALWAYS AS (int4range(((EXTRACT(epoch FROM starts_at))::integer / 60), ((EXTRACT(epoch FROM ends_at))::integer / 60), '[)'::text)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expert_availability_rules_valid_period CHECK (((starts_at < ends_at) AND (EXTRACT(second FROM starts_at) = (0)::numeric) AND (EXTRACT(second FROM ends_at) = (0)::numeric) AND ((valid_from IS NULL) OR (valid_until IS NULL) OR (valid_from <= valid_until)))),
    CONSTRAINT expert_availability_rules_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: COLUMN expert_availability_rules.weekday; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expert_availability_rules.weekday IS 'ISO weekday used by the UI: 0=Monday through 6=Sunday.';


--
-- Name: expert_brand_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expert_brand_profiles (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expert_name text DEFAULT ''::text NOT NULL,
    professional_title text DEFAULT 'Ekspert kredytowy'::text NOT NULL,
    tagline text DEFAULT ''::text NOT NULL,
    contact_email text DEFAULT ''::text NOT NULL,
    contact_phone text DEFAULT ''::text NOT NULL,
    website_url text DEFAULT ''::text NOT NULL,
    location text DEFAULT ''::text NOT NULL,
    bio text DEFAULT ''::text NOT NULL,
    specializations text[] DEFAULT '{}'::text[] NOT NULL,
    visual_style text DEFAULT 'minimal'::text NOT NULL,
    portrait_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expert_brand_profiles_lengths_check CHECK (((char_length(expert_name) <= 100) AND (char_length(professional_title) <= 100) AND (char_length(tagline) <= 140) AND (char_length(contact_email) <= 160) AND (char_length(contact_phone) <= 40) AND (char_length(website_url) <= 240) AND (char_length(location) <= 100) AND (char_length(bio) <= 800) AND (cardinality(specializations) <= 8))),
    CONSTRAINT expert_brand_profiles_portrait_path_check CHECK (((portrait_path IS NULL) OR (portrait_path ~~ ((((organization_id)::text || '/'::text) || (user_id)::text) || '/portrait/%'::text)))),
    CONSTRAINT expert_brand_profiles_visual_style_check CHECK ((visual_style = ANY (ARRAY['minimal'::text, 'editorial'::text, 'warm'::text])))
);


--
-- Name: TABLE expert_brand_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.expert_brand_profiles IS 'Expert profile content for materials. Product name, logos and visual tokens remain in organization_design_settings.';


--
-- Name: expert_time_off; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expert_time_off (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    expert_user_id uuid NOT NULL,
    kind text DEFAULT 'vacation'::text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    time_off_period tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)'::text)) STORED,
    timezone text NOT NULL,
    all_day boolean DEFAULT true NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_by_user_id uuid NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expert_time_off_all_day_check CHECK (all_day),
    CONSTRAINT expert_time_off_calendar_boundaries_check CHECK (((starts_at = ((((starts_at AT TIME ZONE timezone))::date)::timestamp without time zone AT TIME ZONE timezone)) AND (ends_at = ((((ends_at AT TIME ZONE timezone))::date)::timestamp without time zone AT TIME ZONE timezone)))),
    CONSTRAINT expert_time_off_cancellation_shape_check CHECK ((((status = 'active'::text) AND (cancelled_at IS NULL)) OR ((status = 'cancelled'::text) AND (cancelled_at IS NOT NULL)))),
    CONSTRAINT expert_time_off_kind_check CHECK ((kind = 'vacation'::text)),
    CONSTRAINT expert_time_off_notes_check CHECK (((notes IS NULL) OR (length(notes) <= 2000))),
    CONSTRAINT expert_time_off_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text]))),
    CONSTRAINT expert_time_off_timezone_check CHECK ((btrim(timezone) <> ''::text)),
    CONSTRAINT expert_time_off_valid_period_check CHECK ((starts_at < ends_at))
);


--
-- Name: TABLE expert_time_off; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.expert_time_off IS 'Native expert absences. Active rows reserve the expert globally through appointment_resource_reservations.';


--
-- Name: COLUMN expert_time_off.all_day; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expert_time_off.all_day IS 'Presentation intent. starts_at and ends_at remain authoritative half-open instants, including across DST changes.';


--
-- Name: external_busy_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_busy_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    calendar_id text NOT NULL,
    external_event_id text NOT NULL,
    busy_period tstzrange NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT external_busy_blocks_calendar_id_check CHECK ((btrim(calendar_id) <> ''::text)),
    CONSTRAINT external_busy_blocks_external_event_id_check CHECK ((btrim(external_event_id) <> ''::text)),
    CONSTRAINT external_busy_blocks_valid_period CHECK (((NOT isempty(busy_period)) AND (lower(busy_period) IS NOT NULL) AND (upper(busy_period) IS NOT NULL) AND lower_inc(busy_period) AND (NOT upper_inc(busy_period))))
);


--
-- Name: TABLE external_busy_blocks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.external_busy_blocks IS 'Privacy-minimized external availability cache: identifiers and half-open busy ranges only.';


--
-- Name: facilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    timezone text DEFAULT 'Europe/Warsaw'::text NOT NULL,
    address_line1 text,
    address_line2 text,
    postal_code text,
    city text,
    country_code text DEFAULT 'PL'::text NOT NULL,
    phone text,
    email text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    latitude double precision,
    longitude double precision,
    CONSTRAINT facilities_coordinates_pair_check CHECK (((latitude IS NULL) = (longitude IS NULL))),
    CONSTRAINT facilities_country_code_check CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT facilities_email_check CHECK (((email IS NULL) OR (email = lower(btrim(email))))),
    CONSTRAINT facilities_latitude_range_check CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)))),
    CONSTRAINT facilities_longitude_range_check CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))),
    CONSTRAINT facilities_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT facilities_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT facilities_timezone_check CHECK ((btrim(timezone) <> ''::text))
);


--
-- Name: COLUMN facilities.timezone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facilities.timezone IS 'IANA timezone used to interpret local recurring schedules; defaults to Europe/Warsaw.';


--
-- Name: COLUMN facilities.latitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facilities.latitude IS 'Optional WGS84 latitude published for directory map placement when paired with longitude.';


--
-- Name: COLUMN facilities.longitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facilities.longitude IS 'Optional WGS84 longitude published for directory map placement when paired with latitude.';


--
-- Name: facility_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    storage_bucket text DEFAULT 'facility-images'::text NOT NULL,
    storage_path text NOT NULL,
    original_filename text NOT NULL,
    mime_type text DEFAULT 'image/webp'::text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    width_px integer NOT NULL,
    height_px integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    alt_text text,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT facility_images_alt_text_length_check CHECK (((alt_text IS NULL) OR (char_length(alt_text) <= 500))),
    CONSTRAINT facility_images_bucket_check CHECK ((storage_bucket = 'facility-images'::text)),
    CONSTRAINT facility_images_dimensions_check CHECK ((((width_px >= 1) AND (width_px <= 2000)) AND ((height_px >= 1) AND (height_px <= 2000)))),
    CONSTRAINT facility_images_filename_length_check CHECK (((char_length(original_filename) >= 1) AND (char_length(original_filename) <= 255))),
    CONSTRAINT facility_images_mime_type_check CHECK ((mime_type = 'image/webp'::text)),
    CONSTRAINT facility_images_path_check CHECK ((storage_path ~~ ((((organization_id)::text || '/'::text) || (facility_id)::text) || '/%'::text))),
    CONSTRAINT facility_images_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT facility_images_size_check CHECK (((size_bytes >= 1) AND (size_bytes <= 8388608))),
    CONSTRAINT facility_images_sort_order_check CHECK ((sort_order >= 0))
);


--
-- Name: TABLE facility_images; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.facility_images IS 'Private, optimized presentation photos assigned to an organization facility.';


--
-- Name: facility_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_memberships (
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    is_bookable boolean DEFAULT true NOT NULL,
    booking_priority integer DEFAULT 100 NOT NULL,
    last_assigned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT facility_memberships_booking_priority_check CHECK (((booking_priority >= 0) AND (booking_priority <= 10000))),
    CONSTRAINT facility_memberships_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: facility_opening_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_opening_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    weekday smallint NOT NULL,
    opens_at time without time zone NOT NULL,
    closes_at time without time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    opening_range int4range GENERATED ALWAYS AS (int4range(((EXTRACT(epoch FROM opens_at))::integer / 60), ((EXTRACT(epoch FROM closes_at))::integer / 60), '[)'::text)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT facility_opening_hours_valid_period CHECK (((opens_at < closes_at) AND (EXTRACT(second FROM opens_at) = (0)::numeric) AND (EXTRACT(second FROM closes_at) = (0)::numeric))),
    CONSTRAINT facility_opening_hours_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: COLUMN facility_opening_hours.weekday; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facility_opening_hours.weekday IS 'ISO weekday used by the UI: 0=Monday through 6=Sunday.';


--
-- Name: facility_opening_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_opening_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    local_date date NOT NULL,
    is_closed boolean DEFAULT false NOT NULL,
    opens_at time without time zone,
    closes_at time without time zone,
    opening_range int4range GENERATED ALWAYS AS (
CASE
    WHEN is_closed THEN int4range(0, 1440, '[)'::text)
    ELSE int4range(((EXTRACT(epoch FROM opens_at))::integer / 60), ((EXTRACT(epoch FROM closes_at))::integer / 60), '[)'::text)
END) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT facility_opening_overrides_shape CHECK (((is_closed AND (opens_at IS NULL) AND (closes_at IS NULL)) OR ((NOT is_closed) AND (opens_at IS NOT NULL) AND (closes_at IS NOT NULL) AND (opens_at < closes_at) AND (EXTRACT(second FROM opens_at) = (0)::numeric) AND (EXTRACT(second FROM closes_at) = (0)::numeric))))
);


--
-- Name: facility_service_experts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_service_experts (
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    service_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: facility_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_services (
    organization_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    service_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mail_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    provider text DEFAULT 'google'::text NOT NULL,
    account_id text NOT NULL,
    account_email text NOT NULL,
    encrypted_access_token text,
    encrypted_refresh_token text,
    token_expires_at timestamp with time zone,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mail_connections_account_email_check CHECK (((btrim(account_email) <> ''::text) AND (account_email = lower(btrim(account_email))))),
    CONSTRAINT mail_connections_account_id_check CHECK ((btrim(account_id) <> ''::text)),
    CONSTRAINT mail_connections_provider_check CHECK ((provider = 'google'::text)),
    CONSTRAINT mail_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'error'::text, 'revoked'::text])))
);


--
-- Name: TABLE mail_connections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mail_connections IS 'Server-only, application-encrypted OAuth credentials for personal Gmail integrations.';


--
-- Name: mail_send_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_send_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    request_hash text NOT NULL,
    message_id_header text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    provider_message_id text,
    provider_thread_id text,
    attempts integer DEFAULT 1 NOT NULL,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mail_send_requests_attempts_check CHECK ((attempts >= 1)),
    CONSTRAINT mail_send_requests_message_id_header_check CHECK (((btrim(message_id_header) <> ''::text) AND (message_id_header !~ E'[\\r\\n]'::text))),
    CONSTRAINT mail_send_requests_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT mail_send_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'unknown'::text, 'failed'::text])))
);


--
-- Name: TABLE mail_send_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mail_send_requests IS 'Server-only Gmail send idempotency and delivery-state metadata; never stores recipients, subjects, bodies, or attachment filenames.';


--
-- Name: mortgage_bank_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_id uuid NOT NULL,
    value text NOT NULL,
    alias_type text NOT NULL,
    valid_from date,
    valid_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_bank_aliases_alias_type_check CHECK ((alias_type = ANY (ARRAY['former_name'::text, 'short_name'::text, 'legal_name'::text, 'former_domain'::text, 'search_term'::text]))),
    CONSTRAINT mortgage_bank_aliases_check CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT mortgage_bank_aliases_value_check CHECK (((btrim(value) <> ''::text) AND (char_length(value) <= 200)))
);


--
-- Name: mortgage_bank_file_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_file_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_key text NOT NULL,
    label text NOT NULL,
    icon text,
    sort_order integer DEFAULT 100 NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_bank_file_categories_key_format CHECK ((category_key ~ '^[a-z][a-z0-9_]{1,63}$'::text))
);


--
-- Name: mortgage_bank_file_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_file_chunks (
    id bigint NOT NULL,
    version_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    page_start integer,
    page_end integer,
    locator text,
    content text NOT NULL,
    token_count integer,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, COALESCE(content, ''::text))) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_bank_file_chunks_content_length CHECK (((char_length(content) >= 1) AND (char_length(content) <= 50000))),
    CONSTRAINT mortgage_bank_file_chunks_index_nonnegative CHECK ((chunk_index >= 0)),
    CONSTRAINT mortgage_bank_file_chunks_locator_length CHECK (((locator IS NULL) OR (char_length(locator) <= 500))),
    CONSTRAINT mortgage_bank_file_chunks_page_end CHECK (((page_end IS NULL) OR (page_start IS NULL) OR (page_end >= page_start))),
    CONSTRAINT mortgage_bank_file_chunks_page_start CHECK (((page_start IS NULL) OR (page_start > 0))),
    CONSTRAINT mortgage_bank_file_chunks_token_count CHECK (((token_count IS NULL) OR (token_count >= 0)))
);


--
-- Name: TABLE mortgage_bank_file_chunks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mortgage_bank_file_chunks IS 'Source-grounded searchable fragments with page/section locators.';


--
-- Name: mortgage_bank_file_chunks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_file_chunks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.mortgage_bank_file_chunks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: mortgage_bank_file_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_file_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chunk_id bigint NOT NULL,
    embedding_kind text DEFAULT 'content'::text NOT NULL,
    model text NOT NULL,
    dimensions integer NOT NULL,
    recipe_version text DEFAULT 'search-result-v1'::text NOT NULL,
    source_sha256 text NOT NULL,
    embedding extensions.vector(768) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_bank_file_embeddings_dimensions CHECK ((dimensions = 768)),
    CONSTRAINT mortgage_bank_file_embeddings_kind CHECK ((embedding_kind = ANY (ARRAY['content'::text, 'description'::text, 'page_multimodal'::text]))),
    CONSTRAINT mortgage_bank_file_embeddings_model_length CHECK (((char_length(model) >= 2) AND (char_length(model) <= 160))),
    CONSTRAINT mortgage_bank_file_embeddings_recipe_length CHECK (((char_length(recipe_version) >= 2) AND (char_length(recipe_version) <= 80))),
    CONSTRAINT mortgage_bank_file_embeddings_sha256 CHECK ((source_sha256 ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: TABLE mortgage_bank_file_embeddings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mortgage_bank_file_embeddings IS 'Optional Gemini Embedding 2 vectors. Original chunks remain the source of truth.';


--
-- Name: mortgage_bank_file_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_file_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    file_id uuid NOT NULL,
    version_id uuid,
    actor_user_id uuid,
    action text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_bank_file_events_action_length CHECK (((char_length(action) >= 2) AND (char_length(action) <= 100)))
);


--
-- Name: TABLE mortgage_bank_file_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mortgage_bank_file_events IS 'Append-only audit trail for repository mutations, previews and downloads.';


--
-- Name: mortgage_bank_file_processing_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_file_processing_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_id uuid NOT NULL,
    job_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_bank_file_processing_jobs_attempts CHECK (((attempts >= 0) AND (attempts <= 100))),
    CONSTRAINT mortgage_bank_file_processing_jobs_error_length CHECK (((last_error IS NULL) OR (char_length(last_error) <= 10000))),
    CONSTRAINT mortgage_bank_file_processing_jobs_status CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT mortgage_bank_file_processing_jobs_type CHECK ((job_type = ANY (ARRAY['extract'::text, 'describe'::text, 'embed'::text, 'refresh_source'::text])))
);


--
-- Name: mortgage_bank_file_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_file_products (
    file_id uuid NOT NULL,
    product_id uuid NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mortgage_bank_file_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_file_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    file_id uuid NOT NULL,
    version_number integer NOT NULL,
    version_label text NOT NULL,
    storage_path text NOT NULL,
    original_file_name text NOT NULL,
    mime_type text NOT NULL,
    mime_group text NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    source_download_url text,
    resolved_download_url text,
    source_etag text,
    source_last_modified text,
    effective_from date,
    effective_to date,
    published_at date,
    status text DEFAULT 'processing'::text NOT NULL,
    extraction_status text DEFAULT 'pending'::text NOT NULL,
    embedding_status text DEFAULT 'pending'::text NOT NULL,
    page_count integer,
    extracted_text text,
    generated_description text,
    extraction_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    embedding_model text,
    embedding_dimensions integer,
    retrieved_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_bank_file_versions_effective_range CHECK (((effective_to IS NULL) OR (effective_from IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT mortgage_bank_file_versions_embedding_dimensions CHECK (((embedding_dimensions IS NULL) OR ((embedding_dimensions >= 128) AND (embedding_dimensions <= 3072)))),
    CONSTRAINT mortgage_bank_file_versions_embedding_status CHECK ((embedding_status = ANY (ARRAY['disabled'::text, 'pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT mortgage_bank_file_versions_extraction_status CHECK ((extraction_status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'unsupported'::text]))),
    CONSTRAINT mortgage_bank_file_versions_label_length CHECK (((char_length(btrim(version_label)) >= 1) AND (char_length(btrim(version_label)) <= 40))),
    CONSTRAINT mortgage_bank_file_versions_mime_group CHECK ((mime_group = ANY (ARRAY['pdf'::text, 'spreadsheet'::text, 'document'::text, 'image'::text, 'other'::text]))),
    CONSTRAINT mortgage_bank_file_versions_mime_length CHECK (((char_length(mime_type) >= 3) AND (char_length(mime_type) <= 255))),
    CONSTRAINT mortgage_bank_file_versions_name_length CHECK (((char_length(original_file_name) >= 1) AND (char_length(original_file_name) <= 500))),
    CONSTRAINT mortgage_bank_file_versions_number_positive CHECK ((version_number > 0)),
    CONSTRAINT mortgage_bank_file_versions_page_count CHECK (((page_count IS NULL) OR ((page_count >= 1) AND (page_count <= 10000)))),
    CONSTRAINT mortgage_bank_file_versions_path_length CHECK (((char_length(storage_path) >= 5) AND (char_length(storage_path) <= 1024))),
    CONSTRAINT mortgage_bank_file_versions_sha256 CHECK ((checksum_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT mortgage_bank_file_versions_size CHECK (((size_bytes > 0) AND (size_bytes <= 52428800))),
    CONSTRAINT mortgage_bank_file_versions_status CHECK ((status = ANY (ARRAY['current'::text, 'draft'::text, 'expired'::text, 'archived'::text, 'processing'::text, 'failed'::text])))
);


--
-- Name: TABLE mortgage_bank_file_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mortgage_bank_file_versions IS 'Immutable binary revisions plus extraction and embedding processing state.';


--
-- Name: mortgage_bank_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_id uuid NOT NULL,
    category_id uuid,
    title text NOT NULL,
    description text,
    source_page_url text,
    current_version_id uuid,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT mortgage_bank_files_description_length CHECK (((description IS NULL) OR (char_length(description) <= 10000))),
    CONSTRAINT mortgage_bank_files_source_page_url_length CHECK (((source_page_url IS NULL) OR (char_length(source_page_url) <= 4096))),
    CONSTRAINT mortgage_bank_files_title_length CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 500)))
);


--
-- Name: TABLE mortgage_bank_files; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mortgage_bank_files IS 'Global logical files owned by a financial institution; binaries and versions are stored separately.';


--
-- Name: mortgage_bank_override_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_override_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    override_id uuid,
    organization_id uuid NOT NULL,
    bank_id uuid NOT NULL,
    revision integer NOT NULL,
    action text NOT NULL,
    is_enabled boolean NOT NULL,
    custom_name text,
    custom_website_url text,
    logo_path text,
    notes text,
    changed_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_bank_override_revisions_action_check CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'reset'::text]))),
    CONSTRAINT mortgage_bank_override_revisions_revision_check CHECK ((revision > 0))
);


--
-- Name: mortgage_bank_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_bank_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    bank_id uuid NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    custom_name text,
    custom_website_url text,
    logo_path text,
    notes text,
    revision integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_bank_overrides_check CHECK (((logo_path IS NULL) OR ((char_length(logo_path) <= 500) AND (logo_path ~~ ((((organization_id)::text || '/'::text) || (bank_id)::text) || '/%'::text))))),
    CONSTRAINT mortgage_bank_overrides_custom_name_check CHECK (((custom_name IS NULL) OR (btrim(custom_name) <> ''::text))),
    CONSTRAINT mortgage_bank_overrides_custom_name_check1 CHECK (((custom_name IS NULL) OR (char_length(custom_name) <= 200))),
    CONSTRAINT mortgage_bank_overrides_custom_website_url_check CHECK (((custom_website_url IS NULL) OR (btrim(custom_website_url) <> ''::text))),
    CONSTRAINT mortgage_bank_overrides_custom_website_url_check1 CHECK (((custom_website_url IS NULL) OR ((char_length(custom_website_url) <= 500) AND (custom_website_url ~* '^https?://[^[:space:]]+$'::text)))),
    CONSTRAINT mortgage_bank_overrides_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 4000))),
    CONSTRAINT mortgage_bank_overrides_revision_check CHECK ((revision > 0))
);


--
-- Name: mortgage_banks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_banks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    website_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    logo_url text,
    logo_background_color text,
    CONSTRAINT mortgage_banks_logo_background_color_check CHECK (((logo_background_color IS NULL) OR (logo_background_color ~ '^#[0-9A-Fa-f]{6}$'::text))),
    CONSTRAINT mortgage_banks_logo_url_check CHECK (((logo_url IS NULL) OR ((char_length(logo_url) <= 1000) AND (logo_url ~* '^https://[^[:space:]]+$'::text)))),
    CONSTRAINT mortgage_banks_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT mortgage_banks_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


--
-- Name: mortgage_capacity_setting_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_capacity_setting_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    revision integer NOT NULL,
    action text NOT NULL,
    settings jsonb NOT NULL,
    changed_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_capacity_setting_revisions_action_check CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'reset'::text]))),
    CONSTRAINT mortgage_capacity_setting_revisions_revision_check CHECK ((revision > 0)),
    CONSTRAINT mortgage_capacity_setting_revisions_settings_check CHECK ((jsonb_typeof(settings) = 'object'::text))
);


--
-- Name: mortgage_capacity_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_capacity_settings (
    organization_id uuid NOT NULL,
    policy_as_of date NOT NULL,
    minimum_social_as_of date NOT NULL,
    nbp_reference_rate_as_of date NOT NULL,
    dsti_limit_pct numeric(5,2) NOT NULL,
    income_buffer_pct numeric(5,2) NOT NULL,
    credit_limit_monthly_charge_pct numeric(5,2) NOT NULL,
    max_ltv_pct numeric(5,2) NOT NULL,
    default_interest_rate_pct numeric(6,3) NOT NULL,
    default_interest_type text NOT NULL,
    default_fixed_rate_period_months integer NOT NULL,
    nbp_reference_rate_pct numeric(6,3) NOT NULL,
    variable_rate_volatility_buffer_pct numeric(6,3) NOT NULL,
    minimum_social_1_person numeric(12,2) NOT NULL,
    minimum_social_2_people numeric(12,2) NOT NULL,
    minimum_social_3_people numeric(12,2) NOT NULL,
    minimum_social_4_people numeric(12,2) NOT NULL,
    minimum_social_5_people numeric(12,2) NOT NULL,
    minimum_social_additional_person numeric(12,2) NOT NULL,
    notes text,
    revision integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_capacity_settings_credit_limit_monthly_charge_pc_check CHECK (((credit_limit_monthly_charge_pct >= (0)::numeric) AND (credit_limit_monthly_charge_pct <= (100)::numeric))),
    CONSTRAINT mortgage_capacity_settings_default_fixed_rate_period_mont_check CHECK (((default_fixed_rate_period_months >= 60) AND (default_fixed_rate_period_months <= 420))),
    CONSTRAINT mortgage_capacity_settings_default_interest_rate_pct_check CHECK (((default_interest_rate_pct >= (0)::numeric) AND (default_interest_rate_pct <= (50)::numeric))),
    CONSTRAINT mortgage_capacity_settings_default_interest_type_check CHECK ((default_interest_type = ANY (ARRAY['periodically_fixed'::text, 'variable'::text, 'fixed_for_term'::text]))),
    CONSTRAINT mortgage_capacity_settings_dsti_limit_pct_check CHECK (((dsti_limit_pct > (0)::numeric) AND (dsti_limit_pct <= (100)::numeric))),
    CONSTRAINT mortgage_capacity_settings_income_buffer_pct_check CHECK (((income_buffer_pct >= (0)::numeric) AND (income_buffer_pct <= (50)::numeric))),
    CONSTRAINT mortgage_capacity_settings_max_ltv_pct_check CHECK (((max_ltv_pct > (0)::numeric) AND (max_ltv_pct <= (80)::numeric))),
    CONSTRAINT mortgage_capacity_settings_minimum_social_1_person_check CHECK ((minimum_social_1_person >= (0)::numeric)),
    CONSTRAINT mortgage_capacity_settings_minimum_social_2_people_check CHECK ((minimum_social_2_people >= (0)::numeric)),
    CONSTRAINT mortgage_capacity_settings_minimum_social_3_people_check CHECK ((minimum_social_3_people >= (0)::numeric)),
    CONSTRAINT mortgage_capacity_settings_minimum_social_4_people_check CHECK ((minimum_social_4_people >= (0)::numeric)),
    CONSTRAINT mortgage_capacity_settings_minimum_social_5_people_check CHECK ((minimum_social_5_people >= (0)::numeric)),
    CONSTRAINT mortgage_capacity_settings_minimum_social_additional_pers_check CHECK ((minimum_social_additional_person >= (0)::numeric)),
    CONSTRAINT mortgage_capacity_settings_nbp_reference_rate_pct_check CHECK (((nbp_reference_rate_pct >= (0)::numeric) AND (nbp_reference_rate_pct <= (30)::numeric))),
    CONSTRAINT mortgage_capacity_settings_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 4000))),
    CONSTRAINT mortgage_capacity_settings_revision_check CHECK ((revision > 0)),
    CONSTRAINT mortgage_capacity_sigma_check CHECK ((variable_rate_volatility_buffer_pct = ANY (ARRAY[(0)::numeric, 1.5]))),
    CONSTRAINT mortgage_capacity_social_amounts_upper_bound CHECK (((minimum_social_1_person <= (100000)::numeric) AND (minimum_social_2_people <= (100000)::numeric) AND (minimum_social_3_people <= (100000)::numeric) AND (minimum_social_4_people <= (100000)::numeric) AND (minimum_social_5_people <= (100000)::numeric) AND (minimum_social_additional_person <= (100000)::numeric)))
);


--
-- Name: mortgage_catalog_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_catalog_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_id uuid,
    product_id uuid,
    draft_id uuid,
    product_version_id uuid,
    event_type text NOT NULL,
    actor_user_id uuid,
    revision_before bigint,
    revision_after bigint,
    content_sha256_before text,
    content_sha256_after text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_catalog_events_after_hash_check CHECK (((content_sha256_after IS NULL) OR (content_sha256_after ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT mortgage_catalog_events_before_hash_check CHECK (((content_sha256_before IS NULL) OR (content_sha256_before ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT mortgage_catalog_events_event_type_check CHECK ((event_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'::text)),
    CONSTRAINT mortgage_catalog_events_metadata_object_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);


--
-- Name: COLUMN mortgage_catalog_events.draft_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mortgage_catalog_events.draft_id IS 'Stable audit identifier, intentionally not a foreign key because successful publication deletes the draft.';


--
-- Name: mortgage_document_template_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_document_template_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    action text NOT NULL,
    revision bigint NOT NULL,
    template_json jsonb NOT NULL,
    validation_report jsonb NOT NULL,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_document_template_revisions_action_check CHECK ((action = ANY (ARRAY['draft_saved'::text, 'published'::text]))),
    CONSTRAINT mortgage_document_template_revisions_revision_check CHECK ((revision > 0)),
    CONSTRAINT mortgage_document_template_revisions_template_json_check CHECK ((jsonb_typeof(template_json) = 'object'::text)),
    CONSTRAINT mortgage_document_template_revisions_validation_report_check CHECK ((jsonb_typeof(validation_report) = 'object'::text))
);


--
-- Name: TABLE mortgage_document_template_revisions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mortgage_document_template_revisions IS 'Immutable audit snapshots created for every draft save and publication.';


--
-- Name: mortgage_document_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_document_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_id uuid NOT NULL,
    template_key text NOT NULL,
    label text NOT NULL,
    source_file_name text NOT NULL,
    source_sha256 text NOT NULL,
    registry_version integer NOT NULL,
    draft_json jsonb,
    draft_validation_report jsonb,
    draft_revision bigint DEFAULT 0 NOT NULL,
    draft_updated_at timestamp with time zone,
    draft_updated_by_user_id uuid,
    active_json jsonb,
    active_validation_report jsonb,
    active_revision bigint DEFAULT 0 NOT NULL,
    active_published_at timestamp with time zone,
    active_published_by_user_id uuid,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_published_revision_id uuid,
    CONSTRAINT mortgage_document_templates_active_object_check CHECK (((active_json IS NULL) OR (jsonb_typeof(active_json) = 'object'::text))),
    CONSTRAINT mortgage_document_templates_active_revision_check CHECK ((active_revision >= 0)),
    CONSTRAINT mortgage_document_templates_active_state_check CHECK ((((active_revision = 0) AND (active_json IS NULL) AND (active_validation_report IS NULL) AND (active_published_at IS NULL)) OR ((active_revision > 0) AND (active_json IS NOT NULL) AND (active_validation_report IS NOT NULL) AND (active_published_at IS NOT NULL)))),
    CONSTRAINT mortgage_document_templates_active_validation_object_check CHECK (((active_validation_report IS NULL) OR (jsonb_typeof(active_validation_report) = 'object'::text))),
    CONSTRAINT mortgage_document_templates_current_revision_state_check CHECK ((((active_revision = 0) AND (current_published_revision_id IS NULL)) OR ((active_revision > 0) AND (current_published_revision_id IS NOT NULL)))),
    CONSTRAINT mortgage_document_templates_draft_object_check CHECK (((draft_json IS NULL) OR (jsonb_typeof(draft_json) = 'object'::text))),
    CONSTRAINT mortgage_document_templates_draft_revision_check CHECK ((draft_revision >= 0)),
    CONSTRAINT mortgage_document_templates_draft_state_check CHECK ((((draft_revision = 0) AND (draft_json IS NULL) AND (draft_validation_report IS NULL) AND (draft_updated_at IS NULL)) OR ((draft_revision > 0) AND (draft_json IS NOT NULL) AND (draft_validation_report IS NOT NULL) AND (draft_updated_at IS NOT NULL)))),
    CONSTRAINT mortgage_document_templates_draft_validation_object_check CHECK (((draft_validation_report IS NULL) OR (jsonb_typeof(draft_validation_report) = 'object'::text))),
    CONSTRAINT mortgage_document_templates_label_check CHECK ((btrim(label) <> ''::text)),
    CONSTRAINT mortgage_document_templates_registry_version_check CHECK ((registry_version > 0)),
    CONSTRAINT mortgage_document_templates_source_file_name_check CHECK ((btrim(source_file_name) <> ''::text)),
    CONSTRAINT mortgage_document_templates_source_sha256_check CHECK ((source_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT mortgage_document_templates_template_key_check CHECK ((template_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'::text))
);


--
-- Name: TABLE mortgage_document_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mortgage_document_templates IS 'Global, institution-owned PDF template drafts and explicitly published runtime configurations.';


--
-- Name: COLUMN mortgage_document_templates.active_json; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mortgage_document_templates.active_json IS 'Validated configuration used by Multiwniosek instead of the bundled code registry.';


--
-- Name: mortgage_product_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_product_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    base_version_id uuid,
    revision bigint DEFAULT 1 NOT NULL,
    draft_data jsonb NOT NULL,
    validation_report jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_product_drafts_data_object_check CHECK ((jsonb_typeof(draft_data) = 'object'::text)),
    CONSTRAINT mortgage_product_drafts_revision_check CHECK ((revision > 0)),
    CONSTRAINT mortgage_product_drafts_validation_object_check CHECK ((jsonb_typeof(validation_report) = 'object'::text))
);


--
-- Name: mortgage_product_override_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_product_override_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    override_id uuid,
    organization_id uuid NOT NULL,
    product_id uuid NOT NULL,
    revision integer NOT NULL,
    action text NOT NULL,
    is_enabled boolean NOT NULL,
    custom_name text,
    parameters jsonb NOT NULL,
    notes text,
    changed_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_product_override_revisions_action_check CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'reset'::text]))),
    CONSTRAINT mortgage_product_override_revisions_revision_check CHECK ((revision > 0))
);


--
-- Name: mortgage_product_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_product_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    product_id uuid NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    custom_name text,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    revision integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_product_overrides_custom_name_check CHECK (((custom_name IS NULL) OR (btrim(custom_name) <> ''::text))),
    CONSTRAINT mortgage_product_overrides_parameters_allowed_keys_check CHECK (((parameters - ARRAY['effective_from'::text, 'effective_to'::text, 'calculation_date'::text, 'data_status'::text, 'completeness_score'::text, 'interest_type'::text, 'fixed_rate_pct'::text, 'fixed_period_months'::text, 'margin_pct'::text, 'reference_rate_code'::text, 'reference_rate_pct'::text, 'reference_rate_as_of'::text, 'representative_apr_pct'::text, 'min_amount'::text, 'max_amount'::text, 'min_term_months'::text, 'max_term_months'::text, 'max_ltv_pct'::text, 'is_eco'::text, 'cost_rules'::text, 'requirements'::text, 'document_requirements'::text, 'multiform_template_ids'::text, 'representative_example'::text, 'assumptions'::text, 'unknown_fields'::text]) = '{}'::jsonb)),
    CONSTRAINT mortgage_product_overrides_parameters_check CHECK ((jsonb_typeof(parameters) = 'object'::text)),
    CONSTRAINT mortgage_product_overrides_revision_check CHECK ((revision > 0))
);


--
-- Name: mortgage_product_version_document_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_product_version_document_templates (
    product_version_id uuid NOT NULL,
    template_revision_id uuid NOT NULL,
    requirement_code text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_product_version_document_templa_requirement_code_check CHECK ((requirement_code ~ '^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$'::text))
);


--
-- Name: TABLE mortgage_product_version_document_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.mortgage_product_version_document_templates IS 'Pins a product version to an immutable published PDF template revision.';


--
-- Name: mortgage_product_version_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_product_version_sources (
    product_version_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    source_role text DEFAULT 'primary'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_product_version_sources_source_role_check CHECK ((source_role = ANY (ARRAY['primary'::text, 'pricing'::text, 'eligibility'::text, 'costs'::text, 'documents'::text, 'legal'::text, 'general'::text, 'representative_example'::text, 'other'::text])))
);


--
-- Name: mortgage_product_version_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_product_version_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_version_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    min_amount numeric(14,2),
    max_amount numeric(14,2),
    min_term_months integer,
    max_term_months integer,
    min_ltv_pct numeric(7,4),
    max_ltv_pct numeric(7,4),
    interest_type text NOT NULL,
    fixed_rate_pct numeric(8,5),
    fixed_period_months integer,
    margin_pct numeric(8,5),
    reference_rate_code text,
    reference_rate_pct numeric(8,5),
    reference_rate_as_of date,
    representative_apr_pct numeric(8,5),
    calculation_readiness text DEFAULT 'complete'::text NOT NULL,
    pricing_config jsonb NOT NULL,
    eligibility_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_product_version_variants_amount_range_check CHECK (((max_amount IS NULL) OR (min_amount IS NULL) OR (max_amount >= min_amount))),
    CONSTRAINT mortgage_product_version_variants_calculation_readiness_check CHECK ((calculation_readiness = ANY (ARRAY['complete'::text, 'partial'::text, 'unsupported'::text]))),
    CONSTRAINT mortgage_product_version_variants_code_check CHECK ((code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'::text)),
    CONSTRAINT mortgage_product_version_variants_eligibility_object_check CHECK ((jsonb_typeof(eligibility_config) = 'object'::text)),
    CONSTRAINT mortgage_product_version_variants_fixed_period_months_check CHECK (((fixed_period_months IS NULL) OR (fixed_period_months > 0))),
    CONSTRAINT mortgage_product_version_variants_interest_type_check CHECK ((interest_type = ANY (ARRAY['fixed_periodic'::text, 'variable'::text, 'mixed'::text]))),
    CONSTRAINT mortgage_product_version_variants_ltv_range_check CHECK (((max_ltv_pct IS NULL) OR (min_ltv_pct IS NULL) OR (max_ltv_pct >= min_ltv_pct))),
    CONSTRAINT mortgage_product_version_variants_max_amount_check CHECK (((max_amount IS NULL) OR (max_amount >= (0)::numeric))),
    CONSTRAINT mortgage_product_version_variants_max_ltv_pct_check CHECK (((max_ltv_pct IS NULL) OR ((max_ltv_pct >= (0)::numeric) AND (max_ltv_pct <= (200)::numeric)))),
    CONSTRAINT mortgage_product_version_variants_max_term_months_check CHECK (((max_term_months IS NULL) OR (max_term_months > 0))),
    CONSTRAINT mortgage_product_version_variants_min_amount_check CHECK (((min_amount IS NULL) OR (min_amount >= (0)::numeric))),
    CONSTRAINT mortgage_product_version_variants_min_ltv_pct_check CHECK (((min_ltv_pct IS NULL) OR ((min_ltv_pct >= (0)::numeric) AND (min_ltv_pct <= (200)::numeric)))),
    CONSTRAINT mortgage_product_version_variants_min_term_months_check CHECK (((min_term_months IS NULL) OR (min_term_months > 0))),
    CONSTRAINT mortgage_product_version_variants_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT mortgage_product_version_variants_pricing_object_check CHECK ((jsonb_typeof(pricing_config) = 'object'::text)),
    CONSTRAINT mortgage_product_version_variants_term_range_check CHECK (((max_term_months IS NULL) OR (min_term_months IS NULL) OR (max_term_months >= min_term_months)))
);


--
-- Name: mortgage_product_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_product_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_key text NOT NULL,
    product_id uuid NOT NULL,
    source_document_id uuid,
    effective_from date,
    effective_to date,
    retrieved_at timestamp with time zone NOT NULL,
    calculation_date date,
    data_status text NOT NULL,
    completeness_score smallint NOT NULL,
    interest_type text NOT NULL,
    fixed_rate_pct numeric(8,5),
    fixed_period_months integer,
    margin_pct numeric(8,5),
    reference_rate_code text,
    reference_rate_pct numeric(8,5),
    reference_rate_as_of date,
    representative_apr_pct numeric(8,5),
    min_amount numeric(14,2),
    max_amount numeric(14,2),
    min_term_months integer,
    max_term_months integer,
    max_ltv_pct numeric(7,4),
    is_eco boolean DEFAULT false NOT NULL,
    cost_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    requirements jsonb DEFAULT '[]'::jsonb NOT NULL,
    representative_example jsonb DEFAULT '{}'::jsonb NOT NULL,
    assumptions jsonb DEFAULT '[]'::jsonb NOT NULL,
    unknown_fields text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    document_requirements jsonb DEFAULT '[]'::jsonb NOT NULL,
    multiform_template_ids text[] DEFAULT '{}'::text[] NOT NULL,
    version_number integer NOT NULL,
    lifecycle_status text DEFAULT 'published'::text NOT NULL,
    calculator_schema_version integer DEFAULT 1 NOT NULL,
    calculator_engine_version text DEFAULT 'legacy-flat-v1'::text NOT NULL,
    content_sha256 text NOT NULL,
    validation_report jsonb DEFAULT '{}'::jsonb NOT NULL,
    published_at timestamp with time zone,
    published_by_user_id uuid,
    retired_at timestamp with time zone,
    retired_by_user_id uuid,
    CONSTRAINT mortgage_product_versions_check CHECK ((((interest_type = 'fixed_periodic'::text) AND (fixed_rate_pct IS NOT NULL) AND (fixed_period_months IS NOT NULL)) OR (interest_type = 'variable'::text))),
    CONSTRAINT mortgage_product_versions_completeness_score_check CHECK (((completeness_score >= 0) AND (completeness_score <= 100))),
    CONSTRAINT mortgage_product_versions_content_sha256_check CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT mortgage_product_versions_data_status_check CHECK ((data_status = ANY (ARRAY['confirmed'::text, 'inferred'::text, 'draft'::text]))),
    CONSTRAINT mortgage_product_versions_document_requirements_array_check CHECK ((jsonb_typeof(document_requirements) = 'array'::text)),
    CONSTRAINT mortgage_product_versions_engine_not_blank_check CHECK ((btrim(calculator_engine_version) <> ''::text)),
    CONSTRAINT mortgage_product_versions_fixed_period_months_check CHECK (((fixed_period_months IS NULL) OR (fixed_period_months > 0))),
    CONSTRAINT mortgage_product_versions_interest_type_check CHECK ((interest_type = ANY (ARRAY['fixed_periodic'::text, 'variable'::text]))),
    CONSTRAINT mortgage_product_versions_lifecycle_check CHECK ((lifecycle_status = ANY (ARRAY['published'::text, 'retired'::text]))),
    CONSTRAINT mortgage_product_versions_multiform_template_ids_no_null_check CHECK ((array_position(multiform_template_ids, NULL::text) IS NULL)),
    CONSTRAINT mortgage_product_versions_number_positive_check CHECK ((version_number > 0)),
    CONSTRAINT mortgage_product_versions_retirement_check CHECK ((((lifecycle_status = 'published'::text) AND (retired_at IS NULL) AND (retired_by_user_id IS NULL)) OR ((lifecycle_status = 'retired'::text) AND (retired_at IS NOT NULL)))),
    CONSTRAINT mortgage_product_versions_schema_positive_check CHECK ((calculator_schema_version > 0)),
    CONSTRAINT mortgage_product_versions_validation_object_check CHECK ((jsonb_typeof(validation_report) = 'object'::text))
);


--
-- Name: COLUMN mortgage_product_versions.document_requirements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mortgage_product_versions.document_requirements IS 'Structured document checklist used by a saved offer snapshot.';


--
-- Name: COLUMN mortgage_product_versions.multiform_template_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mortgage_product_versions.multiform_template_ids IS 'Multiform template identifiers that can render this product application.';


--
-- Name: mortgage_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'housing'::text NOT NULL,
    distribution_channel text DEFAULT 'bank_public_website'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_published_version_id uuid,
    revision bigint DEFAULT 1 NOT NULL,
    archived_at timestamp with time zone,
    archived_by_user_id uuid,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    product_kind text DEFAULT 'mortgage'::text NOT NULL,
    CONSTRAINT mortgage_products_category_check CHECK ((category = ANY (ARRAY['housing'::text, 'construction'::text, 'refinance'::text, 'eco'::text, 'family'::text]))),
    CONSTRAINT mortgage_products_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT mortgage_products_product_kind_check CHECK ((product_kind = ANY (ARRAY['mortgage'::text, 'home_equity'::text]))),
    CONSTRAINT mortgage_products_revision_positive_check CHECK ((revision > 0)),
    CONSTRAINT mortgage_products_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


--
-- Name: COLUMN mortgage_products.product_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mortgage_products.product_kind IS 'Calculator/domain kind of the bank offer. mortgage and home_equity currently share the mortgage V2 engine; cash loans require a separate engine before this constraint is extended.';


--
-- Name: mortgage_source_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mortgage_source_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    bank_id uuid NOT NULL,
    product_id uuid,
    title text NOT NULL,
    source_url text NOT NULL,
    source_kind text NOT NULL,
    mime_type text,
    sha256 text,
    storage_path text,
    retrieved_at timestamp with time zone NOT NULL,
    published_at date,
    retrieval_status text DEFAULT 'pending'::text NOT NULL,
    extraction_status text DEFAULT 'reviewed'::text NOT NULL,
    facts jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mortgage_source_documents_extraction_status_check CHECK ((extraction_status = ANY (ARRAY['pending'::text, 'automatic'::text, 'reviewed'::text, 'quarantined'::text]))),
    CONSTRAINT mortgage_source_documents_retrieval_status_check CHECK ((retrieval_status = ANY (ARRAY['pending'::text, 'downloaded'::text, 'failed'::text]))),
    CONSTRAINT mortgage_source_documents_source_kind_check CHECK ((source_kind = ANY (ARRAY['product_page'::text, 'general_information'::text, 'pricing_table'::text, 'promotion_rules'::text, 'other'::text])))
);


--
-- Name: organization_design_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_design_settings (
    organization_id uuid NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_design_settings_settings_check CHECK ((jsonb_typeof(settings) = 'object'::text))
);


--
-- Name: TABLE organization_design_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_design_settings IS 'Versioned organization-wide design tokens and brand assets. Only organization admins may change them.';


--
-- Name: organization_user_access_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_user_access_states (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    updated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_user_access_states_revision_valid CHECK ((revision >= 0))
);


--
-- Name: organization_user_admin_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_user_admin_roles (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_key text NOT NULL,
    assigned_by_user_id uuid NOT NULL,
    reason text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_user_admin_roles_reason_not_blank CHECK (((char_length(btrim(reason)) >= 10) AND (char_length(btrim(reason)) <= 2000))),
    CONSTRAINT organization_user_admin_roles_role_valid CHECK ((role_key = ANY (ARRAY['access_admin'::text, 'structure_admin'::text, 'consents_admin'::text, 'crm_config_admin'::text])))
);


--
-- Name: TABLE organization_user_admin_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_user_admin_roles IS 'Direct organization-scoped administrative roles. organization_admin remains organization_memberships.role = admin.';


--
-- Name: organization_user_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_user_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    actor_user_id uuid,
    actor_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    target_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    event_type text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    resource_label text,
    changes jsonb DEFAULT '[]'::jsonb NOT NULL,
    reason text,
    source text DEFAULT 'admin_panel'::text NOT NULL,
    correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    revision_before bigint,
    revision_after bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_user_audit_events_changes_array CHECK ((jsonb_typeof(changes) = 'array'::text)),
    CONSTRAINT organization_user_audit_events_event_type_not_blank CHECK (((char_length(btrim(event_type)) >= 3) AND (char_length(btrim(event_type)) <= 100))),
    CONSTRAINT organization_user_audit_events_resource_type_not_blank CHECK (((char_length(btrim(resource_type)) >= 3) AND (char_length(btrim(resource_type)) <= 100))),
    CONSTRAINT organization_user_audit_events_revision_order CHECK ((((revision_before IS NULL) AND (revision_after IS NULL)) OR ((revision_before IS NOT NULL) AND (revision_after IS NOT NULL) AND (revision_before >= 0) AND (revision_after >= revision_before)))),
    CONSTRAINT organization_user_audit_events_snapshots_objects CHECK (((jsonb_typeof(actor_snapshot) = 'object'::text) AND (jsonb_typeof(target_snapshot) = 'object'::text)))
);


--
-- Name: TABLE organization_user_audit_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_user_audit_events IS 'Append-only audit history for administrative access, grants and organization structure changes.';


--
-- Name: organization_user_direct_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_user_direct_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    permission_key text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    justification text NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    granted_by_user_id uuid NOT NULL,
    revoked_by_user_id uuid,
    revoked_at timestamp with time zone,
    revocation_reason text,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_user_direct_grants_justification_not_blank CHECK (((char_length(btrim(justification)) >= 10) AND (char_length(btrim(justification)) <= 2000))),
    CONSTRAINT organization_user_direct_grants_permission_valid CHECK ((permission_key = 'compliance.consents.definitions.publish'::text)),
    CONSTRAINT organization_user_direct_grants_revision_valid CHECK ((revision >= 1)),
    CONSTRAINT organization_user_direct_grants_status_valid CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text]))),
    CONSTRAINT organization_user_direct_grants_timeline_valid CHECK (((expires_at > valid_from) AND (((status = 'active'::text) AND (revoked_at IS NULL) AND (revoked_by_user_id IS NULL) AND (revocation_reason IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by_user_id IS NOT NULL) AND ((char_length(btrim(revocation_reason)) >= 10) AND (char_length(btrim(revocation_reason)) <= 2000))))))
);


--
-- Name: TABLE organization_user_direct_grants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_user_direct_grants IS 'Time-limited direct grants that never inherit from an administrative role or team.';


--
-- Name: organization_user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_user_preferences (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    default_facility_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE organization_user_preferences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.organization_user_preferences IS 'Scheduling preferences scoped to one organization membership. Endpoint authorization decides which organization facility the user may select.';


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_user_roles (
    user_id uuid NOT NULL,
    role text NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_user_roles_role_check CHECK ((role = 'super_admin'::text))
);


--
-- Name: TABLE platform_user_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.platform_user_roles IS 'Global platform roles. Super admins manage only the mortgage product and institution catalog interfaces.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    display_name text,
    locale text DEFAULT 'pl-PL'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_locale_check CHECK ((locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'::text))
);


--
-- Name: TABLE profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profiles IS 'Neutral account profile shared by workforce and client product contexts.';


--
-- Name: team_facilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_facilities (
    organization_id uuid NOT NULL,
    team_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_memberships (
    organization_id uuid NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_memberships_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    kind text DEFAULT 'team'::text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teams_kind_check CHECK ((kind = ANY (ARRAY['team'::text, 'department'::text, 'division'::text, 'other'::text]))),
    CONSTRAINT teams_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT teams_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'expert'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    full_name text,
    avatar_url text,
    CONSTRAINT users_avatar_url_length_check CHECK (((avatar_url IS NULL) OR (length(avatar_url) <= 2000))),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['expert'::text, 'admin'::text])))
);


--
-- Name: COLUMN users.organization_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.organization_id IS 'Default organization used for redirects only. Authorization uses organization_memberships.';


--
-- Name: COLUMN users.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.role IS 'Role mirror for the default organization. Per-organization roles live in organization_memberships.';


--
-- Name: COLUMN users.avatar_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.avatar_url IS 'Public-facing expert portrait URL. Null keeps the initials fallback.';


--
-- Name: waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    survey_token uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    survey_domain text[],
    survey_usecase text[],
    survey_priority text,
    survey_contrib text,
    survey_notes text,
    survey_completed_at timestamp with time zone,
    CONSTRAINT waitlist_email_check CHECK ((email = lower(TRIM(BOTH FROM email))))
);


--
-- Name: organization_admin_access_commands organization_admin_access_commands_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.organization_admin_access_commands
    ADD CONSTRAINT organization_admin_access_commands_pkey PRIMARY KEY (organization_id, idempotency_key);


--
-- Name: team_graph_revisions team_graph_revisions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.team_graph_revisions
    ADD CONSTRAINT team_graph_revisions_pkey PRIMARY KEY (organization_id);


--
-- Name: administrative_role_permissions administrative_role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.administrative_role_permissions
    ADD CONSTRAINT administrative_role_permissions_pkey PRIMARY KEY (role_key, permission_key);


--
-- Name: administrative_roles administrative_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.administrative_roles
    ADD CONSTRAINT administrative_roles_pkey PRIMARY KEY (role_key);


--
-- Name: appointment_calendar_events appointment_calendar_events_appointment_id_connection_id_ca_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_calendar_events
    ADD CONSTRAINT appointment_calendar_events_appointment_id_connection_id_ca_key UNIQUE (appointment_id, connection_id, calendar_id);


--
-- Name: appointment_calendar_events appointment_calendar_events_connection_id_calendar_id_exter_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_calendar_events
    ADD CONSTRAINT appointment_calendar_events_connection_id_calendar_id_exter_key UNIQUE (connection_id, calendar_id, external_event_id);


--
-- Name: appointment_calendar_events appointment_calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_calendar_events
    ADD CONSTRAINT appointment_calendar_events_pkey PRIMARY KEY (id);


--
-- Name: appointment_resource_reservations appointment_expert_reservations_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_resource_reservations
    ADD CONSTRAINT appointment_expert_reservations_no_overlap EXCLUDE USING gist (resource_id WITH =, busy_period WITH &&) WHERE (((resource_type = 'expert'::text) AND (status = ANY (ARRAY['hold'::text, 'confirmed'::text]))));


--
-- Name: appointment_resource_reservations appointment_resource_reservat_organization_id_appointment_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_resource_reservations
    ADD CONSTRAINT appointment_resource_reservat_organization_id_appointment_i_key UNIQUE (organization_id, appointment_id, resource_type, resource_id);


--
-- Name: appointment_resource_reservations appointment_resource_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_resource_reservations
    ADD CONSTRAINT appointment_resource_reservations_pkey PRIMARY KEY (id);


--
-- Name: appointment_resource_reservations appointment_scoped_resources_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_resource_reservations
    ADD CONSTRAINT appointment_scoped_resources_no_overlap EXCLUDE USING gist (organization_id WITH =, resource_type WITH =, resource_id WITH =, busy_period WITH &&) WHERE (((resource_type <> 'expert'::text) AND (status = ANY (ARRAY['hold'::text, 'confirmed'::text]))));


--
-- Name: appointments appointments_manage_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_manage_token_key UNIQUE (manage_token);


--
-- Name: appointments appointments_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: booking_outbox booking_outbox_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_outbox
    ADD CONSTRAINT booking_outbox_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: booking_outbox booking_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_outbox
    ADD CONSTRAINT booking_outbox_pkey PRIMARY KEY (id);


--
-- Name: booking_rate_limits booking_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_rate_limits
    ADD CONSTRAINT booking_rate_limits_pkey PRIMARY KEY (widget_id, rate_scope, client_key, window_started_at);


--
-- Name: booking_services booking_services_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: booking_services booking_services_organization_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_organization_id_slug_key UNIQUE (organization_id, slug);


--
-- Name: booking_services booking_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_pkey PRIMARY KEY (id);


--
-- Name: booking_widget_events booking_widget_events_event_id_shape; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.booking_widget_events
    ADD CONSTRAINT booking_widget_events_event_id_shape CHECK ((((event_type = ANY (ARRAY['booking_attempt'::text, 'booking_completed'::text])) AND (event_id IS NOT NULL) AND (event_id ~ '^[0-9a-f]{64}$'::text)) OR ((event_type <> ALL (ARRAY['booking_attempt'::text, 'booking_completed'::text])) AND (event_id IS NULL)))) NOT VALID;


--
-- Name: booking_widget_events booking_widget_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widget_events
    ADD CONSTRAINT booking_widget_events_pkey PRIMARY KEY (id);


--
-- Name: booking_widget_events booking_widget_events_service_shape; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.booking_widget_events
    ADD CONSTRAINT booking_widget_events_service_shape CHECK ((((event_type = ANY (ARRAY['widget_view'::text, 'widget_engaged'::text, 'calculator_started'::text, 'calculator_completed'::text])) AND (service_id IS NULL)) OR ((event_type = ANY (ARRAY['service_selected'::text, 'availability_search'::text, 'availability_found'::text, 'slot_selected'::text, 'contact_started'::text, 'booking_attempt'::text, 'booking_completed'::text])) AND (service_id IS NOT NULL)))) NOT VALID;


--
-- Name: booking_widget_services booking_widget_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widget_services
    ADD CONSTRAINT booking_widget_services_pkey PRIMARY KEY (organization_id, facility_id, widget_id, service_id);


--
-- Name: booking_widgets booking_widgets_organization_id_facility_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widgets
    ADD CONSTRAINT booking_widgets_organization_id_facility_id_id_key UNIQUE (organization_id, facility_id, id);


--
-- Name: booking_widgets booking_widgets_organization_id_facility_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widgets
    ADD CONSTRAINT booking_widgets_organization_id_facility_id_slug_key UNIQUE (organization_id, facility_id, slug);


--
-- Name: booking_widgets booking_widgets_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widgets
    ADD CONSTRAINT booking_widgets_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: booking_widgets booking_widgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widgets
    ADD CONSTRAINT booking_widgets_pkey PRIMARY KEY (id);


--
-- Name: booking_widgets booking_widgets_public_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widgets
    ADD CONSTRAINT booking_widgets_public_token_key UNIQUE (public_token);


--
-- Name: calendar_connections calendar_connections_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: calendar_connections calendar_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_pkey PRIMARY KEY (id);


--
-- Name: client_account_links client_account_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_account_links
    ADD CONSTRAINT client_account_links_pkey PRIMARY KEY (auth_user_id, organization_id, client_person_id);


--
-- Name: crm_activities crm_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_pkey PRIMARY KEY (id);


--
-- Name: crm_case_bank_applications crm_case_bank_applications_organization_id_case_id_bank_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_organization_id_case_id_bank_id_key UNIQUE (organization_id, case_id, bank_id);


--
-- Name: crm_case_bank_applications crm_case_bank_applications_organization_id_case_id_offer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_organization_id_case_id_offer_id_key UNIQUE (organization_id, case_id, offer_id);


--
-- Name: crm_case_bank_applications crm_case_bank_applications_organization_id_case_id_slot_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_organization_id_case_id_slot_key UNIQUE (organization_id, case_id, slot);


--
-- Name: crm_case_bank_applications crm_case_bank_applications_organization_id_case_id_submissi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_organization_id_case_id_submissi_key UNIQUE (organization_id, case_id, submission_id);


--
-- Name: crm_case_bank_applications crm_case_bank_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_pkey PRIMARY KEY (submission_id);


--
-- Name: crm_case_clients crm_case_clients_case_client_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_clients
    ADD CONSTRAINT crm_case_clients_case_client_key UNIQUE (case_id, client_id);


--
-- Name: crm_case_clients crm_case_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_clients
    ADD CONSTRAINT crm_case_clients_pkey PRIMARY KEY (id);


--
-- Name: crm_case_contract_selections crm_case_contract_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_contract_selections
    ADD CONSTRAINT crm_case_contract_selections_pkey PRIMARY KEY (organization_id, case_id);


--
-- Name: crm_case_item_settlements crm_case_item_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_item_settlements
    ADD CONSTRAINT crm_case_item_settlements_pkey PRIMARY KEY (id);


--
-- Name: crm_case_items crm_case_items_organization_case_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_items
    ADD CONSTRAINT crm_case_items_organization_case_id_key UNIQUE (organization_id, case_id, id);


--
-- Name: crm_case_items crm_case_items_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_items
    ADD CONSTRAINT crm_case_items_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: crm_case_items crm_case_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_items
    ADD CONSTRAINT crm_case_items_pkey PRIMARY KEY (id);


--
-- Name: crm_case_multiform_drafts crm_case_multiform_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_multiform_drafts
    ADD CONSTRAINT crm_case_multiform_drafts_pkey PRIMARY KEY (organization_id, case_id);


--
-- Name: crm_case_offer_selections crm_case_offer_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_selections
    ADD CONSTRAINT crm_case_offer_selections_pkey PRIMARY KEY (organization_id, case_id);


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_organization_case_id_bank_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_snapshots
    ADD CONSTRAINT crm_case_offer_snapshots_organization_case_id_bank_key UNIQUE (organization_id, case_id, id, bank_id);


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_organization_case_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_snapshots
    ADD CONSTRAINT crm_case_offer_snapshots_organization_case_id_key UNIQUE (organization_id, case_id, id);


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_snapshots
    ADD CONSTRAINT crm_case_offer_snapshots_pkey PRIMARY KEY (id);


--
-- Name: crm_case_participants crm_case_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_participants
    ADD CONSTRAINT crm_case_participants_pkey PRIMARY KEY (id);


--
-- Name: crm_case_property_selections crm_case_property_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_property_selections
    ADD CONSTRAINT crm_case_property_selections_pkey PRIMARY KEY (organization_id, case_id);


--
-- Name: crm_cases crm_cases_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_cases
    ADD CONSTRAINT crm_cases_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: crm_cases crm_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_cases
    ADD CONSTRAINT crm_cases_pkey PRIMARY KEY (id);


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_organization_id_id_ke; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_organization_id_id_ke UNIQUE (organization_id, id);


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_pkey PRIMARY KEY (id);


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_request_idempotency_u; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_request_idempotency_u UNIQUE (organization_id, requested_by_user_id, request_idempotency_key);


--
-- Name: crm_client_anonymization_request_events crm_client_anonymization_request_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_request_events
    ADD CONSTRAINT crm_client_anonymization_request_events_pkey PRIMARY KEY (id);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_idempotency_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_idempotency_key_unique UNIQUE (organization_id, idempotency_key);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_number_unique UNIQUE (organization_id, request_number);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_pkey PRIMARY KEY (id);


--
-- Name: crm_client_consent_events crm_client_consent_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_consent_events
    ADD CONSTRAINT crm_client_consent_events_pkey PRIMARY KEY (id);


--
-- Name: crm_client_people crm_client_people_organization_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_people
    ADD CONSTRAINT crm_client_people_organization_client_id_key UNIQUE (organization_id, client_id, id);


--
-- Name: crm_client_people crm_client_people_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_people
    ADD CONSTRAINT crm_client_people_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: crm_client_people crm_client_people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_people
    ADD CONSTRAINT crm_client_people_pkey PRIMARY KEY (id);


--
-- Name: crm_clients crm_clients_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_clients
    ADD CONSTRAINT crm_clients_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: crm_clients crm_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_clients
    ADD CONSTRAINT crm_clients_pkey PRIMARY KEY (id);


--
-- Name: crm_consent_definition_versions crm_consent_definition_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definition_versions
    ADD CONSTRAINT crm_consent_definition_versions_pkey PRIMARY KEY (id);


--
-- Name: crm_consent_definitions crm_consent_definitions_organization_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definitions
    ADD CONSTRAINT crm_consent_definitions_organization_code_key UNIQUE (organization_id, code);


--
-- Name: crm_consent_definitions crm_consent_definitions_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definitions
    ADD CONSTRAINT crm_consent_definitions_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: crm_consent_definitions crm_consent_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definitions
    ADD CONSTRAINT crm_consent_definitions_pkey PRIMARY KEY (id);


--
-- Name: crm_consent_definition_versions crm_consent_versions_definition_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definition_versions
    ADD CONSTRAINT crm_consent_versions_definition_version_key UNIQUE (definition_id, version);


--
-- Name: crm_consent_definition_versions crm_consent_versions_organization_definition_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definition_versions
    ADD CONSTRAINT crm_consent_versions_organization_definition_id_key UNIQUE (organization_id, definition_id, id);


--
-- Name: crm_documents crm_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_pkey PRIMARY KEY (id);


--
-- Name: crm_eve_sessions crm_eve_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_eve_sessions
    ADD CONSTRAINT crm_eve_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: crm_item_submissions crm_item_submissions_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_item_submissions
    ADD CONSTRAINT crm_item_submissions_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: crm_item_submissions crm_item_submissions_organization_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_item_submissions
    ADD CONSTRAINT crm_item_submissions_organization_item_id_key UNIQUE (organization_id, case_item_id, id);


--
-- Name: crm_item_submissions crm_item_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_item_submissions
    ADD CONSTRAINT crm_item_submissions_pkey PRIMARY KEY (id);


--
-- Name: crm_product_types crm_product_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_product_types
    ADD CONSTRAINT crm_product_types_pkey PRIMARY KEY (id);


--
-- Name: crm_properties crm_properties_organization_case_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_properties
    ADD CONSTRAINT crm_properties_organization_case_id_key UNIQUE (organization_id, case_id, id);


--
-- Name: crm_properties crm_properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_properties
    ADD CONSTRAINT crm_properties_pkey PRIMARY KEY (id);


--
-- Name: crm_property_images crm_property_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_property_images
    ADD CONSTRAINT crm_property_images_pkey PRIMARY KEY (id);


--
-- Name: crm_property_images crm_property_images_property_id_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_property_images
    ADD CONSTRAINT crm_property_images_property_id_sha256_key UNIQUE (property_id, sha256);


--
-- Name: crm_property_images crm_property_images_storage_bucket_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_property_images
    ADD CONSTRAINT crm_property_images_storage_bucket_storage_path_key UNIQUE (storage_bucket, storage_path);


--
-- Name: crm_providers crm_providers_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_providers
    ADD CONSTRAINT crm_providers_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: crm_providers crm_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_providers
    ADD CONSTRAINT crm_providers_pkey PRIMARY KEY (id);


--
-- Name: crm_tasks crm_tasks_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: crm_tasks crm_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_pkey PRIMARY KEY (id);


--
-- Name: crm_workflow_statuses crm_workflow_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_workflow_statuses
    ADD CONSTRAINT crm_workflow_statuses_pkey PRIMARY KEY (id);


--
-- Name: crm_workflows crm_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_workflows
    ADD CONSTRAINT crm_workflows_pkey PRIMARY KEY (id);


--
-- Name: expert_availability_overrides expert_availability_overrides_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_availability_overrides
    ADD CONSTRAINT expert_availability_overrides_no_overlap EXCLUDE USING gist (organization_id WITH =, facility_id WITH =, user_id WITH =, local_date WITH =, availability_range WITH &&);


--
-- Name: expert_availability_overrides expert_availability_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_availability_overrides
    ADD CONSTRAINT expert_availability_overrides_pkey PRIMARY KEY (id);


--
-- Name: expert_availability_rules expert_availability_rules_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_availability_rules
    ADD CONSTRAINT expert_availability_rules_no_overlap EXCLUDE USING gist (organization_id WITH =, facility_id WITH =, user_id WITH =, weekday WITH =, availability_range WITH &&, daterange(valid_from, valid_until, '[]'::text) WITH &&) WHERE (is_active);


--
-- Name: expert_availability_rules expert_availability_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_availability_rules
    ADD CONSTRAINT expert_availability_rules_pkey PRIMARY KEY (id);


--
-- Name: expert_brand_profiles expert_brand_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_brand_profiles
    ADD CONSTRAINT expert_brand_profiles_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: expert_time_off expert_time_off_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_time_off
    ADD CONSTRAINT expert_time_off_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: expert_time_off expert_time_off_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_time_off
    ADD CONSTRAINT expert_time_off_pkey PRIMARY KEY (id);


--
-- Name: external_busy_blocks external_busy_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_busy_blocks
    ADD CONSTRAINT external_busy_blocks_pkey PRIMARY KEY (id);


--
-- Name: facilities facilities_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: facilities facilities_organization_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_organization_id_slug_key UNIQUE (organization_id, slug);


--
-- Name: facilities facilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_pkey PRIMARY KEY (id);


--
-- Name: facility_images facility_images_facility_id_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_images
    ADD CONSTRAINT facility_images_facility_id_sha256_key UNIQUE (facility_id, sha256);


--
-- Name: facility_images facility_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_images
    ADD CONSTRAINT facility_images_pkey PRIMARY KEY (id);


--
-- Name: facility_images facility_images_storage_bucket_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_images
    ADD CONSTRAINT facility_images_storage_bucket_storage_path_key UNIQUE (storage_bucket, storage_path);


--
-- Name: facility_memberships facility_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_memberships
    ADD CONSTRAINT facility_memberships_pkey PRIMARY KEY (organization_id, facility_id, user_id);


--
-- Name: facility_opening_hours facility_opening_hours_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_opening_hours
    ADD CONSTRAINT facility_opening_hours_no_overlap EXCLUDE USING gist (organization_id WITH =, facility_id WITH =, weekday WITH =, opening_range WITH &&) WHERE (is_active);


--
-- Name: facility_opening_hours facility_opening_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_opening_hours
    ADD CONSTRAINT facility_opening_hours_pkey PRIMARY KEY (id);


--
-- Name: facility_opening_overrides facility_opening_overrides_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_opening_overrides
    ADD CONSTRAINT facility_opening_overrides_no_overlap EXCLUDE USING gist (organization_id WITH =, facility_id WITH =, local_date WITH =, opening_range WITH &&);


--
-- Name: facility_opening_overrides facility_opening_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_opening_overrides
    ADD CONSTRAINT facility_opening_overrides_pkey PRIMARY KEY (id);


--
-- Name: facility_service_experts facility_service_experts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_service_experts
    ADD CONSTRAINT facility_service_experts_pkey PRIMARY KEY (organization_id, facility_id, service_id, user_id);


--
-- Name: facility_services facility_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_services
    ADD CONSTRAINT facility_services_pkey PRIMARY KEY (organization_id, facility_id, service_id);


--
-- Name: mail_connections mail_connections_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_connections
    ADD CONSTRAINT mail_connections_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: mail_connections mail_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_connections
    ADD CONSTRAINT mail_connections_pkey PRIMARY KEY (id);


--
-- Name: mail_send_requests mail_send_requests_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_send_requests
    ADD CONSTRAINT mail_send_requests_idempotency_key UNIQUE (organization_id, owner_user_id, idempotency_key);


--
-- Name: mail_send_requests mail_send_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_send_requests
    ADD CONSTRAINT mail_send_requests_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_aliases mortgage_bank_aliases_bank_id_alias_type_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_aliases
    ADD CONSTRAINT mortgage_bank_aliases_bank_id_alias_type_value_key UNIQUE (bank_id, alias_type, value);


--
-- Name: mortgage_bank_aliases mortgage_bank_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_aliases
    ADD CONSTRAINT mortgage_bank_aliases_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_file_categories mortgage_bank_file_categories_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_categories
    ADD CONSTRAINT mortgage_bank_file_categories_key_unique UNIQUE (category_key);


--
-- Name: mortgage_bank_file_categories mortgage_bank_file_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_categories
    ADD CONSTRAINT mortgage_bank_file_categories_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_file_chunks mortgage_bank_file_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_chunks
    ADD CONSTRAINT mortgage_bank_file_chunks_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_file_chunks mortgage_bank_file_chunks_version_index_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_chunks
    ADD CONSTRAINT mortgage_bank_file_chunks_version_index_unique UNIQUE (version_id, chunk_index);


--
-- Name: mortgage_bank_file_embeddings mortgage_bank_file_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_embeddings
    ADD CONSTRAINT mortgage_bank_file_embeddings_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_file_embeddings mortgage_bank_file_embeddings_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_embeddings
    ADD CONSTRAINT mortgage_bank_file_embeddings_unique UNIQUE (chunk_id, embedding_kind, model, recipe_version);


--
-- Name: mortgage_bank_file_events mortgage_bank_file_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_events
    ADD CONSTRAINT mortgage_bank_file_events_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_file_processing_jobs mortgage_bank_file_processing_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_processing_jobs
    ADD CONSTRAINT mortgage_bank_file_processing_jobs_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_file_processing_jobs mortgage_bank_file_processing_jobs_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_processing_jobs
    ADD CONSTRAINT mortgage_bank_file_processing_jobs_unique UNIQUE (version_id, job_type);


--
-- Name: mortgage_bank_file_products mortgage_bank_file_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_products
    ADD CONSTRAINT mortgage_bank_file_products_pkey PRIMARY KEY (file_id, product_id);


--
-- Name: mortgage_bank_file_versions mortgage_bank_file_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_versions
    ADD CONSTRAINT mortgage_bank_file_versions_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_file_versions mortgage_bank_file_versions_storage_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_versions
    ADD CONSTRAINT mortgage_bank_file_versions_storage_path_unique UNIQUE (storage_path);


--
-- Name: mortgage_bank_file_versions mortgage_bank_file_versions_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_versions
    ADD CONSTRAINT mortgage_bank_file_versions_version_unique UNIQUE (file_id, version_number);


--
-- Name: mortgage_bank_files mortgage_bank_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_files
    ADD CONSTRAINT mortgage_bank_files_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_override_revisions mortgage_bank_override_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_override_revisions
    ADD CONSTRAINT mortgage_bank_override_revisions_pkey PRIMARY KEY (id);


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_organization_id_bank_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_overrides
    ADD CONSTRAINT mortgage_bank_overrides_organization_id_bank_id_key UNIQUE (organization_id, bank_id);


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_overrides
    ADD CONSTRAINT mortgage_bank_overrides_pkey PRIMARY KEY (id);


--
-- Name: mortgage_banks mortgage_banks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_banks
    ADD CONSTRAINT mortgage_banks_pkey PRIMARY KEY (id);


--
-- Name: mortgage_banks mortgage_banks_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_banks
    ADD CONSTRAINT mortgage_banks_slug_key UNIQUE (slug);


--
-- Name: mortgage_capacity_setting_revisions mortgage_capacity_setting_revision_organization_id_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_capacity_setting_revisions
    ADD CONSTRAINT mortgage_capacity_setting_revision_organization_id_revision_key UNIQUE (organization_id, revision);


--
-- Name: mortgage_capacity_setting_revisions mortgage_capacity_setting_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_capacity_setting_revisions
    ADD CONSTRAINT mortgage_capacity_setting_revisions_pkey PRIMARY KEY (id);


--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_capacity_settings
    ADD CONSTRAINT mortgage_capacity_settings_pkey PRIMARY KEY (organization_id);


--
-- Name: mortgage_catalog_events mortgage_catalog_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_catalog_events
    ADD CONSTRAINT mortgage_catalog_events_pkey PRIMARY KEY (id);


--
-- Name: mortgage_document_template_revisions mortgage_document_template_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_template_revisions
    ADD CONSTRAINT mortgage_document_template_revisions_pkey PRIMARY KEY (id);


--
-- Name: mortgage_document_templates mortgage_document_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_templates
    ADD CONSTRAINT mortgage_document_templates_pkey PRIMARY KEY (id);


--
-- Name: mortgage_document_templates mortgage_document_templates_template_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_templates
    ADD CONSTRAINT mortgage_document_templates_template_key_key UNIQUE (template_key);


--
-- Name: mortgage_product_drafts mortgage_product_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_drafts
    ADD CONSTRAINT mortgage_product_drafts_pkey PRIMARY KEY (id);


--
-- Name: mortgage_product_drafts mortgage_product_drafts_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_drafts
    ADD CONSTRAINT mortgage_product_drafts_product_id_key UNIQUE (product_id);


--
-- Name: mortgage_product_override_revisions mortgage_product_override_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_override_revisions
    ADD CONSTRAINT mortgage_product_override_revisions_pkey PRIMARY KEY (id);


--
-- Name: mortgage_product_overrides mortgage_product_overrides_organization_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_overrides
    ADD CONSTRAINT mortgage_product_overrides_organization_id_product_id_key UNIQUE (organization_id, product_id);


--
-- Name: mortgage_product_overrides mortgage_product_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_overrides
    ADD CONSTRAINT mortgage_product_overrides_pkey PRIMARY KEY (id);


--
-- Name: mortgage_product_version_document_templates mortgage_product_version_document_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_version_document_templates
    ADD CONSTRAINT mortgage_product_version_document_templates_pkey PRIMARY KEY (product_version_id, requirement_code);


--
-- Name: mortgage_product_version_sources mortgage_product_version_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_version_sources
    ADD CONSTRAINT mortgage_product_version_sources_pkey PRIMARY KEY (product_version_id, source_document_id, source_role);


--
-- Name: mortgage_product_version_variants mortgage_product_version_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_version_variants
    ADD CONSTRAINT mortgage_product_version_variants_pkey PRIMARY KEY (id);


--
-- Name: mortgage_product_version_variants mortgage_product_version_variants_version_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_version_variants
    ADD CONSTRAINT mortgage_product_version_variants_version_code_key UNIQUE (product_version_id, code);


--
-- Name: mortgage_product_versions mortgage_product_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_versions
    ADD CONSTRAINT mortgage_product_versions_pkey PRIMARY KEY (id);


--
-- Name: mortgage_product_versions mortgage_product_versions_product_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_versions
    ADD CONSTRAINT mortgage_product_versions_product_id_id_key UNIQUE (product_id, id);


--
-- Name: mortgage_product_versions mortgage_product_versions_product_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_versions
    ADD CONSTRAINT mortgage_product_versions_product_number_key UNIQUE (product_id, version_number);


--
-- Name: mortgage_product_versions mortgage_product_versions_version_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_versions
    ADD CONSTRAINT mortgage_product_versions_version_key_key UNIQUE (version_key);


--
-- Name: mortgage_products mortgage_products_bank_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_products
    ADD CONSTRAINT mortgage_products_bank_id_slug_key UNIQUE (bank_id, slug);


--
-- Name: mortgage_products mortgage_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_products
    ADD CONSTRAINT mortgage_products_pkey PRIMARY KEY (id);


--
-- Name: mortgage_source_documents mortgage_source_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_source_documents
    ADD CONSTRAINT mortgage_source_documents_pkey PRIMARY KEY (id);


--
-- Name: mortgage_source_documents mortgage_source_documents_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_source_documents
    ADD CONSTRAINT mortgage_source_documents_source_key_key UNIQUE (source_key);


--
-- Name: mortgage_source_documents mortgage_source_documents_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_source_documents
    ADD CONSTRAINT mortgage_source_documents_storage_path_key UNIQUE (storage_path);


--
-- Name: organization_design_settings organization_design_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_design_settings
    ADD CONSTRAINT organization_design_settings_pkey PRIMARY KEY (organization_id);


--
-- Name: organization_memberships organization_memberships_organization_id_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_organization_id_user_id_role_key UNIQUE (organization_id, user_id, role);


--
-- Name: organization_memberships organization_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: organization_user_access_states organization_user_access_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_access_states
    ADD CONSTRAINT organization_user_access_states_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: organization_user_admin_roles organization_user_admin_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_admin_roles
    ADD CONSTRAINT organization_user_admin_roles_pkey PRIMARY KEY (organization_id, user_id, role_key);


--
-- Name: organization_user_audit_events organization_user_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_audit_events
    ADD CONSTRAINT organization_user_audit_events_pkey PRIMARY KEY (id);


--
-- Name: organization_user_direct_grants organization_user_direct_grants_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_direct_grants
    ADD CONSTRAINT organization_user_direct_grants_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: organization_user_direct_grants organization_user_direct_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_direct_grants
    ADD CONSTRAINT organization_user_direct_grants_pkey PRIMARY KEY (id);


--
-- Name: organization_user_preferences organization_user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_preferences
    ADD CONSTRAINT organization_user_preferences_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: platform_user_roles platform_user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_user_roles
    ADD CONSTRAINT platform_user_roles_pkey PRIMARY KEY (user_id, role);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: team_edges team_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_edges
    ADD CONSTRAINT team_edges_pkey PRIMARY KEY (organization_id, parent_team_id, child_team_id);


--
-- Name: team_facilities team_facilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_facilities
    ADD CONSTRAINT team_facilities_pkey PRIMARY KEY (organization_id, team_id, facility_id);


--
-- Name: team_memberships team_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_memberships
    ADD CONSTRAINT team_memberships_pkey PRIMARY KEY (organization_id, team_id, user_id);


--
-- Name: teams teams_organization_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: teams teams_organization_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_organization_id_slug_key UNIQUE (organization_id, slug);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: waitlist waitlist_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_email_key UNIQUE (email);


--
-- Name: waitlist waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);


--
-- Name: waitlist waitlist_survey_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_survey_token_key UNIQUE (survey_token);


--
-- Name: appointment_calendar_events_organization_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_calendar_events_organization_appointment_idx ON public.appointment_calendar_events USING btree (organization_id, appointment_id);


--
-- Name: appointment_calendar_events_sync_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_calendar_events_sync_status_idx ON public.appointment_calendar_events USING btree (sync_status, updated_at) WHERE (sync_status = ANY (ARRAY['pending'::text, 'error'::text]));


--
-- Name: appointment_expert_reservations_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_expert_reservations_period_idx ON public.appointment_resource_reservations USING gist (resource_id, busy_period) WHERE (resource_type = 'expert'::text);


--
-- Name: appointment_resource_reservations_appointment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_resource_reservations_appointment_idx ON public.appointment_resource_reservations USING btree (organization_id, appointment_id);


--
-- Name: appointment_resource_reservations_resource_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointment_resource_reservations_resource_period_idx ON public.appointment_resource_reservations USING gist (organization_id, resource_type, resource_id, busy_period);


--
-- Name: appointment_resource_reservations_time_off_owner_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointment_resource_reservations_time_off_owner_key ON public.appointment_resource_reservations USING btree (organization_id, time_off_id, resource_type, resource_id) WHERE (time_off_id IS NOT NULL);


--
-- Name: appointments_active_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_active_period_idx ON public.appointments USING gist (appointment_period) WHERE (status = ANY (ARRAY['hold'::text, 'confirmed'::text]));


--
-- Name: appointments_client_person_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_client_person_start_idx ON public.appointments USING btree (organization_id, client_person_id, starts_at DESC) WHERE (client_person_id IS NOT NULL);


--
-- Name: appointments_client_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_client_start_idx ON public.appointments USING btree (organization_id, client_id, starts_at DESC);


--
-- Name: appointments_customer_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_customer_name_trgm_idx ON public.appointments USING gin (customer_name extensions.gin_trgm_ops);


--
-- Name: appointments_expert_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_expert_start_idx ON public.appointments USING btree (organization_id, expert_user_id, starts_at);


--
-- Name: appointments_expired_holds_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_expired_holds_idx ON public.appointments USING btree (hold_expires_at) WHERE (status = 'hold'::text);


--
-- Name: appointments_facility_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_facility_start_idx ON public.appointments USING btree (organization_id, facility_id, starts_at);


--
-- Name: appointments_omnisearch_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_omnisearch_text_trgm_idx ON public.appointments USING gin (omnisearch_text extensions.gin_trgm_ops);


--
-- Name: appointments_omnisearch_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_omnisearch_vector_idx ON public.appointments USING gin (omnisearch_vector);


--
-- Name: appointments_org_crm_task_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_org_crm_task_start_idx ON public.appointments USING btree (organization_id, crm_task_id, starts_at DESC) WHERE (crm_task_id IS NOT NULL);


--
-- Name: appointments_service_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_service_start_idx ON public.appointments USING btree (organization_id, service_id, starts_at);


--
-- Name: appointments_staff_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointments_staff_idempotency_key ON public.appointments USING btree (organization_id, created_by_user_id, idempotency_key) WHERE ((source = 'staff'::text) AND (idempotency_key IS NOT NULL));


--
-- Name: appointments_widget_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appointments_widget_created_idx ON public.appointments USING btree (organization_id, widget_id, created_at DESC) WHERE (widget_id IS NOT NULL);


--
-- Name: appointments_widget_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX appointments_widget_idempotency_key ON public.appointments USING btree (widget_id, idempotency_key) WHERE ((widget_id IS NOT NULL) AND (idempotency_key IS NOT NULL));


--
-- Name: booking_outbox_aggregate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_outbox_aggregate_idx ON public.booking_outbox USING btree (organization_id, aggregate_type, aggregate_id);


--
-- Name: booking_outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_outbox_pending_idx ON public.booking_outbox USING btree (available_at, id) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: booking_rate_limits_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_rate_limits_expiry_idx ON public.booking_rate_limits USING btree (window_started_at);


--
-- Name: booking_widget_events_booking_event_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX booking_widget_events_booking_event_key ON public.booking_widget_events USING btree (widget_id, event_type, event_id) WHERE (event_id IS NOT NULL);


--
-- Name: INDEX booking_widget_events_booking_event_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.booking_widget_events_booking_event_key IS 'Prevents an idempotent booking retry from becoming a second attempt or completion after a page refresh.';


--
-- Name: booking_widget_events_retention_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_widget_events_retention_idx ON public.booking_widget_events USING btree (occurred_at);


--
-- Name: booking_widget_events_service_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_widget_events_service_time_idx ON public.booking_widget_events USING btree (organization_id, service_id, occurred_at DESC) WHERE (service_id IS NOT NULL);


--
-- Name: booking_widget_events_visit_event_service_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX booking_widget_events_visit_event_service_key ON public.booking_widget_events USING btree (widget_id, visit_id, event_type, service_id) NULLS NOT DISTINCT;


--
-- Name: INDEX booking_widget_events_visit_event_service_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.booking_widget_events_visit_event_service_key IS 'One funnel stage per widget visit, event type and optional service. Makes public retries idempotent.';


--
-- Name: booking_widget_events_widget_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_widget_events_widget_time_idx ON public.booking_widget_events USING btree (organization_id, widget_id, occurred_at DESC);


--
-- Name: booking_widget_services_service_widget_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_widget_services_service_widget_idx ON public.booking_widget_services USING btree (organization_id, facility_id, service_id, widget_id);


--
-- Name: booking_widgets_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_widgets_created_by_idx ON public.booking_widgets USING btree (organization_id, created_by_user_id) WHERE (created_by_user_id IS NOT NULL);


--
-- Name: booking_widgets_facility_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_widgets_facility_active_idx ON public.booking_widgets USING btree (organization_id, facility_id, is_active);


--
-- Name: booking_widgets_fixed_expert_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_widgets_fixed_expert_idx ON public.booking_widgets USING btree (organization_id, facility_id, fixed_expert_user_id) WHERE (fixed_expert_user_id IS NOT NULL);


--
-- Name: booking_widgets_public_directory_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_widgets_public_directory_idx ON public.booking_widgets USING btree (created_at, id) WHERE (is_active AND is_directory_listed AND (widget_type = 'calendar'::text));


--
-- Name: calendar_connections_expert_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX calendar_connections_expert_provider_key ON public.calendar_connections USING btree (organization_id, owner_user_id, provider) WHERE (owner_kind = 'expert'::text);


--
-- Name: calendar_connections_facility_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX calendar_connections_facility_provider_key ON public.calendar_connections USING btree (organization_id, facility_id, provider) WHERE (owner_kind = 'facility'::text);


--
-- Name: calendar_connections_webhook_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_connections_webhook_expiry_idx ON public.calendar_connections USING btree (webhook_expires_at) WHERE ((status = 'active'::text) AND (webhook_expires_at IS NOT NULL));


--
-- Name: client_account_links_active_person_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_account_links_active_person_idx ON public.client_account_links USING btree (organization_id, client_person_id) WHERE (revoked_at IS NULL);


--
-- Name: client_account_links_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_account_links_identity_idx ON public.client_account_links USING btree (auth_user_id, organization_id, client_person_id) WHERE (revoked_at IS NULL);


--
-- Name: crm_activities_org_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_org_actor_idx ON public.crm_activities USING btree (organization_id, actor_user_id);


--
-- Name: crm_activities_org_case_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_org_case_created_idx ON public.crm_activities USING btree (organization_id, case_id, created_at DESC);


--
-- Name: crm_activities_org_client_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_org_client_created_idx ON public.crm_activities USING btree (organization_id, client_id, created_at DESC);


--
-- Name: crm_activities_org_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_org_item_idx ON public.crm_activities USING btree (organization_id, case_item_id);


--
-- Name: crm_activities_org_submission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_org_submission_idx ON public.crm_activities USING btree (organization_id, submission_id);


--
-- Name: crm_activities_org_task_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_org_task_created_idx ON public.crm_activities USING btree (organization_id, task_id, created_at DESC) WHERE (task_id IS NOT NULL);


--
-- Name: crm_case_bank_applications_case_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_bank_applications_case_item_idx ON public.crm_case_bank_applications USING btree (organization_id, case_id, case_item_id, slot);


--
-- Name: crm_case_bank_applications_omnisearch_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_bank_applications_omnisearch_text_trgm_idx ON public.crm_case_bank_applications USING gin (omnisearch_text extensions.gin_trgm_ops);


--
-- Name: crm_case_bank_applications_omnisearch_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_bank_applications_omnisearch_vector_idx ON public.crm_case_bank_applications USING gin (omnisearch_vector);


--
-- Name: crm_case_bank_applications_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_bank_applications_property_idx ON public.crm_case_bank_applications USING btree (organization_id, property_id, case_id) WHERE (property_id IS NOT NULL);


--
-- Name: crm_case_clients_one_primary_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_case_clients_one_primary_idx ON public.crm_case_clients USING btree (case_id) WHERE is_primary;


--
-- Name: crm_case_clients_organization_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_clients_organization_case_idx ON public.crm_case_clients USING btree (organization_id, case_id, client_id);


--
-- Name: crm_case_clients_organization_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_clients_organization_client_idx ON public.crm_case_clients USING btree (organization_id, client_id, case_id);


--
-- Name: crm_case_contract_selections_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_contract_selections_application_idx ON public.crm_case_contract_selections USING btree (organization_id, application_id, case_id);


--
-- Name: crm_case_item_settlements_case_item_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_case_item_settlements_case_item_key ON public.crm_case_item_settlements USING btree (case_item_id);


--
-- Name: crm_case_item_settlements_org_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_item_settlements_org_due_idx ON public.crm_case_item_settlements USING btree (organization_id, due_date);


--
-- Name: crm_case_item_settlements_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_item_settlements_org_status_idx ON public.crm_case_item_settlements USING btree (organization_id, status_code);


--
-- Name: crm_case_items_org_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_items_org_case_idx ON public.crm_case_items USING btree (organization_id, case_id);


--
-- Name: crm_case_items_org_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_items_org_product_idx ON public.crm_case_items USING btree (organization_id, product_type_id);


--
-- Name: crm_case_items_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_items_org_status_idx ON public.crm_case_items USING btree (organization_id, status_code);


--
-- Name: crm_case_multiform_drafts_organization_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_multiform_drafts_organization_updated_idx ON public.crm_case_multiform_drafts USING btree (organization_id, updated_at DESC);


--
-- Name: crm_case_multiform_drafts_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_multiform_drafts_updated_by_idx ON public.crm_case_multiform_drafts USING btree (organization_id, updated_by_user_id) WHERE (updated_by_user_id IS NOT NULL);


--
-- Name: crm_case_offer_selections_offer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_offer_selections_offer_idx ON public.crm_case_offer_selections USING btree (organization_id, offer_id, case_id);


--
-- Name: crm_case_offer_snapshots_organization_bank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_offer_snapshots_organization_bank_idx ON public.crm_case_offer_snapshots USING btree (organization_id, bank_id, case_id) WHERE (bank_id IS NOT NULL);


--
-- Name: crm_case_offer_snapshots_organization_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_offer_snapshots_organization_case_idx ON public.crm_case_offer_snapshots USING btree (organization_id, case_id, saved_at DESC, id);


--
-- Name: crm_case_offer_snapshots_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_offer_snapshots_product_idx ON public.crm_case_offer_snapshots USING btree (mortgage_product_id, mortgage_product_version_id) WHERE (mortgage_product_id IS NOT NULL);


--
-- Name: crm_case_participants_case_person_role_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_case_participants_case_person_role_key ON public.crm_case_participants USING btree (case_id, person_id, role);


--
-- Name: crm_case_participants_org_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_participants_org_case_idx ON public.crm_case_participants USING btree (organization_id, case_id);


--
-- Name: crm_case_participants_org_person_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_participants_org_person_idx ON public.crm_case_participants USING btree (organization_id, person_id);


--
-- Name: crm_case_property_selections_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_case_property_selections_property_idx ON public.crm_case_property_selections USING btree (organization_id, property_id, case_id);


--
-- Name: crm_cases_org_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_cases_org_client_idx ON public.crm_cases USING btree (organization_id, client_id);


--
-- Name: crm_cases_org_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_cases_org_owner_idx ON public.crm_cases USING btree (organization_id, owner_user_id);


--
-- Name: crm_cases_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_cases_org_status_idx ON public.crm_cases USING btree (organization_id, status_code);


--
-- Name: crm_cases_org_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_cases_org_updated_idx ON public.crm_cases USING btree (organization_id, updated_at DESC);


--
-- Name: crm_cases_organization_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_cases_organization_created_idx ON public.crm_cases USING btree (organization_id, created_at DESC, id);


--
-- Name: crm_cases_organization_title_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_cases_organization_title_idx ON public.crm_cases USING btree (organization_id, lower(title), id);


--
-- Name: crm_cases_search_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_cases_search_text_trgm_idx ON public.crm_cases USING gin (search_text extensions.gin_trgm_ops);


--
-- Name: crm_cases_search_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_cases_search_vector_idx ON public.crm_cases USING gin (search_vector);


--
-- Name: crm_cases_title_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_cases_title_trgm_idx ON public.crm_cases USING gin (title extensions.gin_trgm_ops);


--
-- Name: crm_client_anonymization_execution_grants_approver_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_anonymization_execution_grants_approver_queue_idx ON public.crm_client_anonymization_execution_grants USING btree (organization_id, approver_user_id, created_at, id) WHERE (status = 'pending_approval'::text);


--
-- Name: crm_client_anonymization_execution_grants_grantee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_anonymization_execution_grants_grantee_idx ON public.crm_client_anonymization_execution_grants USING btree (organization_id, grantee_user_id, status, expires_at);


--
-- Name: crm_client_anonymization_execution_grants_one_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_client_anonymization_execution_grants_one_open_idx ON public.crm_client_anonymization_execution_grants USING btree (organization_id, request_id) WHERE (status = ANY (ARRAY['pending_approval'::text, 'active'::text]));


--
-- Name: crm_client_anonymization_request_events_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_anonymization_request_events_actor_idx ON public.crm_client_anonymization_request_events USING btree (actor_user_id);


--
-- Name: crm_client_anonymization_request_events_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_anonymization_request_events_request_idx ON public.crm_client_anonymization_request_events USING btree (organization_id, request_id, created_at, id);


--
-- Name: crm_client_anonymization_requests_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_anonymization_requests_client_idx ON public.crm_client_anonymization_requests USING btree (organization_id, client_id, requested_at DESC);


--
-- Name: crm_client_anonymization_requests_one_active_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_client_anonymization_requests_one_active_client_idx ON public.crm_client_anonymization_requests USING btree (organization_id, client_id) WHERE (status = ANY (ARRAY['received'::text, 'identity_verification'::text, 'legal_review'::text, 'approved'::text, 'in_progress'::text]));


--
-- Name: crm_client_anonymization_requests_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_client_anonymization_requests_one_active_idx ON public.crm_client_anonymization_requests USING btree (organization_id, subject_person_id) WHERE (status = ANY (ARRAY['received'::text, 'identity_verification'::text, 'legal_review'::text, 'approved'::text, 'in_progress'::text]));


--
-- Name: crm_client_anonymization_requests_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_anonymization_requests_queue_idx ON public.crm_client_anonymization_requests USING btree (organization_id, status, due_at) WHERE (status = ANY (ARRAY['received'::text, 'identity_verification'::text, 'legal_review'::text, 'approved'::text, 'in_progress'::text]));


--
-- Name: crm_client_consent_events_client_definition_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_consent_events_client_definition_latest_idx ON public.crm_client_consent_events USING btree (organization_id, client_id, definition_id, occurred_at DESC, id DESC);


--
-- Name: crm_client_consent_events_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_consent_events_client_idx ON public.crm_client_consent_events USING btree (organization_id, client_id, occurred_at DESC);


--
-- Name: crm_client_consent_events_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_consent_events_current_idx ON public.crm_client_consent_events USING btree (organization_id, subject_person_id, definition_id, occurred_at DESC, id DESC);


--
-- Name: crm_client_people_org_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_people_org_client_idx ON public.crm_client_people USING btree (organization_id, client_id);


--
-- Name: crm_client_people_organization_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_people_organization_email_idx ON public.crm_client_people USING btree (organization_id, email_normalized, client_id) WHERE (email_normalized IS NOT NULL);


--
-- Name: crm_client_people_organization_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_client_people_organization_phone_idx ON public.crm_client_people USING btree (organization_id, phone_normalized, client_id) WHERE (phone_normalized IS NOT NULL);


--
-- Name: crm_clients_display_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_display_name_trgm_idx ON public.crm_clients USING gin (display_name extensions.gin_trgm_ops);


--
-- Name: crm_clients_metadata_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_metadata_idx ON public.crm_clients USING gin (metadata jsonb_path_ops);


--
-- Name: crm_clients_org_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_org_owner_idx ON public.crm_clients USING btree (organization_id, owner_user_id);


--
-- Name: crm_clients_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_org_status_idx ON public.crm_clients USING btree (organization_id, status_code);


--
-- Name: crm_clients_org_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_org_updated_idx ON public.crm_clients USING btree (organization_id, updated_at DESC);


--
-- Name: crm_clients_organization_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_organization_created_idx ON public.crm_clients USING btree (organization_id, created_at DESC, id);


--
-- Name: crm_clients_organization_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_organization_email_idx ON public.crm_clients USING btree (organization_id, primary_email_normalized) WHERE (primary_email_normalized IS NOT NULL);


--
-- Name: crm_clients_organization_owner_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_organization_owner_updated_idx ON public.crm_clients USING btree (organization_id, owner_user_id, updated_at DESC, id);


--
-- Name: crm_clients_organization_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_organization_phone_idx ON public.crm_clients USING btree (organization_id, primary_phone_normalized) WHERE (primary_phone_normalized IS NOT NULL);


--
-- Name: crm_clients_organization_source_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_organization_source_updated_idx ON public.crm_clients USING btree (organization_id, lead_source, updated_at DESC, id) WHERE (lead_source IS NOT NULL);


--
-- Name: crm_clients_organization_status_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_organization_status_updated_idx ON public.crm_clients USING btree (organization_id, status_code, updated_at DESC, id);


--
-- Name: crm_clients_search_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_search_text_trgm_idx ON public.crm_clients USING gin (search_text extensions.gin_trgm_ops);


--
-- Name: crm_clients_search_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_search_vector_idx ON public.crm_clients USING gin (search_vector);


--
-- Name: crm_clients_tags_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_clients_tags_idx ON public.crm_clients USING gin (tags);


--
-- Name: crm_consent_definitions_organization_context_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_consent_definitions_organization_context_idx ON public.crm_consent_definitions USING btree (organization_id, context, code);


--
-- Name: crm_consent_versions_definition_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_consent_versions_definition_history_idx ON public.crm_consent_definition_versions USING btree (organization_id, definition_id, version DESC);


--
-- Name: crm_documents_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_documents_name_trgm_idx ON public.crm_documents USING gin (name extensions.gin_trgm_ops);


--
-- Name: crm_documents_omnisearch_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_documents_omnisearch_text_trgm_idx ON public.crm_documents USING gin (omnisearch_text extensions.gin_trgm_ops);


--
-- Name: crm_documents_omnisearch_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_documents_omnisearch_vector_idx ON public.crm_documents USING gin (omnisearch_vector);


--
-- Name: crm_documents_org_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_documents_org_case_idx ON public.crm_documents USING btree (organization_id, case_id);


--
-- Name: crm_documents_org_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_documents_org_client_idx ON public.crm_documents USING btree (organization_id, client_id);


--
-- Name: crm_documents_org_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_documents_org_item_idx ON public.crm_documents USING btree (organization_id, case_item_id);


--
-- Name: crm_documents_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_documents_org_status_idx ON public.crm_documents USING btree (organization_id, status_code);


--
-- Name: crm_documents_organization_case_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_documents_organization_case_created_idx ON public.crm_documents USING btree (organization_id, case_id, created_at DESC, id) WHERE (case_id IS NOT NULL);


--
-- Name: crm_documents_organization_case_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_documents_organization_case_type_idx ON public.crm_documents USING btree (organization_id, case_id, document_type, created_at DESC) WHERE (case_id IS NOT NULL);


--
-- Name: crm_documents_storage_object_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_documents_storage_object_key ON public.crm_documents USING btree (storage_bucket, storage_path) WHERE ((storage_bucket IS NOT NULL) AND (storage_path IS NOT NULL));


--
-- Name: crm_eve_sessions_user_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_eve_sessions_user_organization_idx ON public.crm_eve_sessions USING btree (user_id, organization_id, updated_at DESC);


--
-- Name: crm_item_submissions_omnisearch_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_item_submissions_omnisearch_text_trgm_idx ON public.crm_item_submissions USING gin (omnisearch_text extensions.gin_trgm_ops);


--
-- Name: crm_item_submissions_omnisearch_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_item_submissions_omnisearch_vector_idx ON public.crm_item_submissions USING gin (omnisearch_vector);


--
-- Name: crm_item_submissions_org_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_item_submissions_org_item_idx ON public.crm_item_submissions USING btree (organization_id, case_item_id);


--
-- Name: crm_item_submissions_org_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_item_submissions_org_provider_idx ON public.crm_item_submissions USING btree (organization_id, provider_id);


--
-- Name: crm_item_submissions_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_item_submissions_org_status_idx ON public.crm_item_submissions USING btree (organization_id, status_code);


--
-- Name: crm_item_submissions_reference_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_item_submissions_reference_trgm_idx ON public.crm_item_submissions USING gin (external_reference extensions.gin_trgm_ops) WHERE (external_reference IS NOT NULL);


--
-- Name: crm_product_types_org_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_product_types_org_code_key ON public.crm_product_types USING btree (organization_id, code) WHERE (organization_id IS NOT NULL);


--
-- Name: crm_product_types_org_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_product_types_org_domain_idx ON public.crm_product_types USING btree (organization_id, domain);


--
-- Name: crm_product_types_system_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_product_types_system_code_key ON public.crm_product_types USING btree (code) WHERE (organization_id IS NULL);


--
-- Name: crm_properties_org_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_properties_org_case_idx ON public.crm_properties USING btree (organization_id, case_id);


--
-- Name: crm_property_images_property_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_property_images_property_sort_idx ON public.crm_property_images USING btree (organization_id, property_id, sort_order, id);


--
-- Name: crm_providers_org_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_providers_org_kind_idx ON public.crm_providers USING btree (organization_id, kind);


--
-- Name: crm_settlements_org_payer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_settlements_org_payer_idx ON public.crm_case_item_settlements USING btree (organization_id, payer_provider_id);


--
-- Name: crm_tasks_delegation_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_tasks_delegation_idempotency_key ON public.crm_tasks USING btree (organization_id, delegator_user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: crm_tasks_omnisearch_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_omnisearch_text_trgm_idx ON public.crm_tasks USING gin (omnisearch_text extensions.gin_trgm_ops);


--
-- Name: crm_tasks_omnisearch_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_omnisearch_vector_idx ON public.crm_tasks USING gin (omnisearch_vector);


--
-- Name: crm_tasks_org_assignee_delegation_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_org_assignee_delegation_due_idx ON public.crm_tasks USING btree (organization_id, assignee_user_id, delegation_status, due_at) WHERE (delegation_status <> 'not_delegated'::text);


--
-- Name: crm_tasks_org_assignee_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_org_assignee_due_idx ON public.crm_tasks USING btree (organization_id, assignee_user_id, due_at);


--
-- Name: crm_tasks_org_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_org_case_idx ON public.crm_tasks USING btree (organization_id, case_id);


--
-- Name: crm_tasks_org_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_org_client_idx ON public.crm_tasks USING btree (organization_id, client_id);


--
-- Name: crm_tasks_org_delegator_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_org_delegator_recent_idx ON public.crm_tasks USING btree (organization_id, delegator_user_id, delegated_at DESC) WHERE (delegation_status <> 'not_delegated'::text);


--
-- Name: crm_tasks_org_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_org_item_idx ON public.crm_tasks USING btree (organization_id, case_item_id);


--
-- Name: crm_tasks_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_org_status_idx ON public.crm_tasks USING btree (organization_id, status_code);


--
-- Name: crm_tasks_title_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_title_trgm_idx ON public.crm_tasks USING gin (title extensions.gin_trgm_ops);


--
-- Name: crm_workflow_statuses_org_workflow_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_workflow_statuses_org_workflow_idx ON public.crm_workflow_statuses USING btree (organization_id, workflow_id, sort_order);


--
-- Name: crm_workflow_statuses_workflow_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_workflow_statuses_workflow_code_key ON public.crm_workflow_statuses USING btree (workflow_id, code);


--
-- Name: crm_workflows_org_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_workflows_org_code_key ON public.crm_workflows USING btree (organization_id, scope, code) WHERE (organization_id IS NOT NULL);


--
-- Name: crm_workflows_org_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_workflows_org_scope_idx ON public.crm_workflows USING btree (organization_id, scope);


--
-- Name: crm_workflows_system_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_workflows_system_code_key ON public.crm_workflows USING btree (scope, code) WHERE (organization_id IS NULL);


--
-- Name: expert_availability_overrides_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expert_availability_overrides_lookup_idx ON public.expert_availability_overrides USING btree (organization_id, facility_id, user_id, local_date);


--
-- Name: expert_availability_rules_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expert_availability_rules_lookup_idx ON public.expert_availability_rules USING btree (organization_id, facility_id, user_id, weekday, valid_from, valid_until);


--
-- Name: expert_time_off_active_calendar_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expert_time_off_active_calendar_idx ON public.expert_time_off USING btree (organization_id, starts_at, expert_user_id) WHERE (status = 'active'::text);


--
-- Name: expert_time_off_active_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expert_time_off_active_period_idx ON public.expert_time_off USING gist (organization_id, expert_user_id, time_off_period) WHERE (status = 'active'::text);


--
-- Name: expert_time_off_expert_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expert_time_off_expert_start_idx ON public.expert_time_off USING btree (organization_id, expert_user_id, starts_at);


--
-- Name: external_busy_blocks_connection_calendar_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_busy_blocks_connection_calendar_idx ON public.external_busy_blocks USING btree (organization_id, connection_id, calendar_id);


--
-- Name: external_busy_blocks_external_instance_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX external_busy_blocks_external_instance_key ON public.external_busy_blocks USING btree (connection_id, calendar_id, external_event_id, lower(busy_period), upper(busy_period));


--
-- Name: external_busy_blocks_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_busy_blocks_period_idx ON public.external_busy_blocks USING gist (busy_period);


--
-- Name: facility_images_facility_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_images_facility_sort_idx ON public.facility_images USING btree (organization_id, facility_id, sort_order, created_at, id);


--
-- Name: facility_memberships_bookable_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_memberships_bookable_idx ON public.facility_memberships USING btree (organization_id, facility_id, booking_priority, last_assigned_at) WHERE is_bookable;


--
-- Name: facility_memberships_user_facility_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_memberships_user_facility_idx ON public.facility_memberships USING btree (organization_id, user_id, facility_id);


--
-- Name: facility_opening_hours_facility_weekday_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_opening_hours_facility_weekday_idx ON public.facility_opening_hours USING btree (organization_id, facility_id, weekday);


--
-- Name: facility_opening_overrides_facility_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_opening_overrides_facility_date_idx ON public.facility_opening_overrides USING btree (organization_id, facility_id, local_date);


--
-- Name: facility_service_experts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_service_experts_user_idx ON public.facility_service_experts USING btree (organization_id, user_id, facility_id, service_id);


--
-- Name: facility_services_service_facility_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_services_service_facility_idx ON public.facility_services USING btree (organization_id, service_id, facility_id);


--
-- Name: mail_connections_org_owner_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mail_connections_org_owner_id_key ON public.mail_connections USING btree (organization_id, owner_user_id, id);


--
-- Name: mail_connections_owner_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mail_connections_owner_provider_key ON public.mail_connections USING btree (organization_id, owner_user_id, provider);


--
-- Name: mortgage_bank_aliases_bank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_aliases_bank_idx ON public.mortgage_bank_aliases USING btree (bank_id);


--
-- Name: mortgage_bank_file_chunks_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_file_chunks_search_idx ON public.mortgage_bank_file_chunks USING gin (search_vector);


--
-- Name: mortgage_bank_file_chunks_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_file_chunks_version_idx ON public.mortgage_bank_file_chunks USING btree (version_id, chunk_index);


--
-- Name: mortgage_bank_file_embeddings_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_file_embeddings_hnsw_idx ON public.mortgage_bank_file_embeddings USING hnsw (embedding extensions.vector_cosine_ops);


--
-- Name: mortgage_bank_file_events_file_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_file_events_file_created_idx ON public.mortgage_bank_file_events USING btree (file_id, created_at DESC);


--
-- Name: mortgage_bank_file_jobs_ready_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_file_jobs_ready_idx ON public.mortgage_bank_file_processing_jobs USING btree (status, available_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: mortgage_bank_file_products_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_file_products_product_idx ON public.mortgage_bank_file_products USING btree (product_id, file_id);


--
-- Name: mortgage_bank_file_versions_checksum_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_file_versions_checksum_idx ON public.mortgage_bank_file_versions USING btree (checksum_sha256);


--
-- Name: mortgage_bank_file_versions_file_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_file_versions_file_created_idx ON public.mortgage_bank_file_versions USING btree (file_id, created_at DESC);


--
-- Name: mortgage_bank_file_versions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_file_versions_status_idx ON public.mortgage_bank_file_versions USING btree (status, effective_from DESC);


--
-- Name: mortgage_bank_files_bank_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_files_bank_current_idx ON public.mortgage_bank_files USING btree (bank_id, current_version_id) WHERE (archived_at IS NULL);


--
-- Name: mortgage_bank_files_bank_title_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mortgage_bank_files_bank_title_unique ON public.mortgage_bank_files USING btree (bank_id, lower(btrim(title))) WHERE (archived_at IS NULL);


--
-- Name: mortgage_bank_files_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_files_category_idx ON public.mortgage_bank_files USING btree (category_id, bank_id) WHERE (archived_at IS NULL);


--
-- Name: mortgage_bank_files_title_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_files_title_trgm_idx ON public.mortgage_bank_files USING gin (title extensions.gin_trgm_ops);


--
-- Name: mortgage_bank_override_revisions_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_override_revisions_lookup_idx ON public.mortgage_bank_override_revisions USING btree (organization_id, bank_id, created_at DESC);


--
-- Name: mortgage_bank_overrides_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_bank_overrides_organization_idx ON public.mortgage_bank_overrides USING btree (organization_id, bank_id);


--
-- Name: mortgage_capacity_setting_revisions_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_capacity_setting_revisions_lookup_idx ON public.mortgage_capacity_setting_revisions USING btree (organization_id, created_at DESC);


--
-- Name: mortgage_catalog_events_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_catalog_events_actor_idx ON public.mortgage_catalog_events USING btree (actor_user_id, created_at DESC) WHERE (actor_user_id IS NOT NULL);


--
-- Name: mortgage_catalog_events_bank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_catalog_events_bank_idx ON public.mortgage_catalog_events USING btree (bank_id, created_at DESC) WHERE (bank_id IS NOT NULL);


--
-- Name: mortgage_catalog_events_product_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_catalog_events_product_created_idx ON public.mortgage_catalog_events USING btree (product_id, created_at DESC, id DESC);


--
-- Name: mortgage_catalog_events_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_catalog_events_version_idx ON public.mortgage_catalog_events USING btree (product_version_id) WHERE (product_version_id IS NOT NULL);


--
-- Name: mortgage_document_template_revisions_published_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mortgage_document_template_revisions_published_revision_idx ON public.mortgage_document_template_revisions USING btree (template_id, revision) WHERE (action = 'published'::text);


--
-- Name: mortgage_document_template_revisions_template_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_document_template_revisions_template_created_idx ON public.mortgage_document_template_revisions USING btree (template_id, created_at DESC);


--
-- Name: mortgage_document_templates_bank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_document_templates_bank_idx ON public.mortgage_document_templates USING btree (bank_id, template_key);


--
-- Name: mortgage_product_drafts_base_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_drafts_base_version_idx ON public.mortgage_product_drafts USING btree (base_version_id) WHERE (base_version_id IS NOT NULL);


--
-- Name: mortgage_product_drafts_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_drafts_created_by_idx ON public.mortgage_product_drafts USING btree (created_by_user_id) WHERE (created_by_user_id IS NOT NULL);


--
-- Name: mortgage_product_drafts_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_drafts_updated_by_idx ON public.mortgage_product_drafts USING btree (updated_by_user_id) WHERE (updated_by_user_id IS NOT NULL);


--
-- Name: mortgage_product_override_revisions_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_override_revisions_lookup_idx ON public.mortgage_product_override_revisions USING btree (organization_id, product_id, created_at DESC);


--
-- Name: mortgage_product_overrides_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_overrides_organization_idx ON public.mortgage_product_overrides USING btree (organization_id, product_id);


--
-- Name: mortgage_product_version_document_templates_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_version_document_templates_revision_idx ON public.mortgage_product_version_document_templates USING btree (template_revision_id);


--
-- Name: mortgage_product_version_sources_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_version_sources_document_idx ON public.mortgage_product_version_sources USING btree (source_document_id, product_version_id);


--
-- Name: mortgage_product_version_variants_amount_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_version_variants_amount_idx ON public.mortgage_product_version_variants USING btree (product_version_id, min_amount, max_amount);


--
-- Name: mortgage_product_version_variants_eligibility_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_version_variants_eligibility_gin_idx ON public.mortgage_product_version_variants USING gin (eligibility_config jsonb_path_ops);


--
-- Name: mortgage_product_version_variants_one_default_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mortgage_product_version_variants_one_default_idx ON public.mortgage_product_version_variants USING btree (product_version_id) WHERE is_default;


--
-- Name: mortgage_product_version_variants_pricing_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_version_variants_pricing_gin_idx ON public.mortgage_product_version_variants USING gin (pricing_config jsonb_path_ops);


--
-- Name: mortgage_product_version_variants_version_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_version_variants_version_sort_idx ON public.mortgage_product_version_variants USING btree (product_version_id, sort_order, id);


--
-- Name: mortgage_product_versions_product_retrieved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_versions_product_retrieved_idx ON public.mortgage_product_versions USING btree (product_id, retrieved_at DESC);


--
-- Name: mortgage_product_versions_published_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_versions_published_by_idx ON public.mortgage_product_versions USING btree (published_by_user_id) WHERE (published_by_user_id IS NOT NULL);


--
-- Name: mortgage_product_versions_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_versions_published_idx ON public.mortgage_product_versions USING btree (product_id, lifecycle_status, version_number DESC);


--
-- Name: mortgage_product_versions_retired_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_product_versions_retired_by_idx ON public.mortgage_product_versions USING btree (retired_by_user_id) WHERE (retired_by_user_id IS NOT NULL);


--
-- Name: mortgage_products_active_bank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_products_active_bank_idx ON public.mortgage_products USING btree (is_active, bank_id);


--
-- Name: mortgage_products_archived_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_products_archived_by_idx ON public.mortgage_products USING btree (archived_by_user_id) WHERE (archived_by_user_id IS NOT NULL);


--
-- Name: mortgage_products_archived_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_products_archived_idx ON public.mortgage_products USING btree (archived_at) WHERE (archived_at IS NOT NULL);


--
-- Name: mortgage_products_bank_product_kind_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_products_bank_product_kind_active_idx ON public.mortgage_products USING btree (bank_id, product_kind, is_active) WHERE (archived_at IS NULL);


--
-- Name: mortgage_products_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_products_created_by_idx ON public.mortgage_products USING btree (created_by_user_id) WHERE (created_by_user_id IS NOT NULL);


--
-- Name: mortgage_products_current_published_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_products_current_published_version_idx ON public.mortgage_products USING btree (current_published_version_id) WHERE (current_published_version_id IS NOT NULL);


--
-- Name: mortgage_products_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_products_updated_by_idx ON public.mortgage_products USING btree (updated_by_user_id) WHERE (updated_by_user_id IS NOT NULL);


--
-- Name: mortgage_source_documents_bank_retrieved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mortgage_source_documents_bank_retrieved_idx ON public.mortgage_source_documents USING btree (bank_id, retrieved_at DESC);


--
-- Name: organization_memberships_user_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_memberships_user_org_idx ON public.organization_memberships USING btree (user_id, organization_id);


--
-- Name: organization_user_access_states_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_user_access_states_updated_by_idx ON public.organization_user_access_states USING btree (updated_by_user_id) WHERE (updated_by_user_id IS NOT NULL);


--
-- Name: organization_user_admin_roles_assigner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_user_admin_roles_assigner_idx ON public.organization_user_admin_roles USING btree (assigned_by_user_id);


--
-- Name: organization_user_admin_roles_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_user_admin_roles_user_idx ON public.organization_user_admin_roles USING btree (user_id, organization_id);


--
-- Name: organization_user_audit_events_actor_timeline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_user_audit_events_actor_timeline_idx ON public.organization_user_audit_events USING btree (organization_id, actor_user_id, created_at DESC) WHERE (actor_user_id IS NOT NULL);


--
-- Name: organization_user_audit_events_correlation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_user_audit_events_correlation_idx ON public.organization_user_audit_events USING btree (organization_id, correlation_id);


--
-- Name: organization_user_audit_events_target_timeline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_user_audit_events_target_timeline_idx ON public.organization_user_audit_events USING btree (organization_id, target_user_id, created_at DESC, id DESC);


--
-- Name: organization_user_direct_grants_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_user_direct_grants_effective_idx ON public.organization_user_direct_grants USING btree (organization_id, user_id, permission_key, expires_at) WHERE (status = 'active'::text);


--
-- Name: organization_user_direct_grants_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_user_direct_grants_one_active_idx ON public.organization_user_direct_grants USING btree (organization_id, user_id, permission_key) WHERE (status = 'active'::text);


--
-- Name: organization_user_preferences_default_facility_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_user_preferences_default_facility_idx ON public.organization_user_preferences USING btree (organization_id, default_facility_id) WHERE (default_facility_id IS NOT NULL);


--
-- Name: team_edges_child_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_edges_child_parent_idx ON public.team_edges USING btree (organization_id, child_team_id, parent_team_id);


--
-- Name: team_facilities_facility_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_facilities_facility_team_idx ON public.team_facilities USING btree (organization_id, facility_id, team_id);


--
-- Name: team_memberships_user_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_memberships_user_team_idx ON public.team_memberships USING btree (organization_id, user_id, team_id);


--
-- Name: users_default_organization_membership_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_default_organization_membership_idx ON public.users USING btree (organization_id, id, role);


--
-- Name: users_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_organization_id_idx ON public.users USING btree (organization_id);


--
-- Name: waitlist_survey_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX waitlist_survey_token_idx ON public.waitlist USING btree (survey_token);


--
-- Name: mortgage_product_version_document_templates a_mortgage_product_version_document_templates_validate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER a_mortgage_product_version_document_templates_validate BEFORE INSERT OR UPDATE ON public.mortgage_product_version_document_templates FOR EACH ROW EXECUTE FUNCTION private.validate_mortgage_product_version_document_template();


--
-- Name: mortgage_product_versions a_mortgage_product_versions_pin_document_templates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER a_mortgage_product_versions_pin_document_templates AFTER INSERT ON public.mortgage_product_versions FOR EACH ROW EXECUTE FUNCTION private.pin_mortgage_product_version_document_templates();


--
-- Name: appointment_calendar_events appointment_calendar_events_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointment_calendar_events_set_updated_at BEFORE UPDATE ON public.appointment_calendar_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: appointment_resource_reservations appointment_resource_reservations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointment_resource_reservations_set_updated_at BEFORE UPDATE ON public.appointment_resource_reservations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: appointments appointments_enqueue_outbox; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_enqueue_outbox AFTER INSERT OR UPDATE OF starts_at, ends_at, expert_user_id, status, client_id, client_person_id, meeting_mode, meeting_url ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.enqueue_appointment_outbox();


--
-- Name: appointments appointments_refresh_omnisearch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_refresh_omnisearch BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.refresh_appointment_omnisearch();


--
-- Name: appointments appointments_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: appointments appointments_sync_reservation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_sync_reservation AFTER INSERT OR UPDATE OF starts_at, ends_at, expert_user_id, service_id, status, hold_expires_at ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.sync_appointment_reservation();


--
-- Name: booking_services booking_services_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_services_set_updated_at BEFORE UPDATE ON public.booking_services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: booking_widget_events booking_widget_events_retention; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_widget_events_retention BEFORE INSERT ON public.booking_widget_events FOR EACH ROW EXECUTE FUNCTION private.prune_booking_widget_events();


--
-- Name: booking_widgets booking_widgets_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_widgets_set_updated_at BEFORE UPDATE ON public.booking_widgets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: calendar_connections calendar_connections_reset_dependents; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER calendar_connections_reset_dependents BEFORE UPDATE OF account_id, selected_calendar_id ON public.calendar_connections FOR EACH ROW EXECUTE FUNCTION private.reset_calendar_connection_dependents();


--
-- Name: calendar_connections calendar_connections_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER calendar_connections_set_updated_at BEFORE UPDATE ON public.calendar_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_case_bank_applications crm_case_bank_applications_guard_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_bank_applications_guard_insert BEFORE INSERT ON public.crm_case_bank_applications FOR EACH ROW EXECUTE FUNCTION private.guard_crm_case_bank_application_insert();


--
-- Name: crm_case_bank_applications crm_case_bank_applications_refresh_omnisearch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_bank_applications_refresh_omnisearch BEFORE INSERT OR UPDATE ON public.crm_case_bank_applications FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_bank_application_omnisearch();


--
-- Name: crm_case_bank_applications crm_case_bank_applications_snapshot_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_bank_applications_snapshot_guard BEFORE UPDATE ON public.crm_case_bank_applications FOR EACH ROW EXECUTE FUNCTION private.validate_crm_case_bank_application_snapshot();


--
-- Name: crm_case_clients crm_case_clients_refresh_case_search_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_clients_refresh_case_search_projection AFTER INSERT OR DELETE OR UPDATE OF client_id, is_primary ON public.crm_case_clients FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_case_search_from_relation();


--
-- Name: crm_case_contract_selections crm_case_contract_selections_close_other_applications; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_contract_selections_close_other_applications AFTER INSERT ON public.crm_case_contract_selections FOR EACH ROW EXECUTE FUNCTION private.close_other_crm_case_bank_applications();


--
-- Name: crm_case_contract_selections crm_case_contract_selections_guard_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_contract_selections_guard_insert BEFORE INSERT ON public.crm_case_contract_selections FOR EACH ROW EXECUTE FUNCTION private.guard_crm_case_contract_insert();


--
-- Name: crm_case_items crm_case_items_refresh_case_search_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_items_refresh_case_search_projection AFTER INSERT OR DELETE OR UPDATE OF case_id, product_type_id, title, status_code ON public.crm_case_items FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_case_search_from_relation();


--
-- Name: crm_case_items crm_case_items_validate_product_type_scope; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_items_validate_product_type_scope BEFORE INSERT OR UPDATE OF organization_id, product_type_id ON public.crm_case_items FOR EACH ROW EXECUTE FUNCTION private.validate_crm_product_type_scope();


--
-- Name: crm_case_multiform_drafts crm_case_multiform_drafts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_multiform_drafts_set_updated_at BEFORE UPDATE ON public.crm_case_multiform_drafts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_validate_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_offer_snapshots_validate_insert BEFORE INSERT ON public.crm_case_offer_snapshots FOR EACH ROW EXECUTE FUNCTION private.validate_crm_case_offer_snapshot_insert();


--
-- Name: crm_case_offer_snapshots crm_case_offers_refresh_case_search_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_case_offers_refresh_case_search_projection AFTER INSERT OR DELETE ON public.crm_case_offer_snapshots FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_case_search_from_relation();


--
-- Name: crm_cases crm_cases_refresh_search_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_cases_refresh_search_projection AFTER INSERT OR UPDATE OF title, description, status_code ON public.crm_cases FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_case_search_from_case();


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_client_anonymization_execution_grants_set_updated_at BEFORE UPDATE ON public.crm_client_anonymization_execution_grants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_client_anonymization_request_events crm_client_anonymization_request_events_protect_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_client_anonymization_request_events_protect_append_only BEFORE DELETE OR UPDATE ON public.crm_client_anonymization_request_events FOR EACH ROW EXECUTE FUNCTION private.protect_crm_client_anonymization_request_event();


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_protect_identity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_client_anonymization_requests_protect_identity BEFORE UPDATE ON public.crm_client_anonymization_requests FOR EACH ROW EXECUTE FUNCTION private.protect_crm_client_anonymization_request_identity();


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_client_anonymization_requests_set_updated_at BEFORE UPDATE ON public.crm_client_anonymization_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_client_people crm_client_people_refresh_client_search_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_client_people_refresh_client_search_projection AFTER INSERT OR DELETE OR UPDATE OF client_id, first_name, last_name, display_name, email, phone, pesel ON public.crm_client_people FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_client_search_projection();


--
-- Name: crm_clients crm_clients_enforce_creation_consents; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER crm_clients_enforce_creation_consents AFTER INSERT ON public.crm_clients DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.enforce_crm_client_creation_consents();


--
-- Name: crm_clients crm_clients_refresh_case_search_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_clients_refresh_case_search_projection AFTER UPDATE OF display_name, primary_email, primary_phone, search_text ON public.crm_clients FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_case_search_from_client();


--
-- Name: crm_clients crm_clients_set_search_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_clients_set_search_projection BEFORE INSERT OR UPDATE OF display_name, primary_email, primary_phone, lead_source, notes, tags, metadata ON public.crm_clients FOR EACH ROW EXECUTE FUNCTION private.set_crm_client_search_projection();


--
-- Name: crm_clients crm_clients_validate_owner_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_clients_validate_owner_assignment BEFORE INSERT OR UPDATE OF owner_user_id ON public.crm_clients FOR EACH ROW EXECUTE FUNCTION private.validate_crm_client_owner_assignment();


--
-- Name: crm_consent_definitions crm_consent_definitions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_consent_definitions_set_updated_at BEFORE UPDATE ON public.crm_consent_definitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_documents crm_documents_refresh_omnisearch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_documents_refresh_omnisearch BEFORE INSERT OR UPDATE ON public.crm_documents FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_document_omnisearch();


--
-- Name: crm_eve_sessions crm_eve_sessions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_eve_sessions_set_updated_at BEFORE UPDATE ON public.crm_eve_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_item_submissions crm_item_submissions_guard_mortgage_application_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_item_submissions_guard_mortgage_application_delete BEFORE DELETE ON public.crm_item_submissions FOR EACH ROW EXECUTE FUNCTION private.guard_crm_bank_application_submission_delete();


--
-- Name: crm_item_submissions crm_item_submissions_guard_signed_bank_application_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_item_submissions_guard_signed_bank_application_status BEFORE UPDATE OF status_code ON public.crm_item_submissions FOR EACH ROW EXECUTE FUNCTION private.guard_signed_crm_bank_application_status();


--
-- Name: crm_item_submissions crm_item_submissions_refresh_omnisearch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_item_submissions_refresh_omnisearch BEFORE INSERT OR UPDATE ON public.crm_item_submissions FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_submission_omnisearch();


--
-- Name: crm_item_submissions crm_item_submissions_require_bank_application_snapshot_to_start; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_item_submissions_require_bank_application_snapshot_to_start BEFORE UPDATE OF status_code ON public.crm_item_submissions FOR EACH ROW EXECUTE FUNCTION private.require_crm_bank_application_snapshot_to_start();


--
-- Name: crm_product_types crm_product_types_refresh_case_search_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_product_types_refresh_case_search_projection AFTER UPDATE OF name, code, domain ON public.crm_product_types FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_case_search_from_product_type();


--
-- Name: crm_properties crm_properties_refresh_case_search_projection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_properties_refresh_case_search_projection AFTER INSERT OR DELETE OR UPDATE OF case_id, case_item_id, listing_title, address, city, postal_code, property_type, market_type, description ON public.crm_properties FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_case_search_from_property();


--
-- Name: crm_tasks crm_tasks_cancel_future_appointments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_tasks_cancel_future_appointments AFTER UPDATE OF delegation_status, assignee_user_id ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION private.cancel_future_delegated_task_appointments();


--
-- Name: crm_tasks crm_tasks_guard_status_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_tasks_guard_status_actor BEFORE UPDATE OF status_code, delegation_status ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION private.guard_delegated_task_status_actor();


--
-- Name: crm_tasks crm_tasks_record_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_tasks_record_audit AFTER INSERT OR UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION private.record_crm_task_audit();


--
-- Name: crm_tasks crm_tasks_refresh_omnisearch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_tasks_refresh_omnisearch BEFORE INSERT OR UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION private.refresh_crm_task_omnisearch();


--
-- Name: crm_tasks crm_tasks_validate_delegation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_tasks_validate_delegation BEFORE INSERT OR UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION private.validate_crm_task_delegation();


--
-- Name: expert_availability_overrides expert_availability_overrides_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER expert_availability_overrides_set_updated_at BEFORE UPDATE ON public.expert_availability_overrides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: expert_availability_rules expert_availability_rules_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER expert_availability_rules_set_updated_at BEFORE UPDATE ON public.expert_availability_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: expert_time_off expert_time_off_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER expert_time_off_set_updated_at BEFORE UPDATE ON public.expert_time_off FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: expert_time_off expert_time_off_sync_reservation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER expert_time_off_sync_reservation AFTER INSERT OR UPDATE OF expert_user_id, starts_at, ends_at, status ON public.expert_time_off FOR EACH ROW EXECUTE FUNCTION private.sync_expert_time_off_reservation();


--
-- Name: expert_time_off expert_time_off_validate_timezone; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER expert_time_off_validate_timezone BEFORE INSERT OR UPDATE OF timezone ON public.expert_time_off FOR EACH ROW EXECUTE FUNCTION private.validate_facility_timezone();


--
-- Name: external_busy_blocks external_busy_blocks_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER external_busy_blocks_set_updated_at BEFORE UPDATE ON public.external_busy_blocks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facilities facilities_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facilities_set_updated_at BEFORE UPDATE ON public.facilities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facilities facilities_validate_timezone; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facilities_validate_timezone BEFORE INSERT OR UPDATE OF timezone ON public.facilities FOR EACH ROW EXECUTE FUNCTION private.validate_facility_timezone();


--
-- Name: facility_images facility_images_enforce_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facility_images_enforce_limit BEFORE INSERT ON public.facility_images FOR EACH ROW EXECUTE FUNCTION private.enforce_facility_image_limit();


--
-- Name: facility_memberships facility_memberships_audit_structure_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facility_memberships_audit_structure_change AFTER INSERT OR UPDATE OF role, is_bookable, booking_priority ON public.facility_memberships FOR EACH ROW EXECUTE FUNCTION private.audit_structure_membership_change();


--
-- Name: facility_memberships facility_memberships_audit_structure_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facility_memberships_audit_structure_delete BEFORE DELETE ON public.facility_memberships FOR EACH ROW EXECUTE FUNCTION private.audit_structure_membership_change();


--
-- Name: facility_memberships facility_memberships_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facility_memberships_set_updated_at BEFORE UPDATE ON public.facility_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facility_opening_hours facility_opening_hours_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facility_opening_hours_set_updated_at BEFORE UPDATE ON public.facility_opening_hours FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facility_opening_overrides facility_opening_overrides_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facility_opening_overrides_set_updated_at BEFORE UPDATE ON public.facility_opening_overrides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facility_service_experts facility_service_experts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facility_service_experts_set_updated_at BEFORE UPDATE ON public.facility_service_experts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facility_services facility_services_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER facility_services_set_updated_at BEFORE UPDATE ON public.facility_services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mail_connections mail_connections_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mail_connections_set_updated_at BEFORE UPDATE ON public.mail_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mail_send_requests mail_send_requests_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mail_send_requests_set_updated_at BEFORE UPDATE ON public.mail_send_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_bank_aliases mortgage_bank_aliases_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_bank_aliases_set_updated_at BEFORE UPDATE ON public.mortgage_bank_aliases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_bank_file_categories mortgage_bank_file_categories_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_bank_file_categories_set_updated_at BEFORE UPDATE ON public.mortgage_bank_file_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_bank_file_events mortgage_bank_file_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_bank_file_events_append_only BEFORE DELETE OR UPDATE ON public.mortgage_bank_file_events FOR EACH ROW EXECUTE FUNCTION private.reject_mortgage_bank_file_event_mutation();


--
-- Name: mortgage_bank_file_processing_jobs mortgage_bank_file_jobs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_bank_file_jobs_set_updated_at BEFORE UPDATE ON public.mortgage_bank_file_processing_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_bank_file_versions mortgage_bank_file_versions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_bank_file_versions_set_updated_at BEFORE UPDATE ON public.mortgage_bank_file_versions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_bank_files mortgage_bank_files_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_bank_files_set_updated_at BEFORE UPDATE ON public.mortgage_bank_files FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_bank_overrides_audit AFTER INSERT OR DELETE OR UPDATE ON public.mortgage_bank_overrides FOR EACH ROW EXECUTE FUNCTION private.audit_mortgage_bank_override();


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_prepare; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_bank_overrides_prepare BEFORE INSERT OR UPDATE ON public.mortgage_bank_overrides FOR EACH ROW EXECUTE FUNCTION private.prepare_mortgage_bank_override();


--
-- Name: mortgage_banks mortgage_banks_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_banks_set_updated_at BEFORE UPDATE ON public.mortgage_banks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_capacity_settings_audit AFTER INSERT OR DELETE OR UPDATE ON public.mortgage_capacity_settings FOR EACH ROW EXECUTE FUNCTION private.audit_mortgage_capacity_settings();


--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_prepare; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_capacity_settings_prepare BEFORE INSERT OR UPDATE ON public.mortgage_capacity_settings FOR EACH ROW EXECUTE FUNCTION private.prepare_mortgage_capacity_settings();


--
-- Name: mortgage_catalog_events mortgage_catalog_events_protect_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_catalog_events_protect_append_only BEFORE DELETE OR UPDATE ON public.mortgage_catalog_events FOR EACH ROW EXECUTE FUNCTION private.protect_mortgage_catalog_event();


--
-- Name: mortgage_document_template_revisions mortgage_document_template_revisions_protect_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_document_template_revisions_protect_append_only BEFORE DELETE OR UPDATE ON public.mortgage_document_template_revisions FOR EACH ROW EXECUTE FUNCTION private.protect_mortgage_document_template_revision();


--
-- Name: mortgage_document_templates mortgage_document_templates_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_document_templates_set_updated_at BEFORE UPDATE ON public.mortgage_document_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_document_templates mortgage_document_templates_validate_active_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_document_templates_validate_active_state BEFORE INSERT OR UPDATE ON public.mortgage_document_templates FOR EACH ROW EXECUTE FUNCTION private.validate_mortgage_document_template_active_state();


--
-- Name: mortgage_product_drafts mortgage_product_drafts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_drafts_set_updated_at BEFORE UPDATE ON public.mortgage_product_drafts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_product_overrides mortgage_product_overrides_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_overrides_audit AFTER INSERT OR DELETE OR UPDATE ON public.mortgage_product_overrides FOR EACH ROW EXECUTE FUNCTION private.audit_mortgage_product_override();


--
-- Name: mortgage_product_overrides mortgage_product_overrides_prepare; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_overrides_prepare BEFORE INSERT OR UPDATE ON public.mortgage_product_overrides FOR EACH ROW EXECUTE FUNCTION private.prepare_mortgage_product_override();


--
-- Name: mortgage_product_version_document_templates mortgage_product_version_document_templates_protect_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_version_document_templates_protect_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.mortgage_product_version_document_templates FOR EACH ROW EXECUTE FUNCTION private.protect_published_mortgage_version_child();


--
-- Name: mortgage_product_version_sources mortgage_product_version_sources_protect_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_version_sources_protect_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.mortgage_product_version_sources FOR EACH ROW EXECUTE FUNCTION private.protect_published_mortgage_version_child();


--
-- Name: mortgage_product_version_variants mortgage_product_version_variants_protect_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_version_variants_protect_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.mortgage_product_version_variants FOR EACH ROW EXECUTE FUNCTION private.protect_published_mortgage_version_child();


--
-- Name: mortgage_product_versions mortgage_product_versions_finalize_legacy_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_versions_finalize_legacy_insert AFTER INSERT ON public.mortgage_product_versions FOR EACH ROW EXECUTE FUNCTION private.finalize_legacy_mortgage_product_version_insert();


--
-- Name: mortgage_product_versions mortgage_product_versions_prepare_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_versions_prepare_insert BEFORE INSERT ON public.mortgage_product_versions FOR EACH ROW EXECUTE FUNCTION private.prepare_mortgage_product_version_insert();


--
-- Name: mortgage_product_versions mortgage_product_versions_protect_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_versions_protect_immutable BEFORE DELETE OR UPDATE ON public.mortgage_product_versions FOR EACH ROW EXECUTE FUNCTION private.protect_mortgage_product_version();


--
-- Name: mortgage_product_versions mortgage_product_versions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_product_versions_set_updated_at BEFORE UPDATE ON public.mortgage_product_versions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_products mortgage_products_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_products_set_updated_at BEFORE UPDATE ON public.mortgage_products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mortgage_source_documents mortgage_source_documents_protect_published_evidence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_source_documents_protect_published_evidence BEFORE DELETE OR UPDATE ON public.mortgage_source_documents FOR EACH ROW EXECUTE FUNCTION private.protect_published_mortgage_source_document();


--
-- Name: mortgage_source_documents mortgage_source_documents_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER mortgage_source_documents_set_updated_at BEFORE UPDATE ON public.mortgage_source_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organization_memberships organization_memberships_initialize_access_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_memberships_initialize_access_state AFTER INSERT ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION private.initialize_organization_user_access_state();


--
-- Name: organization_memberships organization_memberships_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_memberships_set_updated_at BEFORE UPDATE ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organization_user_audit_events organization_user_audit_events_protect_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_user_audit_events_protect_append_only BEFORE DELETE OR UPDATE ON public.organization_user_audit_events FOR EACH ROW EXECUTE FUNCTION private.protect_organization_user_audit_event();


--
-- Name: organization_user_direct_grants organization_user_direct_grants_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_user_direct_grants_set_updated_at BEFORE UPDATE ON public.organization_user_direct_grants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organization_user_preferences organization_user_preferences_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_user_preferences_set_updated_at BEFORE UPDATE ON public.organization_user_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organizations organizations_provision_default_crm_consents; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_provision_default_crm_consents AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.provision_default_crm_consents_on_organization_insert();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_case_clients set_crm_case_clients_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_case_clients_updated_at BEFORE UPDATE ON public.crm_case_clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_case_item_settlements set_crm_case_item_settlements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_case_item_settlements_updated_at BEFORE UPDATE ON public.crm_case_item_settlements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_case_items set_crm_case_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_case_items_updated_at BEFORE UPDATE ON public.crm_case_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_case_participants set_crm_case_participants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_case_participants_updated_at BEFORE UPDATE ON public.crm_case_participants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_cases set_crm_cases_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_cases_updated_at BEFORE UPDATE ON public.crm_cases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_client_people set_crm_client_people_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_client_people_updated_at BEFORE UPDATE ON public.crm_client_people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_clients set_crm_clients_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_clients_updated_at BEFORE UPDATE ON public.crm_clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_documents set_crm_documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_documents_updated_at BEFORE UPDATE ON public.crm_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_item_submissions set_crm_item_submissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_item_submissions_updated_at BEFORE UPDATE ON public.crm_item_submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_product_types set_crm_product_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_product_types_updated_at BEFORE UPDATE ON public.crm_product_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_properties set_crm_properties_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_properties_updated_at BEFORE UPDATE ON public.crm_properties FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_property_images set_crm_property_images_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_property_images_updated_at BEFORE UPDATE ON public.crm_property_images FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_providers set_crm_providers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_providers_updated_at BEFORE UPDATE ON public.crm_providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_tasks set_crm_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_tasks_updated_at BEFORE UPDATE ON public.crm_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_workflow_statuses set_crm_workflow_statuses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_workflow_statuses_updated_at BEFORE UPDATE ON public.crm_workflow_statuses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_workflows set_crm_workflows_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_crm_workflows_updated_at BEFORE UPDATE ON public.crm_workflows FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: expert_brand_profiles set_expert_brand_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_expert_brand_profiles_updated_at BEFORE UPDATE ON public.expert_brand_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: facility_images set_facility_images_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_facility_images_updated_at BEFORE UPDATE ON public.facility_images FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: team_edges team_edges_reject_cycles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER team_edges_reject_cycles BEFORE INSERT ON public.team_edges FOR EACH ROW EXECUTE FUNCTION private.reject_team_edge_cycle();


--
-- Name: team_memberships team_memberships_audit_structure_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER team_memberships_audit_structure_change AFTER INSERT OR UPDATE OF role ON public.team_memberships FOR EACH ROW EXECUTE FUNCTION private.audit_structure_membership_change();


--
-- Name: team_memberships team_memberships_audit_structure_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER team_memberships_audit_structure_delete BEFORE DELETE ON public.team_memberships FOR EACH ROW EXECUTE FUNCTION private.audit_structure_membership_change();


--
-- Name: team_memberships team_memberships_protect_last_admin; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER team_memberships_protect_last_admin BEFORE DELETE OR UPDATE OF role ON public.team_memberships FOR EACH ROW EXECUTE FUNCTION private.protect_last_team_admin();


--
-- Name: team_memberships team_memberships_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER team_memberships_set_updated_at BEFORE UPDATE ON public.team_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: teams teams_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organization_admin_access_commands organization_admin_access_commands_organization_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.organization_admin_access_commands
    ADD CONSTRAINT organization_admin_access_commands_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: team_graph_revisions team_graph_revisions_organization_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.team_graph_revisions
    ADD CONSTRAINT team_graph_revisions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: administrative_role_permissions administrative_role_permissions_role_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.administrative_role_permissions
    ADD CONSTRAINT administrative_role_permissions_role_key_fkey FOREIGN KEY (role_key) REFERENCES public.administrative_roles(role_key) ON DELETE CASCADE;


--
-- Name: appointment_calendar_events appointment_calendar_events_appointment_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_calendar_events
    ADD CONSTRAINT appointment_calendar_events_appointment_fkey FOREIGN KEY (organization_id, appointment_id) REFERENCES public.appointments(organization_id, id) ON DELETE CASCADE;


--
-- Name: appointment_calendar_events appointment_calendar_events_connection_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_calendar_events
    ADD CONSTRAINT appointment_calendar_events_connection_fkey FOREIGN KEY (organization_id, connection_id) REFERENCES public.calendar_connections(organization_id, id) ON DELETE CASCADE;


--
-- Name: appointment_resource_reservations appointment_resource_reservations_appointment_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_resource_reservations
    ADD CONSTRAINT appointment_resource_reservations_appointment_fkey FOREIGN KEY (organization_id, appointment_id) REFERENCES public.appointments(organization_id, id) ON DELETE CASCADE;


--
-- Name: appointment_resource_reservations appointment_resource_reservations_time_off_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_resource_reservations
    ADD CONSTRAINT appointment_resource_reservations_time_off_fkey FOREIGN KEY (organization_id, time_off_id) REFERENCES public.expert_time_off(organization_id, id) ON DELETE CASCADE;


--
-- Name: appointments appointments_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_client_fkey FOREIGN KEY (organization_id, client_id) REFERENCES public.crm_clients(organization_id, id);


--
-- Name: appointments appointments_client_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_client_person_fkey FOREIGN KEY (organization_id, client_id, client_person_id) REFERENCES public.crm_client_people(organization_id, client_id, id);


--
-- Name: appointments appointments_created_by_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_created_by_member_fkey FOREIGN KEY (organization_id, created_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: appointments appointments_expert_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_expert_user_fkey FOREIGN KEY (expert_user_id) REFERENCES public.users(id);


--
-- Name: appointments appointments_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_facility_fkey FOREIGN KEY (organization_id, facility_id) REFERENCES public.facilities(organization_id, id);


--
-- Name: appointments appointments_organization_crm_task_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_organization_crm_task_fkey FOREIGN KEY (organization_id, crm_task_id) REFERENCES public.crm_tasks(organization_id, id) ON DELETE SET NULL;


--
-- Name: appointments appointments_service_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_service_fkey FOREIGN KEY (organization_id, service_id) REFERENCES public.booking_services(organization_id, id);


--
-- Name: appointments appointments_widget_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_widget_fkey FOREIGN KEY (widget_id) REFERENCES public.booking_widgets(id) ON DELETE SET NULL;


--
-- Name: booking_outbox booking_outbox_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_outbox
    ADD CONSTRAINT booking_outbox_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: booking_rate_limits booking_rate_limits_widget_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_rate_limits
    ADD CONSTRAINT booking_rate_limits_widget_id_fkey FOREIGN KEY (widget_id) REFERENCES public.booking_widgets(id) ON DELETE CASCADE;


--
-- Name: booking_services booking_services_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: booking_widget_events booking_widget_events_service_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widget_events
    ADD CONSTRAINT booking_widget_events_service_fkey FOREIGN KEY (organization_id, service_id) REFERENCES public.booking_services(organization_id, id) ON DELETE CASCADE;


--
-- Name: booking_widget_events booking_widget_events_widget_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widget_events
    ADD CONSTRAINT booking_widget_events_widget_fkey FOREIGN KEY (organization_id, facility_id, widget_id) REFERENCES public.booking_widgets(organization_id, facility_id, id) ON DELETE CASCADE;


--
-- Name: booking_widget_services booking_widget_services_facility_service_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widget_services
    ADD CONSTRAINT booking_widget_services_facility_service_fkey FOREIGN KEY (organization_id, facility_id, service_id) REFERENCES public.facility_services(organization_id, facility_id, service_id) ON DELETE CASCADE;


--
-- Name: booking_widget_services booking_widget_services_widget_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widget_services
    ADD CONSTRAINT booking_widget_services_widget_fkey FOREIGN KEY (organization_id, facility_id, widget_id) REFERENCES public.booking_widgets(organization_id, facility_id, id) ON DELETE CASCADE;


--
-- Name: booking_widgets booking_widgets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widgets
    ADD CONSTRAINT booking_widgets_created_by_fkey FOREIGN KEY (organization_id, created_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: booking_widgets booking_widgets_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widgets
    ADD CONSTRAINT booking_widgets_facility_fkey FOREIGN KEY (organization_id, facility_id) REFERENCES public.facilities(organization_id, id) ON DELETE CASCADE;


--
-- Name: booking_widgets booking_widgets_fixed_expert_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_widgets
    ADD CONSTRAINT booking_widgets_fixed_expert_fkey FOREIGN KEY (organization_id, facility_id, fixed_expert_user_id) REFERENCES public.facility_memberships(organization_id, facility_id, user_id);


--
-- Name: calendar_connections calendar_connections_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_facility_fkey FOREIGN KEY (organization_id, facility_id) REFERENCES public.facilities(organization_id, id) ON DELETE CASCADE;


--
-- Name: calendar_connections calendar_connections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: calendar_connections calendar_connections_owner_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_owner_user_fkey FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: client_account_links client_account_links_appointment_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_account_links
    ADD CONSTRAINT client_account_links_appointment_fkey FOREIGN KEY (organization_id, source_appointment_id) REFERENCES public.appointments(organization_id, id) ON DELETE SET NULL (source_appointment_id);


--
-- Name: client_account_links client_account_links_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_account_links
    ADD CONSTRAINT client_account_links_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: client_account_links client_account_links_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_account_links
    ADD CONSTRAINT client_account_links_person_fkey FOREIGN KEY (organization_id, client_id, client_person_id) REFERENCES public.crm_client_people(organization_id, client_id, id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_activities crm_activities_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.crm_cases(id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_case_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_case_item_id_fkey FOREIGN KEY (case_item_id) REFERENCES public.crm_case_items(id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.crm_clients(id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_organization_actor_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_organization_actor_membership_fkey FOREIGN KEY (organization_id, actor_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_activities crm_activities_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_organization_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_organization_client_fkey FOREIGN KEY (organization_id, client_id) REFERENCES public.crm_clients(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_organization_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_organization_item_fkey FOREIGN KEY (organization_id, case_item_id) REFERENCES public.crm_case_items(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_organization_submission_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_organization_submission_fkey FOREIGN KEY (organization_id, submission_id) REFERENCES public.crm_item_submissions(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_organization_task_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_organization_task_fkey FOREIGN KEY (organization_id, task_id) REFERENCES public.crm_tasks(organization_id, id) ON DELETE SET NULL;


--
-- Name: crm_activities crm_activities_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.crm_item_submissions(id) ON DELETE CASCADE;


--
-- Name: crm_case_bank_applications crm_case_bank_applications_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE RESTRICT;


--
-- Name: crm_case_bank_applications crm_case_bank_applications_baseline_offer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_baseline_offer_fkey FOREIGN KEY (organization_id, case_id, comparison_baseline_offer_id) REFERENCES public.crm_case_offer_snapshots(organization_id, case_id, id) ON DELETE RESTRICT;


--
-- Name: crm_case_bank_applications crm_case_bank_applications_case_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_case_item_fkey FOREIGN KEY (organization_id, case_item_id) REFERENCES public.crm_case_items(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_bank_applications crm_case_bank_applications_case_offer_bank_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_case_offer_bank_fkey FOREIGN KEY (organization_id, case_id, offer_id, bank_id) REFERENCES public.crm_case_offer_snapshots(organization_id, case_id, id, bank_id) ON DELETE RESTRICT;


--
-- Name: crm_case_bank_applications crm_case_bank_applications_case_property_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_case_property_fkey FOREIGN KEY (organization_id, case_id, property_id) REFERENCES public.crm_properties(organization_id, case_id, id) ON DELETE RESTRICT;


--
-- Name: crm_case_bank_applications crm_case_bank_applications_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_case_bank_applications crm_case_bank_applications_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_bank_applications crm_case_bank_applications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_bank_applications crm_case_bank_applications_submission_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_bank_applications
    ADD CONSTRAINT crm_case_bank_applications_submission_item_fkey FOREIGN KEY (organization_id, case_item_id, submission_id) REFERENCES public.crm_item_submissions(organization_id, case_item_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_clients crm_case_clients_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_clients
    ADD CONSTRAINT crm_case_clients_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_clients crm_case_clients_organization_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_clients
    ADD CONSTRAINT crm_case_clients_organization_client_fkey FOREIGN KEY (organization_id, client_id) REFERENCES public.crm_clients(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_clients crm_case_clients_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_clients
    ADD CONSTRAINT crm_case_clients_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_contract_selections crm_case_contract_selections_application_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_contract_selections
    ADD CONSTRAINT crm_case_contract_selections_application_fkey FOREIGN KEY (organization_id, case_id, application_id) REFERENCES public.crm_case_bank_applications(organization_id, case_id, submission_id) ON DELETE RESTRICT;


--
-- Name: crm_case_contract_selections crm_case_contract_selections_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_contract_selections
    ADD CONSTRAINT crm_case_contract_selections_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_contract_selections crm_case_contract_selections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_contract_selections
    ADD CONSTRAINT crm_case_contract_selections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_contract_selections crm_case_contract_selections_signed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_contract_selections
    ADD CONSTRAINT crm_case_contract_selections_signed_by_user_id_fkey FOREIGN KEY (signed_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: crm_case_item_settlements crm_case_item_settlements_case_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_item_settlements
    ADD CONSTRAINT crm_case_item_settlements_case_item_id_fkey FOREIGN KEY (case_item_id) REFERENCES public.crm_case_items(id) ON DELETE CASCADE;


--
-- Name: crm_case_item_settlements crm_case_item_settlements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_item_settlements
    ADD CONSTRAINT crm_case_item_settlements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_item_settlements crm_case_item_settlements_payer_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_item_settlements
    ADD CONSTRAINT crm_case_item_settlements_payer_provider_id_fkey FOREIGN KEY (payer_provider_id) REFERENCES public.crm_providers(id) ON DELETE SET NULL;


--
-- Name: crm_case_items crm_case_items_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_items
    ADD CONSTRAINT crm_case_items_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.crm_cases(id) ON DELETE CASCADE;


--
-- Name: crm_case_items crm_case_items_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_items
    ADD CONSTRAINT crm_case_items_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_items crm_case_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_items
    ADD CONSTRAINT crm_case_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_items crm_case_items_organization_owner_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_items
    ADD CONSTRAINT crm_case_items_organization_owner_membership_fkey FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_case_items crm_case_items_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_items
    ADD CONSTRAINT crm_case_items_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_case_items crm_case_items_product_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_items
    ADD CONSTRAINT crm_case_items_product_type_id_fkey FOREIGN KEY (product_type_id) REFERENCES public.crm_product_types(id);


--
-- Name: crm_case_multiform_drafts crm_case_multiform_drafts_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_multiform_drafts
    ADD CONSTRAINT crm_case_multiform_drafts_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_multiform_drafts crm_case_multiform_drafts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_multiform_drafts
    ADD CONSTRAINT crm_case_multiform_drafts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_multiform_drafts crm_case_multiform_drafts_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_multiform_drafts
    ADD CONSTRAINT crm_case_multiform_drafts_updated_by_fkey FOREIGN KEY (organization_id, updated_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE SET NULL (updated_by_user_id);


--
-- Name: crm_case_offer_selections crm_case_offer_selections_case_offer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_selections
    ADD CONSTRAINT crm_case_offer_selections_case_offer_fkey FOREIGN KEY (organization_id, case_id, offer_id) REFERENCES public.crm_case_offer_snapshots(organization_id, case_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_offer_selections crm_case_offer_selections_focused_application_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_selections
    ADD CONSTRAINT crm_case_offer_selections_focused_application_fkey FOREIGN KEY (organization_id, case_id, offer_id) REFERENCES public.crm_case_bank_applications(organization_id, case_id, offer_id) ON DELETE CASCADE;


--
-- Name: crm_case_offer_selections crm_case_offer_selections_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_selections
    ADD CONSTRAINT crm_case_offer_selections_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_offer_selections crm_case_offer_selections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_selections
    ADD CONSTRAINT crm_case_offer_selections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_offer_selections crm_case_offer_selections_selected_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_selections
    ADD CONSTRAINT crm_case_offer_selections_selected_by_user_id_fkey FOREIGN KEY (selected_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_snapshots
    ADD CONSTRAINT crm_case_offer_snapshots_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE SET NULL;


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_mortgage_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_snapshots
    ADD CONSTRAINT crm_case_offer_snapshots_mortgage_product_id_fkey FOREIGN KEY (mortgage_product_id) REFERENCES public.mortgage_products(id) ON DELETE SET NULL;


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_mortgage_product_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_snapshots
    ADD CONSTRAINT crm_case_offer_snapshots_mortgage_product_version_id_fkey FOREIGN KEY (mortgage_product_version_id) REFERENCES public.mortgage_product_versions(id) ON DELETE SET NULL;


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_snapshots
    ADD CONSTRAINT crm_case_offer_snapshots_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_snapshots
    ADD CONSTRAINT crm_case_offer_snapshots_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_saved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_offer_snapshots
    ADD CONSTRAINT crm_case_offer_snapshots_saved_by_user_id_fkey FOREIGN KEY (saved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_case_participants crm_case_participants_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_participants
    ADD CONSTRAINT crm_case_participants_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.crm_cases(id) ON DELETE CASCADE;


--
-- Name: crm_case_participants crm_case_participants_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_participants
    ADD CONSTRAINT crm_case_participants_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_participants crm_case_participants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_participants
    ADD CONSTRAINT crm_case_participants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_participants crm_case_participants_organization_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_participants
    ADD CONSTRAINT crm_case_participants_organization_person_fkey FOREIGN KEY (organization_id, person_id) REFERENCES public.crm_client_people(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_participants crm_case_participants_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_participants
    ADD CONSTRAINT crm_case_participants_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.crm_client_people(id) ON DELETE CASCADE;


--
-- Name: crm_case_property_selections crm_case_property_selections_case_property_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_property_selections
    ADD CONSTRAINT crm_case_property_selections_case_property_fkey FOREIGN KEY (organization_id, case_id, property_id) REFERENCES public.crm_properties(organization_id, case_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_property_selections crm_case_property_selections_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_property_selections
    ADD CONSTRAINT crm_case_property_selections_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_property_selections crm_case_property_selections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_property_selections
    ADD CONSTRAINT crm_case_property_selections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_property_selections crm_case_property_selections_selected_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_property_selections
    ADD CONSTRAINT crm_case_property_selections_selected_by_user_id_fkey FOREIGN KEY (selected_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_cases crm_cases_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_cases
    ADD CONSTRAINT crm_cases_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.crm_clients(id) ON DELETE CASCADE;


--
-- Name: crm_cases crm_cases_organization_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_cases
    ADD CONSTRAINT crm_cases_organization_client_fkey FOREIGN KEY (organization_id, client_id) REFERENCES public.crm_clients(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_cases crm_cases_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_cases
    ADD CONSTRAINT crm_cases_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_cases crm_cases_organization_owner_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_cases
    ADD CONSTRAINT crm_cases_organization_owner_membership_fkey FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_cases crm_cases_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_cases
    ADD CONSTRAINT crm_cases_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_approver_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_approver_fkey FOREIGN KEY (approver_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_consumer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_consumer_fkey FOREIGN KEY (consumed_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_grantee_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_grantee_fkey FOREIGN KEY (organization_id, grantee_user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_request_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_request_fkey FOREIGN KEY (organization_id, request_id) REFERENCES public.crm_client_anonymization_requests(organization_id, id) ON DELETE RESTRICT;


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_requester_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_requester_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_revoker_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_execution_grants
    ADD CONSTRAINT crm_client_anonymization_execution_grants_revoker_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: crm_client_anonymization_request_events crm_client_anonymization_request_events_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_request_events
    ADD CONSTRAINT crm_client_anonymization_request_events_actor_fkey FOREIGN KEY (organization_id, actor_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_client_anonymization_request_events crm_client_anonymization_request_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_request_events
    ADD CONSTRAINT crm_client_anonymization_request_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_client_anonymization_request_events crm_client_anonymization_request_events_request_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_request_events
    ADD CONSTRAINT crm_client_anonymization_request_events_request_fkey FOREIGN KEY (organization_id, request_id) REFERENCES public.crm_client_anonymization_requests(organization_id, id);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_approver_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_approver_fkey FOREIGN KEY (organization_id, approved_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_completed_by_fkey FOREIGN KEY (organization_id, completed_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_created_by_fkey FOREIGN KEY (organization_id, created_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_identity_verifier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_identity_verifier_fkey FOREIGN KEY (organization_id, identity_verified_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_organization_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_organization_client_fkey FOREIGN KEY (organization_id, client_id) REFERENCES public.crm_clients(organization_id, id);


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_subject_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_anonymization_requests
    ADD CONSTRAINT crm_client_anonymization_requests_subject_person_fkey FOREIGN KEY (organization_id, client_id, subject_person_id) REFERENCES public.crm_client_people(organization_id, client_id, id);


--
-- Name: crm_client_consent_events crm_client_consent_events_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_consent_events
    ADD CONSTRAINT crm_client_consent_events_client_fkey FOREIGN KEY (organization_id, client_id) REFERENCES public.crm_clients(organization_id, id);


--
-- Name: crm_client_consent_events crm_client_consent_events_definition_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_consent_events
    ADD CONSTRAINT crm_client_consent_events_definition_fkey FOREIGN KEY (organization_id, definition_id) REFERENCES public.crm_consent_definitions(organization_id, id);


--
-- Name: crm_client_consent_events crm_client_consent_events_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_consent_events
    ADD CONSTRAINT crm_client_consent_events_person_fkey FOREIGN KEY (organization_id, subject_person_id) REFERENCES public.crm_client_people(organization_id, id);


--
-- Name: crm_client_consent_events crm_client_consent_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_consent_events
    ADD CONSTRAINT crm_client_consent_events_recorded_by_fkey FOREIGN KEY (organization_id, recorded_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_client_consent_events crm_client_consent_events_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_consent_events
    ADD CONSTRAINT crm_client_consent_events_version_fkey FOREIGN KEY (organization_id, definition_id, definition_version_id) REFERENCES public.crm_consent_definition_versions(organization_id, definition_id, id);


--
-- Name: crm_client_people crm_client_people_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_people
    ADD CONSTRAINT crm_client_people_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.crm_clients(id) ON DELETE CASCADE;


--
-- Name: crm_client_people crm_client_people_organization_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_people
    ADD CONSTRAINT crm_client_people_organization_client_fkey FOREIGN KEY (organization_id, client_id) REFERENCES public.crm_clients(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_client_people crm_client_people_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_client_people
    ADD CONSTRAINT crm_client_people_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_clients crm_clients_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_clients
    ADD CONSTRAINT crm_clients_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_clients crm_clients_organization_owner_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_clients
    ADD CONSTRAINT crm_clients_organization_owner_membership_fkey FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_clients crm_clients_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_clients
    ADD CONSTRAINT crm_clients_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_consent_definitions crm_consent_definitions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definitions
    ADD CONSTRAINT crm_consent_definitions_created_by_fkey FOREIGN KEY (organization_id, created_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_consent_definitions crm_consent_definitions_current_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definitions
    ADD CONSTRAINT crm_consent_definitions_current_version_fkey FOREIGN KEY (organization_id, id, current_version_id) REFERENCES public.crm_consent_definition_versions(organization_id, definition_id, id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: crm_consent_definitions crm_consent_definitions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definitions
    ADD CONSTRAINT crm_consent_definitions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_consent_definitions crm_consent_definitions_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definitions
    ADD CONSTRAINT crm_consent_definitions_updated_by_fkey FOREIGN KEY (organization_id, updated_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_consent_definition_versions crm_consent_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definition_versions
    ADD CONSTRAINT crm_consent_versions_created_by_fkey FOREIGN KEY (organization_id, created_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_consent_definition_versions crm_consent_versions_definition_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consent_definition_versions
    ADD CONSTRAINT crm_consent_versions_definition_fkey FOREIGN KEY (organization_id, definition_id) REFERENCES public.crm_consent_definitions(organization_id, id);


--
-- Name: crm_documents crm_documents_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.crm_cases(id) ON DELETE CASCADE;


--
-- Name: crm_documents crm_documents_case_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_case_item_id_fkey FOREIGN KEY (case_item_id) REFERENCES public.crm_case_items(id) ON DELETE CASCADE;


--
-- Name: crm_documents crm_documents_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.crm_clients(id) ON DELETE CASCADE;


--
-- Name: crm_documents crm_documents_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_documents crm_documents_organization_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_organization_client_fkey FOREIGN KEY (organization_id, client_id) REFERENCES public.crm_clients(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_documents crm_documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_documents crm_documents_organization_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_organization_item_fkey FOREIGN KEY (organization_id, case_item_id) REFERENCES public.crm_case_items(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_documents crm_documents_organization_submission_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_organization_submission_fkey FOREIGN KEY (organization_id, submission_id) REFERENCES public.crm_item_submissions(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_documents crm_documents_organization_uploader_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_organization_uploader_membership_fkey FOREIGN KEY (organization_id, uploaded_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE SET NULL (uploaded_by_user_id);


--
-- Name: crm_documents crm_documents_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_documents
    ADD CONSTRAINT crm_documents_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.crm_item_submissions(id) ON DELETE CASCADE;


--
-- Name: crm_eve_sessions crm_eve_sessions_organization_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_eve_sessions
    ADD CONSTRAINT crm_eve_sessions_organization_member_fkey FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: crm_item_submissions crm_item_submissions_case_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_item_submissions
    ADD CONSTRAINT crm_item_submissions_case_item_id_fkey FOREIGN KEY (case_item_id) REFERENCES public.crm_case_items(id) ON DELETE CASCADE;


--
-- Name: crm_item_submissions crm_item_submissions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_item_submissions
    ADD CONSTRAINT crm_item_submissions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_item_submissions crm_item_submissions_organization_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_item_submissions
    ADD CONSTRAINT crm_item_submissions_organization_item_fkey FOREIGN KEY (organization_id, case_item_id) REFERENCES public.crm_case_items(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_item_submissions crm_item_submissions_organization_provider_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_item_submissions
    ADD CONSTRAINT crm_item_submissions_organization_provider_fkey FOREIGN KEY (organization_id, provider_id) REFERENCES public.crm_providers(organization_id, id);


--
-- Name: crm_item_submissions crm_item_submissions_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_item_submissions
    ADD CONSTRAINT crm_item_submissions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.crm_providers(id) ON DELETE SET NULL;


--
-- Name: crm_product_types crm_product_types_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_product_types
    ADD CONSTRAINT crm_product_types_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_properties crm_properties_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_properties
    ADD CONSTRAINT crm_properties_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.crm_cases(id) ON DELETE CASCADE;


--
-- Name: crm_properties crm_properties_case_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_properties
    ADD CONSTRAINT crm_properties_case_item_id_fkey FOREIGN KEY (case_item_id) REFERENCES public.crm_case_items(id) ON DELETE CASCADE;


--
-- Name: crm_properties crm_properties_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_properties
    ADD CONSTRAINT crm_properties_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_properties crm_properties_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_properties
    ADD CONSTRAINT crm_properties_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_property_images crm_property_images_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_property_images
    ADD CONSTRAINT crm_property_images_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.crm_cases(id) ON DELETE CASCADE;


--
-- Name: crm_property_images crm_property_images_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_property_images
    ADD CONSTRAINT crm_property_images_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_property_images crm_property_images_property_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_property_images
    ADD CONSTRAINT crm_property_images_property_fkey FOREIGN KEY (organization_id, case_id, property_id) REFERENCES public.crm_properties(organization_id, case_id, id) ON DELETE CASCADE;


--
-- Name: crm_providers crm_providers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_providers
    ADD CONSTRAINT crm_providers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_case_item_settlements crm_settlements_organization_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_item_settlements
    ADD CONSTRAINT crm_settlements_organization_item_fkey FOREIGN KEY (organization_id, case_item_id) REFERENCES public.crm_case_items(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_case_item_settlements crm_settlements_organization_payer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_case_item_settlements
    ADD CONSTRAINT crm_settlements_organization_payer_fkey FOREIGN KEY (organization_id, payer_provider_id) REFERENCES public.crm_providers(organization_id, id);


--
-- Name: crm_tasks crm_tasks_assignee_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_tasks crm_tasks_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.crm_cases(id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_case_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_case_item_id_fkey FOREIGN KEY (case_item_id) REFERENCES public.crm_case_items(id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.crm_clients(id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_organization_assignee_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_organization_assignee_membership_fkey FOREIGN KEY (organization_id, assignee_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_tasks crm_tasks_organization_case_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_organization_case_fkey FOREIGN KEY (organization_id, case_id) REFERENCES public.crm_cases(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_organization_case_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_organization_case_item_fkey FOREIGN KEY (organization_id, case_id, case_item_id) REFERENCES public.crm_case_items(organization_id, case_id, id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_organization_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_organization_client_fkey FOREIGN KEY (organization_id, client_id) REFERENCES public.crm_clients(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_organization_delegator_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_organization_delegator_membership_fkey FOREIGN KEY (organization_id, delegator_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: crm_tasks crm_tasks_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_organization_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_organization_item_fkey FOREIGN KEY (organization_id, case_item_id) REFERENCES public.crm_case_items(organization_id, id) ON DELETE CASCADE;


--
-- Name: crm_workflow_statuses crm_workflow_statuses_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_workflow_statuses
    ADD CONSTRAINT crm_workflow_statuses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: crm_workflow_statuses crm_workflow_statuses_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_workflow_statuses
    ADD CONSTRAINT crm_workflow_statuses_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.crm_workflows(id) ON DELETE CASCADE;


--
-- Name: crm_workflows crm_workflows_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_workflows
    ADD CONSTRAINT crm_workflows_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: expert_availability_overrides expert_availability_overrides_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_availability_overrides
    ADD CONSTRAINT expert_availability_overrides_membership_fkey FOREIGN KEY (organization_id, facility_id, user_id) REFERENCES public.facility_memberships(organization_id, facility_id, user_id) ON DELETE CASCADE;


--
-- Name: expert_availability_rules expert_availability_rules_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_availability_rules
    ADD CONSTRAINT expert_availability_rules_membership_fkey FOREIGN KEY (organization_id, facility_id, user_id) REFERENCES public.facility_memberships(organization_id, facility_id, user_id) ON DELETE CASCADE;


--
-- Name: expert_brand_profiles expert_brand_profiles_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_brand_profiles
    ADD CONSTRAINT expert_brand_profiles_membership_fkey FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: expert_brand_profiles expert_brand_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_brand_profiles
    ADD CONSTRAINT expert_brand_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: expert_brand_profiles expert_brand_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_brand_profiles
    ADD CONSTRAINT expert_brand_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: expert_time_off expert_time_off_creator_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_time_off
    ADD CONSTRAINT expert_time_off_creator_membership_fkey FOREIGN KEY (organization_id, created_by_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: expert_time_off expert_time_off_expert_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expert_time_off
    ADD CONSTRAINT expert_time_off_expert_membership_fkey FOREIGN KEY (organization_id, expert_user_id) REFERENCES public.organization_memberships(organization_id, user_id);


--
-- Name: external_busy_blocks external_busy_blocks_connection_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_busy_blocks
    ADD CONSTRAINT external_busy_blocks_connection_fkey FOREIGN KEY (organization_id, connection_id) REFERENCES public.calendar_connections(organization_id, id) ON DELETE CASCADE;


--
-- Name: facilities facilities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: facility_images facility_images_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_images
    ADD CONSTRAINT facility_images_facility_fkey FOREIGN KEY (organization_id, facility_id) REFERENCES public.facilities(organization_id, id) ON DELETE CASCADE;


--
-- Name: facility_images facility_images_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_images
    ADD CONSTRAINT facility_images_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: facility_images facility_images_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_images
    ADD CONSTRAINT facility_images_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: facility_memberships facility_memberships_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_memberships
    ADD CONSTRAINT facility_memberships_facility_fkey FOREIGN KEY (organization_id, facility_id) REFERENCES public.facilities(organization_id, id) ON DELETE CASCADE;


--
-- Name: facility_memberships facility_memberships_organization_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_memberships
    ADD CONSTRAINT facility_memberships_organization_member_fkey FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: facility_opening_hours facility_opening_hours_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_opening_hours
    ADD CONSTRAINT facility_opening_hours_facility_fkey FOREIGN KEY (organization_id, facility_id) REFERENCES public.facilities(organization_id, id) ON DELETE CASCADE;


--
-- Name: facility_opening_overrides facility_opening_overrides_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_opening_overrides
    ADD CONSTRAINT facility_opening_overrides_facility_fkey FOREIGN KEY (organization_id, facility_id) REFERENCES public.facilities(organization_id, id) ON DELETE CASCADE;


--
-- Name: facility_service_experts facility_service_experts_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_service_experts
    ADD CONSTRAINT facility_service_experts_membership_fkey FOREIGN KEY (organization_id, facility_id, user_id) REFERENCES public.facility_memberships(organization_id, facility_id, user_id) ON DELETE CASCADE;


--
-- Name: facility_service_experts facility_service_experts_service_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_service_experts
    ADD CONSTRAINT facility_service_experts_service_fkey FOREIGN KEY (organization_id, facility_id, service_id) REFERENCES public.facility_services(organization_id, facility_id, service_id) ON DELETE CASCADE;


--
-- Name: facility_services facility_services_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_services
    ADD CONSTRAINT facility_services_facility_fkey FOREIGN KEY (organization_id, facility_id) REFERENCES public.facilities(organization_id, id) ON DELETE CASCADE;


--
-- Name: facility_services facility_services_service_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_services
    ADD CONSTRAINT facility_services_service_fkey FOREIGN KEY (organization_id, service_id) REFERENCES public.booking_services(organization_id, id) ON DELETE CASCADE;


--
-- Name: mail_connections mail_connections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_connections
    ADD CONSTRAINT mail_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mail_connections mail_connections_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_connections
    ADD CONSTRAINT mail_connections_owner_fkey FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: mail_send_requests mail_send_requests_connection_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_send_requests
    ADD CONSTRAINT mail_send_requests_connection_fkey FOREIGN KEY (organization_id, owner_user_id, connection_id) REFERENCES public.mail_connections(organization_id, owner_user_id, id) ON DELETE CASCADE;


--
-- Name: mail_send_requests mail_send_requests_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_send_requests
    ADD CONSTRAINT mail_send_requests_membership_fkey FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_aliases mortgage_bank_aliases_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_aliases
    ADD CONSTRAINT mortgage_bank_aliases_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_file_chunks mortgage_bank_file_chunks_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_chunks
    ADD CONSTRAINT mortgage_bank_file_chunks_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.mortgage_bank_file_versions(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_file_embeddings mortgage_bank_file_embeddings_chunk_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_embeddings
    ADD CONSTRAINT mortgage_bank_file_embeddings_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES public.mortgage_bank_file_chunks(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_file_events mortgage_bank_file_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_events
    ADD CONSTRAINT mortgage_bank_file_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_bank_file_events mortgage_bank_file_events_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_events
    ADD CONSTRAINT mortgage_bank_file_events_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.mortgage_bank_files(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_file_events mortgage_bank_file_events_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_events
    ADD CONSTRAINT mortgage_bank_file_events_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.mortgage_bank_file_versions(id) ON DELETE SET NULL;


--
-- Name: mortgage_bank_file_processing_jobs mortgage_bank_file_processing_jobs_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_processing_jobs
    ADD CONSTRAINT mortgage_bank_file_processing_jobs_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.mortgage_bank_file_versions(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_file_products mortgage_bank_file_products_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_products
    ADD CONSTRAINT mortgage_bank_file_products_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_bank_file_products mortgage_bank_file_products_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_products
    ADD CONSTRAINT mortgage_bank_file_products_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.mortgage_bank_files(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_file_products mortgage_bank_file_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_products
    ADD CONSTRAINT mortgage_bank_file_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.mortgage_products(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_file_versions mortgage_bank_file_versions_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_versions
    ADD CONSTRAINT mortgage_bank_file_versions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_bank_file_versions mortgage_bank_file_versions_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_file_versions
    ADD CONSTRAINT mortgage_bank_file_versions_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.mortgage_bank_files(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_files mortgage_bank_files_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_files
    ADD CONSTRAINT mortgage_bank_files_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE RESTRICT;


--
-- Name: mortgage_bank_files mortgage_bank_files_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_files
    ADD CONSTRAINT mortgage_bank_files_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.mortgage_bank_file_categories(id) ON DELETE SET NULL;


--
-- Name: mortgage_bank_files mortgage_bank_files_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_files
    ADD CONSTRAINT mortgage_bank_files_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_bank_files mortgage_bank_files_current_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_files
    ADD CONSTRAINT mortgage_bank_files_current_version_fkey FOREIGN KEY (current_version_id) REFERENCES public.mortgage_bank_file_versions(id) ON DELETE SET NULL;


--
-- Name: mortgage_bank_files mortgage_bank_files_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_files
    ADD CONSTRAINT mortgage_bank_files_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_bank_override_revisions mortgage_bank_override_revisions_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_override_revisions
    ADD CONSTRAINT mortgage_bank_override_revisions_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_override_revisions mortgage_bank_override_revisions_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_override_revisions
    ADD CONSTRAINT mortgage_bank_override_revisions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mortgage_bank_override_revisions mortgage_bank_override_revisions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_override_revisions
    ADD CONSTRAINT mortgage_bank_override_revisions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_override_revisions mortgage_bank_override_revisions_override_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_override_revisions
    ADD CONSTRAINT mortgage_bank_override_revisions_override_id_fkey FOREIGN KEY (override_id) REFERENCES public.mortgage_bank_overrides(id) ON DELETE SET NULL;


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_overrides
    ADD CONSTRAINT mortgage_bank_overrides_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_overrides
    ADD CONSTRAINT mortgage_bank_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_overrides
    ADD CONSTRAINT mortgage_bank_overrides_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_bank_overrides
    ADD CONSTRAINT mortgage_bank_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mortgage_capacity_setting_revisions mortgage_capacity_setting_revisions_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_capacity_setting_revisions
    ADD CONSTRAINT mortgage_capacity_setting_revisions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mortgage_capacity_setting_revisions mortgage_capacity_setting_revisions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_capacity_setting_revisions
    ADD CONSTRAINT mortgage_capacity_setting_revisions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_capacity_settings
    ADD CONSTRAINT mortgage_capacity_settings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_capacity_settings
    ADD CONSTRAINT mortgage_capacity_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_capacity_settings
    ADD CONSTRAINT mortgage_capacity_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mortgage_catalog_events mortgage_catalog_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_catalog_events
    ADD CONSTRAINT mortgage_catalog_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: mortgage_catalog_events mortgage_catalog_events_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_catalog_events
    ADD CONSTRAINT mortgage_catalog_events_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE RESTRICT;


--
-- Name: mortgage_catalog_events mortgage_catalog_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_catalog_events
    ADD CONSTRAINT mortgage_catalog_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.mortgage_products(id) ON DELETE RESTRICT;


--
-- Name: mortgage_catalog_events mortgage_catalog_events_product_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_catalog_events
    ADD CONSTRAINT mortgage_catalog_events_product_version_id_fkey FOREIGN KEY (product_version_id) REFERENCES public.mortgage_product_versions(id) ON DELETE RESTRICT;


--
-- Name: mortgage_document_template_revisions mortgage_document_template_revisions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_template_revisions
    ADD CONSTRAINT mortgage_document_template_revisions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_document_template_revisions mortgage_document_template_revisions_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_template_revisions
    ADD CONSTRAINT mortgage_document_template_revisions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.mortgage_document_templates(id) ON DELETE CASCADE;


--
-- Name: mortgage_document_templates mortgage_document_templates_active_published_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_templates
    ADD CONSTRAINT mortgage_document_templates_active_published_by_user_id_fkey FOREIGN KEY (active_published_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_document_templates mortgage_document_templates_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_templates
    ADD CONSTRAINT mortgage_document_templates_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE CASCADE;


--
-- Name: mortgage_document_templates mortgage_document_templates_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_templates
    ADD CONSTRAINT mortgage_document_templates_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_document_templates mortgage_document_templates_current_published_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_templates
    ADD CONSTRAINT mortgage_document_templates_current_published_revision_id_fkey FOREIGN KEY (current_published_revision_id) REFERENCES public.mortgage_document_template_revisions(id) ON DELETE RESTRICT;


--
-- Name: mortgage_document_templates mortgage_document_templates_draft_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_document_templates
    ADD CONSTRAINT mortgage_document_templates_draft_updated_by_user_id_fkey FOREIGN KEY (draft_updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_product_drafts mortgage_product_drafts_base_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_drafts
    ADD CONSTRAINT mortgage_product_drafts_base_version_fkey FOREIGN KEY (product_id, base_version_id) REFERENCES public.mortgage_product_versions(product_id, id) ON DELETE RESTRICT;


--
-- Name: mortgage_product_drafts mortgage_product_drafts_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_drafts
    ADD CONSTRAINT mortgage_product_drafts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_product_drafts mortgage_product_drafts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_drafts
    ADD CONSTRAINT mortgage_product_drafts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.mortgage_products(id) ON DELETE CASCADE;


--
-- Name: mortgage_product_drafts mortgage_product_drafts_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_drafts
    ADD CONSTRAINT mortgage_product_drafts_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_product_override_revisions mortgage_product_override_revisions_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_override_revisions
    ADD CONSTRAINT mortgage_product_override_revisions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mortgage_product_override_revisions mortgage_product_override_revisions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_override_revisions
    ADD CONSTRAINT mortgage_product_override_revisions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mortgage_product_override_revisions mortgage_product_override_revisions_override_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_override_revisions
    ADD CONSTRAINT mortgage_product_override_revisions_override_id_fkey FOREIGN KEY (override_id) REFERENCES public.mortgage_product_overrides(id) ON DELETE SET NULL;


--
-- Name: mortgage_product_override_revisions mortgage_product_override_revisions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_override_revisions
    ADD CONSTRAINT mortgage_product_override_revisions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.mortgage_products(id) ON DELETE CASCADE;


--
-- Name: mortgage_product_overrides mortgage_product_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_overrides
    ADD CONSTRAINT mortgage_product_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mortgage_product_overrides mortgage_product_overrides_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_overrides
    ADD CONSTRAINT mortgage_product_overrides_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: mortgage_product_overrides mortgage_product_overrides_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_overrides
    ADD CONSTRAINT mortgage_product_overrides_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.mortgage_products(id) ON DELETE CASCADE;


--
-- Name: mortgage_product_overrides mortgage_product_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_overrides
    ADD CONSTRAINT mortgage_product_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: mortgage_product_version_document_templates mortgage_product_version_document_tem_template_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_version_document_templates
    ADD CONSTRAINT mortgage_product_version_document_tem_template_revision_id_fkey FOREIGN KEY (template_revision_id) REFERENCES public.mortgage_document_template_revisions(id) ON DELETE RESTRICT;


--
-- Name: mortgage_product_version_document_templates mortgage_product_version_document_templ_product_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_version_document_templates
    ADD CONSTRAINT mortgage_product_version_document_templ_product_version_id_fkey FOREIGN KEY (product_version_id) REFERENCES public.mortgage_product_versions(id) ON DELETE CASCADE;


--
-- Name: mortgage_product_version_sources mortgage_product_version_sources_product_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_version_sources
    ADD CONSTRAINT mortgage_product_version_sources_product_version_id_fkey FOREIGN KEY (product_version_id) REFERENCES public.mortgage_product_versions(id) ON DELETE CASCADE;


--
-- Name: mortgage_product_version_sources mortgage_product_version_sources_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_version_sources
    ADD CONSTRAINT mortgage_product_version_sources_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.mortgage_source_documents(id) ON DELETE RESTRICT;


--
-- Name: mortgage_product_version_variants mortgage_product_version_variants_product_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_version_variants
    ADD CONSTRAINT mortgage_product_version_variants_product_version_id_fkey FOREIGN KEY (product_version_id) REFERENCES public.mortgage_product_versions(id) ON DELETE CASCADE;


--
-- Name: mortgage_product_versions mortgage_product_versions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_versions
    ADD CONSTRAINT mortgage_product_versions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.mortgage_products(id) ON DELETE CASCADE;


--
-- Name: mortgage_product_versions mortgage_product_versions_published_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_versions
    ADD CONSTRAINT mortgage_product_versions_published_by_user_id_fkey FOREIGN KEY (published_by_user_id) REFERENCES public.users(id);


--
-- Name: mortgage_product_versions mortgage_product_versions_retired_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_versions
    ADD CONSTRAINT mortgage_product_versions_retired_by_user_id_fkey FOREIGN KEY (retired_by_user_id) REFERENCES public.users(id);


--
-- Name: mortgage_product_versions mortgage_product_versions_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_product_versions
    ADD CONSTRAINT mortgage_product_versions_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.mortgage_source_documents(id) ON DELETE SET NULL;


--
-- Name: mortgage_products mortgage_products_archived_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_products
    ADD CONSTRAINT mortgage_products_archived_by_user_id_fkey FOREIGN KEY (archived_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_products mortgage_products_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_products
    ADD CONSTRAINT mortgage_products_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE RESTRICT;


--
-- Name: mortgage_products mortgage_products_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_products
    ADD CONSTRAINT mortgage_products_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_products mortgage_products_current_published_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_products
    ADD CONSTRAINT mortgage_products_current_published_version_fkey FOREIGN KEY (id, current_published_version_id) REFERENCES public.mortgage_product_versions(product_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: mortgage_products mortgage_products_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_products
    ADD CONSTRAINT mortgage_products_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mortgage_source_documents mortgage_source_documents_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_source_documents
    ADD CONSTRAINT mortgage_source_documents_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES public.mortgage_banks(id) ON DELETE RESTRICT;


--
-- Name: mortgage_source_documents mortgage_source_documents_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mortgage_source_documents
    ADD CONSTRAINT mortgage_source_documents_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.mortgage_products(id) ON DELETE SET NULL;


--
-- Name: organization_design_settings organization_design_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_design_settings
    ADD CONSTRAINT organization_design_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_design_settings organization_design_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_design_settings
    ADD CONSTRAINT organization_design_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_memberships organization_memberships_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_memberships organization_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organization_user_access_states organization_user_access_states_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_access_states
    ADD CONSTRAINT organization_user_access_states_membership_fkey FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: organization_user_access_states organization_user_access_states_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_access_states
    ADD CONSTRAINT organization_user_access_states_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_user_access_states organization_user_access_states_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_access_states
    ADD CONSTRAINT organization_user_access_states_updated_by_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_user_admin_roles organization_user_admin_roles_assigner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_admin_roles
    ADD CONSTRAINT organization_user_admin_roles_assigner_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: organization_user_admin_roles organization_user_admin_roles_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_admin_roles
    ADD CONSTRAINT organization_user_admin_roles_membership_fkey FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: organization_user_admin_roles organization_user_admin_roles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_admin_roles
    ADD CONSTRAINT organization_user_admin_roles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_user_admin_roles organization_user_admin_roles_role_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_admin_roles
    ADD CONSTRAINT organization_user_admin_roles_role_key_fkey FOREIGN KEY (role_key) REFERENCES public.administrative_roles(role_key);


--
-- Name: organization_user_audit_events organization_user_audit_events_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_audit_events
    ADD CONSTRAINT organization_user_audit_events_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_user_audit_events organization_user_audit_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_audit_events
    ADD CONSTRAINT organization_user_audit_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_user_audit_events organization_user_audit_events_target_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_audit_events
    ADD CONSTRAINT organization_user_audit_events_target_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: organization_user_direct_grants organization_user_direct_grants_granter_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_direct_grants
    ADD CONSTRAINT organization_user_direct_grants_granter_fkey FOREIGN KEY (granted_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: organization_user_direct_grants organization_user_direct_grants_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_direct_grants
    ADD CONSTRAINT organization_user_direct_grants_membership_fkey FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: organization_user_direct_grants organization_user_direct_grants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_direct_grants
    ADD CONSTRAINT organization_user_direct_grants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_user_direct_grants organization_user_direct_grants_revoker_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_direct_grants
    ADD CONSTRAINT organization_user_direct_grants_revoker_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: organization_user_preferences organization_user_preferences_default_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_preferences
    ADD CONSTRAINT organization_user_preferences_default_facility_fkey FOREIGN KEY (organization_id, default_facility_id) REFERENCES public.facilities(organization_id, id) ON DELETE SET NULL (default_facility_id);


--
-- Name: organization_user_preferences organization_user_preferences_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_user_preferences
    ADD CONSTRAINT organization_user_preferences_membership_fkey FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: platform_user_roles platform_user_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_user_roles
    ADD CONSTRAINT platform_user_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES identity.users(id) ON DELETE SET NULL;


--
-- Name: platform_user_roles platform_user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_user_roles
    ADD CONSTRAINT platform_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES identity.users(id) ON DELETE CASCADE;


--
-- Name: team_edges team_edges_child_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_edges
    ADD CONSTRAINT team_edges_child_fkey FOREIGN KEY (organization_id, child_team_id) REFERENCES public.teams(organization_id, id) ON DELETE CASCADE;


--
-- Name: team_edges team_edges_parent_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_edges
    ADD CONSTRAINT team_edges_parent_fkey FOREIGN KEY (organization_id, parent_team_id) REFERENCES public.teams(organization_id, id) ON DELETE CASCADE;


--
-- Name: team_facilities team_facilities_facility_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_facilities
    ADD CONSTRAINT team_facilities_facility_fkey FOREIGN KEY (organization_id, facility_id) REFERENCES public.facilities(organization_id, id) ON DELETE CASCADE;


--
-- Name: team_facilities team_facilities_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_facilities
    ADD CONSTRAINT team_facilities_team_fkey FOREIGN KEY (organization_id, team_id) REFERENCES public.teams(organization_id, id) ON DELETE CASCADE;


--
-- Name: team_memberships team_memberships_organization_member_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_memberships
    ADD CONSTRAINT team_memberships_organization_member_fkey FOREIGN KEY (organization_id, user_id) REFERENCES public.organization_memberships(organization_id, user_id) ON DELETE CASCADE;


--
-- Name: team_memberships team_memberships_team_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_memberships
    ADD CONSTRAINT team_memberships_team_fkey FOREIGN KEY (organization_id, team_id) REFERENCES public.teams(organization_id, id) ON DELETE CASCADE;


--
-- Name: teams teams_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: users users_default_organization_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_default_organization_membership_fkey FOREIGN KEY (organization_id, id, role) REFERENCES public.organization_memberships(organization_id, user_id, role) ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES identity.users(id) ON DELETE CASCADE;


--
-- Name: administrative_role_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.administrative_role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: administrative_role_permissions administrative_role_permissions_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY administrative_role_permissions_authenticated_read ON public.administrative_role_permissions FOR SELECT TO authenticated USING (true);


--
-- Name: administrative_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.administrative_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: administrative_roles administrative_roles_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY administrative_roles_authenticated_read ON public.administrative_roles FOR SELECT TO authenticated USING (true);


--
-- Name: organization_memberships admins can delete organization memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can delete organization memberships" ON public.organization_memberships FOR DELETE TO authenticated USING (private.is_organization_admin(organization_id));


--
-- Name: organization_memberships admins can insert organization memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can insert organization memberships" ON public.organization_memberships FOR INSERT TO authenticated WITH CHECK (private.is_organization_admin(organization_id));


--
-- Name: organization_memberships admins can update organization memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can update organization memberships" ON public.organization_memberships FOR UPDATE TO authenticated USING (private.is_organization_admin(organization_id)) WITH CHECK (private.is_organization_admin(organization_id));


--
-- Name: organizations admins can update organizations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins can update organizations" ON public.organizations FOR UPDATE TO authenticated USING (private.is_organization_admin(id)) WITH CHECK (private.is_organization_admin(id));


--
-- Name: expert_availability_overrides admins or experts can manage expert availability overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins or experts can manage expert availability overrides" ON public.expert_availability_overrides TO authenticated USING ((( SELECT private.is_organization_admin(expert_availability_overrides.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(expert_availability_overrides.organization_id, expert_availability_overrides.facility_id) AS is_facility_admin) OR ((user_id = ( SELECT app.current_user_id() AS uid)) AND ( SELECT private.is_facility_member(expert_availability_overrides.organization_id, expert_availability_overrides.facility_id) AS is_facility_member)))) WITH CHECK ((( SELECT private.is_organization_admin(expert_availability_overrides.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(expert_availability_overrides.organization_id, expert_availability_overrides.facility_id) AS is_facility_admin) OR ((user_id = ( SELECT app.current_user_id() AS uid)) AND ( SELECT private.is_facility_member(expert_availability_overrides.organization_id, expert_availability_overrides.facility_id) AS is_facility_member))));


--
-- Name: expert_availability_rules admins or experts can manage expert availability rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins or experts can manage expert availability rules" ON public.expert_availability_rules TO authenticated USING ((( SELECT private.is_organization_admin(expert_availability_rules.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(expert_availability_rules.organization_id, expert_availability_rules.facility_id) AS is_facility_admin) OR ((user_id = ( SELECT app.current_user_id() AS uid)) AND ( SELECT private.is_facility_member(expert_availability_rules.organization_id, expert_availability_rules.facility_id) AS is_facility_member)))) WITH CHECK ((( SELECT private.is_organization_admin(expert_availability_rules.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(expert_availability_rules.organization_id, expert_availability_rules.facility_id) AS is_facility_admin) OR ((user_id = ( SELECT app.current_user_id() AS uid)) AND ( SELECT private.is_facility_member(expert_availability_rules.organization_id, expert_availability_rules.facility_id) AS is_facility_member))));


--
-- Name: booking_widget_services admins or fixed experts can manage booking widget services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins or fixed experts can manage booking widget services" ON public.booking_widget_services TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.booking_widgets widget
  WHERE ((widget.organization_id = booking_widget_services.organization_id) AND (widget.facility_id = booking_widget_services.facility_id) AND (widget.id = booking_widget_services.widget_id) AND ( SELECT private.can_manage_booking_widget(widget.organization_id, widget.facility_id, widget.fixed_expert_user_id) AS can_manage_booking_widget))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.booking_widgets widget
  WHERE ((widget.organization_id = booking_widget_services.organization_id) AND (widget.facility_id = booking_widget_services.facility_id) AND (widget.id = booking_widget_services.widget_id) AND ( SELECT private.can_manage_booking_widget(widget.organization_id, widget.facility_id, widget.fixed_expert_user_id) AS can_manage_booking_widget) AND ((widget.fixed_expert_user_id IS NULL) OR (EXISTS ( SELECT 1
           FROM public.facility_service_experts service_expert
          WHERE ((service_expert.organization_id = booking_widget_services.organization_id) AND (service_expert.facility_id = booking_widget_services.facility_id) AND (service_expert.service_id = booking_widget_services.service_id) AND (service_expert.user_id = widget.fixed_expert_user_id) AND service_expert.is_active))))))));


--
-- Name: booking_widgets admins or fixed experts can manage booking widgets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins or fixed experts can manage booking widgets" ON public.booking_widgets TO authenticated USING (( SELECT private.can_manage_booking_widget(booking_widgets.organization_id, booking_widgets.facility_id, booking_widgets.fixed_expert_user_id) AS can_manage_booking_widget)) WITH CHECK (( SELECT private.can_write_booking_widget(booking_widgets.organization_id, booking_widgets.facility_id, booking_widgets.fixed_expert_user_id, booking_widgets.created_by_user_id, booking_widgets.booking_mode) AS can_write_booking_widget));


--
-- Name: appointment_calendar_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_calendar_events ENABLE ROW LEVEL SECURITY;

--
-- Name: appointment_resource_reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_resource_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_services ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_widget_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_widget_events ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_widget_services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_widget_services ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_widgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_widgets ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: client_account_links client links are visible to their identity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "client links are visible to their identity" ON public.client_account_links FOR SELECT TO authenticated USING (((auth_user_id = ( SELECT app.current_user_id() AS uid)) AND (revoked_at IS NULL)));


--
-- Name: client_account_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_account_links ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_property_images crm property images are scoped to org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crm property images are scoped to org" ON public.crm_property_images FOR SELECT TO authenticated USING (( SELECT private.is_organization_member(crm_property_images.organization_id) AS is_organization_member));


--
-- Name: crm_property_images crm property images can be deleted in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crm property images can be deleted in org" ON public.crm_property_images FOR DELETE TO authenticated USING (( SELECT private.is_organization_member(crm_property_images.organization_id) AS is_organization_member));


--
-- Name: crm_property_images crm property images can be inserted in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crm property images can be inserted in org" ON public.crm_property_images FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_organization_member(crm_property_images.organization_id) AS is_organization_member));


--
-- Name: crm_property_images crm property images can be updated in org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "crm property images can be updated in org" ON public.crm_property_images FOR UPDATE TO authenticated USING (( SELECT private.is_organization_member(crm_property_images.organization_id) AS is_organization_member)) WITH CHECK (( SELECT private.is_organization_member(crm_property_images.organization_id) AS is_organization_member));


--
-- Name: crm_activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_bank_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_bank_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_bank_applications crm_case_bank_applications_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_bank_applications_member_read ON public.crm_case_bank_applications FOR SELECT TO authenticated USING (( SELECT private.is_organization_member(crm_case_bank_applications.organization_id) AS is_organization_member));


--
-- Name: crm_case_clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_clients ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_clients crm_case_clients_member_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_clients_member_delete ON public.crm_case_clients FOR DELETE TO authenticated USING (( SELECT private.is_organization_member(crm_case_clients.organization_id) AS is_organization_member));


--
-- Name: crm_case_clients crm_case_clients_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_clients_member_insert ON public.crm_case_clients FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_organization_member(crm_case_clients.organization_id) AS is_organization_member));


--
-- Name: crm_case_clients crm_case_clients_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_clients_member_read ON public.crm_case_clients FOR SELECT TO authenticated USING (( SELECT private.is_organization_member(crm_case_clients.organization_id) AS is_organization_member));


--
-- Name: crm_case_clients crm_case_clients_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_clients_member_update ON public.crm_case_clients FOR UPDATE TO authenticated USING (( SELECT private.is_organization_member(crm_case_clients.organization_id) AS is_organization_member)) WITH CHECK (( SELECT private.is_organization_member(crm_case_clients.organization_id) AS is_organization_member));


--
-- Name: crm_case_contract_selections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_contract_selections ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_contract_selections crm_case_contract_selections_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_contract_selections_member_insert ON public.crm_case_contract_selections FOR INSERT TO authenticated WITH CHECK ((( SELECT private.is_organization_member(crm_case_contract_selections.organization_id) AS is_organization_member) AND (signed_by_user_id = ( SELECT app.current_user_id() AS uid)) AND (EXISTS ( SELECT 1
   FROM (public.crm_case_bank_applications application
     JOIN public.crm_item_submissions submission ON (((submission.organization_id = application.organization_id) AND (submission.id = application.submission_id))))
  WHERE ((application.organization_id = crm_case_contract_selections.organization_id) AND (application.case_id = crm_case_contract_selections.case_id) AND (application.submission_id = crm_case_contract_selections.application_id) AND (submission.status_code = 'zaakceptowane'::text))))));


--
-- Name: crm_case_contract_selections crm_case_contract_selections_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_contract_selections_member_read ON public.crm_case_contract_selections FOR SELECT TO authenticated USING (( SELECT private.is_organization_member(crm_case_contract_selections.organization_id) AS is_organization_member));


--
-- Name: crm_case_item_settlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_item_settlements ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_item_settlements crm_case_item_settlements_organization_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_item_settlements_organization_members ON public.crm_case_item_settlements TO authenticated USING (private.is_organization_member(organization_id)) WITH CHECK (private.is_organization_member(organization_id));


--
-- Name: crm_case_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_items ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_items crm_case_items_organization_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_items_organization_members ON public.crm_case_items TO authenticated USING (private.is_organization_member(organization_id)) WITH CHECK (private.is_organization_member(organization_id));


--
-- Name: crm_case_multiform_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_multiform_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_multiform_drafts crm_case_multiform_drafts_member_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_multiform_drafts_member_delete ON public.crm_case_multiform_drafts FOR DELETE TO authenticated USING (( SELECT private.is_organization_member(crm_case_multiform_drafts.organization_id) AS is_organization_member));


--
-- Name: crm_case_multiform_drafts crm_case_multiform_drafts_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_multiform_drafts_member_insert ON public.crm_case_multiform_drafts FOR INSERT TO authenticated WITH CHECK ((( SELECT private.is_organization_member(crm_case_multiform_drafts.organization_id) AS is_organization_member) AND (updated_by_user_id = ( SELECT app.current_user_id() AS uid))));


--
-- Name: crm_case_multiform_drafts crm_case_multiform_drafts_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_multiform_drafts_member_read ON public.crm_case_multiform_drafts FOR SELECT TO authenticated USING (( SELECT private.is_organization_member(crm_case_multiform_drafts.organization_id) AS is_organization_member));


--
-- Name: crm_case_multiform_drafts crm_case_multiform_drafts_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_multiform_drafts_member_update ON public.crm_case_multiform_drafts FOR UPDATE TO authenticated USING (( SELECT private.is_organization_member(crm_case_multiform_drafts.organization_id) AS is_organization_member)) WITH CHECK ((( SELECT private.is_organization_member(crm_case_multiform_drafts.organization_id) AS is_organization_member) AND (updated_by_user_id = ( SELECT app.current_user_id() AS uid))));


--
-- Name: crm_case_offer_selections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_offer_selections ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_offer_selections crm_case_offer_selections_member_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_offer_selections_member_delete ON public.crm_case_offer_selections FOR DELETE TO authenticated USING (( SELECT private.is_organization_member(crm_case_offer_selections.organization_id) AS is_organization_member));


--
-- Name: crm_case_offer_selections crm_case_offer_selections_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_offer_selections_member_insert ON public.crm_case_offer_selections FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_organization_member(crm_case_offer_selections.organization_id) AS is_organization_member));


--
-- Name: crm_case_offer_selections crm_case_offer_selections_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_offer_selections_member_read ON public.crm_case_offer_selections FOR SELECT TO authenticated USING (( SELECT private.is_organization_member(crm_case_offer_selections.organization_id) AS is_organization_member));


--
-- Name: crm_case_offer_selections crm_case_offer_selections_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_offer_selections_member_update ON public.crm_case_offer_selections FOR UPDATE TO authenticated USING (( SELECT private.is_organization_member(crm_case_offer_selections.organization_id) AS is_organization_member)) WITH CHECK (( SELECT private.is_organization_member(crm_case_offer_selections.organization_id) AS is_organization_member));


--
-- Name: crm_case_offer_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_offer_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_offer_snapshots crm_case_offer_snapshots_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_offer_snapshots_member_read ON public.crm_case_offer_snapshots FOR SELECT TO authenticated USING (( SELECT private.is_organization_member(crm_case_offer_snapshots.organization_id) AS is_organization_member));


--
-- Name: crm_case_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_participants crm_case_participants_organization_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_participants_organization_members ON public.crm_case_participants TO authenticated USING (private.is_organization_member(organization_id)) WITH CHECK (private.is_organization_member(organization_id));


--
-- Name: crm_case_property_selections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_case_property_selections ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_case_property_selections crm_case_property_selections_member_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_property_selections_member_delete ON public.crm_case_property_selections FOR DELETE TO authenticated USING (( SELECT private.is_organization_member(crm_case_property_selections.organization_id) AS is_organization_member));


--
-- Name: crm_case_property_selections crm_case_property_selections_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_property_selections_member_insert ON public.crm_case_property_selections FOR INSERT TO authenticated WITH CHECK (( SELECT private.is_organization_member(crm_case_property_selections.organization_id) AS is_organization_member));


--
-- Name: crm_case_property_selections crm_case_property_selections_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_property_selections_member_read ON public.crm_case_property_selections FOR SELECT TO authenticated USING (( SELECT private.is_organization_member(crm_case_property_selections.organization_id) AS is_organization_member));


--
-- Name: crm_case_property_selections crm_case_property_selections_member_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_case_property_selections_member_update ON public.crm_case_property_selections FOR UPDATE TO authenticated USING (( SELECT private.is_organization_member(crm_case_property_selections.organization_id) AS is_organization_member)) WITH CHECK (( SELECT private.is_organization_member(crm_case_property_selections.organization_id) AS is_organization_member));


--
-- Name: crm_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_cases ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_cases crm_cases_organization_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_cases_organization_members ON public.crm_cases TO authenticated USING (private.is_organization_member(organization_id)) WITH CHECK (private.is_organization_member(organization_id));


--
-- Name: crm_client_anonymization_execution_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_client_anonymization_execution_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_client_anonymization_execution_grants crm_client_anonymization_execution_grants_scoped_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_client_anonymization_execution_grants_scoped_read ON public.crm_client_anonymization_execution_grants FOR SELECT TO authenticated USING (((grantee_user_id = ( SELECT app.current_user_id() AS uid)) OR (requested_by_user_id = ( SELECT app.current_user_id() AS uid)) OR (approver_user_id = ( SELECT app.current_user_id() AS uid)) OR ( SELECT private.has_administrative_permission(crm_client_anonymization_execution_grants.organization_id, 'iam.grants.manage'::text) AS has_administrative_permission)));


--
-- Name: crm_client_anonymization_request_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_client_anonymization_request_events ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_client_anonymization_request_events crm_client_anonymization_request_events_privacy_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_client_anonymization_request_events_privacy_read ON public.crm_client_anonymization_request_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.crm_client_anonymization_requests anonymization_request
  WHERE ((anonymization_request.organization_id = crm_client_anonymization_request_events.organization_id) AND (anonymization_request.id = crm_client_anonymization_request_events.request_id) AND ( SELECT private.user_can_view_client_privacy(anonymization_request.organization_id, anonymization_request.client_id, ( SELECT app.current_user_id() AS uid)) AS user_can_view_client_privacy)))));


--
-- Name: crm_client_anonymization_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_client_anonymization_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_client_anonymization_requests crm_client_anonymization_requests_privacy_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_client_anonymization_requests_privacy_read ON public.crm_client_anonymization_requests FOR SELECT TO authenticated USING (( SELECT private.user_can_view_client_privacy(crm_client_anonymization_requests.organization_id, crm_client_anonymization_requests.client_id, ( SELECT app.current_user_id() AS uid)) AS user_can_view_client_privacy));


--
-- Name: crm_client_consent_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_client_consent_events ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_client_consent_events crm_client_consent_events_member_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_client_consent_events_member_insert ON public.crm_client_consent_events FOR INSERT TO authenticated WITH CHECK ((private.is_organization_member(organization_id) AND (recorded_by_user_id = ( SELECT app.current_user_id() AS uid))));


--
-- Name: crm_client_consent_events crm_client_consent_events_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_client_consent_events_member_read ON public.crm_client_consent_events FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: crm_client_people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_client_people ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_client_people crm_client_people_organization_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_client_people_organization_members ON public.crm_client_people TO authenticated USING (private.is_organization_member(organization_id)) WITH CHECK (private.is_organization_member(organization_id));


--
-- Name: crm_clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_clients ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_clients crm_clients_organization_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_clients_organization_members ON public.crm_clients TO authenticated USING (private.is_organization_member(organization_id)) WITH CHECK (private.is_organization_member(organization_id));


--
-- Name: crm_consent_definition_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_consent_definition_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_consent_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_consent_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_consent_definitions crm_consent_definitions_manager_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_consent_definitions_manager_insert ON public.crm_consent_definitions FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_administrative_permission(crm_consent_definitions.organization_id, 'compliance.consents.definitions.manage'::text) AS has_administrative_permission));


--
-- Name: crm_consent_definitions crm_consent_definitions_manager_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_consent_definitions_manager_update ON public.crm_consent_definitions FOR UPDATE TO authenticated USING (( SELECT private.has_administrative_permission(crm_consent_definitions.organization_id, 'compliance.consents.definitions.manage'::text) AS has_administrative_permission)) WITH CHECK (( SELECT private.has_administrative_permission(crm_consent_definitions.organization_id, 'compliance.consents.definitions.manage'::text) AS has_administrative_permission));


--
-- Name: crm_consent_definitions crm_consent_definitions_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_consent_definitions_member_read ON public.crm_consent_definitions FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: crm_consent_definition_versions crm_consent_versions_manager_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_consent_versions_manager_insert ON public.crm_consent_definition_versions FOR INSERT TO authenticated WITH CHECK ((( SELECT private.has_administrative_permission(crm_consent_definition_versions.organization_id, 'compliance.consents.definitions.manage'::text) AS has_administrative_permission) AND ((status <> 'published'::text) OR ( SELECT private.has_administrative_permission(crm_consent_definition_versions.organization_id, 'compliance.consents.definitions.publish'::text) AS has_administrative_permission))));


--
-- Name: crm_consent_definition_versions crm_consent_versions_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_consent_versions_member_read ON public.crm_consent_definition_versions FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: crm_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_documents crm_documents_organization_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_documents_organization_members ON public.crm_documents TO authenticated USING (private.is_organization_member(organization_id)) WITH CHECK (private.is_organization_member(organization_id));


--
-- Name: crm_eve_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_eve_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_eve_sessions crm_eve_sessions_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_eve_sessions_owner_read ON public.crm_eve_sessions FOR SELECT TO authenticated USING (((user_id = ( SELECT app.current_user_id() AS uid)) AND private.is_organization_member(organization_id)));


--
-- Name: crm_item_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_item_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_item_submissions crm_item_submissions_organization_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_item_submissions_organization_members ON public.crm_item_submissions TO authenticated USING (private.is_organization_member(organization_id)) WITH CHECK (private.is_organization_member(organization_id));


--
-- Name: crm_product_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_product_types ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_product_types crm_product_types_visible_to_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_product_types_visible_to_members ON public.crm_product_types FOR SELECT TO authenticated USING (((organization_id IS NULL) OR private.is_organization_member(organization_id)));


--
-- Name: crm_properties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_properties ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_properties crm_properties_organization_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_properties_organization_members ON public.crm_properties TO authenticated USING (private.is_organization_member(organization_id)) WITH CHECK (private.is_organization_member(organization_id));


--
-- Name: crm_property_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_property_images ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_providers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_providers crm_providers_visible_to_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_providers_visible_to_members ON public.crm_providers FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: crm_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_workflow_statuses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_workflow_statuses ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_workflow_statuses crm_workflow_statuses_visible_to_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_workflow_statuses_visible_to_members ON public.crm_workflow_statuses FOR SELECT TO authenticated USING (((organization_id IS NULL) OR private.is_organization_member(organization_id)));


--
-- Name: crm_workflows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_workflows ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_workflows crm_workflows_visible_to_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_workflows_visible_to_members ON public.crm_workflows FOR SELECT TO authenticated USING (((organization_id IS NULL) OR private.is_organization_member(organization_id)));


--
-- Name: expert_availability_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expert_availability_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: expert_availability_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expert_availability_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: expert_brand_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expert_brand_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: expert_time_off; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expert_time_off ENABLE ROW LEVEL SECURITY;

--
-- Name: expert_brand_profiles experts delete own brand profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "experts delete own brand profile" ON public.expert_brand_profiles FOR DELETE TO authenticated USING ((user_id = ( SELECT app.current_user_id() AS uid)));


--
-- Name: expert_brand_profiles experts insert own brand profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "experts insert own brand profile" ON public.expert_brand_profiles FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT app.current_user_id() AS uid)) AND (organization_id IN ( SELECT membership.organization_id
   FROM public.organization_memberships membership
  WHERE (membership.user_id = ( SELECT app.current_user_id() AS uid))))));


--
-- Name: expert_brand_profiles experts read own brand profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "experts read own brand profile" ON public.expert_brand_profiles FOR SELECT TO authenticated USING ((user_id = ( SELECT app.current_user_id() AS uid)));


--
-- Name: expert_brand_profiles experts update own brand profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "experts update own brand profile" ON public.expert_brand_profiles FOR UPDATE TO authenticated USING ((user_id = ( SELECT app.current_user_id() AS uid))) WITH CHECK ((user_id = ( SELECT app.current_user_id() AS uid)));


--
-- Name: external_busy_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_busy_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: facilities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_memberships facility admins can delete facility memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "facility admins can delete facility memberships" ON public.facility_memberships FOR DELETE TO authenticated USING ((( SELECT private.is_organization_admin(facility_memberships.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_memberships.organization_id, facility_memberships.facility_id) AS is_facility_admin)));


--
-- Name: facility_memberships facility admins can insert facility memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "facility admins can insert facility memberships" ON public.facility_memberships FOR INSERT TO authenticated WITH CHECK ((( SELECT private.is_organization_admin(facility_memberships.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_memberships.organization_id, facility_memberships.facility_id) AS is_facility_admin)));


--
-- Name: facility_opening_hours facility admins can manage facility opening hours; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "facility admins can manage facility opening hours" ON public.facility_opening_hours TO authenticated USING ((( SELECT private.is_organization_admin(facility_opening_hours.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_opening_hours.organization_id, facility_opening_hours.facility_id) AS is_facility_admin))) WITH CHECK ((( SELECT private.is_organization_admin(facility_opening_hours.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_opening_hours.organization_id, facility_opening_hours.facility_id) AS is_facility_admin)));


--
-- Name: facility_opening_overrides facility admins can manage facility opening overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "facility admins can manage facility opening overrides" ON public.facility_opening_overrides TO authenticated USING ((( SELECT private.is_organization_admin(facility_opening_overrides.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_opening_overrides.organization_id, facility_opening_overrides.facility_id) AS is_facility_admin))) WITH CHECK ((( SELECT private.is_organization_admin(facility_opening_overrides.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_opening_overrides.organization_id, facility_opening_overrides.facility_id) AS is_facility_admin)));


--
-- Name: facility_service_experts facility admins can manage facility service experts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "facility admins can manage facility service experts" ON public.facility_service_experts TO authenticated USING ((( SELECT private.is_organization_admin(facility_service_experts.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_service_experts.organization_id, facility_service_experts.facility_id) AS is_facility_admin))) WITH CHECK ((( SELECT private.is_organization_admin(facility_service_experts.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_service_experts.organization_id, facility_service_experts.facility_id) AS is_facility_admin)));


--
-- Name: facility_services facility admins can manage facility services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "facility admins can manage facility services" ON public.facility_services TO authenticated USING ((( SELECT private.is_organization_admin(facility_services.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_services.organization_id, facility_services.facility_id) AS is_facility_admin))) WITH CHECK ((( SELECT private.is_organization_admin(facility_services.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_services.organization_id, facility_services.facility_id) AS is_facility_admin)));


--
-- Name: facility_memberships facility admins can update facility memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "facility admins can update facility memberships" ON public.facility_memberships FOR UPDATE TO authenticated USING ((( SELECT private.is_organization_admin(facility_memberships.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_memberships.organization_id, facility_memberships.facility_id) AS is_facility_admin))) WITH CHECK ((( SELECT private.is_organization_admin(facility_memberships.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(facility_memberships.organization_id, facility_memberships.facility_id) AS is_facility_admin)));


--
-- Name: appointments facility admins or assigned experts can insert appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "facility admins or assigned experts can insert appointments" ON public.appointments FOR INSERT TO authenticated WITH CHECK ((( SELECT private.is_organization_admin(appointments.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(appointments.organization_id, appointments.facility_id) AS is_facility_admin) OR ((expert_user_id = ( SELECT app.current_user_id() AS uid)) AND ( SELECT private.is_facility_member(appointments.organization_id, appointments.facility_id) AS is_facility_member))));


--
-- Name: appointments facility admins or assigned experts can update appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "facility admins or assigned experts can update appointments" ON public.appointments FOR UPDATE TO authenticated USING ((( SELECT private.is_organization_admin(appointments.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(appointments.organization_id, appointments.facility_id) AS is_facility_admin) OR (expert_user_id = ( SELECT app.current_user_id() AS uid)))) WITH CHECK ((( SELECT private.is_organization_admin(appointments.organization_id) AS is_organization_admin) OR ( SELECT private.is_facility_admin(appointments.organization_id, appointments.facility_id) AS is_facility_admin) OR ((expert_user_id = ( SELECT app.current_user_id() AS uid)) AND ( SELECT private.is_facility_member(appointments.organization_id, appointments.facility_id) AS is_facility_member))));


--
-- Name: facility_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_images ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_opening_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_opening_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_opening_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_opening_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_service_experts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_service_experts ENABLE ROW LEVEL SECURITY;

--
-- Name: facility_services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_services ENABLE ROW LEVEL SECURITY;

--
-- Name: mail_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mail_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: mail_send_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mail_send_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_memberships members can view organization memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can view organization memberships" ON public.organization_memberships FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: organizations members can view organizations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members can view organizations" ON public.organizations FOR SELECT TO authenticated USING (private.is_organization_member(id));


--
-- Name: mortgage_bank_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_aliases mortgage_bank_aliases_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_bank_aliases_authenticated_read ON public.mortgage_bank_aliases FOR SELECT TO authenticated USING (true);


--
-- Name: mortgage_bank_file_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_file_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_file_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_file_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_file_embeddings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_file_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_file_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_file_events ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_file_processing_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_file_processing_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_file_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_file_products ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_file_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_file_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_files ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_override_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_override_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_override_revisions mortgage_bank_override_revisions_super_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_bank_override_revisions_super_admin_read ON public.mortgage_bank_override_revisions FOR SELECT TO authenticated USING ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_bank_override_revisions.organization_id) AS is_organization_member)));


--
-- Name: mortgage_bank_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_bank_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_bank_overrides_member_read ON public.mortgage_bank_overrides FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_super_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_bank_overrides_super_admin_delete ON public.mortgage_bank_overrides FOR DELETE TO authenticated USING ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_bank_overrides.organization_id) AS is_organization_member)));


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_super_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_bank_overrides_super_admin_insert ON public.mortgage_bank_overrides FOR INSERT TO authenticated WITH CHECK ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_bank_overrides.organization_id) AS is_organization_member)));


--
-- Name: mortgage_bank_overrides mortgage_bank_overrides_super_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_bank_overrides_super_admin_update ON public.mortgage_bank_overrides FOR UPDATE TO authenticated USING ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_bank_overrides.organization_id) AS is_organization_member))) WITH CHECK ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_bank_overrides.organization_id) AS is_organization_member)));


--
-- Name: mortgage_banks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_banks ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_banks mortgage_banks_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_banks_authenticated_read ON public.mortgage_banks FOR SELECT TO authenticated USING (true);


--
-- Name: mortgage_capacity_setting_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_capacity_setting_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_capacity_setting_revisions mortgage_capacity_setting_revisions_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_capacity_setting_revisions_admin_read ON public.mortgage_capacity_setting_revisions FOR SELECT TO authenticated USING (private.is_organization_admin(organization_id));


--
-- Name: mortgage_capacity_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_capacity_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_configuration_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_capacity_settings_configuration_delete ON public.mortgage_capacity_settings FOR DELETE TO authenticated USING (( SELECT private.has_administrative_permission(mortgage_capacity_settings.organization_id, 'crm.configuration.manage'::text) AS has_administrative_permission));


--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_configuration_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_capacity_settings_configuration_insert ON public.mortgage_capacity_settings FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_administrative_permission(mortgage_capacity_settings.organization_id, 'crm.configuration.manage'::text) AS has_administrative_permission));


--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_configuration_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_capacity_settings_configuration_update ON public.mortgage_capacity_settings FOR UPDATE TO authenticated USING (( SELECT private.has_administrative_permission(mortgage_capacity_settings.organization_id, 'crm.configuration.manage'::text) AS has_administrative_permission)) WITH CHECK (( SELECT private.has_administrative_permission(mortgage_capacity_settings.organization_id, 'crm.configuration.manage'::text) AS has_administrative_permission));


--
-- Name: mortgage_capacity_settings mortgage_capacity_settings_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_capacity_settings_member_read ON public.mortgage_capacity_settings FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: mortgage_catalog_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_catalog_events ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_document_template_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_document_template_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_document_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_document_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_product_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_product_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_product_override_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_product_override_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_product_override_revisions mortgage_product_override_revisions_super_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_product_override_revisions_super_admin_read ON public.mortgage_product_override_revisions FOR SELECT TO authenticated USING ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_product_override_revisions.organization_id) AS is_organization_member)));


--
-- Name: mortgage_product_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_product_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_product_overrides mortgage_product_overrides_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_product_overrides_member_read ON public.mortgage_product_overrides FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: mortgage_product_overrides mortgage_product_overrides_super_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_product_overrides_super_admin_delete ON public.mortgage_product_overrides FOR DELETE TO authenticated USING ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_product_overrides.organization_id) AS is_organization_member)));


--
-- Name: mortgage_product_overrides mortgage_product_overrides_super_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_product_overrides_super_admin_insert ON public.mortgage_product_overrides FOR INSERT TO authenticated WITH CHECK ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_product_overrides.organization_id) AS is_organization_member)));


--
-- Name: mortgage_product_overrides mortgage_product_overrides_super_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_product_overrides_super_admin_update ON public.mortgage_product_overrides FOR UPDATE TO authenticated USING ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_product_overrides.organization_id) AS is_organization_member))) WITH CHECK ((( SELECT private.is_super_admin() AS is_super_admin) AND ( SELECT private.is_organization_member(mortgage_product_overrides.organization_id) AS is_organization_member)));


--
-- Name: mortgage_product_version_document_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_product_version_document_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_product_version_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_product_version_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_product_version_sources mortgage_product_version_sources_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_product_version_sources_authenticated_read ON public.mortgage_product_version_sources FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.mortgage_product_versions version
     JOIN public.mortgage_products product ON ((product.id = version.product_id)))
  WHERE ((version.id = mortgage_product_version_sources.product_version_id) AND (version.lifecycle_status = 'published'::text) AND (product.current_published_version_id = version.id) AND product.is_active AND (product.archived_at IS NULL)))));


--
-- Name: mortgage_product_version_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_product_version_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_product_version_variants mortgage_product_version_variants_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_product_version_variants_authenticated_read ON public.mortgage_product_version_variants FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.mortgage_product_versions version
     JOIN public.mortgage_products product ON ((product.id = version.product_id)))
  WHERE ((version.id = mortgage_product_version_variants.product_version_id) AND (version.lifecycle_status = 'published'::text) AND (product.current_published_version_id = version.id) AND product.is_active AND (product.archived_at IS NULL)))));


--
-- Name: mortgage_product_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_product_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_product_versions mortgage_product_versions_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_product_versions_authenticated_read ON public.mortgage_product_versions FOR SELECT TO authenticated USING (((lifecycle_status = 'published'::text) AND (EXISTS ( SELECT 1
   FROM public.mortgage_products product
  WHERE ((product.id = mortgage_product_versions.product_id) AND (product.current_published_version_id = mortgage_product_versions.id) AND product.is_active AND (product.archived_at IS NULL))))));


--
-- Name: mortgage_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_products ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_products mortgage_products_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_products_authenticated_read ON public.mortgage_products FOR SELECT TO authenticated USING ((is_active AND (archived_at IS NULL) AND (current_published_version_id IS NOT NULL)));


--
-- Name: mortgage_source_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mortgage_source_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: mortgage_source_documents mortgage_source_documents_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mortgage_source_documents_authenticated_read ON public.mortgage_source_documents FOR SELECT TO authenticated USING (true);


--
-- Name: appointments organization admins can delete appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization admins can delete appointments" ON public.appointments FOR DELETE TO authenticated USING (( SELECT private.is_organization_admin(appointments.organization_id) AS is_organization_admin));


--
-- Name: booking_services organization admins can manage booking services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization admins can manage booking services" ON public.booking_services TO authenticated USING (( SELECT private.is_organization_admin(booking_services.organization_id) AS is_organization_admin)) WITH CHECK (( SELECT private.is_organization_admin(booking_services.organization_id) AS is_organization_admin));


--
-- Name: organization_design_settings organization admins insert design settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization admins insert design settings" ON public.organization_design_settings FOR INSERT TO authenticated WITH CHECK ((organization_id IN ( SELECT membership.organization_id
   FROM public.organization_memberships membership
  WHERE ((membership.user_id = ( SELECT app.current_user_id() AS uid)) AND (membership.role = 'admin'::text)))));


--
-- Name: organization_design_settings organization admins update design settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization admins update design settings" ON public.organization_design_settings FOR UPDATE TO authenticated USING ((organization_id IN ( SELECT membership.organization_id
   FROM public.organization_memberships membership
  WHERE ((membership.user_id = ( SELECT app.current_user_id() AS uid)) AND (membership.role = 'admin'::text))))) WITH CHECK ((organization_id IN ( SELECT membership.organization_id
   FROM public.organization_memberships membership
  WHERE ((membership.user_id = ( SELECT app.current_user_id() AS uid)) AND (membership.role = 'admin'::text)))));


--
-- Name: crm_activities organization members can create crm activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization members can create crm activities" ON public.crm_activities FOR INSERT TO authenticated WITH CHECK ((private.is_organization_member(organization_id) AND (task_id IS NULL)));


--
-- Name: crm_tasks organization members can create crm tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization members can create crm tasks" ON public.crm_tasks FOR INSERT TO authenticated WITH CHECK ((private.is_organization_member(organization_id) AND ((delegation_status = 'not_delegated'::text) OR (delegator_user_id = ( SELECT app.current_user_id() AS uid)))));


--
-- Name: crm_activities organization members can delete non audit activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization members can delete non audit activities" ON public.crm_activities FOR DELETE TO authenticated USING ((private.is_organization_member(organization_id) AND (task_id IS NULL)));


--
-- Name: crm_tasks organization members can delete non delegated crm tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization members can delete non delegated crm tasks" ON public.crm_tasks FOR DELETE TO authenticated USING ((private.is_organization_member(organization_id) AND (delegation_status = 'not_delegated'::text)));


--
-- Name: crm_activities organization members can update non audit activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization members can update non audit activities" ON public.crm_activities FOR UPDATE TO authenticated USING ((private.is_organization_member(organization_id) AND (task_id IS NULL))) WITH CHECK ((private.is_organization_member(organization_id) AND (task_id IS NULL)));


--
-- Name: booking_services organization members can view booking services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization members can view booking services" ON public.booking_services FOR SELECT TO authenticated USING (( SELECT private.is_organization_member(booking_services.organization_id) AS is_organization_member));


--
-- Name: crm_activities organization members can view crm activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization members can view crm activities" ON public.crm_activities FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: crm_tasks organization members can view crm tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization members can view crm tasks" ON public.crm_tasks FOR SELECT TO authenticated USING (private.is_organization_member(organization_id));


--
-- Name: organization_design_settings organization members read design settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization members read design settings" ON public.organization_design_settings FOR SELECT TO authenticated USING ((organization_id IN ( SELECT membership.organization_id
   FROM public.organization_memberships membership
  WHERE (membership.user_id = ( SELECT app.current_user_id() AS uid)))));


--
-- Name: team_facilities organization or scoped team admins can link facilities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization or scoped team admins can link facilities" ON public.team_facilities FOR INSERT TO authenticated WITH CHECK ((( SELECT private.is_organization_admin(team_facilities.organization_id) AS is_organization_admin) OR (( SELECT private.is_team_admin(team_facilities.organization_id, team_facilities.team_id) AS is_team_admin) AND ( SELECT private.has_facility_admin_membership(team_facilities.organization_id, team_facilities.facility_id) AS has_facility_admin_membership))));


--
-- Name: team_facilities organization or scoped team admins can unlink facilities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization or scoped team admins can unlink facilities" ON public.team_facilities FOR DELETE TO authenticated USING ((( SELECT private.is_organization_admin(team_facilities.organization_id) AS is_organization_admin) OR (( SELECT private.is_team_admin(team_facilities.organization_id, team_facilities.team_id) AS is_team_admin) AND ( SELECT private.has_facility_admin_membership(team_facilities.organization_id, team_facilities.facility_id) AS has_facility_admin_membership))));


--
-- Name: team_memberships organization or team admins can delete team memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization or team admins can delete team memberships" ON public.team_memberships FOR DELETE TO authenticated USING ((( SELECT private.is_organization_admin(team_memberships.organization_id) AS is_organization_admin) OR ( SELECT private.is_team_admin(team_memberships.organization_id, team_memberships.team_id) AS is_team_admin)));


--
-- Name: team_memberships organization or team admins can insert team memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization or team admins can insert team memberships" ON public.team_memberships FOR INSERT TO authenticated WITH CHECK ((( SELECT private.is_organization_admin(team_memberships.organization_id) AS is_organization_admin) OR ( SELECT private.is_team_admin(team_memberships.organization_id, team_memberships.team_id) AS is_team_admin)));


--
-- Name: team_memberships organization or team admins can update team memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "organization or team admins can update team memberships" ON public.team_memberships FOR UPDATE TO authenticated USING ((( SELECT private.is_organization_admin(team_memberships.organization_id) AS is_organization_admin) OR ( SELECT private.is_team_admin(team_memberships.organization_id, team_memberships.team_id) AS is_team_admin))) WITH CHECK ((( SELECT private.is_organization_admin(team_memberships.organization_id) AS is_organization_admin) OR ( SELECT private.is_team_admin(team_memberships.organization_id, team_memberships.team_id) AS is_team_admin)));


--
-- Name: organization_design_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_design_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_user_access_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_user_access_states ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_user_access_states organization_user_access_states_scoped_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_user_access_states_scoped_read ON public.organization_user_access_states FOR SELECT TO authenticated USING (((user_id = ( SELECT app.current_user_id() AS uid)) OR ( SELECT private.has_administrative_permission(organization_user_access_states.organization_id, 'iam.members.read'::text) AS has_administrative_permission)));


--
-- Name: organization_user_admin_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_user_admin_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_user_admin_roles organization_user_admin_roles_scoped_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_user_admin_roles_scoped_read ON public.organization_user_admin_roles FOR SELECT TO authenticated USING (((user_id = ( SELECT app.current_user_id() AS uid)) OR ( SELECT private.has_administrative_permission(organization_user_admin_roles.organization_id, 'iam.members.read'::text) AS has_administrative_permission)));


--
-- Name: organization_user_audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_user_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_user_audit_events organization_user_audit_events_access_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_user_audit_events_access_admin_read ON public.organization_user_audit_events FOR SELECT TO authenticated USING (( SELECT private.has_administrative_permission(organization_user_audit_events.organization_id, 'iam.audit.read'::text) AS has_administrative_permission));


--
-- Name: organization_user_direct_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_user_direct_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_user_direct_grants organization_user_direct_grants_scoped_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_user_direct_grants_scoped_read ON public.organization_user_direct_grants FOR SELECT TO authenticated USING (((user_id = ( SELECT app.current_user_id() AS uid)) OR ( SELECT private.has_administrative_permission(organization_user_direct_grants.organization_id, 'iam.grants.manage'::text) AS has_administrative_permission)));


--
-- Name: organization_user_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_user_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles are editable by their identity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles are editable by their identity" ON public.profiles FOR UPDATE TO authenticated USING ((id = ( SELECT app.current_user_id() AS uid))) WITH CHECK ((id = ( SELECT app.current_user_id() AS uid)));


--
-- Name: profiles profiles are visible to their identity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles are visible to their identity" ON public.profiles FOR SELECT TO authenticated USING ((id = ( SELECT app.current_user_id() AS uid)));


--
-- Name: appointments scoped members can view appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view appointments" ON public.appointments FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(appointments.organization_id, appointments.facility_id) AS can_view_facility));


--
-- Name: booking_widget_services scoped members can view booking widget services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view booking widget services" ON public.booking_widget_services FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(booking_widget_services.organization_id, booking_widget_services.facility_id) AS can_view_facility));


--
-- Name: booking_widgets scoped members can view booking widgets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view booking widgets" ON public.booking_widgets FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(booking_widgets.organization_id, booking_widgets.facility_id) AS can_view_facility));


--
-- Name: expert_availability_overrides scoped members can view expert availability overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view expert availability overrides" ON public.expert_availability_overrides FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(expert_availability_overrides.organization_id, expert_availability_overrides.facility_id) AS can_view_facility));


--
-- Name: expert_availability_rules scoped members can view expert availability rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view expert availability rules" ON public.expert_availability_rules FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(expert_availability_rules.organization_id, expert_availability_rules.facility_id) AS can_view_facility));


--
-- Name: facility_images scoped members can view facility images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view facility images" ON public.facility_images FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(facility_images.organization_id, facility_images.facility_id) AS can_view_facility));


--
-- Name: facility_memberships scoped members can view facility memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view facility memberships" ON public.facility_memberships FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(facility_memberships.organization_id, facility_memberships.facility_id) AS can_view_facility));


--
-- Name: facility_opening_hours scoped members can view facility opening hours; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view facility opening hours" ON public.facility_opening_hours FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(facility_opening_hours.organization_id, facility_opening_hours.facility_id) AS can_view_facility));


--
-- Name: facility_opening_overrides scoped members can view facility opening overrides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view facility opening overrides" ON public.facility_opening_overrides FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(facility_opening_overrides.organization_id, facility_opening_overrides.facility_id) AS can_view_facility));


--
-- Name: facility_service_experts scoped members can view facility service experts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view facility service experts" ON public.facility_service_experts FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(facility_service_experts.organization_id, facility_service_experts.facility_id) AS can_view_facility));


--
-- Name: facility_services scoped members can view facility services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view facility services" ON public.facility_services FOR SELECT TO authenticated USING (( SELECT private.can_view_facility(facility_services.organization_id, facility_services.facility_id) AS can_view_facility));


--
-- Name: team_facilities scoped members can view team facility links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view team facility links" ON public.team_facilities FOR SELECT TO authenticated USING ((( SELECT private.can_view_facility(team_facilities.organization_id, team_facilities.facility_id) AS can_view_facility) OR ( SELECT private.can_view_team(team_facilities.organization_id, team_facilities.team_id) AS can_view_team)));


--
-- Name: team_memberships scoped members can view team memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "scoped members can view team memberships" ON public.team_memberships FOR SELECT TO authenticated USING (( SELECT private.can_view_team(team_memberships.organization_id, team_memberships.team_id) AS can_view_team));


--
-- Name: facilities structure managers can create facilities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure managers can create facilities" ON public.facilities FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_administrative_permission(facilities.organization_id, 'structure.manage'::text) AS has_administrative_permission));


--
-- Name: facilities structure managers can delete facilities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure managers can delete facilities" ON public.facilities FOR DELETE TO authenticated USING (( SELECT private.has_administrative_permission(facilities.organization_id, 'structure.manage'::text) AS has_administrative_permission));


--
-- Name: team_edges structure managers can delete team edges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure managers can delete team edges" ON public.team_edges FOR DELETE TO authenticated USING (( SELECT private.has_administrative_permission(team_edges.organization_id, 'structure.manage'::text) AS has_administrative_permission));


--
-- Name: teams structure managers can delete teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure managers can delete teams" ON public.teams FOR DELETE TO authenticated USING (( SELECT private.has_administrative_permission(teams.organization_id, 'structure.manage'::text) AS has_administrative_permission));


--
-- Name: teams structure managers can insert teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure managers can insert teams" ON public.teams FOR INSERT TO authenticated WITH CHECK (( SELECT private.has_administrative_permission(teams.organization_id, 'structure.manage'::text) AS has_administrative_permission));


--
-- Name: facilities structure or scoped facility admins can update facilities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure or scoped facility admins can update facilities" ON public.facilities FOR UPDATE TO authenticated USING ((( SELECT private.has_administrative_permission(facilities.organization_id, 'structure.manage'::text) AS has_administrative_permission) OR ( SELECT private.is_facility_admin(facilities.organization_id, facilities.id) AS is_facility_admin))) WITH CHECK ((( SELECT private.has_administrative_permission(facilities.organization_id, 'structure.manage'::text) AS has_administrative_permission) OR ( SELECT private.is_facility_admin(facilities.organization_id, facilities.id) AS is_facility_admin)));


--
-- Name: teams structure or scoped team admins can update teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure or scoped team admins can update teams" ON public.teams FOR UPDATE TO authenticated USING ((( SELECT private.has_administrative_permission(teams.organization_id, 'structure.manage'::text) AS has_administrative_permission) OR ( SELECT private.is_team_admin(teams.organization_id, teams.id) AS is_team_admin))) WITH CHECK ((( SELECT private.has_administrative_permission(teams.organization_id, 'structure.manage'::text) AS has_administrative_permission) OR ( SELECT private.is_team_admin(teams.organization_id, teams.id) AS is_team_admin)));


--
-- Name: facilities structure readers can view facilities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure readers can view facilities" ON public.facilities FOR SELECT TO authenticated USING ((( SELECT private.has_administrative_permission(facilities.organization_id, 'structure.read'::text) AS has_administrative_permission) OR ( SELECT private.can_view_facility(facilities.organization_id, facilities.id) AS can_view_facility)));


--
-- Name: team_edges structure readers can view team edges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure readers can view team edges" ON public.team_edges FOR SELECT TO authenticated USING ((( SELECT private.has_administrative_permission(team_edges.organization_id, 'structure.read'::text) AS has_administrative_permission) OR ( SELECT private.can_view_team(team_edges.organization_id, team_edges.parent_team_id) AS can_view_team) OR ( SELECT private.can_view_team(team_edges.organization_id, team_edges.child_team_id) AS can_view_team)));


--
-- Name: teams structure readers can view teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "structure readers can view teams" ON public.teams FOR SELECT TO authenticated USING ((( SELECT private.has_administrative_permission(teams.organization_id, 'structure.read'::text) AS has_administrative_permission) OR ( SELECT private.can_view_team(teams.organization_id, teams.id) AS can_view_team)));


--
-- Name: crm_tasks task participants can update crm tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task participants can update crm tasks" ON public.crm_tasks FOR UPDATE TO authenticated USING ((private.is_organization_member(organization_id) AND ((delegation_status = 'not_delegated'::text) OR (delegator_user_id = ( SELECT app.current_user_id() AS uid)) OR (assignee_user_id = ( SELECT app.current_user_id() AS uid)) OR private.is_organization_admin(organization_id)))) WITH CHECK ((private.is_organization_member(organization_id) AND ((delegation_status = 'not_delegated'::text) OR (delegator_user_id = ( SELECT app.current_user_id() AS uid)) OR (assignee_user_id = ( SELECT app.current_user_id() AS uid)) OR private.is_organization_admin(organization_id))));


--
-- Name: team_edges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_edges ENABLE ROW LEVEL SECURITY;

--
-- Name: team_facilities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_facilities ENABLE ROW LEVEL SECURITY;

--
-- Name: team_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_user_roles users can read their platform roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can read their platform roles" ON public.platform_user_roles FOR SELECT TO authenticated USING ((user_id = ( SELECT app.current_user_id() AS uid)));


--
-- Name: users users can view shared organization profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can view shared organization profiles" ON public.users FOR SELECT TO authenticated USING (private.shares_organization(id));


--
-- Name: waitlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict ZT8nAR96TTjvtLhJtM7AkaGSovb0iUb6nb7eU4XoJOVTnHl3wO3iJtHT3avWocl
