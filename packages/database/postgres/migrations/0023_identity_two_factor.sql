-- TOTP secrets and recovery codes are encrypted by Better Auth before they
-- reach PostgreSQL. They remain isolated in the private identity schema.

ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS identity.two_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  verified boolean NOT NULL DEFAULT true,
  failed_verification_count integer NOT NULL DEFAULT 0
    CHECK (failed_verification_count >= 0),
  locked_until timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_two_factors_user_id_unique
  ON identity.two_factors (user_id);
CREATE INDEX IF NOT EXISTS identity_two_factors_secret_idx
  ON identity.two_factors (secret);

REVOKE ALL PRIVILEGES ON identity.two_factors
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.two_factors
  TO openexpert_auth;

COMMENT ON COLUMN identity.users.two_factor_enabled IS
  'True after the user verifies the first TOTP code during 2FA enrollment.';
COMMENT ON TABLE identity.two_factors IS
  'Better Auth TOTP configuration, encrypted recovery codes, and lockout state.';
