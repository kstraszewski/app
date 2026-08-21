#!/usr/bin/env bash

set -euo pipefail

database_url="${OPENEXPERT_0078_DATABASE_URL:-${1:-}}"
if [[ -z "$database_url" ]]; then
  echo "usage: OPENEXPERT_0078_DATABASE_URL=postgresql://... bash $0" >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 2
fi

organization_id_value="$(
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 -c 'SELECT gen_random_uuid();'
)"
owner_user_id_value="$(
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 -c 'SELECT gen_random_uuid();'
)"
first_target_user_id_value="$(
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 -c 'SELECT gen_random_uuid();'
)"
second_target_user_id_value="$(
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 -c 'SELECT gen_random_uuid();'
)"

for identifier in \
  "$organization_id_value" \
  "$owner_user_id_value" \
  "$first_target_user_id_value" \
  "$second_target_user_id_value"; do
  if [[ ! "$identifier" =~ ^[0-9a-f-]{36}$ ]]; then
    echo "failed to allocate validated MVCC fixture identifiers" >&2
    exit 1
  fi
done

owner_email_value="capacity-owner-${owner_user_id_value//-/}@example.test"
first_target_email_value="capacity-a-${first_target_user_id_value//-/}@example.test"
second_target_email_value="capacity-b-${second_target_user_id_value//-/}@example.test"
task_temp_dir="$(mktemp -d /tmp/openexpert-0078-capacity.XXXXXX)"
first_output="$task_temp_dir/first.log"
second_output="$task_temp_dir/second.log"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  psql "$database_url" -X -v ON_ERROR_STOP=1 \
    -v organization_id_value="$organization_id_value" \
    -v owner_user_id_value="$owner_user_id_value" \
    -v first_target_user_id_value="$first_target_user_id_value" \
    -v second_target_user_id_value="$second_target_user_id_value" <<'SQL' \
    >/dev/null 2>&1 || true
BEGIN;
DELETE FROM public.organization_user_access_states
WHERE organization_id = :'organization_id_value'::uuid;
DELETE FROM public.organization_memberships
WHERE organization_id = :'organization_id_value'::uuid;
DELETE FROM public.organization_billing_accounts
WHERE organization_id = :'organization_id_value'::uuid;
DELETE FROM public.crm_consent_definition_versions
WHERE organization_id = :'organization_id_value'::uuid;
DELETE FROM public.crm_consent_definitions
WHERE organization_id = :'organization_id_value'::uuid;
DELETE FROM public.users
WHERE id IN (
  :'owner_user_id_value'::uuid,
  :'first_target_user_id_value'::uuid,
  :'second_target_user_id_value'::uuid
);
DELETE FROM public.organizations
WHERE id = :'organization_id_value'::uuid;
DELETE FROM identity.users
WHERE id IN (
  :'owner_user_id_value'::uuid,
  :'first_target_user_id_value'::uuid,
  :'second_target_user_id_value'::uuid
);
COMMIT;
SQL

  rm -f "$first_output" "$second_output"
  rmdir "$task_temp_dir" 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Commit one occupied member and two licensed seats. Each concurrent RPC below
# names a different verified identity, but both contend for the same final slot.
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -v organization_id_value="$organization_id_value" \
  -v owner_user_id_value="$owner_user_id_value" \
  -v first_target_user_id_value="$first_target_user_id_value" \
  -v second_target_user_id_value="$second_target_user_id_value" \
  -v owner_email_value="$owner_email_value" \
  -v first_target_email_value="$first_target_email_value" \
  -v second_target_email_value="$second_target_email_value" <<'SQL'
BEGIN;

INSERT INTO identity.users (id, name, email, email_verified)
VALUES
  (
    :'owner_user_id_value'::uuid,
    '0078 MVCC Owner',
    :'owner_email_value',
    true
  ),
  (
    :'first_target_user_id_value'::uuid,
    '0078 MVCC First',
    :'first_target_email_value',
    true
  ),
  (
    :'second_target_user_id_value'::uuid,
    '0078 MVCC Second',
    :'second_target_email_value',
    true
  );

INSERT INTO public.organizations (
  id,
  name,
  slug,
  kind,
  billing_access_state
) VALUES (
  :'organization_id_value'::uuid,
  '0078 capacity MVCC smoke',
  'capacity-mvcc-' || replace(:'organization_id_value', '-', ''),
  'application',
  'active'
);

INSERT INTO public.users (
  id,
  organization_id,
  email,
  role,
  full_name
) VALUES (
  :'owner_user_id_value'::uuid,
  :'organization_id_value'::uuid,
  :'owner_email_value',
  'admin',
  '0078 MVCC Owner'
);

INSERT INTO public.organization_memberships (
  organization_id,
  user_id,
  role
) VALUES (
  :'organization_id_value'::uuid,
  :'owner_user_id_value'::uuid,
  'admin'
);

INSERT INTO public.organization_billing_accounts (
  organization_id,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_checkout_session_id,
  stripe_price_id,
  stripe_subscription_status,
  stripe_subscription_item_id,
  licensed_seat_count,
  livemode,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  last_stripe_event_created_at,
  last_synced_at
) VALUES (
  :'organization_id_value'::uuid,
  'cus_' || replace(:'organization_id_value', '-', ''),
  'sub_' || replace(:'organization_id_value', '-', ''),
  'cs_test_' || replace(:'organization_id_value', '-', ''),
  'price_' || replace(:'organization_id_value', '-', ''),
  'active',
  'si_' || replace(:'organization_id_value', '-', ''),
  2,
  false,
  statement_timestamp() - interval '1 day',
  statement_timestamp() + interval '29 days',
  false,
  extract(epoch FROM statement_timestamp())::bigint,
  statement_timestamp()
);

COMMIT;
SQL

set +e
psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT public.add_organization_member_within_capacity_v1(
    '$organization_id_value'::uuid,
    '$owner_user_id_value'::uuid,
    '$first_target_email_value',
    'expert'
  );" >"$first_output" 2>&1 &
first_pid=$!

psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT public.add_organization_member_within_capacity_v1(
    '$organization_id_value'::uuid,
    '$owner_user_id_value'::uuid,
    '$second_target_email_value',
    'expert'
  );" >"$second_output" 2>&1 &
second_pid=$!

wait "$first_pid"
first_status=$?
wait "$second_pid"
second_status=$?
set -e

if [[ "$first_status" -eq 0 && "$second_status" -eq 0 ]] \
   || [[ "$first_status" -ne 0 && "$second_status" -ne 0 ]]; then
  cat "$first_output" >&2
  cat "$second_output" >&2
  echo "MVCC failure: exactly one final-seat caller must succeed" >&2
  exit 1
fi

failed_output="$first_output"
if [[ "$first_status" -eq 0 ]]; then
  failed_output="$second_output"
fi
if ! grep -q 'organization_seat_capacity_exhausted' "$failed_output"; then
  cat "$first_output" >&2
  cat "$second_output" >&2
  echo "MVCC failure: losing caller did not observe exhausted capacity" >&2
  exit 1
fi

observed_counts="$(
  psql "$database_url" -X -At -F '|' -v ON_ERROR_STOP=1 \
    -c "SELECT
      count(membership.user_id)::integer,
      account.licensed_seat_count
    FROM public.organization_billing_accounts AS account
    JOIN public.organization_memberships AS membership
      ON membership.organization_id = account.organization_id
    WHERE account.organization_id = '$organization_id_value'::uuid
    GROUP BY account.licensed_seat_count;"
)"

if [[ "$observed_counts" != "2|2" ]]; then
  cat "$first_output" >&2
  cat "$second_output" >&2
  echo "MVCC failure: observed member/licensed counts '$observed_counts'" >&2
  exit 1
fi

echo "0078 capacity MVCC smoke passed: one of two final-seat callers committed"
