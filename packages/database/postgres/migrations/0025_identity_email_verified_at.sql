-- Preserve when the current email address was actually verified. `updated_at`
-- is not suitable for auth claims because unrelated profile changes move it.

ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamp with time zone;

-- Make a retry safe even if an external migration runner previously stopped
-- after creating the trigger but before validating the constraint.
DROP TRIGGER IF EXISTS enforce_identity_email_verified_at
  ON identity.users;

-- Historical rows did not record the verification event. `created_at` is a
-- conservative lower bound: it can look older, but never makes an old
-- verification appear artificially fresh after a later profile update.
UPDATE identity.users
   SET email_verified_at = created_at
 WHERE email_verified = true
   AND email_verified_at IS NULL;

CREATE OR REPLACE FUNCTION private.enforce_identity_email_verified_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF new.email_verified IS NOT TRUE THEN
    new.email_verified_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    new.email_verified_at := statement_timestamp();
  ELSIF old.email_verified IS DISTINCT FROM true
    OR lower(btrim(new.email)) IS DISTINCT FROM lower(btrim(old.email)) THEN
    new.email_verified_at := statement_timestamp();
  ELSE
    -- The timestamp is immutable while the same address remains verified.
    new.email_verified_at := old.email_verified_at;
  END IF;

  RETURN new;
END
$function$;

CREATE TRIGGER enforce_identity_email_verified_at
  BEFORE INSERT OR UPDATE OF email, email_verified, email_verified_at
  ON identity.users
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_identity_email_verified_at();

ALTER TABLE identity.users
  DROP CONSTRAINT IF EXISTS identity_users_email_verified_at_check,
  ADD CONSTRAINT identity_users_email_verified_at_check
    CHECK (email_verified = (email_verified_at IS NOT NULL)) NOT VALID;

ALTER TABLE identity.users
  VALIDATE CONSTRAINT identity_users_email_verified_at_check;

REVOKE ALL ON FUNCTION private.enforce_identity_email_verified_at()
  FROM PUBLIC, anonymous, authenticated, openexpert_service, openexpert_auth;

COMMENT ON COLUMN identity.users.email_verified_at IS
  'Timestamp when the current email address most recently became verified.';
