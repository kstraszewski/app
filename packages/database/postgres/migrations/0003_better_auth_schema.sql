-- Better Auth 1.6.25, explicitly mapped to plural snake_case tables in the
-- private identity schema. Only the dedicated auth connection and the trusted
-- application service can access identity data.

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_users_email_unique
  ON identity.users (lower(email));

CREATE TABLE IF NOT EXISTS identity.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS better_auth_sessions_token_key
  ON identity.sessions (token);
CREATE INDEX IF NOT EXISTS better_auth_sessions_user_id_idx
  ON identity.sessions (user_id);
CREATE INDEX IF NOT EXISTS better_auth_sessions_expires_at_idx
  ON identity.sessions (expires_at);

CREATE TABLE IF NOT EXISTS identity.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamp with time zone,
  refresh_token_expires_at timestamp with time zone,
  scope text,
  password text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS better_auth_accounts_provider_account_key
  ON identity.accounts (provider_id, account_id);
CREATE INDEX IF NOT EXISTS better_auth_accounts_user_id_idx
  ON identity.accounts (user_id);

CREATE TABLE IF NOT EXISTS identity.verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS better_auth_verifications_identifier_idx
  ON identity.verifications (identifier);
CREATE INDEX IF NOT EXISTS better_auth_verifications_expires_at_idx
  ON identity.verifications (expires_at);

CREATE TABLE IF NOT EXISTS identity.jwks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key text NOT NULL,
  private_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS better_auth_jwks_created_at_idx
  ON identity.jwks (created_at DESC);

CREATE OR REPLACE FUNCTION private.provision_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (new.id, nullif(btrim(new.name), ''))
  ON CONFLICT (id) DO UPDATE
  SET display_name = coalesce(
    public.profiles.display_name,
    excluded.display_name
  );

  RETURN new;
END
$function$;

DROP TRIGGER IF EXISTS on_identity_user_created ON identity.users;
CREATE TRIGGER on_identity_user_created
  AFTER INSERT ON identity.users
  FOR EACH ROW
  EXECUTE FUNCTION private.provision_auth_user();

REVOKE ALL ON FUNCTION private.provision_auth_user()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA identity
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA identity
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT USAGE ON SCHEMA identity TO openexpert_auth, openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON identity.users,
     identity.sessions,
     identity.accounts,
     identity.verifications,
     identity.jwks
  TO openexpert_auth;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA identity
  TO openexpert_auth;

-- Backend jobs may provision and inspect identities, but sessions,
-- credentials, verifications, and private signing keys remain isolated behind
-- the dedicated Better Auth connection.
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.users
  TO openexpert_service;
