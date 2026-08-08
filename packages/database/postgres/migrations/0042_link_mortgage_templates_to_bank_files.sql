-- Every newly created Multiwniosek template is grounded in an immutable
-- version from the bank-file repository. Nullable columns preserve the three
-- historical templates that were previously shipped only as code assets.
ALTER TABLE public.mortgage_document_templates
  ADD COLUMN source_file_id uuid,
  ADD COLUMN source_file_version_id uuid;

WITH candidates AS (
  SELECT
    template.id AS template_id,
    file.id AS file_id,
    version.id AS version_id,
    row_number() OVER (
      PARTITION BY template.id
      ORDER BY
        (file.current_version_id = version.id) DESC,
        version.created_at DESC,
        version.id
    ) AS position
  FROM public.mortgage_document_templates template
  JOIN public.mortgage_bank_files file
    ON file.bank_id = template.bank_id
   AND file.archived_at IS NULL
  JOIN public.mortgage_bank_file_versions version
    ON version.file_id = file.id
   AND version.checksum_sha256 = template.source_sha256
), selected AS (
  SELECT
    candidate.*,
    row_number() OVER (
      PARTITION BY candidate.version_id
      ORDER BY candidate.template_id
    ) AS source_position
  FROM candidates candidate
  WHERE candidate.position = 1
)
UPDATE public.mortgage_document_templates template
SET
  source_file_id = selected.file_id,
  source_file_version_id = selected.version_id
FROM selected
WHERE selected.template_id = template.id
  AND selected.source_position = 1;

ALTER TABLE public.mortgage_document_templates
  ADD CONSTRAINT mortgage_document_templates_source_pair_check
    CHECK (
      (source_file_id IS NULL AND source_file_version_id IS NULL)
      OR (source_file_id IS NOT NULL AND source_file_version_id IS NOT NULL)
    ),
  ADD CONSTRAINT mortgage_document_templates_source_file_id_fkey
    FOREIGN KEY (source_file_id)
    REFERENCES public.mortgage_bank_files(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT mortgage_document_templates_source_file_version_id_fkey
    FOREIGN KEY (source_file_version_id)
    REFERENCES public.mortgage_bank_file_versions(id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX mortgage_document_templates_source_file_version_unique
  ON public.mortgage_document_templates(source_file_version_id)
  WHERE source_file_version_id IS NOT NULL;

CREATE FUNCTION private.validate_mortgage_document_template_source_relation()
RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
DECLARE
  source_bank_id uuid;
  version_file_id uuid;
  version_file_name text;
  version_sha256 text;
BEGIN
  IF NEW.source_file_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT file.bank_id
  INTO source_bank_id
  FROM public.mortgage_bank_files file
  WHERE file.id = NEW.source_file_id
    AND file.archived_at IS NULL;

  SELECT version.file_id, version.original_file_name, version.checksum_sha256
  INTO version_file_id, version_file_name, version_sha256
  FROM public.mortgage_bank_file_versions version
  WHERE version.id = NEW.source_file_version_id;

  IF source_bank_id IS NULL OR source_bank_id <> NEW.bank_id THEN
    RAISE EXCEPTION 'mortgage_template_source_bank_mismatch' USING ERRCODE = '23514';
  END IF;
  IF version_file_id IS NULL OR version_file_id <> NEW.source_file_id THEN
    RAISE EXCEPTION 'mortgage_template_source_version_mismatch' USING ERRCODE = '23514';
  END IF;
  IF version_file_name <> NEW.source_file_name OR version_sha256 <> NEW.source_sha256 THEN
    RAISE EXCEPTION 'mortgage_template_source_metadata_mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_mortgage_document_template_source_relation()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER validate_mortgage_document_template_source_relation
  BEFORE INSERT OR UPDATE OF
    bank_id,
    source_file_id,
    source_file_version_id,
    source_file_name,
    source_sha256
  ON public.mortgage_document_templates
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_mortgage_document_template_source_relation();

CREATE OR REPLACE FUNCTION private.validate_mortgage_product_version_document_template()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.mortgage_document_template_revisions revision
    JOIN public.mortgage_document_templates template
      ON template.id = revision.template_id
    JOIN public.mortgage_product_versions version
      ON version.id = NEW.product_version_id
    JOIN public.mortgage_products product
      ON product.id = version.product_id
    WHERE revision.id = NEW.template_revision_id
      AND revision.action = 'published'
      AND template.bank_id = product.bank_id
      AND template.source_file_id IS NOT NULL
      AND template.source_file_version_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'mortgage_product_version_template_pin_is_invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.validate_mortgage_product_version_document_template() IS
  'Requires product versions to pin a published template revision for the same bank and an immutable bank-file source version.';

CREATE FUNCTION public.create_mortgage_document_template_from_bank_file(
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
  IF version_record.mime_type <> 'application/pdf'
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
    OR p_template_json #>> '{source,sha256}' IS DISTINCT FROM version_record.checksum_sha256 THEN
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

REVOKE ALL ON FUNCTION public.create_mortgage_document_template_from_bank_file(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.create_mortgage_document_template_from_bank_file(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  uuid
) TO openexpert_service;

COMMENT ON COLUMN public.mortgage_document_templates.source_file_id IS
  'Logical bank-repository file from which this Multiwniosek template was created.';
COMMENT ON COLUMN public.mortgage_document_templates.source_file_version_id IS
  'Immutable bank-file version used for editing, validation and document generation.';
