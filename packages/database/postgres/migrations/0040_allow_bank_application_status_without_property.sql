-- A bank application may proceed before the property calculation is available.
-- The Multiwniosek workflow validates the document and form requirements separately.
DROP TRIGGER IF EXISTS crm_item_submissions_require_bank_application_snapshot_to_start
  ON public.crm_item_submissions;
