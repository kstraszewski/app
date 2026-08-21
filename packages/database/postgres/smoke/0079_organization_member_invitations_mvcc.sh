#!/usr/bin/env bash

set -euo pipefail

database_url="${OPENEXPERT_0079_DATABASE_URL:-${1:-}}"
if [[ -z "$database_url" ]]; then
  echo "usage: OPENEXPERT_0079_DATABASE_URL=postgresql://... bash $0" >&2
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
owner_email_value="member-invite-owner-${owner_user_id_value//-/}@example.test"
first_email_value="member-invite-a-${organization_id_value//-/}@example.test"
second_email_value="member-invite-b-${organization_id_value//-/}@example.test"
first_token_hash="$(printf '%s' "0079-a-${organization_id_value}" | shasum -a 256 | awk '{print $1}')"
second_token_hash="$(printf '%s' "0079-b-${organization_id_value}" | shasum -a 256 | awk '{print $1}')"
task_temp_dir="$(mktemp -d /tmp/openexpert-0079-member-invite.XXXXXX)"
first_output="$task_temp_dir/first.log"
second_output="$task_temp_dir/second.log"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  psql "$database_url" -X -v ON_ERROR_STOP=1 \
    -v organization_id_value="$organization_id_value" \
    -v owner_user_id_value="$owner_user_id_value" <<'SQL' \
    >/dev/null 2>&1 || true
BEGIN;
DELETE FROM public.organization_member_invitations
WHERE organization_id = :'organization_id_value'::uuid;
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
WHERE id = :'owner_user_id_value'::uuid;
DELETE FROM public.organizations
WHERE id = :'organization_id_value'::uuid;
DELETE FROM identity.users
WHERE id = :'owner_user_id_value'::uuid;
COMMIT;
SQL
  rm -f "$first_output" "$second_output"
  rmdir "$task_temp_dir" 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -v organization_id_value="$organization_id_value" \
  -v owner_user_id_value="$owner_user_id_value" \
  -v owner_email_value="$owner_email_value" <<'SQL'
BEGIN;
INSERT INTO identity.users (id, name, email, email_verified)
VALUES (
  :'owner_user_id_value'::uuid,
  '0079 MVCC Owner',
  :'owner_email_value',
  true
);
INSERT INTO public.organizations (id, name, slug, kind, billing_access_state)
VALUES (
  :'organization_id_value'::uuid,
  '0079 member invitation MVCC smoke',
  'member-invite-mvcc-' || replace(:'organization_id_value', '-', ''),
  'application',
  'active'
);
INSERT INTO public.users (id, organization_id, email, role, full_name)
VALUES (
  :'owner_user_id_value'::uuid,
  :'organization_id_value'::uuid,
  :'owner_email_value',
  'admin',
  '0079 MVCC Owner'
);
INSERT INTO public.organization_memberships (organization_id, user_id, role)
VALUES (:'organization_id_value'::uuid, :'owner_user_id_value'::uuid, 'admin');
INSERT INTO public.organization_billing_accounts (
  organization_id,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_subscription_item_id,
  stripe_price_id,
  stripe_subscription_status,
  licensed_seat_count,
  current_period_start,
  current_period_end,
  last_synced_at
) VALUES (
  :'organization_id_value'::uuid,
  'cus_' || replace(:'organization_id_value', '-', ''),
  'sub_' || replace(:'organization_id_value', '-', ''),
  'si_' || replace(:'organization_id_value', '-', ''),
  'price_' || replace(:'organization_id_value', '-', ''),
  'active',
  2,
  statement_timestamp() - interval '1 day',
  statement_timestamp() + interval '29 days',
  statement_timestamp()
);
COMMIT;
SQL

set +e
psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT public.create_organization_member_invitation_v1(
    '$organization_id_value'::uuid,
    '$owner_user_id_value'::uuid,
    '$first_email_value',
    'expert',
    NULL,
    '$first_token_hash',
    statement_timestamp() + interval '1 day'
  );" >"$first_output" 2>&1 &
first_pid=$!

psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT public.create_organization_member_invitation_v1(
    '$organization_id_value'::uuid,
    '$owner_user_id_value'::uuid,
    '$second_email_value',
    'expert',
    NULL,
    '$second_token_hash',
    statement_timestamp() + interval '1 day'
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
  echo "MVCC failure: exactly one final-seat invitation must commit" >&2
  exit 1
fi

failed_output="$first_output"
if [[ "$first_status" -eq 0 ]]; then
  failed_output="$second_output"
fi
if ! grep -q 'organization_seat_capacity_exhausted' "$failed_output"; then
  cat "$first_output" >&2
  cat "$second_output" >&2
  echo "MVCC failure: losing invitation did not observe exhausted capacity" >&2
  exit 1
fi

observed_counts="$(
  psql "$database_url" -X -At -F '|' -v ON_ERROR_STOP=1 \
    -c "SELECT
      (SELECT count(*)::integer
       FROM public.organization_memberships AS membership
       WHERE membership.organization_id = '$organization_id_value'::uuid),
      (SELECT count(*)::integer
       FROM public.organization_member_invitations AS invitation
       WHERE invitation.organization_id = '$organization_id_value'::uuid
         AND invitation.status = 'pending'
         AND invitation.expires_at > statement_timestamp()),
      account.licensed_seat_count
    FROM public.organization_billing_accounts AS account
    WHERE account.organization_id = '$organization_id_value'::uuid;"
)"

if [[ "$observed_counts" != "1|1|2" ]]; then
  cat "$first_output" >&2
  cat "$second_output" >&2
  echo "MVCC failure: observed member/reserved/licensed counts '$observed_counts'" >&2
  exit 1
fi

echo "0079 member invitation MVCC smoke passed: one of two final-seat reservations committed"
