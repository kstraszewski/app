-- Better Auth and OpenExpert auth entry points share this private,
-- database-backed limiter. PostgreSQL serializes increments per key, so limits
-- remain effective across serverless instances and application deployments.

CREATE TABLE IF NOT EXISTS identity.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  last_request bigint NOT NULL CHECK (last_request >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_rate_limits_key_unique
  ON identity.rate_limits (key);
CREATE INDEX IF NOT EXISTS identity_rate_limits_last_request_idx
  ON identity.rate_limits (last_request);

REVOKE ALL PRIVILEGES ON identity.rate_limits
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.rate_limits
  TO openexpert_auth;

COMMENT ON TABLE identity.rate_limits IS
  'Short-lived, multi-instance rate-limit counters for Better Auth and OpenExpert auth endpoints.';
COMMENT ON COLUMN identity.rate_limits.last_request IS
  'Epoch milliseconds used as the active rate-limit window timestamp.';
