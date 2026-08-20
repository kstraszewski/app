-- Repair existing OpenExpert Bank records created by migration 0058. The
-- public Vercel project alias is stable even when a custom CRM domain is not
-- configured, while CRM responses still prefer the origin-relative asset.

UPDATE public.mortgage_banks
SET logo_url = 'https://openexpert-crm.vercel.app/assets/openexpert-bank.svg',
    updated_at = statement_timestamp()
WHERE slug = 'openexpert-bank'
  AND is_mock = true
  AND logo_url IS DISTINCT FROM 'https://openexpert-crm.vercel.app/assets/openexpert-bank.svg';
