-- Schema-independent seed data belongs here.
-- The reproducible local Auth account is created through the official
-- Supabase Admin API by 'pnpm db:setup', after migrations and this seed run.

-- Idempotently provision the three baseline, channel-specific marketing
-- consents for organizations that already exist when seeding runs. New
-- organizations receive the same set from the database provisioning trigger.
select private.provision_default_crm_consents(organization.id)
from public.organizations organization;
