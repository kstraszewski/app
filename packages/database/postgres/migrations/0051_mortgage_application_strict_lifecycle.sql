-- Strict mortgage lifecycle activation (phase 2).
--
-- IMPORTANT: deploy this migration only after every application server uses
-- execute_crm_mortgage_application_command and the new artifact/signing paths.
-- 0049 is intentionally a separate compatibility-phase release.

-- Stop compatibility reconciliation before changing legacy projections below.
DROP TRIGGER crm_item_submissions_sync_mortgage_legacy_status
  ON public.crm_item_submissions;
DROP TRIGGER crm_case_contract_selections_project_mortgage_process
  ON public.crm_case_contract_selections;

-- Block compatibility-window contract inserts and status writes until the
-- backfill, trigger swap and RPC replacement commit as one unit.
LOCK TABLE public.crm_case_contract_selections IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.crm_item_submissions IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.crm_mortgage_application_processes IN SHARE ROW EXCLUSIVE MODE;

-- A contract may have been signed through the phase-1 legacy RPC after 0049.
-- Promote every signed aggregate that still lacks its terminal ledger event.
WITH candidates AS MATERIALIZED (
  SELECT
    process.organization_id,
    process.case_id,
    process.application_id,
    process.stage AS previous_stage,
    process.revision AS previous_revision,
    contract.signed_at,
    contract.signed_by_user_id
  FROM public.crm_case_contract_selections contract
  JOIN public.crm_mortgage_application_processes process
    ON process.organization_id = contract.organization_id
   AND process.case_id = contract.case_id
   AND process.application_id = contract.application_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_events event
    WHERE event.organization_id = process.organization_id
      AND event.case_id = process.case_id
      AND event.application_id = process.application_id
      AND event.event_type = 'contract_signed'
  )
  FOR UPDATE OF process
), promoted AS (
  UPDATE public.crm_mortgage_application_processes process
  SET stage = 'completed',
      revision = process.revision + 1,
      closed_at = NULL,
      updated_by_user_id = candidates.signed_by_user_id
  FROM candidates
  WHERE process.organization_id = candidates.organization_id
    AND process.case_id = candidates.case_id
    AND process.application_id = candidates.application_id
  RETURNING
    process.organization_id,
    process.case_id,
    process.application_id,
    process.revision,
    candidates.previous_stage,
    candidates.previous_revision,
    candidates.signed_at,
    candidates.signed_by_user_id
)
INSERT INTO public.crm_mortgage_application_events (
  organization_id, case_id, application_id, aggregate_revision,
  command_id, event_type, actor_user_id, occurred_at, payload
)
SELECT
  promoted.organization_id,
  promoted.case_id,
  promoted.application_id,
  promoted.revision,
  gen_random_uuid(),
  'contract_signed',
  promoted.signed_by_user_id,
  promoted.signed_at,
  jsonb_build_object(
    'systemReason', 'phase1_contract_signing_backfill',
    'compatibilityBackfill', true,
    'previousStage', promoted.previous_stage,
    'previousRevision', promoted.previous_revision,
    'result', jsonb_build_object(
      'applicationId', promoted.application_id,
      'stage', 'completed',
      'revision', promoted.revision,
      'signedAt', promoted.signed_at
    )
  )
FROM promoted;

-- Close every non-selected aggregate in a signed case and append the matching
-- revision/event. Historical process rows can be newer than signed_at, hence
-- the monotonic closed_at cutoff.
WITH candidates AS MATERIALIZED (
  SELECT
    process.organization_id,
    process.case_id,
    process.application_id,
    process.stage AS previous_stage,
    process.revision AS previous_revision,
    greatest(contract.signed_at, process.created_at) AS effective_closed_at,
    contract.application_id AS selected_application_id,
    contract.signed_by_user_id
  FROM public.crm_case_contract_selections contract
  JOIN public.crm_mortgage_application_processes process
    ON process.organization_id = contract.organization_id
   AND process.case_id = contract.case_id
   AND process.application_id <> contract.application_id
  WHERE process.stage <> 'closed'
  FOR UPDATE OF process
), closed AS (
  UPDATE public.crm_mortgage_application_processes process
  SET stage = 'closed',
      revision = process.revision + 1,
      closed_at = candidates.effective_closed_at,
      updated_by_user_id = candidates.signed_by_user_id
  FROM candidates
  WHERE process.organization_id = candidates.organization_id
    AND process.case_id = candidates.case_id
    AND process.application_id = candidates.application_id
  RETURNING
    process.organization_id,
    process.case_id,
    process.application_id,
    process.revision,
    candidates.previous_stage,
    candidates.previous_revision,
    candidates.effective_closed_at,
    candidates.selected_application_id,
    candidates.signed_by_user_id
)
INSERT INTO public.crm_mortgage_application_events (
  organization_id, case_id, application_id, aggregate_revision,
  command_id, event_type, actor_user_id, occurred_at, payload
)
SELECT
  closed.organization_id,
  closed.case_id,
  closed.application_id,
  closed.revision,
  gen_random_uuid(),
  'application_closed',
  closed.signed_by_user_id,
  closed.effective_closed_at,
  jsonb_build_object(
    'systemReason', 'phase1_contract_signing_backfill',
    'compatibilityBackfill', true,
    'previousStage', closed.previous_stage,
    'previousRevision', closed.previous_revision,
    'selectedApplicationId', closed.selected_application_id,
    'result', jsonb_build_object(
      'applicationId', closed.application_id,
      'stage', 'closed',
      'revision', closed.revision
    )
  )
FROM closed;

-- Keep the established legacy read model aligned before the command-only
-- lifecycle trigger is installed.
UPDATE public.crm_item_submissions submission
SET status_code = 'zaakceptowane'
FROM public.crm_case_bank_applications application
JOIN public.crm_case_contract_selections contract
  ON contract.organization_id = application.organization_id
 AND contract.case_id = application.case_id
 AND contract.application_id = application.submission_id
WHERE submission.organization_id = application.organization_id
  AND submission.case_item_id = application.case_item_id
  AND submission.id = application.submission_id
  AND submission.status_code IS DISTINCT FROM 'zaakceptowane';

UPDATE public.crm_item_submissions submission
SET status_code = CASE
      WHEN submission.status_code = 'odrzucone' THEN 'odrzucone'
      ELSE 'wycofane'
    END
FROM public.crm_case_bank_applications application
JOIN public.crm_case_contract_selections contract
  ON contract.organization_id = application.organization_id
 AND contract.case_id = application.case_id
 AND contract.application_id <> application.submission_id
WHERE submission.organization_id = application.organization_id
  AND submission.case_item_id = application.case_item_id
  AND submission.id = application.submission_id
  AND submission.status_code IS DISTINCT FROM CASE
    WHEN submission.status_code = 'odrzucone' THEN 'odrzucone'
    ELSE 'wycofane'
  END;

-- From this point generic status/timestamp PATCHes are rejected unless the
-- audited command/signing transaction owns the private capability row.
CREATE TRIGGER crm_item_submissions_guard_mortgage_lifecycle
  BEFORE UPDATE OF status_code, submitted_at, decision_at
  ON public.crm_item_submissions
  FOR EACH ROW EXECUTE FUNCTION private.guard_crm_mortgage_submission_lifecycle();

-- Switch the existing immutable-contract trigger from the phase-1 compatible
-- evidence guard to the strict manager-authorized implementation.
DROP TRIGGER crm_case_contract_selections_guard_insert
  ON public.crm_case_contract_selections;
CREATE TRIGGER crm_case_contract_selections_guard_insert
  BEFORE INSERT ON public.crm_case_contract_selections
  FOR EACH ROW EXECUTE FUNCTION private.guard_crm_case_contract_insert_strict();

CREATE OR REPLACE FUNCTION public.sign_crm_case_contract(
  target_organization_id uuid,
  target_case_id uuid,
  target_application_id uuid
) RETURNS public.crm_case_contract_selections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  result public.crm_case_contract_selections;
BEGIN
  result := public.sign_crm_case_contract_strict(
    target_organization_id, target_case_id, target_application_id
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.sign_crm_case_contract(uuid, uuid, uuid)
  FROM PUBLIC, anonymous, openexpert_service;
GRANT EXECUTE ON FUNCTION public.sign_crm_case_contract(uuid, uuid, uuid)
  TO authenticated, openexpert_owner;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.crm_case_contract_selections
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

COMMENT ON FUNCTION public.sign_crm_case_contract(uuid, uuid, uuid) IS
  'Strict manager-authorized mortgage signing command. Completes the selected aggregate and closes competing applications atomically.';
