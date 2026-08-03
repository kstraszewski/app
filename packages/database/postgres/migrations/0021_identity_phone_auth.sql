-- Verified phone numbers are identity credentials, not CRM contact data.
-- They stay in the private Better Auth schema and are never backfilled from
-- public profiles because existing contact numbers were not verified for login.

ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS phone_number_verified boolean NOT NULL DEFAULT false;

ALTER TABLE identity.users
  DROP CONSTRAINT IF EXISTS identity_users_phone_number_format_check,
  ADD CONSTRAINT identity_users_phone_number_format_check
    CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  DROP CONSTRAINT IF EXISTS identity_users_phone_verification_check,
  ADD CONSTRAINT identity_users_phone_verification_check
    CHECK (phone_number IS NOT NULL OR phone_number_verified = false);

CREATE UNIQUE INDEX IF NOT EXISTS identity_users_phone_number_unique
  ON identity.users (phone_number)
  WHERE phone_number IS NOT NULL;

COMMENT ON COLUMN identity.users.phone_number IS
  'Verified E.164 login identifier. Separate from organization contact/profile phone numbers.';
COMMENT ON COLUMN identity.users.phone_number_verified IS
  'True only after successful Better Auth phone-number OTP verification.';
