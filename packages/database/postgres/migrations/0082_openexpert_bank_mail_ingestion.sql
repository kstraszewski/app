-- Enable the synthetic OpenExpert Bank sender identity and distinguish durable
-- thread links created after a strong, trusted EVE proposal from human links.

INSERT INTO public.mortgage_bank_email_identities (
  bank_id,
  sender_domain,
  allow_subdomains,
  authentication_policy,
  is_active
)
SELECT
  bank.id,
  'openexpert.app',
  false,
  'dmarc_aligned',
  true
FROM public.mortgage_banks AS bank
WHERE bank.slug = 'openexpert-bank'
  AND bank.is_mock
ON CONFLICT (sender_domain) DO UPDATE
SET is_active = true,
    updated_at = statement_timestamp()
WHERE public.mortgage_bank_email_identities.bank_id = EXCLUDED.bank_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.mortgage_bank_email_identities AS identity
    JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
    WHERE identity.sender_domain = 'openexpert.app'
      AND identity.is_active
      AND bank.slug = 'openexpert-bank'
      AND bank.is_mock
  ) THEN
    RAISE EXCEPTION 'openexpert_bank_mail_identity_not_configured'
      USING errcode = '23505';
  END IF;
END;
$$;

ALTER TABLE public.mail_context_thread_links
  DROP CONSTRAINT mail_context_thread_links_source_check;

ALTER TABLE public.mail_context_thread_links
  ADD CONSTRAINT mail_context_thread_links_source_check CHECK (
    link_source IN ('manual', 'sent_from_context', 'bank_mail_agent')
  );

COMMENT ON COLUMN public.mail_context_thread_links.link_source IS
  'Origin of the durable thread link: explicit user action, contextual send, or a trusted strong bank-mail EVE proposal.';
