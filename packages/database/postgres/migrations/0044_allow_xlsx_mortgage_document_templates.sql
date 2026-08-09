-- Multiwniosek supports reviewed native XLSX templates in addition to PDFs.
CREATE OR REPLACE FUNCTION public.create_mortgage_document_template_from_bank_file(
  p_file_id uuid,
  p_version_id uuid,
  p_template_key text,
  p_label text,
  p_template_json jsonb,
  p_validation_report jsonb,
  p_actor_user_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  file_record public.mortgage_bank_files%rowtype;
  version_record public.mortgage_bank_file_versions%rowtype;
  bank_slug text;
  template_record public.mortgage_document_templates%rowtype;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.platform_user_roles role
    WHERE role.user_id = p_actor_user_id
      AND role.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'super_admin_actor_required' USING ERRCODE = '42501';
  END IF;

  SELECT file.*
  INTO file_record
  FROM public.mortgage_bank_files file
  WHERE file.id = p_file_id
    AND file.archived_at IS NULL
  FOR UPDATE;

  IF file_record.id IS NULL THEN
    RAISE EXCEPTION 'mortgage_bank_file_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF file_record.current_version_id IS DISTINCT FROM p_version_id THEN
    RAISE EXCEPTION 'mortgage_bank_file_version_is_not_current' USING ERRCODE = '40001';
  END IF;

  SELECT version.*
  INTO version_record
  FROM public.mortgage_bank_file_versions version
  WHERE version.id = p_version_id
    AND version.file_id = p_file_id;

  IF version_record.id IS NULL THEN
    RAISE EXCEPTION 'mortgage_bank_file_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF version_record.mime_type NOT IN (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    OR version_record.status <> 'current' THEN
    RAISE EXCEPTION 'mortgage_bank_file_version_not_template_ready' USING ERRCODE = '23514';
  END IF;

  SELECT template.*
  INTO template_record
  FROM public.mortgage_document_templates template
  WHERE template.source_file_version_id = p_version_id;

  IF template_record.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', template_record.id,
      'templateKey', template_record.template_key,
      'draftRevision', template_record.draft_revision,
      'created', false
    );
  END IF;

  SELECT bank.slug
  INTO bank_slug
  FROM public.mortgage_banks bank
  WHERE bank.id = file_record.bank_id;

  IF p_template_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    OR char_length(p_template_key) > 120
    OR btrim(p_label) = ''
    OR jsonb_typeof(p_template_json) <> 'object'
    OR jsonb_typeof(p_validation_report) <> 'object'
    OR p_template_json ->> 'id' IS DISTINCT FROM p_template_key
    OR p_template_json ->> 'bank' IS DISTINCT FROM bank_slug
    OR p_template_json #>> '{source,fileName}' IS DISTINCT FROM version_record.original_file_name
    OR p_template_json #>> '{source,sha256}' IS DISTINCT FROM version_record.checksum_sha256
    OR (
      version_record.mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      AND p_template_json #>> '{fillMethod,kind}' NOT IN ('xlsx_native', 'xlsx_manual')
    )
    OR (
      version_record.mime_type = 'application/pdf'
      AND p_template_json #>> '{fillMethod,kind}' IN ('xlsx_native', 'xlsx_manual')
    ) THEN
    RAISE EXCEPTION 'invalid_mortgage_bank_file_template' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.mortgage_document_templates (
    bank_id,
    template_key,
    label,
    source_file_name,
    source_sha256,
    source_file_id,
    source_file_version_id,
    registry_version,
    draft_json,
    draft_validation_report,
    draft_revision,
    draft_updated_at,
    draft_updated_by_user_id,
    created_by_user_id
  ) VALUES (
    file_record.bank_id,
    p_template_key,
    p_label,
    version_record.original_file_name,
    version_record.checksum_sha256,
    p_file_id,
    p_version_id,
    1,
    p_template_json,
    p_validation_report,
    1,
    now(),
    p_actor_user_id,
    p_actor_user_id
  )
  RETURNING * INTO template_record;

  INSERT INTO public.mortgage_document_template_revisions (
    template_id,
    action,
    revision,
    template_json,
    validation_report,
    actor_user_id
  ) VALUES (
    template_record.id,
    'draft_saved',
    1,
    p_template_json,
    p_validation_report,
    p_actor_user_id
  );

  INSERT INTO public.mortgage_bank_file_events (
    file_id,
    version_id,
    actor_user_id,
    action,
    metadata
  ) VALUES (
    p_file_id,
    p_version_id,
    p_actor_user_id,
    'template.created',
    jsonb_build_object(
      'templateId', template_record.id,
      'templateKey', template_record.template_key
    )
  );

  RETURN jsonb_build_object(
    'id', template_record.id,
    'templateKey', template_record.template_key,
    'draftRevision', 1,
    'created', true
  );
END;
$$;

COMMENT ON FUNCTION public.create_mortgage_document_template_from_bank_file(
  uuid, uuid, text, text, jsonb, jsonb, uuid
) IS 'Creates a reviewed PDF or XLSX Multiwniosek draft from the exact current Bank Files version.';
