#!/usr/bin/env bash

set -euo pipefail

database_url="${OPENEXPERT_0074_DATABASE_URL:-${1:-}}"
if [[ -z "$database_url" ]]; then
  echo "usage: OPENEXPERT_0074_DATABASE_URL=postgresql://... bash $0" >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 2
fi

organization_id_value="$(
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
    -c 'SELECT gen_random_uuid();'
)"
event_value="$(
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
    -c 'SELECT extract(epoch FROM statement_timestamp())::bigint;'
)"
if [[ ! "$organization_id_value" =~ ^[0-9a-f-]{36}$ ]] \
   || [[ ! "$event_value" =~ ^[0-9]+$ ]]; then
  echo "failed to allocate validated MVCC fixture identifiers" >&2
  exit 1
fi

task_temp_dir="$(mktemp -d /tmp/openexpert-0074-mvcc.XXXXXX)"
session_a_output="$task_temp_dir/session-a.log"
activity_marker="openexpert_0074_mvcc_${organization_id_value//-/}"
session_a_pid=""

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "$session_a_pid" ]] && kill -0 "$session_a_pid" 2>/dev/null; then
    kill "$session_a_pid" 2>/dev/null || true
    wait "$session_a_pid" 2>/dev/null || true
  fi

  psql "$database_url" -X -v ON_ERROR_STOP=1 \
    -c "DELETE FROM public.organizations WHERE id = '$organization_id_value'::uuid;" \
    >/dev/null 2>&1 || true

  rm -f "$session_a_output"
  rmdir "$task_temp_dir" 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Commit a disposable, blocked one-seat organization that both sessions can
# observe. The trap removes this exact validated UUID on success or failure.
psql "$database_url" -X -v ON_ERROR_STOP=1 \
  -v organization_id_value="$organization_id_value" \
  -v event_value="$event_value" <<'SQL'
BEGIN;

INSERT INTO public.organizations (
  id,
  name,
  slug,
  kind,
  billing_access_state
) VALUES (
  :'organization_id_value'::uuid,
  '0074 MVCC smoke',
  'atomic-mvcc-' || replace(:'organization_id_value', '-', ''),
  'application',
  'blocked'
);

INSERT INTO public.organization_memberships (
  organization_id,
  user_id,
  role
)
SELECT
  :'organization_id_value'::uuid,
  identity_user.id,
  'admin'
FROM identity.users AS identity_user
WHERE identity_user.email_verified
ORDER BY identity_user.created_at, identity_user.id
LIMIT 1;

-- Division by zero fails the setup if the local identity fixture is absent.
SELECT 1 / count(*)::integer
FROM public.organization_memberships AS membership
WHERE membership.organization_id = :'organization_id_value'::uuid;

INSERT INTO public.organization_billing_accounts (
  organization_id,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_checkout_session_id,
  stripe_price_id,
  stripe_subscription_status,
  livemode,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  last_stripe_event_created_at,
  last_synced_at,
  stripe_subscription_item_id,
  licensed_seat_count,
  seat_revision
) VALUES (
  :'organization_id_value'::uuid,
  'cus_' || replace(:'organization_id_value', '-', ''),
  'sub_' || replace(:'organization_id_value', '-', ''),
  'cs_test_' || replace(:'organization_id_value', '-', ''),
  'price_' || replace(:'organization_id_value', '-', ''),
  'active',
  false,
  statement_timestamp() - interval '1 day',
  statement_timestamp() + interval '29 days',
  false,
  :event_value::bigint - 1,
  statement_timestamp(),
  'si_' || replace(:'organization_id_value', '-', ''),
  1,
  1
);

COMMIT;
SQL

# Session A applies the valid combined snapshot but holds its transaction open
# in pg_sleep. The unique comment lets the controller wait until the RPC has
# finished, avoiding timing assumptions before Session B reads.
(
  psql "$database_url" -X -v ON_ERROR_STOP=1 \
    -v organization_id_value="$organization_id_value" \
    -v event_value="$event_value" <<SQL
BEGIN;

SELECT public.apply_organization_billing_and_seat_snapshot_v1(
  :'organization_id_value'::uuid,
  'cus_' || replace(:'organization_id_value', '-', ''),
  'sub_' || replace(:'organization_id_value', '-', ''),
  NULL,
  'price_' || replace(:'organization_id_value', '-', ''),
  'active',
  false,
  statement_timestamp() - interval '1 day',
  statement_timestamp() + interval '29 days',
  false,
  NULL,
  :event_value::bigint,
  'si_' || replace(:'organization_id_value', '-', ''),
  1
);

SELECT pg_sleep(5) /* $activity_marker */;
COMMIT;
SQL
) >"$session_a_output" 2>&1 &
session_a_pid=$!

session_a_holding="false"
for _attempt in {1..100}; do
  if ! kill -0 "$session_a_pid" 2>/dev/null; then
    wait "$session_a_pid" || true
    cat "$session_a_output" >&2
    echo "Session A exited before reaching the uncommitted hold" >&2
    exit 1
  fi

  session_a_holding="$(
    psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
      -c "SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND state = 'active'
          AND position('$activity_marker' IN query) > 0
      );"
  )"
  if [[ "$session_a_holding" == "t" ]]; then
    break
  fi
  sleep 0.05
done

if [[ "$session_a_holding" != "t" ]]; then
  cat "$session_a_output" >&2
  echo "Session A did not reach the uncommitted hold" >&2
  exit 1
fi

state_before_commit="$(
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
    -c "SELECT billing_access_state
        FROM public.organizations
        WHERE id = '$organization_id_value'::uuid;"
)"
if [[ "$state_before_commit" != "blocked" ]]; then
  echo "MVCC failure: Session B saw '$state_before_commit' before Session A commit" >&2
  exit 1
fi

if ! wait "$session_a_pid"; then
  cat "$session_a_output" >&2
  echo "Session A failed" >&2
  exit 1
fi
session_a_pid=""

state_after_commit="$(
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
    -c "SELECT billing_access_state
        FROM public.organizations
        WHERE id = '$organization_id_value'::uuid;"
)"
if [[ "$state_after_commit" != "active" ]]; then
  cat "$session_a_output" >&2
  echo "MVCC failure: Session B saw '$state_after_commit' after Session A commit" >&2
  exit 1
fi

echo "0074 MVCC smoke passed: blocked before commit, active after commit"
