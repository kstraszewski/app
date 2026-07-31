\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE openexpert_owner;

CREATE TABLE app.__rls_context_smoke (
  user_id uuid PRIMARY KEY,
  marker text NOT NULL
);

INSERT INTO app.__rls_context_smoke (user_id, marker)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'visible'),
  ('22222222-2222-4222-8222-222222222222', 'hidden');

ALTER TABLE app.__rls_context_smoke ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.__rls_context_smoke FORCE ROW LEVEL SECURITY;
CREATE POLICY own_row_only
  ON app.__rls_context_smoke
  FOR SELECT
  TO authenticated
  USING (user_id = app.current_user_id());
GRANT SELECT ON app.__rls_context_smoke TO authenticated;

RESET ROLE;
SET LOCAL ROLE openexpert_service;
SELECT app.set_request_context('11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;

DO $smoke$
DECLARE
  visible_markers text[];
BEGIN
  SELECT array_agg(marker ORDER BY marker)
  INTO visible_markers
  FROM app.__rls_context_smoke;

  IF visible_markers IS DISTINCT FROM ARRAY['visible']::text[] THEN
    RAISE EXCEPTION 'RLS context leaked rows: %', visible_markers;
  END IF;

  IF app.current_user_id() IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'::uuid
    OR nullif(auth.user_id()::text, '')::uuid
      IS DISTINCT FROM app.current_user_id()
  THEN
    RAISE EXCEPTION 'application/provider identity boundary failed';
  END IF;
END
$smoke$;

ROLLBACK;

BEGIN;
SET LOCAL ROLE openexpert_service;
SELECT app.set_request_context('11111111-1111-4111-8111-111111111111');
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222"}',
  true
);

DO $smoke$
BEGIN
  IF app.current_user_id() IS DISTINCT FROM '22222222-2222-4222-8222-222222222222'::uuid
  THEN
    RAISE EXCEPTION 'request.jwt.claims did not override app.user_id';
  END IF;
END
$smoke$;

SELECT set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  true
);

DO $smoke$
BEGIN
  IF app.current_user_id() IS DISTINCT FROM '33333333-3333-4333-8333-333333333333'::uuid
  THEN
    RAISE EXCEPTION 'request.jwt.claim.sub did not take precedence';
  END IF;
END
$smoke$;

ROLLBACK;

BEGIN;
SET LOCAL ROLE openexpert_service;
SELECT app.set_request_context('11111111-1111-4111-8111-111111111111');
COMMIT;

DO $smoke$
BEGIN
  IF app.current_user_id() IS NOT NULL THEN
    RAISE EXCEPTION 'app.user_id escaped its transaction';
  END IF;
END
$smoke$;

SELECT 'ok transaction-local RLS context' AS smoke_result;
