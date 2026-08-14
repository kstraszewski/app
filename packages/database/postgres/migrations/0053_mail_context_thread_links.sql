-- Durable, provider-neutral links between mailbox threads and CRM context.
--
-- The table intentionally stores no message content, subject, snippet,
-- participants or recipient addresses. `thread_reference` is the latest
-- opaque provider reference required to reopen the thread, while
-- `thread_key_hash` is a stable, non-reversible identity used for matching.

CREATE TABLE public.mail_context_thread_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  thread_key_hash text NOT NULL,
  thread_reference text NOT NULL,
  client_id uuid,
  case_id uuid,
  link_source text DEFAULT 'manual'::text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_context_thread_links_context_check CHECK (
    num_nonnulls(client_id, case_id) = 1
  ),
  CONSTRAINT mail_context_thread_links_hash_check CHECK (
    thread_key_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_context_thread_links_reference_check CHECK (
    btrim(thread_reference) <> ''
    AND char_length(thread_reference) <= 4096
    AND thread_reference !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mail_context_thread_links_source_check CHECK (
    link_source IN ('manual', 'sent_from_context')
  ),
  CONSTRAINT mail_context_thread_links_connection_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    connection_id
  ) REFERENCES public.mail_connections (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_context_thread_links_client_fkey FOREIGN KEY (
    organization_id,
    client_id
  ) REFERENCES public.crm_clients (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_context_thread_links_case_fkey FOREIGN KEY (
    organization_id,
    case_id
  ) REFERENCES public.crm_cases (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_context_thread_links_scope_unique UNIQUE NULLS NOT DISTINCT (
    organization_id,
    owner_user_id,
    connection_id,
    thread_key_hash,
    client_id,
    case_id
  )
);

CREATE INDEX mail_context_thread_links_client_idx
  ON public.mail_context_thread_links (
    organization_id,
    owner_user_id,
    connection_id,
    client_id,
    updated_at DESC
  )
  WHERE client_id IS NOT NULL;

CREATE INDEX mail_context_thread_links_case_idx
  ON public.mail_context_thread_links (
    organization_id,
    owner_user_id,
    connection_id,
    case_id,
    updated_at DESC
  )
  WHERE case_id IS NOT NULL;

CREATE TRIGGER mail_context_thread_links_set_updated_at
  BEFORE UPDATE ON public.mail_context_thread_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.mail_context_thread_links IS
  'Server-only durable CRM context links for mailbox threads; stores provider identifiers only and never message metadata or content.';

COMMENT ON COLUMN public.mail_context_thread_links.thread_key_hash IS
  'SHA-256 of a provider-specific stable thread identity; never an email address or message content.';

COMMENT ON COLUMN public.mail_context_thread_links.thread_reference IS
  'Latest opaque provider reference needed to reopen the thread; never a subject, participant, recipient or message body.';

ALTER TABLE public.mail_context_thread_links ENABLE ROW LEVEL SECURITY;

-- Every caller reaches this table only after the Nitro API has validated the
-- Better Auth session, organization, mailbox owner and CRM scope. The service
-- role deliberately does not bypass RLS, so it needs an explicit policy.
CREATE POLICY openexpert_service_all
  ON public.mail_context_thread_links
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.mail_context_thread_links
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mail_context_thread_links
  TO openexpert_service;
