-- WebAuthn public credentials. Private keys never leave the user's
-- authenticator; this table stores only the public verification material.

CREATE TABLE IF NOT EXISTS identity.passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  public_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  counter integer NOT NULL DEFAULT 0 CHECK (counter >= 0),
  device_type text NOT NULL,
  backed_up boolean NOT NULL DEFAULT false,
  transports text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  aaguid text
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_passkeys_credential_id_unique
  ON identity.passkeys (credential_id);
CREATE INDEX IF NOT EXISTS identity_passkeys_user_id_idx
  ON identity.passkeys (user_id);

REVOKE ALL PRIVILEGES ON identity.passkeys
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.passkeys
  TO openexpert_auth;

COMMENT ON TABLE identity.passkeys IS
  'Better Auth WebAuthn public credentials. No private passkey material is stored by OpenExpert.';
COMMENT ON COLUMN identity.passkeys.credential_id IS
  'Globally unique WebAuthn credential identifier.';
