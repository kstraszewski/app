-- Provider-neutral mailbox connections with multiple accounts per owner.
--
-- Existing Google rows remain valid: OAuth is the default authentication
-- type and every IMAP/SMTP-specific column is nullable for OAuth providers.

ALTER TABLE public.mail_connections
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS auth_type text DEFAULT 'oauth2' NOT NULL,
  ADD COLUMN IF NOT EXISTS encrypted_credentials text,
  ADD COLUMN IF NOT EXISTS imap_host text,
  ADD COLUMN IF NOT EXISTS imap_port integer,
  ADD COLUMN IF NOT EXISTS imap_security text,
  ADD COLUMN IF NOT EXISTS imap_username text,
  ADD COLUMN IF NOT EXISTS smtp_host text,
  ADD COLUMN IF NOT EXISTS smtp_port integer,
  ADD COLUMN IF NOT EXISTS smtp_security text,
  ADD COLUMN IF NOT EXISTS smtp_username text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

-- Keep a rerun safe if a previous attempt added auth_type without completing
-- its default/not-null transition.
UPDATE public.mail_connections
SET auth_type = CASE WHEN provider = 'imap' THEN 'password' ELSE 'oauth2' END
WHERE auth_type IS NULL;

ALTER TABLE public.mail_connections
  ALTER COLUMN auth_type SET DEFAULT 'oauth2',
  ALTER COLUMN auth_type SET NOT NULL;

ALTER TABLE public.mail_connections
  DROP CONSTRAINT IF EXISTS mail_connections_provider_check,
  DROP CONSTRAINT IF EXISTS mail_connections_auth_type_check,
  DROP CONSTRAINT IF EXISTS mail_connections_account_email_format_check,
  DROP CONSTRAINT IF EXISTS mail_connections_display_name_check,
  DROP CONSTRAINT IF EXISTS mail_connections_encrypted_credentials_check,
  DROP CONSTRAINT IF EXISTS mail_connections_imap_host_check,
  DROP CONSTRAINT IF EXISTS mail_connections_imap_username_check,
  DROP CONSTRAINT IF EXISTS mail_connections_smtp_host_check,
  DROP CONSTRAINT IF EXISTS mail_connections_smtp_username_check,
  DROP CONSTRAINT IF EXISTS mail_connections_imap_transport_check,
  DROP CONSTRAINT IF EXISTS mail_connections_smtp_transport_check,
  DROP CONSTRAINT IF EXISTS mail_connections_provider_configuration_check;

ALTER TABLE public.mail_connections
  ADD CONSTRAINT mail_connections_provider_check CHECK (
    provider IN ('google', 'microsoft', 'imap')
  ),
  ADD CONSTRAINT mail_connections_auth_type_check CHECK (
    auth_type IN ('oauth2', 'password')
  ),
  ADD CONSTRAINT mail_connections_account_email_format_check CHECK (
    char_length(account_email) <= 254
    AND account_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    AND account_email !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT mail_connections_display_name_check CHECK (
    display_name IS NULL OR (
      display_name = btrim(display_name)
      AND display_name <> ''
      AND char_length(display_name) <= 160
      AND display_name !~ '[[:cntrl:]]'
    )
  ),
  ADD CONSTRAINT mail_connections_encrypted_credentials_check CHECK (
    encrypted_credentials IS NULL OR (
      encrypted_credentials = btrim(encrypted_credentials)
      AND encrypted_credentials <> ''
      AND char_length(encrypted_credentials) <= 131072
      AND encrypted_credentials !~ '[[:space:]]'
    )
  ),
  ADD CONSTRAINT mail_connections_imap_host_check CHECK (
    imap_host IS NULL OR (
      imap_host = lower(btrim(imap_host))
      AND imap_host <> ''
      AND char_length(imap_host) <= 253
      AND imap_host !~ '[[:space:]/@?#]'
    )
  ),
  ADD CONSTRAINT mail_connections_imap_username_check CHECK (
    imap_username IS NULL OR (
      imap_username = btrim(imap_username)
      AND imap_username <> ''
      AND char_length(imap_username) <= 320
      AND imap_username !~ '[[:cntrl:]]'
    )
  ),
  ADD CONSTRAINT mail_connections_smtp_host_check CHECK (
    smtp_host IS NULL OR (
      smtp_host = lower(btrim(smtp_host))
      AND smtp_host <> ''
      AND char_length(smtp_host) <= 253
      AND smtp_host !~ '[[:space:]/@?#]'
    )
  ),
  ADD CONSTRAINT mail_connections_smtp_username_check CHECK (
    smtp_username IS NULL OR (
      smtp_username = btrim(smtp_username)
      AND smtp_username <> ''
      AND char_length(smtp_username) <= 320
      AND smtp_username !~ '[[:cntrl:]]'
    )
  ),
  ADD CONSTRAINT mail_connections_imap_transport_check CHECK (
    (imap_port IS NULL AND imap_security IS NULL)
    OR (imap_port = 993 AND imap_security = 'tls')
    OR (imap_port = 143 AND imap_security = 'starttls')
  ),
  ADD CONSTRAINT mail_connections_smtp_transport_check CHECK (
    (smtp_port IS NULL AND smtp_security IS NULL)
    OR (smtp_port = 465 AND smtp_security = 'tls')
    OR (smtp_port = 587 AND smtp_security = 'starttls')
  ),
  ADD CONSTRAINT mail_connections_provider_configuration_check CHECK (
    (
      provider IN ('google', 'microsoft')
      AND auth_type = 'oauth2'
      AND encrypted_credentials IS NULL
      AND imap_host IS NULL
      AND imap_port IS NULL
      AND imap_security IS NULL
      AND imap_username IS NULL
      AND smtp_host IS NULL
      AND smtp_port IS NULL
      AND smtp_security IS NULL
      AND smtp_username IS NULL
    )
    OR (
      provider = 'imap'
      AND auth_type = 'password'
      AND encrypted_credentials IS NOT NULL
      AND imap_host IS NOT NULL
      AND imap_port IS NOT NULL
      AND imap_security IS NOT NULL
      AND imap_username IS NOT NULL
      AND smtp_host IS NOT NULL
      AND smtp_port IS NOT NULL
      AND smtp_security IS NOT NULL
      AND smtp_username IS NOT NULL
      AND encrypted_access_token IS NULL
      AND encrypted_refresh_token IS NULL
      AND token_expires_at IS NULL
      AND cardinality(scopes) = 0
    )
  );

DROP INDEX IF EXISTS public.mail_connections_owner_provider_key;

CREATE UNIQUE INDEX IF NOT EXISTS mail_connections_owner_provider_account_key
  ON public.mail_connections (organization_id, owner_user_id, provider, account_id);

-- An idempotency key belongs to one concrete sender connection. The original
-- Gmail-only constraint scoped it to the owner, which incorrectly prevented
-- the same client-generated key from being used independently on another
-- mailbox. Dropping and recreating the constraint is rerun-safe, preserves all
-- existing rows (the new key is less restrictive), and does not touch either
-- composite foreign key.
ALTER TABLE ONLY public.mail_send_requests
  DROP CONSTRAINT IF EXISTS mail_send_requests_idempotency_key;

ALTER TABLE ONLY public.mail_send_requests
  ADD CONSTRAINT mail_send_requests_idempotency_key UNIQUE (
    organization_id,
    owner_user_id,
    connection_id,
    idempotency_key
  );

COMMENT ON TABLE public.mail_connections IS
  'Server-only, application-encrypted credentials and non-secret connection settings for personal Google, Microsoft and IMAP/SMTP mailboxes.';

COMMENT ON COLUMN public.mail_connections.encrypted_credentials IS
  'Application-encrypted, versioned credential envelope for the IMAP and SMTP transports; never returned to clients.';

COMMENT ON COLUMN public.mail_connections.last_verified_at IS
  'Timestamp of the most recent successful provider credential and transport verification.';

COMMENT ON TABLE public.mail_send_requests IS
  'Server-only provider-neutral send idempotency and delivery-state metadata; never stores recipients, subjects, bodies, or attachment filenames.';
