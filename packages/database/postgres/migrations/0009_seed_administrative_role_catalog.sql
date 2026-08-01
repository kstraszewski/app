-- The portable schema migration intentionally contains only DDL. Restore the
-- administrative role catalog that used to live in the historical Supabase
-- migration so clean PostgreSQL installations can resolve permissions.

insert into public.administrative_roles (
  role_key,
  label,
  description,
  risk_level,
  sort_order
)
values
  (
    'organization_admin',
    'Administrator organizacji',
    'Zarządza organizacją, użytkownikami, strukturą i ustawieniami operacyjnymi bez prawa do edycji lub publikacji definicji zgód.',
    'standard',
    10
  ),
  (
    'access_admin',
    'Administrator dostępów',
    'Zaprasza użytkowników, nadaje role administracyjne i zarządza bezpośrednimi grantami.',
    'standard',
    20
  ),
  (
    'structure_admin',
    'Administrator struktury',
    'Zarządza zespołami, hierarchią oraz placówkami organizacji.',
    'standard',
    30
  ),
  (
    'consents_admin',
    'Administrator zgód',
    'Tworzy i edytuje robocze definicje zgód bez prawa do samodzielnej publikacji.',
    'sensitive',
    40
  ),
  (
    'crm_config_admin',
    'Administrator ustawień operacyjnych',
    'Zarządza założeniami zdolności i wspólnymi parametrami usług.',
    'standard',
    50
  )
on conflict (role_key) do update
set
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  sort_order = excluded.sort_order;

insert into public.administrative_role_permissions (role_key, permission_key)
values
  ('organization_admin', 'organization.settings.manage'),
  ('organization_admin', 'iam.members.read'),
  ('organization_admin', 'iam.members.manage'),
  ('organization_admin', 'iam.roles.manage'),
  ('organization_admin', 'iam.grants.manage'),
  ('organization_admin', 'iam.grants.approve'),
  ('organization_admin', 'iam.audit.read'),
  ('organization_admin', 'structure.read'),
  ('organization_admin', 'structure.manage'),
  ('organization_admin', 'crm.configuration.read'),
  ('organization_admin', 'crm.configuration.manage'),
  ('organization_admin', 'privacy.requests.read'),
  ('organization_admin', 'privacy.grants.request'),
  ('organization_admin', 'privacy.grants.approve'),
  ('access_admin', 'iam.members.read'),
  ('access_admin', 'iam.members.manage'),
  ('access_admin', 'iam.roles.manage'),
  ('access_admin', 'iam.grants.manage'),
  ('access_admin', 'iam.grants.approve'),
  ('access_admin', 'iam.audit.read'),
  ('access_admin', 'privacy.requests.read'),
  ('access_admin', 'privacy.grants.request'),
  ('access_admin', 'privacy.grants.approve'),
  ('structure_admin', 'structure.read'),
  ('structure_admin', 'structure.manage'),
  ('consents_admin', 'compliance.consents.definitions.read'),
  ('consents_admin', 'compliance.consents.definitions.manage'),
  ('consents_admin', 'compliance.consents.audit.read'),
  ('consents_admin', 'privacy.requests.read'),
  ('consents_admin', 'privacy.grants.approve'),
  ('crm_config_admin', 'crm.configuration.read'),
  ('crm_config_admin', 'crm.configuration.manage')
on conflict (role_key, permission_key) do nothing;
