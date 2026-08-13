-- Organization-scoped legal identity used for OFI (art. 17 of the mortgage
-- credit act) and the controller contact block in RODO information notices.
-- Every update creates an immutable revision so a delivered document can be
-- tied to the exact configuration that was active at delivery time.

CREATE TABLE public.organization_intermediary_settings (
  organization_id uuid PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT organization_intermediary_settings_organization_fk
    FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE CASCADE,
  CONSTRAINT organization_intermediary_settings_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE RESTRICT,
  CONSTRAINT organization_intermediary_settings_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES public.users (id) ON DELETE RESTRICT,
  CONSTRAINT organization_intermediary_settings_object_check
    CHECK (jsonb_typeof(settings) = 'object'),
  CONSTRAINT organization_intermediary_settings_revision_check
    CHECK (revision > 0)
);

COMMENT ON TABLE public.organization_intermediary_settings IS
  'Current organization-wide intermediary, OFI and privacy-controller identity. Updates are versioned in organization_intermediary_setting_revisions.';

CREATE TABLE public.organization_intermediary_setting_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  revision bigint NOT NULL,
  settings jsonb NOT NULL,
  changed_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT organization_intermediary_revisions_organization_fk
    FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE CASCADE,
  CONSTRAINT organization_intermediary_revisions_changed_by_fk
    FOREIGN KEY (changed_by) REFERENCES public.users (id) ON DELETE RESTRICT,
  CONSTRAINT organization_intermediary_setting_revisions_unique
    UNIQUE (organization_id, revision),
  CONSTRAINT organization_intermediary_setting_revisions_object_check
    CHECK (jsonb_typeof(settings) = 'object'),
  CONSTRAINT organization_intermediary_setting_revisions_revision_check
    CHECK (revision > 0)
);

COMMENT ON TABLE public.organization_intermediary_setting_revisions IS
  'Immutable audit history for organization intermediary and RODO identity settings.';

CREATE INDEX organization_intermediary_setting_revisions_lookup_idx
  ON public.organization_intermediary_setting_revisions
  (organization_id, created_at DESC);

CREATE FUNCTION private.prepare_organization_intermediary_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := (SELECT app.current_user_id());
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'authenticated_user_required' USING errcode = '42501';
  END IF;

  IF tg_op = 'INSERT' THEN
    new.created_by := actor_id;
    new.updated_by := actor_id;
    new.revision := coalesce((
      SELECT max(history.revision)
      FROM public.organization_intermediary_setting_revisions AS history
      WHERE history.organization_id = new.organization_id
    ), 0) + 1;
    new.created_at := now();
  ELSE
    new.organization_id := old.organization_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := actor_id;
    new.revision := old.revision + 1;
  END IF;

  new.updated_at := now();
  RETURN new;
END
$function$;

CREATE FUNCTION private.audit_organization_intermediary_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.organization_intermediary_setting_revisions (
    organization_id,
    revision,
    settings,
    changed_by
  ) VALUES (
    new.organization_id,
    new.revision,
    new.settings,
    new.updated_by
  );

  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.prepare_organization_intermediary_settings()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION private.audit_organization_intermediary_settings()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER organization_intermediary_settings_prepare
  BEFORE INSERT OR UPDATE ON public.organization_intermediary_settings
  FOR EACH ROW EXECUTE FUNCTION private.prepare_organization_intermediary_settings();

CREATE TRIGGER organization_intermediary_settings_audit
  AFTER INSERT OR UPDATE ON public.organization_intermediary_settings
  FOR EACH ROW EXECUTE FUNCTION private.audit_organization_intermediary_settings();

ALTER TABLE public.organization_intermediary_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_intermediary_setting_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_intermediary_settings_member_read
  ON public.organization_intermediary_settings
  FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));

CREATE POLICY organization_intermediary_settings_admin_insert
  ON public.organization_intermediary_settings
  FOR INSERT TO authenticated
  WITH CHECK (private.is_organization_admin(organization_id));

CREATE POLICY organization_intermediary_settings_admin_update
  ON public.organization_intermediary_settings
  FOR UPDATE TO authenticated
  USING (private.is_organization_admin(organization_id))
  WITH CHECK (private.is_organization_admin(organization_id));

CREATE POLICY organization_intermediary_setting_revisions_admin_read
  ON public.organization_intermediary_setting_revisions
  FOR SELECT TO authenticated
  USING (private.is_organization_admin(organization_id));

CREATE POLICY organization_intermediary_settings_service_read
  ON public.organization_intermediary_settings
  FOR SELECT TO openexpert_service
  USING (true);

CREATE POLICY organization_intermediary_setting_revisions_service_read
  ON public.organization_intermediary_setting_revisions
  FOR SELECT TO openexpert_service
  USING (true);

REVOKE ALL ON TABLE public.organization_intermediary_settings
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.organization_intermediary_setting_revisions
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.organization_intermediary_settings TO authenticated;
GRANT SELECT
  ON TABLE public.organization_intermediary_setting_revisions TO authenticated;
GRANT SELECT
  ON TABLE public.organization_intermediary_settings TO openexpert_service;
GRANT SELECT
  ON TABLE public.organization_intermediary_setting_revisions TO openexpert_service;
