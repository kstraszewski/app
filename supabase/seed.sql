-- Schema-independent seed data belongs here.
-- The reproducible local Auth account is created through the official
-- Supabase Admin API by 'pnpm db:setup', after migrations and this seed run.
-- Organization-dependent demo data (the Szczecin facility and its teams) is
-- provisioned idempotently by that same post-seed step. It can also be applied
-- without resetting the database through `pnpm db:seed-demo`.

-- Idempotently provision the three baseline, channel-specific marketing
-- consents for organizations that already exist when seeding runs. New
-- organizations receive the same set from the database provisioning trigger.
select private.provision_default_crm_consents(organization.id)
from public.organizations organization;
