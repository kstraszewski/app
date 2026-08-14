-- Run after phase-1 migrations + 0049 smoke + 0051 in one disposable transaction.
DO $mortgage_strict_smoke$
DECLARE
  signed_contract public.crm_case_contract_selections%rowtype;
  untouched_draft record;
  actor_id uuid;
  actual_count integer;
BEGIN
  SELECT contract.* INTO signed_contract
  FROM public.crm_case_contract_selections contract
  JOIN public.crm_mortgage_application_events event
    ON event.organization_id = contract.organization_id
   AND event.case_id = contract.case_id
   AND event.application_id = contract.application_id
   AND event.event_type = 'contract_signed'
   AND event.payload ->> 'compatibilityProjection' = 'true'
  ORDER BY contract.signed_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_0051_phase1_contract_fixture_missing';
  END IF;
  actor_id := signed_contract.signed_by_user_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_processes process
    JOIN public.crm_mortgage_application_events event
      ON event.organization_id = process.organization_id
     AND event.case_id = process.case_id
     AND event.application_id = process.application_id
     AND event.aggregate_revision = process.revision
     AND event.event_type = 'contract_signed'
    WHERE process.organization_id = signed_contract.organization_id
      AND process.case_id = signed_contract.case_id
      AND process.application_id = signed_contract.application_id
      AND process.stage = 'completed'
  ) THEN
    RAISE EXCEPTION 'mortgage_0051_signed_projection_not_preserved';
  END IF;

  SELECT count(*) INTO actual_count
  FROM public.crm_case_contract_selections contract
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_events event
    WHERE event.organization_id = contract.organization_id
      AND event.case_id = contract.case_id
      AND event.application_id = contract.application_id
      AND event.event_type = 'contract_signed'
  );
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'mortgage_0051_contract_backfill_left_ledger_gaps: %', actual_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.crm_item_submissions'::regclass
      AND trigger_row.tgname = 'crm_item_submissions_sync_mortgage_legacy_status'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.crm_item_submissions'::regclass
      AND trigger_row.tgname = 'crm_item_submissions_guard_mortgage_lifecycle'
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'mortgage_0051_lifecycle_trigger_swap_failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.crm_case_contract_selections'::regclass
      AND trigger_row.tgname = 'crm_case_contract_selections_project_mortgage_process'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.crm_case_contract_selections'::regclass
      AND trigger_row.tgname = 'crm_case_contract_selections_guard_insert'
      AND trigger_row.tgfoid =
        'private.guard_crm_case_contract_insert_strict()'::regprocedure
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'mortgage_0051_contract_trigger_swap_failed';
  END IF;

  IF has_table_privilege(
    'authenticated', 'public.crm_case_contract_selections', 'INSERT'
  ) OR has_table_privilege(
    'authenticated', 'public.crm_case_contract_selections', 'UPDATE'
  ) OR has_table_privilege(
    'authenticated', 'public.crm_case_contract_selections', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'mortgage_0051_authenticated_contract_dml_still_granted';
  END IF;
  IF NOT has_function_privilege(
    'authenticated', 'public.sign_crm_case_contract(uuid,uuid,uuid)', 'EXECUTE'
  ) OR has_function_privilege(
    'openexpert_service', 'public.sign_crm_case_contract(uuid,uuid,uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'mortgage_0051_sign_rpc_acl_invalid';
  END IF;

  PERFORM set_config('app.user_id', actor_id::text, true);
  BEGIN
    UPDATE public.crm_item_submissions submission
    SET decision_at = coalesce(submission.decision_at, clock_timestamp())
                      + interval '1 second'
    FROM public.crm_case_bank_applications application
    WHERE application.organization_id = signed_contract.organization_id
      AND application.case_id = signed_contract.case_id
      AND application.submission_id = signed_contract.application_id
      AND submission.organization_id = application.organization_id
      AND submission.case_item_id = application.case_item_id
      AND submission.id = application.submission_id;
    RAISE EXCEPTION 'mortgage_0051_generic_lifecycle_patch_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mortgage_submission_lifecycle_requires_audited_command' THEN RAISE; END IF;
  END;

  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.sign_crm_case_contract(
      signed_contract.organization_id,
      signed_contract.case_id,
      signed_contract.application_id
    );
    RAISE EXCEPTION 'mortgage_0051_duplicate_strict_sign_was_accepted';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'A credit agreement has already been signed for this CRM case' THEN RAISE; END IF;
  END;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';

  SELECT
    application.organization_id,
    application.case_id,
    application.case_item_id,
    application.submission_id AS application_id
  INTO untouched_draft
  FROM public.crm_case_bank_applications application
  JOIN public.crm_item_submissions submission
    ON submission.organization_id = application.organization_id
   AND submission.case_item_id = application.case_item_id
   AND submission.id = application.submission_id
  JOIN public.crm_mortgage_application_processes process
    ON process.organization_id = application.organization_id
   AND process.case_id = application.case_id
   AND process.application_id = application.submission_id
  WHERE application.organization_id = signed_contract.organization_id
    AND submission.status_code = 'draft'
    AND process.stage = 'pre_application'
    AND process.revision = 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.crm_case_contract_selections contract
      WHERE contract.organization_id = application.organization_id
        AND contract.case_id = application.case_id
    )
  ORDER BY application.created_at
  LIMIT 1;
  IF untouched_draft.application_id IS NULL THEN
    RAISE EXCEPTION 'mortgage_0051_untouched_draft_fixture_missing';
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    DELETE FROM public.crm_item_submissions submission
    WHERE submission.organization_id = untouched_draft.organization_id
      AND submission.case_item_id = untouched_draft.case_item_id
      AND submission.id = untouched_draft.application_id;
    RAISE EXCEPTION 'mortgage_0051_authenticated_draft_delete_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mortgage_application_delete_requires_internal_role' THEN RAISE; END IF;
  END;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';

  BEGIN
    DELETE FROM public.crm_item_submissions submission
    WHERE submission.organization_id = untouched_draft.organization_id
      AND submission.case_item_id = untouched_draft.case_item_id
      AND submission.id = untouched_draft.application_id;
    RAISE EXCEPTION 'mortgage_0051_internal_untouched_delete_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'mortgage_0051_internal_untouched_delete_rollback' THEN RAISE; END IF;
  END;
END;
$mortgage_strict_smoke$;
