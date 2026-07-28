-- Expert-only CRM omnisearch.
--
-- Cases and clients already have mature search projections. The remaining
-- large expert-facing records get small, purpose-built projections so the
-- command palette never has to fall back to organization-wide wildcard scans.

alter table public.crm_tasks
  add column omnisearch_text text,
  add column omnisearch_vector tsvector;

alter table public.crm_documents
  add column omnisearch_text text,
  add column omnisearch_vector tsvector;

alter table public.crm_item_submissions
  add column omnisearch_text text,
  add column omnisearch_vector tsvector;

alter table public.crm_case_bank_applications
  add column omnisearch_text text,
  add column omnisearch_vector tsvector;

alter table public.appointments
  add column omnisearch_text text,
  add column omnisearch_vector tsvector;

create or replace function private.refresh_crm_task_omnisearch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.refresh_crm_document_omnisearch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.refresh_crm_submission_omnisearch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.refresh_crm_bank_application_omnisearch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.refresh_appointment_omnisearch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

-- Backfill without changing business timestamps or producing task audit rows.
alter table public.crm_tasks disable trigger set_crm_tasks_updated_at;
alter table public.crm_tasks disable trigger crm_tasks_validate_delegation;
alter table public.crm_tasks disable trigger crm_tasks_record_audit;

update public.crm_tasks task
set
  omnisearch_text = private.crm_search_normalize(concat_ws(
    ' ',
    task.title,
    task.description,
    task.status_code,
    task.priority,
    task.delegation_status
  )),
  omnisearch_vector =
    setweight(
      to_tsvector('simple', private.crm_search_normalize(task.title)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        task.description,
        task.status_code,
        task.priority,
        task.delegation_status
      ))),
      'B'
    );

alter table public.crm_tasks enable trigger crm_tasks_record_audit;
alter table public.crm_tasks enable trigger crm_tasks_validate_delegation;
alter table public.crm_tasks enable trigger set_crm_tasks_updated_at;

alter table public.crm_documents disable trigger set_crm_documents_updated_at;

update public.crm_documents document
set
  omnisearch_text = private.crm_search_normalize(concat_ws(
    ' ',
    document.name,
    document.document_type,
    document.status_code
  )),
  omnisearch_vector =
    setweight(
      to_tsvector('simple', private.crm_search_normalize(document.name)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        document.document_type,
        document.status_code
      ))),
      'B'
    );

alter table public.crm_documents enable trigger set_crm_documents_updated_at;

alter table public.crm_item_submissions disable trigger set_crm_item_submissions_updated_at;

update public.crm_item_submissions submission
set
  omnisearch_text = private.crm_search_normalize(concat_ws(
    ' ',
    submission.external_reference,
    submission.status_code,
    submission.notes
  )),
  omnisearch_vector =
    setweight(
      to_tsvector('simple', private.crm_search_normalize(submission.external_reference)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        submission.status_code,
        submission.notes
      ))),
      'B'
    );

alter table public.crm_item_submissions enable trigger set_crm_item_submissions_updated_at;

alter table public.crm_case_bank_applications
  disable trigger crm_case_bank_applications_snapshot_guard;

update public.crm_case_bank_applications application
set
  omnisearch_text = private.crm_search_normalize(concat_ws(
    ' ',
    snapshot.bank_name,
    snapshot.product_name,
    snapshot.version_key
  )),
  omnisearch_vector =
    setweight(
      to_tsvector('simple', private.crm_search_normalize(snapshot.bank_name)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        snapshot.product_name,
        snapshot.version_key
      ))),
      'B'
    )
from public.crm_case_offer_snapshots snapshot
where snapshot.organization_id = application.organization_id
  and snapshot.case_id = application.case_id
  and snapshot.id = application.offer_id;

alter table public.crm_case_bank_applications
  enable trigger crm_case_bank_applications_snapshot_guard;

alter table public.appointments disable trigger appointments_set_updated_at;

update public.appointments appointment
set
  omnisearch_text = private.crm_search_normalize(concat_ws(
    ' ',
    appointment.customer_name,
    appointment.customer_email,
    appointment.customer_phone,
    nullif(regexp_replace(coalesce(appointment.customer_phone, ''), '[^0-9]+', '', 'g'), ''),
    appointment.notes,
    appointment.status,
    appointment.meeting_mode,
    appointment.source
  )),
  omnisearch_vector =
    setweight(
      to_tsvector('simple', private.crm_search_normalize(appointment.customer_name)),
      'A'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        appointment.customer_email,
        appointment.customer_phone,
        nullif(regexp_replace(coalesce(appointment.customer_phone, ''), '[^0-9]+', '', 'g'), '')
      ))),
      'B'
    )
    || setweight(
      to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        appointment.notes,
        appointment.status,
        appointment.meeting_mode,
        appointment.source
      ))),
      'C'
    );

alter table public.appointments enable trigger appointments_set_updated_at;

alter table public.crm_tasks
  alter column omnisearch_text set default '',
  alter column omnisearch_text set not null,
  alter column omnisearch_vector set default ''::tsvector,
  alter column omnisearch_vector set not null;

alter table public.crm_documents
  alter column omnisearch_text set default '',
  alter column omnisearch_text set not null,
  alter column omnisearch_vector set default ''::tsvector,
  alter column omnisearch_vector set not null;

alter table public.crm_item_submissions
  alter column omnisearch_text set default '',
  alter column omnisearch_text set not null,
  alter column omnisearch_vector set default ''::tsvector,
  alter column omnisearch_vector set not null;

alter table public.crm_case_bank_applications
  alter column omnisearch_text set default '',
  alter column omnisearch_text set not null,
  alter column omnisearch_vector set default ''::tsvector,
  alter column omnisearch_vector set not null;

alter table public.appointments
  alter column omnisearch_text set default '',
  alter column omnisearch_text set not null,
  alter column omnisearch_vector set default ''::tsvector,
  alter column omnisearch_vector set not null;

create trigger crm_tasks_refresh_omnisearch
  before insert or update
  on public.crm_tasks
  for each row execute function private.refresh_crm_task_omnisearch();

create trigger crm_documents_refresh_omnisearch
  before insert or update
  on public.crm_documents
  for each row execute function private.refresh_crm_document_omnisearch();

create trigger crm_item_submissions_refresh_omnisearch
  before insert or update
  on public.crm_item_submissions
  for each row execute function private.refresh_crm_submission_omnisearch();

create trigger crm_case_bank_applications_refresh_omnisearch
  before insert or update
  on public.crm_case_bank_applications
  for each row execute function private.refresh_crm_bank_application_omnisearch();

create trigger appointments_refresh_omnisearch
  before insert or update
  on public.appointments
  for each row execute function private.refresh_appointment_omnisearch();

create index crm_tasks_omnisearch_vector_idx
  on public.crm_tasks using gin (omnisearch_vector);
create index crm_tasks_omnisearch_text_trgm_idx
  on public.crm_tasks using gin (omnisearch_text extensions.gin_trgm_ops);
create index crm_tasks_title_trgm_idx
  on public.crm_tasks using gin (title extensions.gin_trgm_ops);

create index crm_documents_omnisearch_vector_idx
  on public.crm_documents using gin (omnisearch_vector);
create index crm_documents_omnisearch_text_trgm_idx
  on public.crm_documents using gin (omnisearch_text extensions.gin_trgm_ops);
create index crm_documents_name_trgm_idx
  on public.crm_documents using gin (name extensions.gin_trgm_ops);

create index crm_item_submissions_omnisearch_vector_idx
  on public.crm_item_submissions using gin (omnisearch_vector);
create index crm_item_submissions_omnisearch_text_trgm_idx
  on public.crm_item_submissions using gin (omnisearch_text extensions.gin_trgm_ops);
create index crm_item_submissions_reference_trgm_idx
  on public.crm_item_submissions using gin (external_reference extensions.gin_trgm_ops)
  where external_reference is not null;

create index crm_case_bank_applications_omnisearch_vector_idx
  on public.crm_case_bank_applications using gin (omnisearch_vector);
create index crm_case_bank_applications_omnisearch_text_trgm_idx
  on public.crm_case_bank_applications using gin (omnisearch_text extensions.gin_trgm_ops);

create index appointments_omnisearch_vector_idx
  on public.appointments using gin (omnisearch_vector);
create index appointments_omnisearch_text_trgm_idx
  on public.appointments using gin (omnisearch_text extensions.gin_trgm_ops);
create index appointments_customer_name_trgm_idx
  on public.appointments using gin (customer_name extensions.gin_trgm_ops);

create index crm_cases_title_trgm_idx
  on public.crm_cases using gin (title extensions.gin_trgm_ops);
create index crm_clients_display_name_trgm_idx
  on public.crm_clients using gin (display_name extensions.gin_trgm_ops);

-- The public RPC is SECURITY INVOKER so appointment RLS continues to enforce
-- facility scope. Expose only this harmless normalizer to that RPC instead of
-- granting application roles access to the broader private helper surface.
create or replace function public.crm_omnisearch_normalize(input text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    coalesce(input, '')
  ));
$$;

create or replace function public.search_crm_omnisearch(
  p_organization_id uuid,
  p_query text,
  p_limit integer default 5
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
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

revoke all on function private.refresh_crm_task_omnisearch() from public, anon, authenticated;
revoke all on function private.refresh_crm_document_omnisearch() from public, anon, authenticated;
revoke all on function private.refresh_crm_submission_omnisearch() from public, anon, authenticated;
revoke all on function private.refresh_crm_bank_application_omnisearch() from public, anon, authenticated;
revoke all on function private.refresh_appointment_omnisearch() from public, anon, authenticated;

revoke all on function public.crm_omnisearch_normalize(text)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_omnisearch_normalize(text)
  to authenticated;

revoke all on function public.search_crm_omnisearch(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_crm_omnisearch(uuid, text, integer)
  to authenticated;

comment on function public.search_crm_omnisearch(uuid, text, integer) is
  'Minimal, ranked, RLS-scoped search payload for the CRM command palette.';
