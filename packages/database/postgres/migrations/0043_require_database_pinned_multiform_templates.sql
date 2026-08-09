ALTER TABLE public.mortgage_product_versions
  ADD COLUMN multiform_template_policy text DEFAULT 'registry_legacy' NOT NULL,
  ADD CONSTRAINT mortgage_product_versions_multiform_template_policy_check
    CHECK (multiform_template_policy IN ('registry_legacy', 'database_pinned'));

COMMENT ON COLUMN public.mortgage_product_versions.multiform_template_policy IS
  'Selects legacy code-registry fallback or a complete immutable set of bank-file-backed template revision pins.';

CREATE OR REPLACE FUNCTION private.pin_mortgage_product_version_document_templates()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  bank_id_value uuid;
  requirement jsonb;
  requirement_code_value text;
  template_key_value text;
  template_revision_id_value uuid;
  pinned_template_keys text[] := '{}'::text[];
  item_index integer := 0;
BEGIN
  SELECT product.bank_id
  INTO bank_id_value
  FROM public.mortgage_products product
  WHERE product.id = NEW.product_id;

  FOR requirement IN
    SELECT item.value
    FROM jsonb_array_elements(coalesce(NEW.document_requirements, '[]'::jsonb)) item
  LOOP
    item_index := item_index + 1;
    template_key_value := nullif(btrim(requirement ->> 'templateId'), '');
    IF template_key_value IS NULL THEN
      CONTINUE;
    END IF;

    IF NEW.multiform_template_policy = 'database_pinned'
      AND NOT template_key_value = ANY(NEW.multiform_template_ids) THEN
      RAISE EXCEPTION 'mortgage_document_template_is_not_declared'
        USING ERRCODE = '23514',
          DETAIL = format(
            'Template %s is referenced by document requirements but missing from multiform_template_ids.',
            template_key_value
          );
    END IF;

    requirement_code_value := coalesce(
      nullif(btrim(requirement ->> 'code'), ''),
      'template-' || item_index::text
    );
    SELECT template.current_published_revision_id
    INTO template_revision_id_value
    FROM public.mortgage_document_templates template
    WHERE template.bank_id = bank_id_value
      AND template.template_key = template_key_value;

    IF template_revision_id_value IS NULL THEN
      IF NEW.calculator_schema_version >= 2
        OR NEW.multiform_template_policy = 'database_pinned' THEN
        RAISE EXCEPTION 'mortgage_document_template_is_not_published'
          USING ERRCODE = '23514',
            DETAIL = format(
              'Template %s is not published for bank %s.',
              template_key_value,
              bank_id_value
            );
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.mortgage_product_version_document_templates (
      product_version_id,
      template_revision_id,
      requirement_code,
      sort_order
    ) VALUES (
      NEW.id,
      template_revision_id_value,
      requirement_code_value,
      item_index
    )
    ON CONFLICT (product_version_id, requirement_code) DO UPDATE
    SET
      template_revision_id = excluded.template_revision_id,
      sort_order = excluded.sort_order;

    pinned_template_keys := array_append(pinned_template_keys, template_key_value);
  END LOOP;

  IF NEW.multiform_template_policy = 'database_pinned' THEN
    IF cardinality(NEW.multiform_template_ids) = 0 THEN
      RAISE EXCEPTION 'mortgage_database_pinned_templates_are_empty'
        USING ERRCODE = '23514';
    END IF;
    IF cardinality(NEW.multiform_template_ids) <> (
      SELECT count(DISTINCT template_key)
      FROM unnest(NEW.multiform_template_ids) template_key
    ) THEN
      RAISE EXCEPTION 'mortgage_database_pinned_templates_contain_duplicates'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM unnest(NEW.multiform_template_ids) template_key
      WHERE NOT template_key = ANY(pinned_template_keys)
    ) THEN
      RAISE EXCEPTION 'mortgage_database_pinned_template_is_missing_requirement'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.pin_mortgage_product_version_document_templates() IS
  'Pins published template revisions on insert and enforces a complete declared set for database_pinned product versions.';
